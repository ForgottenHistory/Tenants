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

Tables: users, llmSettings, gameMasterSettings, contentLlmSettings, imageLlmSettings, llmPresets, characters, tagLibrary, conversations, messages, sceneParticipants, houses, bedrooms, sharedSpaces

**Foreign keys:** `db/index.ts` sets `PRAGMA foreign_keys = ON`. SQLite disables
enforcement per-connection by default — without it, every `onDelete: 'cascade'`
in the schema is silently ignored and deleting a parent leaves orphan rows.
Don't remove it.

- Characters store card data as JSON, images as Base64
- Messages support "swipes" (alternative responses) as JSON array

### House Layer

The game layer. See `PLAN.md` for full design.

**Tables:** `houses`, `bedrooms`, `shared_spaces`, `tenants`, `applicants`

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
| Daily drift | −2 to −5, **25% chance per tenant** | Day rollover |
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

Two guards, because the model doesn't reliably follow the prompt here:
- **Closures are matched by id AND house**, so a hallucinated id can't resolve
  another house's thread.
- **New threads are deduped against open ones** by normalised text. The prompt
  says not to re-open tracked items; it sometimes does anyway, and a duplicate
  would nag twice and never fully close.

**Key routes:** `/` (start or resume), `/house/new` (setup), `/house` (main
view), `/house/tenants` (roster + applicant screening), `/houses` (switch active
house).

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

### LLM Integration (`src/lib/server/`)

- `llm.ts` - Prompt building with template variables: `{{char}}`, `{{user}}`, `{{description}}`, `{{personality}}`, `{{scenario}}`
- `services/llmService.ts` - API calls with retry logic (max 3 retries, exponential backoff)
- `services/queueService.ts` - Request concurrency control per provider
- `services/llmLogService.ts` - Stores last 5 prompts/responses per type for debugging

### Image Generation

- `services/imageTagGenerationService.ts` - Generates Danbooru-style tags from conversation context using Image LLM
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
