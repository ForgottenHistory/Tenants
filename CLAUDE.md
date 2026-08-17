# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project Overview

**Tenants** — a visual-novel-flavored management sim. You own a house, tenants
arrive and leave on leases, and the experience is built around living alongside a
rotating cast of characters.

Built on the DynamicTavern codebase: the chat engine, character cards, world
state, and LLM plumbing are retained; the sandbox exploration layer was removed
and replaced by a purpose-built house/day-cycle game layer.

## Rules

- Don't git commit without permission
- Don't add features that were not part of original request
- Don't hardcode in arbitrary limits
- Styling needs to be consistent. Check other similar components first before implementation.
- You can use Python for tools
- **IMPORTANT: Before writing new code, always check how similar existing code handles the same task.** Look at existing endpoints/components that do similar things and follow their patterns. Don't assume - read the code first.

## Tech Stack

- **Framework**: SvelteKit 2.47+ with Svelte 5
- **Language**: TypeScript 5.9+
- **Styling**: Tailwind CSS 4.1+ with dark theme (CSS custom properties in app.css)
- **Database**: SQLite with Drizzle ORM 0.44+
- **LLM Providers**: OpenRouter & Featherless APIs
- **Real-time**: Socket.IO 4.8+ (custom Vite plugin at `src/lib/server/vite-plugin-socket.ts`)
- **Image Processing**: Sharp 0.34+

## Commands

```bash
npm run dev           # Start dev server
npm run build         # Production build
npm run check         # Type check with svelte-check
npm run lint          # Run ESLint
npm run db:push       # Push schema changes to SQLite
npm run db:studio     # Open Drizzle Studio
```

## Key Directories

- `src/lib/server/` - Server-side code (auth, LLM, database, services)
- `src/lib/components/` - Reusable Svelte components
- `src/lib/stores/` - Client-side state (characters cache, socket client)
- `src/lib/house/` - Shared house constants (client + server both import these)
- `src/routes/api/` - REST API endpoints
- `data/prompts/` - File-based system prompts

## Database

Tables: users, llmSettings, gameMasterSettings, contentLlmSettings,
imageLlmSettings, llmPresets, characters, tagLibrary, conversations, messages,
sceneParticipants, houses, bedrooms, sharedSpaces, tenants, applicants,
occupancy, scenes, threads, relations, houseEvents

- Characters store card data as JSON, images as Base64
- Messages support "swipes" (alternative responses) as JSON array

**Foreign keys:** `db/index.ts` sets `PRAGMA foreign_keys = ON`. SQLite disables
enforcement per-connection by default — without it every `onDelete: 'cascade'` is
silently ignored and deleting a parent leaves orphan rows. Don't remove it.

**SQLite cannot add a foreign key to an existing table**, so drizzle-kit `push`
creates such columns without their constraint. Anything relying on
`on delete set null` must do it explicitly in the service.

### Migrations

`drizzle-kit push` may warn about data loss for NOT NULL columns. Add them
directly instead, which applies the default to existing rows:

```bash
sqlite3 local.db "ALTER TABLE users ADD COLUMN event_recall_days INTEGER NOT NULL DEFAULT 3;"
```

Then `push` sees the column as already existing.

## House Layer

### Structure

**Bedrooms and shared spaces are separate tables**, not one table with a `kind`
flag. A bedroom is a lease slot (one tenant, generates rent, private); a shared
space is a stage (zero-to-many people, owned by the house, costs money, and is
where most of the game happens). One table would mean null-heavy columns and
branching on `kind` in nearly every query.

**One active house at a time** — `houses.isActive`. `createHouse()` and
`setActiveHouse()` both deactivate any other active house in the same
transaction.

Shared constants live in `src/lib/house/` because client and server both need
them:

| File | Holds |
|---|---|
| `phases.ts` | Day cycle (4 phases), `PHASE_PLACEMENT_WEIGHTS`, the week |
| `spacePresets.ts` | Setup-form presets, bedroom-count bounds |
| `tenancy.ts` | Lease length, applicant count, satisfaction bands |
| `activities.ts` | Flavor lines for placed tenants, generic fallback pools |
| `relations.ts` | Event chance/cap, relation bands, `RELATION_EVENTS` |

**Weekdays are derived from `houses.day`, not stored.** Day 1 is a Monday, so
`weekday(day)`, `weekNumber(day)` and `isWeekend(day)` fall out of the counter
with no column and no way for the two to drift. The day number shows alongside
the weekday everywhere ("Day 5 / Friday") since leases are counted in days.
Weekends render in `--accent-secondary`.

### Casting

**The whole character library is the pool.** No per-house roster or eligibility
filter — importing a character card is all it takes to make someone able to
apply. Asking rent is anchored to the vacant rooms' average base rent (±15%,
rounded to $10).

Pipeline: **Library → applicants (per-room shortlist) → tenants (leased into
bedrooms)**. Moving out returns them to the pool and preserves history
(`status: 'moved_out'`, `moveOutDay` set) rather than deleting the row.

**Applicants apply for a specific room**, scoped by `applicants.bedroomId`, so
filling a vacancy is a choice between named people for *that* room. Three per
room (`APPLICANTS_PER_VACANCY`), or fewer when the library can't fill it — a
short list is valid, not an error.

**Shortlists refresh daily.** `ensureApplicantsFor()` returns today's list and
redraws when `generatedOnDay` is stale; `generateApplicantsForRoom()` forces a
redraw. It also prunes on read, since a candidate can take another room or move
out after the list was drawn.

Three exclusions keep the draw sane:
- anyone holding an active tenancy here
- anyone who **moved out today** (`moveOutDay >= house.day`) — eligible again
  from the next day
- anyone already shortlisted for **another room today**, so nobody is offered two
  rooms at once

Accepting clears that room's shortlist but leaves other rooms' lists intact.

Two invariants live in `tenantService`, not the schema (SQLite partial unique
indexes are awkward through drizzle-kit push) — both return **409**:
- one active tenant per bedroom
- one active tenancy per character per house

### Day Cycle

`houseService.advancePhase()` moves the clock one phase, rolling into the next
day after Night.

| Per phase advance | Per day rollover |
|---|---|
| Occupancy placement | Lease expiry |
| Relation events | Satisfaction drift |
| Scene summarisation | Broken-promise penalties |

**Leases settle on day rollover only**, so a lease ends on a day rather than at
an arbitrary hour. `advancePhase` returns `movedOut` so the UI can report it
instead of silently changing the roster. Relation events are rolled **after**
placement, so they belong to the phase being entered, and come back as
`relationEvents`.

**`occupancy` is the spine.** One row per tenant per phase recording `placeKind`
(`'bedroom' | 'shared' | 'away'`), the place, and an activity string. Append-only,
so house history is free.

Because it is a log, **rows outlive the tenancy that created them**. Every read
must filter on `tenants.status = 'active'` (`getForPhase`, `getPresentIn`) or a
moved-out tenant keeps showing up. `moveOut()` additionally deletes that tenant's
rows from the current day forward; earlier history stays true.

`generateForPhase()` is **idempotent** — it clears and re-rolls that day/phase,
so advancing twice can't double-book anyone. `ensureForPhase()` fills in a phase
that was never placed, which is what the house view calls.

Placement is a **weighted random draw** by time of day
(`PHASE_PLACEMENT_WEIGHTS`) — deliberately dumb: no LLM cost, no latency, and the
loop stays testable. The House Director replaces this later behind the same
`occupancy` interface.

A tenant **holds a bedroom lease** (`tenants.bedroomId`) but may not **be there
right now** (`occupancy`). Vacant rooms and absent tenants look different on
purpose.

### Room Scenes

Clicking a room opens a conversation with whoever `occupancy` puts there.
`resolveScene()` is keyed on **(houseId, day, phase, placeKind, placeId)**: first
entry creates the scene, later entries resume it, the next phase gets a fresh
one. Bedrooms are enterable only when someone is actually inside.

**`scenes` is a join table, not columns on `conversations`.** The chat engine
predates the house layer and still serves library chats with no room and no
clock. Delete every `scenes` row and the chat engine still works.

**Interviews are scenes too** — `placeKind: 'interview'` with
`scenes.applicantId`. Summarisation and recall work unchanged, so a tenant
remembers their interview once they move in. The prompt names the room and terms
and states nothing is settled, so the character negotiates rather than narrating
themselves into the house. Accepting or passing nulls `applicantId` and keeps the
scene (done explicitly in the service — see the SQLite foreign-key note above).

**Scenes are conversation-keyed; library chat is character-keyed.** This is why
`/scene/[conversationId]` exists rather than reusing `/chat/[id]`, which resolves
"the active conversation for this character" — an assumption room scenes break,
since one character holds many scenes across days and phases. Scene conversations
are written with `isActive: false` so they never hijack that lookup. Same reason
`/api/scenes/[conversationId]/send` and `/impersonate` exist alongside the
`chat/` equivalents. Everything else (`swipe`, `regenerate`, `edit`, `delete`,
`/api/scene-action`) was already conversation-keyed and is reused unchanged, as
are all the `chat/` components.

**House context rides in `conversations.scenario`.** `generateChatCompletion`
rebuilds it into `{{scenario}}` on *every* message, so the room, hour, activity
and lease terms stay in context instead of decaying out of the history window.
`generateSceneNarration` reads the same column. Built from `occupancy` and
`tenants` — no LLM call, no latency, no cost.

**World panel.** `/api/scenes/[conversationId]/world` (GET reads, POST
regenerates) drives `ChatWorldPanel`. It passes **every** participant, since a
room can hold several people, and feeds `conversation.scenario` in as the
scenario. Gated on `users.worldSidebarEnabled`, **off by default**. Entering a
scene shows stored state immediately then regenerates, since the clock has
usually moved; the refresh is chained onto `loadSettings()` because the gate
isn't known at mount.

### Scene Memory

**Scenes are summarised on phase advance, never on exit.** Walking out of a room
is not an ending — you can walk back in and keep talking. A scene only becomes
immutable when the clock moves past its phase, which is the one moment a summary
is guaranteed correct and needs writing exactly once.

`summariseFinishedScenes()` runs from the advance endpoint and is **deliberately
not awaited** — the clock must move the instant the player clicks. A failed or
slow summary leaves `scenes.summary` null and is retried next advance. Scenes
with no back-and-forth are skipped.

`recallFor()` feeds prior summaries into the house context under **"Earlier:"**,
scoped to the characters present. A scene never recalls itself. Resuming a scene
rebuilds its context, since summaries may have landed in the background.

Each line carries **both** weekday and day number (`Wednesday (day 3), Evening,
Kitchen: …`) — the weekday reads naturally, the number gives orderable distance.

**Recall is budgeted in tokens, not scenes.** `users.sceneRecallPercent` is a
share of the **chat LLM's `contextWindow`** (default 15, clamped 0-90), so it
scales with the model. Scenes are walked newest-first until the budget is spent;
the most recent is always kept even if it alone exceeds it. `estimateTokens()`
(`$lib/house/tenancy.ts`) is a deliberate ~4-chars approximation. 0 disables
recall.

Summaries use the **Content LLM** (`summariseScene()`,
`data/prompts/content_scene_summary.txt`), not the Chat LLM — extraction, not
performance, and it keeps chat latency untouched.

### Satisfaction

**How a tenant feels about living here — not about you.** Housing quality, not a
relationship meter: nothing in it should read as affection.

All movement goes through `satisfactionService`; every number lives in
`SATISFACTION` (`$lib/house/tenancy.ts`).

| Trigger | Effect | When |
|---|---|---|
| Daily drift | −2 to −5, **25% chance per tenant**, opens a gripe thread | Day rollover |
| A scene with them | +3, **once per day** (`tenants.lastTalkedDay`) | On summarisation |
| Resolved request | +8 | On summarisation |
| Kept promise | +10 | On summarisation |
| Missed a dated promise | −12, **charged once** (`threads.penaltyChargedDay`) | Day rollover |

Three deliberate choices:
- **Drift is a chance, not a decay** — a house that degrades on a timer is a
  treadmill.
- **The scene gain is once per day**, or phase-spamming one tenant is optimal.
- **A broken promise is charged once**, on the day it lapses. Charging daily
  would spiral one forgotten repair into a move-out.

**Drift names an actual gripe and opens a thread for it**, drawn from
`HOUSE_GRIPES`, so the complaint reaches scene context under "Unresolved:",
appears in Needs You, and can be resolved for credit. Gripes already open for
that tenant are excluded. Without a named gripe a tenant loses satisfaction over
nothing, and mentioning it to them gets a blank look.

**Satisfaction reaches the prompt** via `satisfactionMood()` on each person in
`Present:` — a sentence about how they feel and would behave, not the UI's
one-word band. Without it a character at 30 satisfaction cheerfully denies any
problem. Kept about **living here**, never about the landlord personally.

### Threads

**Unfinished business between the player and a tenant.** Not authored — the
summariser emits them as rows. One Content LLM call per scene does all three jobs
(summary, new threads, closures).

`kind` is `request` (tenant wants something) or `promise` (player committed to
something). `dueDay` is set only when a day was actually named, so a missed
deadline is detectable rather than merely felt.

Open threads appear in scene context under **"Unresolved:"**, scoped to who is
present, aged in plain language ("Outstanding since yesterday — due Tuesday
(day 9), now overdue").

**The house page shows them in "Needs You"** (`HouseAgendaPanel`), alongside
leases within `LEASE_WARNING_DAYS` of expiry, sorted overdue-first then oldest.
Clicking a row walks to whichever room that character is in; if they're out it
says so rather than failing silently.

**Every row has ✓ and ✕ to close it by hand**
(`POST /api/houses/[houseId]/threads/[threadId]`). Automatic closure depends on
the summariser noticing a conversation settled something — it misses things and
never sees anything handled off-screen, so without a manual close those items sit
in the panel forever and an overdue promise keeps costing satisfaction.

- **✓ resolved** credits satisfaction exactly as an LLM-detected closure does.
- **✕ dropped** clears it with no credit.

The update is guarded on house **and** `status = 'open'`, so a stale click can't
reopen or double-credit; it 409s instead.

The row is a `div` containing a button, not one big button — nesting buttons is
invalid HTML.

Two guards, because the model doesn't reliably follow the prompt:
- **Closures are matched by id AND house**, so a hallucinated id can't resolve
  another house's thread.
- **New threads are deduped against open ones** by normalised text, or a
  duplicate would nag twice and never fully close.

### Relations and the House Log

**How tenants feel about each other**, as distinct from satisfaction. A phase
advance rolls a few off-screen moments between housemates. Every number lives in
`RELATION` (`$lib/house/relations.ts`).

| Setting | Value |
|---|---|
| `EVENT_CHANCE` | 0.28 per pair per advance |
| `MAX_EVENTS_PER_PHASE` | 3 |
| Score range | −100..100 (bands derived, never stored) |
| `EVENT_RECALL_DAYS_DEFAULT` | 3 |
| `EVENT_HARD_CAP` | 20 |

Bands are Hostile / Cool / Neutral / Warm / Close via `relationLabel()`, exactly
like `satisfactionLabel()`.

**`RELATION_EVENTS` is keyed by phase**, so events match the hour. Positive and
negative sit in one pool per phase and are drawn together, so the odds fall out
of the mix rather than a second roll.

Two details that stop the draw reading as mechanical: **candidates are shuffled
before capping**, and **which of the pair is the actor is a coin flip**.

**`relations` is stored unordered** — `characterAId` is always the lower id, so a
pair has exactly one row however it is looked up. Feelings are **mutual**. Keyed
on **characters, not tenants**, so a relationship survives someone moving out and
back in.

**`house_events` is append-only** and stores the **rendered text** rather than a
template plus ids, so a line stays readable after a character is deleted.

**Moving in and out are events too** (`kind: 'move_in' | 'move_out'`, `delta: 0`),
recorded from all four paths that change the roster: `acceptApplicant`,
`placeCharacter`, `moveOut`, and lease expiry inside `advancePhase`. Two ordering
constraints:
- `acceptApplicant` logs **after** its transaction commits — an event for a
  move-in that failed to write would be a lie.
- `moveOut` reads name and room **before** its update, which nulls `bedroomId`.

Both reach scene context via `buildLayoutContext`, after the housemate roster so
names are introduced before being referenced:
- **"How they get on:"** — only pairs outside Neutral; a wall of "Neutral" is
  noise and its absence already means "no strong feelings".
- **"Recently in the house:"** — events from the last `users.eventRecallDays`
  days, oldest-first. This is **common knowledge**, unlike scene recall.

**Event recall is measured in days, not a count** (default 3, clamped 0-14, 0
disables). "The last N events" spans an hour in a chaotic house and a month in a
quiet one. The window is inclusive of today. `EVENT_HARD_CAP` still applies on
top — the day window controls *how far back*, not *how much*.

Both are excluded from interviews: an applicant at the door hasn't lived through
any of it.

**Three surfaces:** the advance notice ("While you were away"), `HouseLifePanel`
on `/house`, and `/house/log` (full history by day with running standings).

**Scene summaries show alongside the events.** `getSummarisedScenes()` returns
condensed scenes with place and cast; the panel lists them under **Remembered**
(folded), and the log interleaves them into each day. This is deliberately the
*same text* fed into `recallFor()` — the player reads exactly what the characters
remember, which makes a bad summary visible rather than mysterious.

**"Between Them" is sorted alphabetically, not by score** — it is a directory you
look names up in; score-ordering moves a row every time anything happens.

**Clicking a pair opens their history** (`RelationDetailModal`).
`getEventsBetween()` matches the pair in **either order**, since `house_events`
records whoever acted as A. The modal shows each delta alongside a running total,
so the score is explained rather than asserted.

### Prompt Context Blocks

`houseSceneService` assembles what a character knows:

| Block | Source | Scope |
|---|---|---|
| Room, hour, description | `buildHouseContext` | The scene |
| `The house:` | `buildLayoutContext` | Rooms + who lives in each |
| `Also living here:` | `buildLayoutContext` | Absent housemates + personality |
| `How they get on:` | `buildLayoutContext` | Non-Neutral pairs |
| `Recently in the house:` | `buildLayoutContext` | House events, last N days |
| `Present:` | `buildHouseContext` | Who is in the room, activity, lease |
| `Their last few days:` | `buildRoutines` | Recent occupancy, per person present |
| `Earlier:` | `recallFor` | Scene summaries, scoped to who is present |
| `Unresolved:` | `openThreadsFor` | Open threads, scoped to who is present |

**Layout blocks are common knowledge** (anyone living here knows the house and
the gossip); **recall, routines and threads are scoped to who is present**.

`buildLayoutContext(houseId, excludeCharacterIds, { roomsOnly, currentDay, userId })`
— `excludeCharacterIds` drops people already under `Present:`; `roomsOnly` is
interview mode. **The events block only renders when `currentDay` is passed**,
and `userId` is what reads `eventRecallDays`.

Housemates carry their card **`personality`**, not `description` — `description`
is the whole card and would be thousands of tokens per resident.

**`buildRoutines` turns `occupancy` into "what have you been up to?"** Without
it a character knows what they are doing right now and nothing about their own
week. Grouped by day, not phase; consecutive repeats of the same place collapse;
today stops before the current phase since `Present:` already covers it. Empty
history returns an empty array rather than a bare heading.

**Cost:** ~30 tokens plus ~350-450 per absent housemate, plus ~20 per event line.
A full four-bedroom house at the default 3-day window adds ~1,200-1,600 tokens
per message — a deliberate trade. The dials if it needs trimming:
`users.eventRecallDays`, `EVENT_HARD_CAP`, and the paragraph budget in
`content_personality_generate.txt`.

### Generating a Personality

Imported cards almost always have an **empty `personality`** — the v2 field
exists but most cards put everything in `description`. That matters because the
house layer repeats `personality` for every resident in every scene prompt.

The **Generate** button (character profile → Overview) builds one from the
Description: `content_personality_generate.txt` → `generatePersonality()` →
`POST /api/characters/[id]/personality`. It returns for review rather than
saving.

It **always builds from scratch** and ignores the current value — unlike Rewrite,
which needs existing text and is useless on the empty field that is the common
case. Rewrite was removed from Personality for that reason (Description keeps
it).

The prompt asks for **two paragraphs — appearance, then manner**. Appearance is
not optional: without it a character can't reference what anyone else looks like.
Standing rule: **only what the description supports, invent nothing.**

### Routes and Navigation

`/` (start or resume), `/house/new` (setup), `/house` (main view),
`/house/tenants` (roster + screening), `/house/log` (history + standings),
`/houses` (switch active house).

Home carries **no** Library or Settings cards — those live in the top nav.

**Home has three states, and an empty house is a gate, not a save.** A house with
zero active tenants has nothing to do:

| State | Primary action |
|---|---|
| No house | Start a New House |
| House, 0 tenants | Find a Tenant (or Import Characters if the library is empty) |
| House + tenants | Continue |

Supporting this: `/house/new` redirects to `/house/tenants` after creating,
`/house/tenants` **auto-draws a first batch of applicants** when the house is
empty and none are waiting, and `/house` shows a "Nobody lives here yet" banner.
A house can fall back into the empty state when leases expire, so this is a live
check, not just first-run onboarding.

**Reset to Day 1** (`resetHouse()`, `POST /api/houses/[houseId]/reset`) clears
threads, scenes, occupancy, applicants, tenants, relations and house events, then
returns to day 1 with `DEFAULT_STARTING_BALANCE`. **The rooms survive.** Two
details:
- **Scene conversations are deleted explicitly** — `scenes` cascades from the
  house but the `conversations` rows it points at do not, leaving orphaned
  transcripts otherwise.
- **Balance resets to the default**, not the house's original starting balance,
  which isn't stored anywhere. Add a `startingBalance` column if that matters.

**House switcher** (`layout/HouseSwitcher.svelte`) sits top-right in the nav.
`MainLayout` fetches the house list client-side rather than threading it through
every page's `load`, so anything that creates or switches a house must dispatch
`window.dispatchEvent(new CustomEvent('houseUpdated'))` — `invalidateAll()` alone
won't update it, since the layout's copy isn't page data.

### Difficulty Dials

Two are player-facing (General Settings → House Simulation), since how busy the
house feels is taste rather than balance:
- `users.houseDriftPercent` (default 25) — chance per tenant per day of a gripe
- `users.houseEventPercent` (default 28) — chance per pair per phase of an event

Both are **percent integers, 0-100**, and **0 disables that system entirely** —
the services return early rather than rolling. Constants in `$lib/house/` remain
the fallback for callers that don't pass a `userId`. `MAX_EVENTS_PER_PHASE` still
caps the draw, so 100% means "every pair rolls", not "unlimited events".

Everything else in `SATISFACTION` and `RELATION` stays a tuned constant.

### Activity Pools

Split by what owns them:

- **Bedroom and away → the character** (`characters.activityPools`, JSON keyed by
  phase). Every character has a room and can leave, in any house. Edited in the
  character profile's **Activities** tab.
- **Shared spaces → the space** (`sharedSpaces.activityPool`, flat JSON
  `string[]`). The room belongs to the house, so a character can't carry lines
  for it. Not phase-keyed: what you do in a kitchen barely changes with the hour.
  Edited from the **Shared Spaces** row on `/house`.

Both fall back to the generic lists in `activities.ts` when unset.

**Write with AI** exists for both (`content_activity_pools.txt`,
`content_space_activities.txt`). Both write into the textareas rather than the
database, so the result is reviewed before saving.

The prompt asks for **YAML**, not JSON: the shape is a fixed two-level nest of
string lists, so models produce it more reliably and one malformed line costs a
single entry rather than the whole document. `parseActivityYaml()` is hand-rolled
and forgiving (code fences, quoted values, inline `[a, b]` lists, trailing
commentary). The endpoint discards any key that isn't a real phase, so a
hallucinated `dawn:` can never reach stored data.

## Chat Engine

### Scene-Based Chat

Multiple characters can participate in one conversation.

**Key tables:**
- `sceneParticipants` — `conversationId`, `characterId`, `isActive`, `joinedAt`,
  `leftAt`
- `conversations.primaryCharacterId` — the main character for a scene
- `messages.characterId` — which character sent an assistant message (null for
  narrator/user)

| Role | Description |
|------|-------------|
| `user` | Player messages |
| `assistant` | Character dialogue (has characterId) |
| `narrator` | AI-generated scene descriptions |
| `system` | Technical/look command outputs |

**Flow:** narrator generates a scene intro → primary character delivers greeting
→ characters enter/leave via `/api/chat/[conversationId]/characters/add` and
`/remove` → narrator announces entries and exits.

`sceneService.ts`: `getActiveCharacters`, `addCharacterToScene`,
`removeCharacterFromScene`, `getPrimaryCharacter`.

### World State

Tracks mood, position, clothes and similar for characters and environment, shown
in a collapsible sidebar.

- `data/config/world_attributes.json` — what to track per entity type
- `data/prompts/world_generation.txt` — generation prompt

| Type | Value | Example |
|------|-------|---------|
| `text` | Single string | mood: "cheerful and relaxed" |
| `list` | Array of {name, description} | clothes: [{name: "dress", …}] |

**Adding an attribute:** add to `world_attributes.json`, add to
`world_generation.txt` output format and example, optionally add an icon in
`ChatWorldPanel.svelte`'s `getAttributeIcon()`.

Services: `worldStateGenerationService` (in `clothesGenerationService.ts`)
generates via the Content LLM; `worldInfoService.ts` is CRUD over
`conversations.worldState`.

Auto-generation settings on `users`: `autoWorldStateEnabled`,
`autoWorldStateMinMessages`, `autoWorldStateMaxMessages`.

### ChatInput

**It hides its action row unless handlers are passed** — `showActions` derives
from `onSceneAction || onImpersonate || onGenerateImage || onRegenerate`, so a
page passing only `onSend` silently gets a bare textbox. Scenes wire impersonate,
regenerate and scene actions; image generation is still unwired.

**It is a two-layer control, and the layers must lay out identically.** A
transparent textarea (visible caret, transparent text) sits over
`.rp-input-highlight`, which re-renders the same string with quotes and
`*actions*` coloured. The caret is drawn by the textarea, so **any style on the
highlight spans that changes glyph advance widths puts the caret visibly off the
character it is on**.

`.rp-action` was `font-style: italic` and the system italic face is ~2.6%
narrower: a long action block pushed everything after it ~29px out of alignment.
**Colour only in those spans** — never font-style, weight, size, letter-spacing,
or family. Italic can't be recovered: `oblique 0deg` keeps the metrics but has no
slant, and every angled `oblique` selects the same narrower face.

To check alignment, compare where each layer paints the same string offset (a
plain-text mirror div versus a `Range` in the highlight).
`document.caretPositionFromPoint` is **useless for this** — it queries the
textarea's own layout and returns the correct offset even when the bug is
present.

## Prompts

### Prose Formatting

**Quotes for speech, asterisks for everything else** — actions, description,
narration, thoughts. Narration is never left bare. Asterisks inside a quote mark
emphasis (`"I was *just* about to…"`), the only time they appear within speech.

`writing_style.txt` also carries a **Length** section: one reply is one beat, two
or three short paragraphs at most. "Keep descriptions short" alone was satisfied
by ten short paragraphs, so the rules are concrete (don't write three spoken
lines, don't keep moving, leave room to answer). `chat_system.txt` repeats the
limit in its closing instruction, the last thing the model reads.

Paths that substitute `{{writing_style}}`: `chatGeneration.ts`, `narration.ts`
(both functions), `impersonation.ts`, and
`contentLlmService.generateScenarioGreeting()`.

**`{{writing_style}}` is substituted _after_ the other variables** (chained
`.replace()` calls, it goes last), so a placeholder written *inside*
`writing_style.txt` is never expanded. Phrase those rules without variables.

### Template Substitution

`llm.ts` builds prompts with `{{char}}`, `{{user}}`, `{{description}}`,
`{{personality}}`, `{{scenario}}`, `{{history}}`, `{{user_description}}`,
`{{example_dialogue}}`.

**Substitution fails silently.** These are plain `.replace()` calls: a
placeholder missing from the `.txt` is a no-op, not an error. `chat_system.txt`
once shipped without `{{history}}`, so every character reply was generated blind.
The same gap hit `{{user_description}}`, so characters never knew who they were
talking to.

Two consequences:
- **Adding a variable to a prompt is two steps** — the placeholder in the `.txt`
  *and* the substitution in whichever code path builds it.
- **`logs/prompts/` is ground truth.** The saved prompt is exactly what was sent,
  so a missing block shows up there immediately. Check it before theorising about
  model behaviour.

**`replaceTemplateVariables` does NOT substitute `{{history}}`.** Chat paths call
it and then replace history themselves, so adding it to the shared helper would
blank the placeholder before they saw it. Callers needing history substitute it
after the helper returns.

**Optional blocks need `{{#if}}`.** A bare `{{user_description}}` under a heading
leaves the heading stranded when the bio is empty. `processConditionals` handles
`{{#if var}}...{{/if}}` and `{{#unless}}`, matching on `\w+`, treating empty
string as falsy.

**Don't chain `{{#if}}` blocks inline** (`{{/if}}{{#if other}}`). The regex is
non-greedy, so the first block swallows through the first `{{/if}}` and the next
`{{#if}}` ends up inside its content, printed as literal text. Put each on its
own lines.

**Example dialogue is positioned by the template, not appended.** It was once
concatenated after the whole prompt, putting it *below* the conversation history.
`chat_system.txt` places it via `{{example_dialogue}}` right after the character
definition. The code still appends as a fallback when the placeholder is absent.

### Prompt Defaults

`data/prompts/*.txt` are the live prompts. `PROMPT_CONFIG` in
`src/routes/prompts/+page.svelte` holds a parallel copy used only by "Reset to
Default" — editing a prompt in the UI writes the file, not the default, so the
two drift unless deliberately synced. The defaults are kept SFW.

## Multi-LLM Architecture

| LLM Type | Purpose | Settings Service |
|----------|---------|------------------|
| **Chat** | Character conversations | `llmSettingsService.ts` |
| **House Director** | Tenant placement, applicants, house events | `gameMasterSettingsService.ts` |
| **Content** | Content creation/generation | `contentLlmSettingsService.ts` |
| **Image** | Danbooru tags for SD | `imageLlmSettingsService.ts` |

**The House Director still uses the storage key `gameMaster`** throughout
`llmSettingsFileService.ts` and the settings/prompts UI. Renaming it would orphan
existing user settings files. Only the user-facing labels changed.

**IMPORTANT:** LLM settings are stored in **files** via
`llmSettingsFileService.ts`, NOT in the database. The `llmSettings` table exists
but is unused. Always go through the service classes.

**Model pools.** Each type has a single `model` plus an optional
`models: string[]`. With two or more entries **one is drawn at random per
request**. Empty, absent, or single-entry falls back to `model`.

`resolveModel()` is the one place that decides, called **per request** rather
than per session. The catch when adding a call path: **callers that pass
`model: settings.model` explicitly bypass the pool**, because an explicit model
always wins in `llmService`. Every generation path resolves through
`resolveModel` and passes the result, so the log and the request agree.

In the UI, `ModelSelector` becomes a multi-select when given `onTogglePool` and
stays open on click. `LLMSettingsForm` keeps `settings.model` pointing at a pool
member, since it is still the fallback everything else reads. Applying a preset
clears the pool.

Supporting services: `llmService.ts` (retry, max 3, exponential backoff),
`queueService.ts` (per-provider concurrency), `llmLogService.ts` (last 5
prompts/responses per type).

## Image Generation

`imageTagGenerationService.ts` generates Danbooru-style tags from conversation
context via the Image LLM. `sdService.ts` handles the Stable Diffusion API
(txt2img, health check, model listing). Tags are stored per-user in
`data/tags_{userId}.txt`.

**`{{tag_library}}` is what keeps tags usable.** `data/tags_{userId}.txt` is the
vocabulary the image model actually understands; without it in the prompt the LLM
writes plausible-sounding tags the checkpoint has never seen.

The `image_*.txt` prompts once had no placeholders at all — the service built
character, scenario, history, world state, clothes and tag library, then sent a
template referencing none of them. They now use `{{char}}`, `{{description}}`,
`{{scenario}}`, `{{world}}`, `{{char_clothes}}`, `{{history}}`,
`{{contextual_tags}}` and `{{tag_library}}`.

## Auth, Sockets, Cards

- **Auth:** cookie-based sessions using userId, bcryptjs hashing, logic in
  `src/lib/server/auth.ts`.
- **Socket.IO:** custom Vite plugin. Rooms: `conversation-{conversationId}`.
  Events: `message`, `typing`.
- **Character cards:** v1/v2 formats, image extraction from PNG metadata via
  `src/lib/utils/characterImageParser.ts`.

## API Patterns

- Endpoints at `src/routes/api/[feature]/+server.ts`
- Export `GET`, `POST`, `PUT`, `DELETE` functions
- Access userId from cookies for auth
- Return JSON responses

## Styling

**Theme: "Lamplight Amber on Neutral Dark."** All colors are CSS custom
properties in `:root` in `src/app.css`. Use Tailwind classes in components.

**The warmth belongs to the accent, not the base.** Backgrounds cover most of the
screen, so tinting them makes the whole UI read brown. Keep backgrounds and text
near-neutral and let `--accent-primary` carry the character. Don't reintroduce
brown backgrounds.

| Token | Value | Role |
|---|---|---|
| `--bg-primary` | `#0c0c0b` | near-black base |
| `--bg-secondary` | `#141413` | raised surface |
| `--bg-tertiary` | `#1c1b19` | inputs, wells |
| `--accent-primary` | `#ffab40` | hot amber |
| `--accent-secondary` | `#ff6b35` | burnt orange |
| `--accent-user` | `#7fd6a8` | mint — user name |
| `--text-primary` | `#ededeb` | soft white |

All text/background pairs pass WCAG AA (lowest is `--text-muted` on
`--bg-tertiary` at 4.81:1). Check contrast if you change these.

**Accents run hot on purpose** — lit signage against near-black, not dimmed wood.
`btn-primary-solid` uses the accents at **full strength with dark text**
(`#1a1207`) plus a soft outer glow. It previously mixed them 60% with black,
which turned every primary action brown. Don't reintroduce the black mix.

**Prefer utility values the project already uses.** Tailwind only generates
classes it finds in source, so a value used nowhere else silently produces no
CSS. A side panel written with `lg:w-72` (unused anywhere) got no width rule at
all, expanded to fill its flex row, and crushed the sibling column to zero width
— with the markup looking correct. Side panels use `w-full lg:w-80 flex-shrink-0`.
When a layout misbehaves in a way the markup doesn't explain, check the class
exists in the generated CSS.

**IMPORTANT: never hardcode hex colors in components.** Three deliberate
exceptions:
- `src/routes/hero/+page.svelte` — a standalone promo banner that doesn't import
  `app.css`.
- `CHARACTER_COLORS` in `ChatMessages.svelte` — per-speaker colors, warm-leaning
  but spread across hues so several tenants in one room stay distinguishable.
- `ABSENT_CHARACTER_COLOR` in the same file — one muted grey for housemates
  mentioned but not in the room.

**Two tiers of name highlighting.** `sceneCharacters` (in the room) each get a
distinct palette hue; `knownCharacters` (the rest of the roster) all share
`ABSENT_CHARACTER_COLOR`. Absent names are added **last**, so anyone who walks in
keeps their palette colour. Characters talk about housemates now that the prompt
tells them who those are, and spending palette slots on absent people would make
the ones actually speaking harder to tell apart.

The default user bubble color (`#e0a458`) is a *user preference* whose factory
value lives in the `users.userBubbleColor` DB default plus several client
fallbacks — change all of them together.

## Environment Variables

Create `.env` from `.env.example`:
```
OPENROUTER_API_KEY=sk-or-v1-...
FEATHERLESS_API_KEY=...  # optional
SD_SERVER_URL=http://127.0.0.1:7860  # Stable Diffusion server
```
