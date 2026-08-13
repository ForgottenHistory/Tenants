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

Pipeline: **Library → applicants (random draw) → tenants (leased into bedrooms)**.
Moving a tenant out returns them to the pool and preserves history
(`status: 'moved_out'`, `moveOutDay` set) rather than deleting the row.

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
- `phases.ts` — the day cycle. `houses.phase` is an index into `HOUSE_PHASES`.
- `spacePresets.ts` — setup-form presets and bedroom-count bounds.
- `tenancy.ts` — lease length, applicant count, satisfaction bands.

**Key routes:** `/` (start or resume), `/house/new` (setup), `/house` (main
view), `/house/tenants` (roster + applicant screening), `/houses` (switch active
house).

Home deliberately carries **no** Library or Settings cards — those live in the
top nav. Home is about the house only.

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
| `--accent-primary` | `#e0a458` | lamplight amber |
| `--accent-secondary` | `#c2703d` | terracotta |
| `--accent-user` | `#8fb08a` | sage — user name |
| `--text-primary` | `#ededeb` | soft white |

All text/background pairs pass WCAG AA (lowest is `--text-muted` on
`--bg-tertiary` at 4.81:1). Check contrast if you change these.

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
