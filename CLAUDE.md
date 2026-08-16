# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Rental House** — a visual-novel-flavored management sim. You own a house, tenants
arrive and leave on leases, and the experience is built around living alongside a
rotating cast of characters.

Built on the DynamicTavern codebase: the chat engine, character cards, world state,
and LLM plumbing are retained; the sandbox exploration layer has been removed and is
being replaced by a purpose-built house/day-cycle game layer.

See `PLAN.md` for design pillars, architecture, and build order.

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
npm run preview       # Preview production build
npm run check         # Type check with svelte-check
npm run lint          # Run ESLint
npm run db:push       # Push schema changes to SQLite
npm run db:studio     # Open Drizzle Studio (visual DB editor)
```

## Architecture

### Key Directories

- `src/lib/server/` - Server-side code (auth, LLM, database, services)
- `src/lib/components/` - Reusable Svelte components
- `src/lib/stores/` - Client-side state (characters cache, socket client)
- `src/routes/api/` - REST API endpoints
- `data/prompts/` - File-based system prompts (system.txt, impersonate.txt)

### Database Schema (`src/lib/server/db/schema.ts`)

Tables: users, llmSettings, gameMasterSettings, contentLlmSettings, imageLlmSettings, llmPresets, characters, tagLibrary, conversations, messages, sceneParticipants, houses, bedrooms, sharedSpaces, tenants, applicants, occupancy, scenes, threads, relations, houseEvents

**Foreign keys:** `db/index.ts` sets `PRAGMA foreign_keys = ON`. SQLite disables
enforcement per-connection by default — without it, every `onDelete: 'cascade'`
in the schema is silently ignored and deleting a parent leaves orphan rows.
Don't remove it.

- Characters store card data as JSON, images as Base64
- Messages support "swipes" (alternative responses) as JSON array

### House Layer

The game layer. See `PLAN.md` for full design.

**Tables:** `houses`, `bedrooms`, `shared_spaces`, `tenants`, `applicants`,
`relations`, `house_events`

**Casting model — the whole character library is the pool.** There is no
per-house roster or eligibility filter: importing a character card is all it
takes to make someone able to apply. `generateApplicants()` draws at random from
every character the user owns, excluding only those holding an active tenancy in
that house. Asking rent is anchored to the vacant rooms' average base rent
(±15%, rounded to $10).

Pipeline: **Library → applicants (per-room shortlist) → tenants (leased into
bedrooms)**. Moving a tenant out returns them to the pool and preserves history
(`status: 'moved_out'`, `moveOutDay` set) rather than deleting the row.

**Applicants apply for a specific room, not the house.** `applicants.bedroomId`
scopes each shortlist, so filling a vacancy is a choice between named people for
*that* room rather than a lucky dip from a global pool. Three per room
(`APPLICANTS_PER_VACANCY`), or fewer when the library can't fill it — a short
list is valid, not an error.

**Shortlists refresh daily.** `ensureApplicantsFor()` returns today's list and
redraws when `generatedOnDay` is stale, so the same room shows different faces
tomorrow with newly rolled asking rents. `generateApplicantsForRoom()` forces a
redraw regardless.

Three exclusions keep the draw sane:
- anyone holding an active tenancy here
- anyone who **moved out today** (`moveOutDay >= house.day`) — somebody who just
  walked out doesn't reappear at the door an hour later; they're eligible again
  from the next day
- anyone already shortlisted for **another room today**, so one character is
  never offered two rooms at once

Accepting a candidate clears that room's entire shortlist (the others were turned
away) but leaves other rooms' lists intact. `ensureApplicantsFor()` also prunes
today's list on read: a candidate can take another room or move out *after* the
list was drawn, and a stale entry would offer someone unavailable.

Two invariants are enforced in `tenantService`, not the schema (SQLite partial
unique indexes are awkward through drizzle-kit push) — both return **409**:
- one active tenant per bedroom
- one active tenancy per character per house

**Bedrooms and shared spaces are deliberately separate tables**, not one table
with a `kind` flag. A bedroom is a lease slot (one tenant, generates rent,
private); a shared space is a stage (zero-to-many people, owned by the house,
costs money, and is where most of the game happens). They differ in occupancy,
ownership, economy, and role, so a single table would mean null-heavy columns
and branching on `kind` in nearly every query.

**One active house at a time** — `houses.isActive`. `houseService.createHouse()`
and `setActiveHouse()` both deactivate any other active house in the same
transaction, so the invariant holds without a separate write path.

**Two difficulty dials are player-facing** (General Settings → House
Simulation), since how busy the house feels is taste rather than balance:
- `users.houseDriftPercent` (default 25) — chance per tenant per day that
  something goes wrong and they raise a gripe.
- `users.houseEventPercent` (default 28) — chance per pair per phase of an
  off-screen moment between housemates.

Both are **percent integers, 0-100**, and **0 disables that system entirely** —
the services return early rather than rolling. The constants in
`$lib/house/` remain the fallback for any caller that doesn't pass a `userId`,
so behaviour is unchanged when the setting isn't reachable. Everything else in
`SATISFACTION` and `RELATION` stays a tuned constant; exposing all nine numbers
would be a dense panel for very little gain.

Note `MAX_EVENTS_PER_PHASE` still caps the draw, so 100% means "every pair rolls"
rather than "unlimited events".

**Shared constants** live in `src/lib/house/` because both client and server
need them:
- `phases.ts` — the day cycle (4 phases), `PHASE_PLACEMENT_WEIGHTS`, and the
  week. `houses.phase` is an index into `HOUSE_PHASES`.

  **Weekdays are derived from `houses.day`, not stored.** Day 1 is a Monday, so
  `weekday(day)`, `weekNumber(day)` and `isWeekend(day)` fall out of the counter
  with no column and no way for the two to drift. Existing houses gained weekdays
  for free. The day number is kept alongside the weekday everywhere it shows —
  "Day 5 / Friday" — since leases and history are counted in days. Weekends
  render in `--accent-secondary` so they read differently at a glance.
- `spacePresets.ts` — setup-form presets and bedroom-count bounds.
- `tenancy.ts` — lease length, applicant count, satisfaction bands.
- `activities.ts` — flavor lines for what a placed tenant is doing, plus the
  generic fallback pools.
- `relations.ts` — how housemates feel about each other: event chance and cap,
  relation bands, and `RELATION_EVENTS` (the off-screen event pools, keyed by
  phase).

**Activity pools split by what owns them.**

- **Bedroom and away → the character** (`characters.activityPools`, JSON keyed by
  phase). Every character has a room and can leave, in any house, and the four
  phases are the same everywhere, so these travel with them. Edited in the
  character profile's **Activities** tab.
- **Shared spaces → the space** (`sharedSpaces.activityPool`, a flat JSON
  `string[]`). The room belongs to the house, so a character can't carry lines
  for it. Not phase-keyed: what you do in a kitchen barely changes with the hour.
  Edited from the **Shared Spaces** row on `/house`.

Both fall back to the generic lists in `activities.ts` when unset — per phase for
characters, per space *kind* for rooms — so an imported card and a fresh house
both work immediately.

**Write with AI** exists for both: `content_activity_pools.txt` writes a
character's 24 lines from their card, `content_space_activities.txt` writes a
room's 6-10 from its name, kind and description. Both write into the textareas
rather than the database, so the result is reviewed and edited before saving.

The prompt asks for **YAML**, not JSON: the shape is a fixed two-level nest of
string lists, which YAML expresses without quoting or brace-matching, so models
produce it more reliably and one malformed line costs a single entry rather than
the whole document. `parseActivityYaml()` is hand-rolled and forgiving — it
tolerates code fences, quoted values, inline `[a, b]` lists, and trailing
commentary. The endpoint then discards any key that isn't a real phase, so a
hallucinated `dawn:` can never reach stored data.

### Day Cycle

`houseService.advancePhase()` moves the clock one phase, rolling into the next
day after Night. **Leases are settled on day rollover only**, not per phase, so a
lease ends on a day rather than at an arbitrary hour; expiring tenants are moved
out and the call returns `movedOut` so the UI can report it instead of silently
changing the roster.

What is **per phase** versus **per day**:

| Per phase advance | Per day rollover |
|---|---|
| Occupancy placement | Lease expiry |
| Relation events (`relationService`) | Satisfaction drift |
| Scene summarisation | Broken-promise penalties |

Relation events are rolled **after** placement, so they belong to the phase being
entered rather than the one just left, and `advancePhase` returns them as
`relationEvents` for the advance notice.

**`occupancy` is the spine.** One row per tenant per phase recording
`placeKind` (`'bedroom' | 'shared' | 'away'`), the place, and an activity string.
It is an append-only log, so house history is free — "who was in the kitchen on
day 12" is just a query.

Because it is a log, **rows outlive the tenancy that created them**. Every read
must filter on `tenants.status = 'active'` (`getForPhase`, `getPresentIn`) or a
moved-out tenant keeps showing up in the house. `moveOut()` additionally deletes
that tenant's rows from the current day forward — history before it stays, since
them having been in the kitchen on day 3 remains true after they leave.

`occupancyService.generateForPhase()` is **idempotent** — it clears and re-rolls
that day/phase, so advancing twice can't double-book anyone.
`ensureForPhase()` fills in a phase that was never placed (houses predating the
day cycle), which is what the house view calls.

Placement is currently a **weighted random draw** by time of day
(`PHASE_PLACEMENT_WEIGHTS`) — mornings quiet, afternoons empty, evenings social,
nights everyone home. This is deliberately dumb: no LLM cost, no latency, and it
makes the loop testable. The House Director replaces this later behind the same
`occupancy` interface, so nothing downstream needs to change.

Note the distinction the house view draws: a tenant **holds a bedroom lease**
(`tenants.bedroomId`) but may not **be there right now** (`occupancy`). Vacant
rooms and absent tenants look different on purpose.

### Room Scenes

Clicking a room opens a conversation with whoever `occupancy` puts there.
`houseSceneService.resolveScene()` is keyed on **(houseId, day, phase, placeKind,
placeId)**: first entry creates the scene, every entry after resumes it, and the
next phase gets a fresh one. Bedrooms are enterable only when someone is actually
inside — the leaseholder may be elsewhere.

**`scenes` is a join table, not columns on `conversations`.** The chat engine
predates the house layer and still serves library chats that have no room and no
clock. Keeping the house keys out means the chat tables stay untouched: delete
every `scenes` row and the chat engine still works.

**Interviews are scenes too.** `placeKind: 'interview'` with `scenes.applicantId`
set — you meet an applicant at the door before deciding whether to offer the
lease. Same table, so summarisation and recall work unchanged: a tenant who was
interviewed remembers that conversation once they move in, because `recallFor()`
matches on `sceneParticipants`. The prompt context names the room they want and
the terms they are asking, and states that nothing is settled, so the character
negotiates rather than narrating themselves into the house.

The transcript outlives the applicant row — accepting or passing nulls
`applicantId` and keeps the scene, since the conversation is what informed the
decision. That detach is done **explicitly in the service**, not by the declared
`on delete set null`: SQLite cannot add a foreign key to an existing table, so
drizzle-kit's `push` created the column without its constraint.

**Scenes are conversation-keyed; library chat is character-keyed.** This is why
`/scene/[conversationId]` exists rather than reusing `/chat/[id]`, which resolves
"the active conversation for this character" — an assumption room scenes break,
since one character can hold several scenes across different days and phases and
all of them persist. Scene conversations are written with `isActive: false` so
they never hijack that lookup. Same reason `/api/scenes/[conversationId]/send`
exists alongside `/api/chat/[characterId]/send`, and the same for
`/impersonate`. Everything else (`swipe`, `regenerate`, `edit`, `delete`) was
already conversation-keyed and is reused unchanged, as are all the `chat/`
components.

**`ChatInput` hides its action row unless handlers are passed** — `showActions`
is derived from `onSceneAction || onImpersonate || onGenerateImage ||
onRegenerate`, so a page that only passes `onSend` silently gets a bare textbox.
Scenes wire impersonate, regenerate and scene actions; image generation is still
unwired.

**`ChatInput` is a two-layer control, and the layers must lay out identically.**
A transparent textarea (visible caret, transparent text) sits over
`.rp-input-highlight`, which re-renders the same string with quotes and
`*actions*` coloured. The caret is drawn by the textarea, so **any style on the
highlight spans that changes glyph advance widths puts the caret visibly off the
character it is actually on** — you click a letter, the caret lands several
characters earlier, and typing or deleting hits the wrong place.

`.rp-action` was `font-style: italic`, and the system italic face is ~2.6%
narrower: a long action block pushed everything after it ~29px out of alignment.
**Colour only in those spans** — never font-style, weight, size, letter-spacing,
or family. Italic can't be recovered here: `oblique 0deg` keeps the metrics but
has no slant, and every angled `oblique` selects the same narrower face.

To check alignment, compare where each layer paints the same string offset (a
plain-text mirror div for the textarea versus a `Range` in the highlight).
`document.caretPositionFromPoint` is **useless for this** — it queries the
textarea's own layout and returns the correct offset even when the bug is
present.

**World panel.** `/api/scenes/[conversationId]/world` (GET reads, POST
regenerates) drives `ChatWorldPanel` on the right of a scene. It passes **every**
participant, not just the one answering, since a room can hold several people,
and feeds `conversation.scenario` in as the scenario so state is grounded in the
actual room and hour. Gated on the `users.worldSidebarEnabled` setting, which is
**off by default** — the panel simply won't render until it's turned on.

**Entering a scene regenerates it.** The stored state is shown immediately, then
refreshed, because the clock has usually moved since you were last in that room —
a panel describing someone asleep in bed when they're now in the yard is worse
than no panel. The refresh is chained onto `loadSettings()` since the panel is
gated on a setting that isn't known at mount.

`/api/scene-action` was already conversation-keyed, so scenes reuse it unchanged.
It backs both the input's action menu and the panel's per-item eye icons
(`look_item`), which write a narrator message into the scene.

**House context rides in `conversations.scenario`.** `generateChatCompletion`
rebuilds it into `{{scenario}}` on *every* message, so the room, the hour, the
activity and the lease terms stay in context for the whole scene instead of
decaying out of the history window after the intro. `generateSceneNarration`
reads the same column, so the narrator gets it too. It is built from data already
in `occupancy` and `tenants` — no LLM call, no latency, no cost.

### Scene Memory

**Scenes are summarised on phase advance, never on exit.** Walking out of a room
is not an ending — you can walk straight back in and keep talking, so summarising
on exit would re-summarise the same conversation every time the player crossed
the doorway. A scene only becomes immutable when the clock moves past its phase,
which is the one moment a summary is guaranteed correct and needs writing exactly
once.

`houseSceneService.summariseFinishedScenes()` runs from the advance endpoint and
is **deliberately not awaited** — the clock must move the instant the player
clicks, with summaries filling in behind it. A failed or slow summary leaves
`scenes.summary` null and is retried on the next advance. Scenes with no
back-and-forth (a narrator intro and nothing else) are skipped, so opening a door
and leaving costs nothing.

`recallFor()` feeds prior summaries back into the house context under an
**"Earlier:"** heading, scoped to the characters actually present — a tenant
recalls what they took part in, not everything that ever happened in the house. A
scene never recalls itself. Resuming a scene rebuilds its context too, since
summaries of earlier scenes may have landed in the background since it was
created.

Each line carries **both** the weekday and the day number
(`Wednesday (day 3), Evening, Kitchen: …`) — the weekday reads naturally, the
number gives orderable distance so the model can reason about gaps and missed
deadlines.

**Recall is budgeted in tokens, not scenes.** `users.sceneRecallPercent` is a
share of the **chat LLM's `contextWindow`** (default 15%, clamped 0-90), so it
scales with the model instead of needing a retune whenever you switch. Summaries
vary from ~80 to ~200 tokens, so "the last N scenes" spent an unpredictable
amount of context. Scenes are walked newest-first until the budget is spent, so
the oldest fall off; the most recent is always kept even if it alone exceeds the
budget. `estimateTokens()` in `$lib/house/tenancy.ts` is a deliberate ~4-chars
approximation — no tokenizer dependency for something that only decides how much
history fits. Set in **General Settings → Scene Memory**; 0 disables recall.

Summaries use the **Content LLM** (`contentLlmService.summariseScene()`,
prompt at `data/prompts/content_scene_summary.txt`), not the Chat LLM — this is
extraction, not performance, and it keeps chat latency and cost untouched.

### Satisfaction

**How a tenant feels about living here — not about you.** It is housing quality,
not a relationship meter: nothing in it should read as affection, and being liked
is not the same as being a good landlord.

All movement goes through `satisfactionService`, and every number lives in
`SATISFACTION` (`$lib/house/tenancy.ts`) so difficulty is one file to tune:

| Trigger | Effect | When |
|---|---|---|
| Daily drift | −2 to −5, **25% chance per tenant**, opens a gripe thread | Day rollover |
| A scene with them | +3, **once per day** (`tenants.lastTalkedDay`) | On summarisation |
| Resolved request | +8 | On summarisation |
| Kept promise | +10 | On summarisation |
| Missed a dated promise | −12, **charged once** (`threads.penaltyChargedDay`) | Day rollover |

Three deliberate choices:
- **Drift is a chance, not a decay.** A house that degrades on a timer is a
  treadmill; one where things *sometimes* go wrong reads as upkeep.
- **The scene gain is once per day**, or phase-spamming the same tenant would be
  the optimal strategy.
- **A broken promise is charged once**, on the day it lapses. The sting is
  missing the deadline, not the ongoing state — charging daily would spiral one
  forgotten repair into a move-out.

Satisfaction is shown on the house-page portraits (band + colour) and reported in
the advance notice when it drops, so a change is never a silent number.

**The drift names an actual gripe and opens a thread for it.** It used to record
the reason as the literal string "something around the house" — so a tenant lost
satisfaction over nothing nameable, and because the reason never reached the
prompt, mentioning it to them got a blank look. Now it draws from `HOUSE_GRIPES`
(a dripping tap, cold shower, flickering light) and inserts a `request` thread,
which means the complaint reaches the scene context under "Unresolved:", appears
in the Needs You panel, and can be resolved for the usual credit. Gripes already
open for that tenant are excluded, so nobody complains about the same tap twice.

**Satisfaction itself reaches the prompt**, via `satisfactionMood()` on each
person in `Present:` — a sentence rather than the UI's one-word band, phrased as
how they feel and how they'd behave ("They are restless about the place — willing
to say so if asked directly"). Without it a character at 30 satisfaction
cheerfully denies any problem, because nothing in the prompt told them they had
one. Kept about **living here**, never about the landlord personally, matching
the rest of the system.

### Threads

**Unfinished business between the player and a tenant** — `threads`. Not
authored: the summariser was already writing "her request was left unresolved"
in prose, so the same pass now emits it as rows. One Content LLM call per scene
does all three jobs (summary, new threads, closures), so this costs nothing
extra.

`kind` is `request` (the tenant wants something) or `promise` (the player
committed to something). `dueDay` is set only when a day was actually named, so a
missed deadline is detectable rather than merely felt.

Open threads appear in the scene context under **"Unresolved:"**, scoped to who
is present, aged in plain language ("Outstanding since yesterday — due Tuesday
(day 9), now overdue"). That is the nudge: a character has a standing reason to
raise something the moment you walk in.

**The house page shows them in a "Needs You" panel** on the right
(`HouseAgendaPanel`), alongside leases within `LEASE_WARNING_DAYS` of expiry.
Sorted overdue-first, then oldest. Clicking a row walks into whichever room that
character is in; if they're out it says so rather than failing silently, since
the thread stays open and they'll be back.

**Every row has ✓ and ✕ to close it by hand**
(`POST /api/houses/[houseId]/threads/[threadId]`, `houseSceneService.closeThread`).
Automatic closure depends on the summariser noticing that a conversation settled
something — it misses things, and it never sees anything handled off-screen, so
without a manual close those items sit in the panel forever and an overdue
promise keeps costing satisfaction.

- **✓ resolved** credits satisfaction exactly as an LLM-detected closure does
  (`creditResolvedThread`).
- **✕ dropped** clears it with no credit — deciding something no longer matters
  is not the same as doing it.

The update is guarded on house **and** `status = 'open'`, so a stale click cannot
reopen or double-credit something already settled; it 409s instead.

Note the row is a `div` containing a button rather than one big button, because
nesting buttons is invalid HTML — the inner button walks to the character, the
action buttons sit beside it.

Two guards, because the model doesn't reliably follow the prompt here:
- **Closures are matched by id AND house**, so a hallucinated id can't resolve
  another house's thread.
- **New threads are deduped against open ones** by normalised text. The prompt
  says not to re-open tracked items; it sometimes does anyway, and a duplicate
  would nag twice and never fully close.

### Relations and the House Log

**How tenants feel about each other** — `relations` — as distinct from
`satisfaction`, which is how they feel about the housing. Housemates get on with
each other whether or not the player is in the room, so a phase advance rolls a
few off-screen moments: someone made coffee, someone ate the leftovers.

Every number lives in `RELATION` (`$lib/house/relations.ts`), same as
`SATISFACTION`:

| Setting | Value | Why |
|---|---|---|
| `EVENT_CHANCE` | 0.28 per pair per advance | Alive, not soap-operatic |
| `MAX_EVENTS_PER_PHASE` | 3 | A wall of notifications reads as noise |
| Score range | −100..100 | Bands derived, never stored |
| `EVENT_RECALL_DAYS_DEFAULT` | 3 | Factory value for the user setting |
| `EVENT_HARD_CAP` | 20 | Ceiling on event lines in one prompt |

Bands are Hostile / Cool / Neutral / Warm / Close, derived by `relationLabel()`
exactly like `satisfactionLabel()`.

**`RELATION_EVENTS` is keyed by phase**, so events match the hour: bathroom
queues and coffee in the morning, errands and borrowed things in the afternoon,
cooking and leftovers in the evening, noise through the wall at night. Positive
and negative sit in one pool per phase and are drawn together, so the odds of a
good or bad day fall out of the mix rather than a second roll.

**Placement is deliberately dumb** — a weighted random draw, no LLM call, no
latency, no cost. Same reasoning as `occupancyService`: the loop stays testable
and free, and the House Director can replace the draw later behind the same
interface.

Two details that stop the draw reading as mechanical:
- **Candidates are shuffled before capping**, so it isn't always the same pairs
  that get through in a busy house.
- **Which of the pair is the actor is a coin flip**, so "{a} ate {b}'s
  leftovers" doesn't always fall on whoever has the lower character id.

**`relations` is stored unordered** — `characterAId` is always the lower id, so
a pair has exactly one row however it is looked up. Feelings are **mutual**: the
asymmetric version (A resents B more than B resents A) would double the rows and
writes for a nuance nothing currently reads. Keyed on **characters, not
tenants**, so a relationship survives someone moving out and moving back in —
they remember each other.

**`house_events` is append-only**, like `occupancy`: the log IS the history. It
stores the **rendered text** rather than a template plus ids, so a line stays
readable after a character is deleted — a line about someone who no longer lives
here is still a true thing that happened.

**Moving in and out are events too** (`kind: 'move_in' | 'move_out'`,
`delta: 0` — arriving isn't good or bad for anyone's relations). Recorded from
all four paths that change the roster: `acceptApplicant`, `placeCharacter`,
`moveOut`, and lease expiry inside `advancePhase` (which moves tenants out
directly rather than through `moveOut`). Two ordering constraints:
- `acceptApplicant` logs **after** its transaction commits — an event for a
  move-in that failed to write would be a lie in the house's history.
- `moveOut` reads the name and room **before** its update, which nulls
  `bedroomId` and would otherwise make the room unrecoverable.

**Relations and events reach the scene context** via `buildLayoutContext`,
after the housemate roster so the names are introduced before being referenced:
- **"How they get on:"** — only pairs outside Neutral. A wall of "Neutral" is
  noise, and the absence of a line already means "no strong feelings".
- **"Recently in the house:"** — events from the last `users.eventRecallDays`
  days, oldest-first, each carrying weekday and day number. This is **common
  knowledge** everyone living there would have, unlike scene recall which is
  scoped to who took part.

**Event recall is measured in days, not a count** (General Settings → Scene
Memory, default 3, clamped 0-14; 0 disables it). "The last N events" spans an
hour in a chaotic house and a month in a quiet one, which is the wrong shape for
"what happened recently" — a day window gives the same sense of recency either
way. The window is inclusive of today, so 1 day means today only.
`EVENT_HARD_CAP` still applies on top: a full house can produce a dozen events a
day, and the day window controls *how far back*, not *how much*.

Both are excluded from interviews, for the same reason housemate personalities
are: an applicant at the door hasn't lived through any of it.

**Three surfaces:** the advance notice ("While you were away"), a `HouseLifePanel`
under Needs You on `/house`, and `/house/log` — the full history grouped by day
with a running standings column.

**Scene summaries are shown alongside the events.** `getSummarisedScenes()`
returns condensed scenes with their place and cast; the panel lists them under
**Remembered** (folded, since they're paragraphs — clicking one opens it), and
the log interleaves them into each day with an accent dot and a tinted row, so a
day reads as everything that happened rather than two disconnected lists. Both
link back to the transcript via `conversationId`.

This is deliberately the *same text* fed into `recallFor()` — the player reads
exactly what the characters remember, which makes a bad summary visible rather
than mysterious.

**"Between Them" is sorted alphabetically, not by score.** It is a directory you
look names up in; score-ordering moves a pair every time anything happens between
them, so the row you want is never where you last saw it.

**Clicking a pair opens their history** (`RelationDetailModal`, on both `/house`
and `/house/log`). `getEventsBetween()` matches the pair in **either order**,
since `house_events` records whoever acted as A — the same two people appear both
ways round. The modal shows each event's delta alongside a **running total**, so
the score is explained rather than asserted: you can see the −6, −12, −17 that
led to "Cool".

### Prompt Context Blocks

`houseSceneService` assembles what a character knows. The blocks, in order:

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

The distinction that matters: **layout blocks are common knowledge** (anyone
living here knows the house and the gossip), while **recall, routines and threads
are scoped to the people actually present** (you remember your own week and what
you took part in).

**`buildRoutines` turns `occupancy` into "what have you been up to?"** The log
already records where every tenant was in every phase; without feeding it back, a
character knows what they are doing *right now* and nothing about their own week.
Three deliberate choices in the rendering:
- **Grouped by day, not phase** — four lines a day per character would bury the
  rest of the prompt, and "Tuesday: morning on the stove, afternoon on the couch"
  is how someone would actually answer.
- **Consecutive repeats of the same place collapse**, so a quiet day reads as one
  phrase instead of four identical ones.
- **Today stops before the current phase**, since `Present:` already states what
  they are doing this moment.

Empty history returns an empty array rather than a bare heading — a house on day 1
has nothing to report.

`buildLayoutContext(houseId, excludeCharacterIds, { roomsOnly, currentDay, userId })` —
`excludeCharacterIds` drops people already under `Present:` with richer detail so
nobody is described twice; `roomsOnly` is the interview mode, giving room names
without occupants, housemates, relations or events. **The events block only
renders when `currentDay` is passed** (it needs a day to measure the window back
from), and `userId` is what reads the player's `eventRecallDays` setting —
without it the block falls back to the default.

Housemates carry their card **`personality`**, not `description` — `personality`
is the generated profile (appearance + manner, see below), while `description` is
the whole card and would be thousands of tokens per resident.

**Cost:** the layout block runs roughly 30 tokens plus ~350-450 per absent
housemate, plus ~20 per event line. A full four-bedroom house at the default
3-day window adds ~1,200-1,600 tokens per message. This is a deliberate trade —
characters knowing who they live with is worth more than the context saved. The
dials, if it ever needs trimming: `users.eventRecallDays` (General Settings),
`EVENT_HARD_CAP`, and the paragraph budget in
`content_personality_generate.txt`.

### Generating a Personality

Imported cards almost always have an **empty `personality`** — the field exists
in the v2 spec but most cards leave it blank, putting everything in
`description`. That matters here because the house layer repeats `personality`
for every resident in every scene prompt.

The **Generate** button on the Personality field (character profile → Overview)
builds one from the Description: `content_personality_generate.txt` →
`contentLlmService.generatePersonality()` → `POST /api/characters/[id]/personality`.
It returns for review rather than saving, so the result lands in edit mode.

It **always builds from scratch** and ignores the current value — unlike Rewrite,
which needs existing text and is therefore useless on the empty field that is the
common case. Rewrite was removed from Personality for that reason (Description
keeps it).

The prompt asks for **two paragraphs — appearance, then manner** — because that
is what a housemate would know about someone they live with. Appearance is not
optional: without it a character can't reference what anyone else looks like,
which is conspicuous in a house where people share a kitchen. Roughly 350-450
tokens per resident; the source description is often ten times that, so this is
still a summary, just not a one-liner.

Standing rule for the prompt: **only what the description supports, invent
nothing** — if the card says nothing about their eyes, they don't get eyes. No
backstory, no plot, no named relationships; this is a description of a person,
not a synopsis of their story.

**Key routes:** `/` (start or resume), `/house/new` (setup), `/house` (main
view), `/house/tenants` (roster + applicant screening), `/house/log` (house
history + relation standings), `/houses` (switch active house).

Home deliberately carries **no** Library or Settings cards — those live in the
top nav. Home is about the house only.

**Home has three states, and an empty house is a gate, not a save.** A house
with zero active tenants has nothing to do — no scenes, no rent, no reason to
advance the day — so Home shows "The house is empty" with *Find a Tenant* as the
primary action and a setup-progress row, rather than a Continue button into a
dead end:

| State | Primary action |
|---|---|
| No house | Start a New House |
| House, 0 tenants | Find a Tenant (or Import Characters if the library is empty) |
| House + tenants | Continue |

Supporting this: `/house/new` redirects to `/house/tenants` (not Home) after
creating, `/house/tenants` **auto-draws a first batch of applicants** when the
house is empty and none are waiting, and `/house` shows a "Nobody lives here
yet" banner. A house can fall back into the empty state when leases expire, so
this is a live check, not just first-run onboarding.

**Reset to Day 1** sits with the stats row on Home (`houseService.resetHouse()`,
`POST /api/houses/[houseId]/reset`). It clears threads, scenes, occupancy,
applicants, tenants, relations and house events, then puts the clock back to day
1 with `DEFAULT_STARTING_BALANCE`. **The rooms survive** — the property is what
you built, and rebuilding it to play again would be busywork.

Two details:
- **Scene conversations are deleted explicitly.** `scenes` cascades from the
  house, but the `conversations` rows it points at do not, so dropping scenes
  alone would leave orphaned transcripts in chat history with no room and no
  clock to reach them by.
- **Balance resets to the default, not the house's original starting balance** —
  the setup form's choice isn't stored anywhere, so there is nothing to restore
  it to. Add a `startingBalance` column if that matters.

**House switcher** (`layout/HouseSwitcher.svelte`) sits in the top-right of the
nav bar, beside logout. It shows the current house with day/phase and drops down
to house shortcuts, other houses to switch to, and manage/create links — so the
house is reachable from any page without going via Home.

`MainLayout` fetches the house list client-side (like personas/characters/
conversations) rather than threading it through every page's `load`. Anything
that creates or switches a house must dispatch `window.dispatchEvent(new
CustomEvent('houseUpdated'))` so the switcher refreshes; `invalidateAll()` alone
won't update it, since the layout's copy isn't page data.

### Prose Formatting

**Quotes for speech, asterisks for everything else** — actions, description,
narration, thoughts. Narration is never left bare. Asterisks inside a quote mark
emphasis (`"I was *just* about to…"`), which is the only time they appear within
speech.

`writing_style.txt` also carries a **Length** section: one reply is one beat, two
or three short paragraphs at most. "Keep descriptions short" alone was satisfied
by ten short paragraphs — the model stacked action-speech-action-speech into a
monologue and walked the character across the room four times in one turn. The
rules are therefore concrete (don't write three spoken lines, don't keep moving,
leave room to answer) rather than a general plea for brevity, and
`chat_system.txt` repeats the limit in its closing instruction, which is the last
thing the model reads.

**Note `{{writing_style}}` is substituted _after_ the other variables** — they
are chained `.replace()` calls in `replaceTemplateVariables`, with
`{{writing_style}}` last. So a placeholder written *inside* `writing_style.txt`
is never expanded; phrase those rules without variables.

The rule lives in `data/prompts/writing_style.txt` and reaches prompts via
`{{writing_style}}`. **Adding it to a prompt is two steps** — the placeholder in
the `.txt`, *and* a `.replace()` in whichever code path builds that prompt.
`chat_system.txt` and `action_scene_intro.txt` had neither, which is why chat
replies and scene intros drifted into bare prose while the `action_*` prompts
(which say "same format as the conversation") had nothing to match.

Paths that substitute it: `chatGeneration.ts`, `narration.ts` (both
`generateNarration` and `generateSceneNarration`), `impersonation.ts`, and
`contentLlmService.generateScenarioGreeting()`.

### Scene-Based Chat System

The chat system uses a scene + narrator paradigm where multiple characters can participate:

**Key Tables:**
- `sceneParticipants` - Tracks which characters are in each conversation/scene
  - `conversationId`, `characterId`, `isActive`, `joinedAt`, `leftAt`
- `conversations.primaryCharacterId` - The main character for a scene
- `messages.characterId` - Which character sent an assistant message (null for narrator/user)

**Message Roles:**
| Role | Description |
|------|-------------|
| `user` | Player messages |
| `assistant` | Character dialogue (has characterId) |
| `narrator` | AI-generated scene descriptions |
| `system` | Technical/look command outputs |

**Scene Flow:**
1. Start chat → Narrator generates scene intro
2. Primary character delivers greeting
3. Characters can enter/leave via `/api/chat/[conversationId]/characters/add` and `/remove`
4. Narrator announces entries/exits

**Key Service:** `sceneService.ts`
- `getActiveCharacters(conversationId)` - Characters currently in scene
- `addCharacterToScene(conversationId, characterId)` - Add character
- `removeCharacterFromScene(conversationId, characterId)` - Remove character
- `getPrimaryCharacter(conversationId)` - Get responding character

### World State System

Tracks dynamic state for characters and environment (mood, position, clothes, etc.) displayed in a collapsible sidebar panel.

**Configuration Files:**
- `data/config/world_attributes.json` - Defines what attributes to track per entity type
- `data/prompts/world_generation.txt` - LLM prompt template for generating state

**Attribute Types:**
| Type | Value | Example |
|------|-------|---------|
| `text` | Single string | mood: "cheerful and relaxed" |
| `list` | Array of {name, description} | clothes: [{name: "dress", description: "blue sundress"}] |

**Adding New Attributes:**
1. Add to `data/config/world_attributes.json` under the appropriate entity (`character` or `user`)
2. Add to `data/prompts/world_generation.txt` output format and example
3. Optionally add icon in `ChatWorldPanel.svelte` `getAttributeIcon()` function

**Key Services:**
- `worldStateGenerationService` (in `clothesGenerationService.ts`) - Generates state via Content LLM
- `worldInfoService.ts` - CRUD for world state in database (`conversations.worldState` JSON column)

**Auto-Generation Settings** (in `users` table):
- `autoWorldStateEnabled` - Generate on new chat start
- `autoWorldStateMinMessages` / `autoWorldStateMaxMessages` - Periodic regeneration range

**UI Component:** `ChatWorldPanel.svelte` - Collapsible sidebar with entity sections, expandable list items, and "look at" action buttons.

### Multi-LLM Architecture

Four separate LLM configurations, each with its own settings service:

| LLM Type | Purpose | Settings Service |
|----------|---------|------------------|
| **Chat** | Character conversations | `llmSettingsService.ts` |
| **House Director** | Tenant placement, applicants, house events | `gameMasterSettingsService.ts` |
| **Content** | Content creation/generation | `contentLlmSettingsService.ts` |
| **Image** | Generate Danbooru tags for SD | `imageLlmSettingsService.ts` |

**NOTE:** The House Director still uses the storage key `gameMaster` throughout
`llmSettingsFileService.ts` and the settings/prompts UI. This is deliberate — renaming
the key would orphan existing user settings files. Only the user-facing labels changed.

**IMPORTANT:** LLM settings are stored in **files** via `llmSettingsFileService.ts`, NOT in the database. The database `llmSettings` table exists but is not used. Always use the service classes (e.g., `llmSettingsService.getSettings()`) to fetch settings.

**Model pools.** Each LLM type has a single `model` plus an optional
`models: string[]`. With two or more entries, **one is drawn at random per
request** — useful for varying prose voice across a long roleplay, or spreading
load across rate limits. Empty, absent, or single-entry falls back to `model`,
so every settings file written before this existed behaves exactly as it did.

`resolveModel()` is the one place that decides, and it is called **per request**
rather than per session, so a long conversation is spread across the pool rather
than pinned to whichever model was drawn first.

The catch when adding a new LLM call path: **callers that pass
`model: settings.model` explicitly bypass the pool entirely**, because an
explicit model always wins in `llmService`. Every generation path
(`chatGeneration`, `impersonation`, both narration functions, `llmCallService`)
resolves through `resolveModel` and passes the result — resolving once per
request so the log and the actual request agree on which model was used.

In the UI, `ModelSelector` becomes a multi-select when given `onTogglePool`; it
stays open on click, since building a pool is several clicks. `LLMSettingsForm`
keeps `settings.model` pointing at a pool member, because it is still the
fallback everything else reads — letting it drift to an unselected model would
make the displayed choice and the model actually used disagree. Applying a preset
clears the pool, since a preset names exactly one model.

### LLM Integration (`src/lib/server/`)

- `llm.ts` - Prompt building with template variables: `{{char}}`, `{{user}}`, `{{description}}`, `{{personality}}`, `{{scenario}}`, `{{history}}`
- `services/llmService.ts` - API calls with retry logic (max 3 retries, exponential backoff)
- `services/queueService.ts` - Request concurrency control per provider
- `services/llmLogService.ts` - Stores last 5 prompts/responses per type for debugging

**Template substitution fails silently.** `replaceTemplateVariables` and the
`{{history}}` replace are plain `.replace()` calls: a placeholder missing from
the `.txt` is a no-op, not an error. `chat_system.txt` shipped without
`{{history}}`, so `generateChatCompletion` built the history string on every
message and then discarded it — every character reply in every chat was
generated blind, seeing only the card and the scenario. Characters re-introduced
themselves and ignored what had just been said.

Two consequences worth keeping in mind:
- **Adding a variable to a prompt is two steps** — the placeholder in the `.txt`
  *and* the substitution in whichever code path builds it. Same trap as
  `{{writing_style}}` (see Prose Formatting).
- **`logs/prompts/` is the ground truth.** The saved prompt is exactly what was
  sent, so a missing block shows up there immediately. Check it before theorising
  about model behaviour.

The same gap hit `{{user_description}}` — `getActiveUserInfo()` returns the
active persona's description (falling back to the profile bio), and
`chatGeneration` fetched it and used only `.name`, so **the character never knew
who it was talking to**. Now wired into `replaceTemplateVariables`, so it is
available to every prompt built through that helper, and used by `chat_system`
and all four impersonate prompts — impersonation especially, since it writes
*as* the player. Note `{{description}}` in those prompts is the **character's**
description, not the player's; they are separate variables.

**Optional blocks need `{{#if}}`.** A bare `{{user_description}}` under a
heading leaves the heading stranded when the bio is empty. `processConditionals`
handles `{{#if var}}...{{/if}}` and `{{#unless}}`, matching on `\w+` so
underscored names work, and treats empty string as falsy.

**Example dialogue is positioned by the template, not appended.** It used to be
concatenated after the whole prompt, which put it *below* the conversation
history — the model read how the character speaks after reading what was
already said. `chat_system.txt` now places it via `{{example_dialogue}}` right
after the character definition. The code still appends as a fallback when the
placeholder is absent, so a custom prompt can't silently lose it.

### Image Generation

- `services/imageTagGenerationService.ts` - Generates Danbooru-style tags from conversation context using Image LLM

**The `image_*.txt` prompts had no placeholders at all.** The service built
character, scenario, history, world state, clothes and the tag library, called
`replaceTemplateVariables`, and then sent a template that referenced none of
them — so the Image LLM was asked for "tags for the character in this scene"
with no scene, and invented everything. They now use `{{char}}`,
`{{description}}`, `{{scenario}}`, `{{world}}`, `{{char_clothes}}`,
`{{history}}`, `{{contextual_tags}}` and `{{tag_library}}`.

**`{{tag_library}}` is what keeps tags usable.** `data/tags_{userId}.txt` is the
vocabulary the image model actually understands; without it in the prompt the LLM
writes plausible-sounding tags that the checkpoint has never seen.

Two traps this exposed:
- **`replaceTemplateVariables` does NOT substitute `{{history}}`.** The chat
  paths call it and then replace history themselves, so adding it to the shared
  helper would blank the placeholder before they ever saw it — silently emptying
  the conversation out of every chat prompt. Callers needing history substitute
  it after the helper returns; `imageTagGenerationService` does exactly that.
- **Don't chain `{{#if}}` blocks inline** (`{{/if}}{{#if other}}`). The regex is
  non-greedy, so the first block swallows through the first `{{/if}}` and the
  next `{{#if}}` on that line ends up inside its content, printed as literal
  text. Put each on its own lines, or omit conditionals where the variable is
  always supplied — which is what these prompts do.
- `services/sdService.ts` - Stable Diffusion API integration (txt2img, health check, model listing)
- Tags are stored per-user in `data/tags_{userId}.txt`

### Authentication

Cookie-based sessions using userId. Password hashing via bcryptjs. Auth logic in `src/lib/server/auth.ts`.

### Socket.IO Integration

Custom Vite plugin integrates Socket.IO. Rooms: `conversation-{conversationId}`. Events: `message`, `typing`.

### Character Cards

Supports v1/v2 formats. Image extraction from PNG metadata via `src/lib/utils/characterImageParser.ts`.

## Database Migrations

When adding new columns to existing tables, `drizzle-kit push` may warn about data loss for NOT NULL columns. To avoid truncating tables, add columns directly with SQLite:

```bash
sqlite3 local.db "ALTER TABLE table_name ADD COLUMN column_name TYPE NOT NULL DEFAULT value;"
```

Example adding multiple columns:
```bash
sqlite3 local.db "ALTER TABLE users ADD COLUMN auto_world_state_enabled INTEGER NOT NULL DEFAULT 0;"
sqlite3 local.db "ALTER TABLE users ADD COLUMN auto_world_state_min_messages INTEGER NOT NULL DEFAULT 5;"
sqlite3 local.db "ALTER TABLE users ADD COLUMN event_recall_days INTEGER NOT NULL DEFAULT 3;"
sqlite3 local.db "ALTER TABLE users ADD COLUMN house_drift_percent INTEGER NOT NULL DEFAULT 25;"
sqlite3 local.db "ALTER TABLE users ADD COLUMN house_event_percent INTEGER NOT NULL DEFAULT 28;"
```

This applies the default to existing rows. Then `drizzle-kit push` will see the columns as already existing.

## API Patterns

- Endpoints at `src/routes/api/[feature]/+server.ts`
- Export `GET`, `POST`, `PUT`, `DELETE` functions
- Access userId from cookies for auth
- Return JSON responses

## Styling

**Theme: "Lamplight Amber on Neutral Dark."** All colors are CSS custom properties
defined in `:root` in `src/app.css` (`--bg-primary`, `--accent-primary`, etc.).
Use Tailwind classes in components.

**The warmth belongs to the accent, not the base.** Backgrounds cover most of the
screen, so tinting them makes the whole UI read brown — amber then stops feeling
like lamplight and just becomes the room color. Keep backgrounds and text
near-neutral (a faint warm breath at most, so amber doesn't clash) and let
`--accent-primary` carry the character. Don't reintroduce brown backgrounds.

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

**Prefer utility values the project already uses.** Tailwind only generates
classes it finds in source, so a value used nowhere else silently produces no
CSS. A side panel written with `lg:w-72` (unused anywhere) got no width rule at
all, expanded to fill its flex row, and crushed the sibling content column to
zero width — with the markup looking perfectly correct. Side panels use
`w-full lg:w-80 flex-shrink-0`; copy that rather than inventing a width. When a
layout misbehaves in a way the markup doesn't explain, check the class actually
exists in the generated CSS.

**Accents run hot on purpose.** They should read as lit signage against the
near-black base, not as dimmed wood tones. `btn-primary-solid` therefore uses the
accents at **full strength with dark text** (`#1a1207`) plus a soft outer glow —
it previously mixed them 60% with black, which turned every primary action in the
app into dull brown. Don't reintroduce the black mix.

**IMPORTANT: never hardcode hex colors in components.** Always use the tokens, so
the theme stays changeable in one place. Two deliberate exceptions:
- `src/routes/hero/+page.svelte` — a standalone 1280×640 promo banner that does not
  import `app.css`, so its colors are inline by necessity.
- `CHARACTER_COLORS` in `ChatMessages.svelte` — per-speaker colors for multi-character
  scenes. Warm-leaning but spread across hues so several tenants in one room stay
  distinguishable. Keep contrast high when editing.
- `ABSENT_CHARACTER_COLOR` in the same file — one muted grey for housemates who
  are **mentioned but not in the room**.

**Two tiers of name highlighting.** `sceneCharacters` (people in the room) draw
from the palette and each get a distinct hue; `knownCharacters` (the rest of the
house roster, supplied by the scene's `load`) all share
`ABSENT_CHARACTER_COLOR`. Absent names are added to the map **last**, so anyone
who walks into the scene keeps their palette colour rather than being muted.

The point is that characters talk about their housemates now that the prompt
tells them who those are — "Zara said she'd fix it" should read as a person.
Spending palette slots on people who aren't present would make the ones actually
speaking harder to tell apart, which is what the palette is for.

The default user bubble color (`#e0a458`) is a *user preference* whose factory value
lives in the `users.userBubbleColor` DB default plus several client fallbacks — change
all of them together if you change it.

## Environment Variables

Create `.env` from `.env.example`:
```
OPENROUTER_API_KEY=sk-or-v1-...
FEATHERLESS_API_KEY=...  # optional
SD_SERVER_URL=http://127.0.0.1:7860  # Stable Diffusion server
```
