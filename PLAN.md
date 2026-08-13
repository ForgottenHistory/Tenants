# Tenants — Project Plan

A visual-novel-flavored management sim: you own a house, tenants come and go on
leases, and the experience is built around living alongside a rotating cast.

Built on the DynamicTavern codebase — we keep the chat engine and LLM plumbing,
strip the sandbox exploration layer, and build a purpose-made house/day-cycle
game layer in its place.

---

## 1. Design Pillars

| Pillar | Decision |
|---|---|
| **Core loop** | Day-cycle sim. Time advances in phases; you choose where to go and who to engage. |
| **Cast rotation** | Lease-driven. Bedrooms are lease slots; leases expire, tenants renew or leave, applicants fill vacancies. |
| **The house** | Bedrooms (private, leased, one tenant each) + shared spaces (public stages where the game happens). Room counts configurable per house. |
| **Scale** | Multiple houses, one active at a time. A house is defined by its rooms, so size is data, not code. |
| **Sim depth** | Light economy. Rent, expenses, repairs, shared-space upgrades — pressure and story hooks, not spreadsheets. |
| **Feel** | Visual novel. Character art, room backdrops, deliberate pacing. Not a chat log with extra steps. |
| **Look** | "Lamplight Amber on Warm Charcoal" — warm dark, domestic, recedes behind character art. See `CLAUDE.md`. |

### The loop, concretely

```
DAY 12 — EVENING                          Balance: $2,340   Rent due in 3 days

  SHARED
  [Kitchen]        Mira is cooking. Jonas at the table.
  [Living Room]    (empty)
  [Back Yard]      Ava, on the phone

  BEDROOMS
  [Room 1] Mira    — out
  [Room 2] Jonas   — out
  [Room 3] Ava     — out
  [Room 4] vacant    Lease ended day 9

  > Go to Kitchen    > Wait    > End Day
```

Shared spaces are listed first because that's where the game happens. Bedrooms
read as a roster — occupancy, lease status, and a way into a private scene.

Each **day** has phases (Morning / Afternoon / Evening / Night). Each phase you
spend one action: enter a room and engage whoever's there, or wait/skip. Tenants
are *somewhere* every phase according to their schedule and mood — the house
keeps moving whether you're watching or not. Ending the day advances the
calendar, ticks leases, and applies economy.

---

## 2. What We Keep, Cut, and Build

### Keep (the foundation — ~roughly two-thirds of value already built)

| Subsystem | Why it stays |
|---|---|
| Chat engine (`llm/chatGeneration.ts`, narration, message roles) | The reason we started here. Multi-character scenes with a narrator maps *exactly* onto a room with two tenants in it. |
| `messages` table w/ swipes, edit, regenerate | Mature, works, no reason to touch. |
| Characters + character cards (v1/v2 import) | Tenants *are* character cards. Free content pipeline — existing cards become applicants. |
| Multi-LLM settings (Chat / Content / Image) | Keep three. Game Master gets repurposed (see below). |
| World state (`worldStateGenerationService`) | **The sleeper asset.** Already tracks mood/clothes/position per character. This becomes the tenant state engine nearly as-is. |
| SD image generation (`sdService`, `imageTagGenerationService`) | Retained for the VN feel — character portraits reflecting current state. |
| `personaService` | Infrastructure, not a feature. Supplies `{{user}}` to every prompt. Keep the service, drop the management UI. |
| Auth, Socket.IO, LLM queue/retry/logging | Plumbing. Untouched. |

### Cut (~4,400 lines, verified zero coupling to chat)

Nothing outside `src/routes/api/sandbox` imports the sandbox services. This
comes out cleanly.

| Target | Lines | Notes |
|---|---|---|
| `src/routes/api/sandbox/**` | | All 20+ endpoints |
| `src/routes/sandbox/**` | ~1,000 | Session UI |
| `src/lib/components/sandbox/` | | |
| `sandboxService`, `sandboxParticipantService`, `sandboxImageService`, `worldService` | ~700 | |
| `sandbox_sessions`, `sandbox_participants`, `sandbox_images` tables | | Plus `messages.sandboxSessionId` |
| `gameMasterService` | 251 | Sandbox-only consumer. See note below. |

**Why the sandbox goes:** it's designed around *randomized, disposable*
encounters — "each location move is a fresh scene," explicitly no persistence.
A lease-driven sim needs the opposite: tenants who persist, occupy specific
rooms, and carry state across days. Adapting it is more work than writing the
house layer fresh against the same chat engine.

**Game Master:** the *service* goes, but the concept returns as the **House
Director** — the model that decides tenant placement each phase, generates
applicants, and fires events. Keeping the 4th LLM settings slot and repointing
it costs nothing and preserves user config UI.

### Deferred (decide after the house layer works)

Branches, lorebooks, scenarios, the persona management UI. All currently
harmless. Lorebooks in particular may earn their keep as house/world lore.
Cutting these now is a distraction; revisit once the core loop is playable.

---

## 3. New Architecture

### Two kinds of space

The house is **not** a flat list of rooms. Bedrooms and shared spaces behave so
differently that collapsing them into one table with a `kind` flag would mean
null-heavy columns and branching on `kind` in nearly every query.

| | **Bedrooms** | **Shared spaces** |
|---|---|---|
| Occupancy | Exactly one tenant, or vacant | Zero to many, changes every phase |
| Ownership | Leased — belongs to someone | Belongs to the house |
| Economy | Generates rent | Costs money; may raise satisfaction |
| Role in play | Private scenes, personal space | **Where the game happens** — hangouts, friction, group scenes |
| Count | Configurable per house | Configurable, expandable via upgrades |

So: two tables. `bedrooms` are lease slots; `sharedSpaces` are stages.

### Houses

Multiple houses exist; **exactly one is active at a time** (`houses.isActive`).
Everything else — bedrooms, shared spaces, tenants, ledger — is scoped by
`houseId`. This keeps the active-house query trivial and makes a second house a
data question rather than an architectural one.

Bedroom count is **per house, not global**. A house is defined by its rooms, so
a 3-bedroom starter and an 8-bedroom manor are the same code with different rows.

### Schema

```
houses           — name, address, balance, day, phase, isActive
bedrooms         — houseId, name, quality, baseRent, condition
sharedSpaces     — houseId, name, kind (kitchen/lounge/yard/...), description,
                   tier, capacity, condition, unlocked
spaceUpgrades    — sharedSpaceId, name, cost, effect, appliedOnDay

tenants          — houseId, characterId, bedroomId, moveInDay, leaseEndDay,
                   rentAmount, satisfaction, status
leases           — tenantId history: signed/renewed/ended, terms, why it ended
applicants       — houseId, characterId, pitch, askingRent, expiresOnDay

occupancy        — WHERE EVERYONE IS: houseId, day, phase, tenantId,
                   spaceId + spaceType ('bedroom' | 'shared'), activity
                   (written by the House Director each phase)

ledger           — houseId, day, type (rent/expense/repair/upgrade), amount, note
houseEvents      — houseId, day, phase, kind, text, involved tenants
```

Reused as-is: `characters`, `messages`, `conversations`, `sceneParticipants`.

**`occupancy` is the spine of the game.** One row per tenant per phase, written
by the House Director. The main view is a read of it; entering a space is a read
of it; "who was in the kitchen on day 12" is a read of it. Because it's a log
rather than a mutable pointer, house history is free — which Phase 6 events and
lease-renewal reasoning both want.

### Scenes

A **scene** = one space, one phase, whoever `occupancy` says is there. That maps
onto the existing chat system directly: a `conversation` with
`sceneParticipants`, keyed by `houseId + day + phase + spaceId` instead of a
session id. Multi-character rooms already work — that's the machinery we kept
the sandbox strip clean to preserve.

### The House Director's job

Because shared spaces are dynamic, most house activity is the Director's output,
not authored content. Each phase it decides:

- where each tenant is (writes `occupancy`)
- what they're doing there (the `activity` string — flavor for the room view)
- whether anything notable happens (writes `houseEvents`)

**Cost control:** one Director call per phase for the whole house, not one per
tenant. Placement is a single structured response covering everyone. Bedrooms
are largely schedule-driven and cheap to infer; shared spaces are where the
Director earns its keep.

### Services

| Service | Responsibility |
|---|---|
| `houseService` | House CRUD, active-house switching, day/phase advance, calendar |
| `bedroomService` | Bedroom slots, assignment, vacancy, condition |
| `spaceService` | Shared spaces, unlocking, upgrades, capacity |
| `occupancyService` | Read/write the per-phase occupancy log; "who is in X" |
| `tenantService` | Tenancy lifecycle, satisfaction, relationship tracking |
| `leaseService` | Expiry checks, renewal decisions, move-outs |
| `applicantService` | Generate applicants (Director LLM) from character library |
| `economyService` | Rent collection, expenses, repairs, upgrades, ledger |
| `directorService` | Per-phase placement + event firing (replaces gameMaster) |

### Routes

```
/houses             — house picker: switch active, create, manage
/house              — main view: spaces, who's where, day/phase, money
/house/space/[id]   — the scene (bedroom or shared). VN presentation.
/house/tenants      — roster, leases, satisfaction
/house/applicants   — screening and signing
/house/upgrades     — expand and improve shared spaces
/house/ledger       — money
/library            — character library (kept)
/settings/*         — kept
```

One scene route serves both space types — the presentation differs by what's in
the room, not by which table the row came from.

---

## 4. Build Order

Each phase ends somewhere playable. No phase depends on unbuilt work.

**Phase 0 — Strip.** Remove sandbox routes/services/components/tables. Verify
chat still works end to end. Single reviewable commit.

**Phase 1 — The house exists.** Schema + `houseService`/`bedroomService`/
`spaceService`. Create a house with a configurable bedroom count and a starting
set of shared spaces. `/house` renders them with a day/phase clock you can
advance. `/houses` switches the active house. No tenants yet.

**Phase 2 — Tenants live there.** Assign characters to bedrooms. A simple
schedule (not yet the Director) writes `occupancy` each phase. Enter a space →
existing chat engine runs the scene with whoever is present. *This is the first
genuinely playable build.*

**Phase 3 — Leases rotate the cast.** Lease timers, renewal decisions driven by
satisfaction, move-outs, applicant generation, screening UI. The core premise is
now real.

**Phase 4 — Economy.** Rent, expenses, repairs, ledger, and shared-space
upgrades as the first money sink. Pressure on decisions.

**Phase 5 — VN presentation.** Space backdrops, character portraits driven by
world state, scene transitions, dialogue presentation. Where it stops looking
like a chat app.

**Phase 6 — The Director takes over.** Replace Phase 2's simple scheduler with
`directorService`: mood- and relationship-aware placement, emergent incidents,
tenant-to-tenant friction, arcs. The layer that makes each playthrough differ.

*Note the ordering:* Phase 2 ships a dumb deterministic scheduler so the game is
playable without LLM cost or latency, and Phase 6 swaps in the Director behind
the same `occupancy` interface. That keeps the fun loop testable early and makes
Director quality an isolated variable rather than a confound.

---

## 5. Settled

- **House scale** — configurable per house, not a global constant. A starter
  house ships with ~4 bedrooms and 3 shared spaces as a default, but nothing in
  the schema assumes a count.
- **Room kinds** — bedrooms and shared spaces are separate tables, not one table
  with a flag. They differ in occupancy, ownership, economy, and role in play.
- **Multiple houses** — supported, one active at a time via `houses.isActive`.

## 6. Open Questions

- **Player presence** — do you live in the house or visit it? Affects whether
  you occupy a bedroom slot and whether "your room" is a space.
- **Time cost** — does every scene consume a phase, or only some actions?
  Cheap to change later; worth guessing and playtesting.
- **Tenant autonomy** — should tenants interact with each other off-screen and
  report it, or only exist when observed? Now partly answered by design: the
  `occupancy` log means tenants *are* somewhere every phase whether or not you
  look. The open part is whether the Director narrates what happened between
  them while you were elsewhere.
- **Shared-space upgrade depth** — is a space a simple tier ladder (basic →
  good → great), or does it hold discrete named upgrades? The schema currently
  supports both; the UI in Phase 4 will have to pick.
