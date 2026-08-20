import type { PhaseId } from './phases';

/**
 * What a tenant is doing where they are.
 *
 * Two kinds of pool, split by what owns them:
 *
 * - **Bedroom and away are per character** (`characters.activityPools`). Every
 *   character has a room and can leave the house, in any house, and the four
 *   phases are the same everywhere — so these travel with the character.
 * - **Shared spaces are generic** (below). Houses define their own spaces, so a
 *   character can't carry lines for a room that may not exist. These are keyed
 *   by space *kind* instead.
 *
 * The generic bedroom/away lists here are the fallback for characters with no
 * pools of their own — an imported card works immediately, just blandly.
 */

type SpaceKind = 'kitchen' | 'lounge' | 'yard' | 'utility' | 'other';

/** Per-character pools, as stored in `characters.activityPools`. */
export interface ActivityPools {
	bedroom?: Partial<Record<PhaseId, string[]>>;
	away?: Partial<Record<PhaseId, string[]>>;
}

const DEFAULT_BEDROOM: Record<PhaseId, string[]> = {
	morning: ['just waking up', 'getting dressed', 'still in bed', 'scrolling their phone'],
	afternoon: ['reading', 'napping', 'on a call', 'keeping to themselves'],
	evening: ['winding down', 'listening to music', 'tidying up', 'on their laptop'],
	night: ['asleep', 'reading in bed', 'lights already off', 'up late']
};

const DEFAULT_AWAY: Record<PhaseId, string[]> = {
	morning: ['out early', 'at work', 'running errands'],
	afternoon: ['at work', 'out with friends', 'across town', 'running errands'],
	evening: ['out for the evening', 'still at work', 'meeting someone'],
	night: ['out late', 'not home yet', 'staying elsewhere']
};

const SHARED_ACTIVITIES: Record<SpaceKind, string[]> = {
	kitchen: ['making coffee', 'cooking', 'raiding the fridge', 'washing up', 'eating at the counter'],
	lounge: ['on the couch', 'watching something', 'sprawled across the sofa', 'half-watching TV'],
	yard: ['getting some air', 'on the phone', 'sitting outside', 'watching the street'],
	utility: ['doing laundry', 'looking for something', 'sorting through boxes'],
	other: ['passing through', 'hanging around', 'killing time']
};

function pick(options: string[]): string {
	return options[Math.floor(Math.random() * options.length)];
}

/** Parse the stored JSON, tolerating null and malformed data. */
export function parseActivityPools(raw: string | null | undefined): ActivityPools {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * What they're doing in their own room. Uses the character's own lines for this
 * phase when they have any, otherwise the generic list.
 */
export function bedroomActivity(phase: PhaseId, pools?: ActivityPools): string {
	const own = pools?.bedroom?.[phase];
	if (own && own.length > 0) return pick(own);
	return pick(DEFAULT_BEDROOM[phase]);
}

/** What they're doing while out of the house. */
export function awayActivity(phase: PhaseId, pools?: ActivityPools): string {
	const own = pools?.away?.[phase];
	if (own && own.length > 0) return pick(own);
	return pick(DEFAULT_AWAY[phase]);
}

/**
 * What they're doing in a shared space.
 *
 * Keyed to the room rather than the character: the space belongs to the house,
 * so a character can't carry lines for it. A space with its own pool uses that;
 * otherwise it falls back to the generic lines for its kind.
 */
export function sharedActivity(kind: string, pool?: string[] | null): string {
	if (pool && pool.length > 0) return pick(pool);
	const key: SpaceKind = (kind as SpaceKind) in SHARED_ACTIVITIES ? (kind as SpaceKind) : 'other';
	return pick(SHARED_ACTIVITIES[key]);
}

/**
 * The bedroom lines available for a phase, rather than one drawn from them.
 *
 * `bedroomActivity` picks; this lists. Moving someone by hand needs the whole
 * pool on screen to choose from, and falls back to the generic list exactly as
 * the picker does so the offered options match what the roll could have given.
 */
export function bedroomActivityOptions(phase: PhaseId, pools?: ActivityPools): string[] {
	const own = pools?.bedroom?.[phase];
	return own && own.length > 0 ? [...own] : [...DEFAULT_BEDROOM[phase]];
}

/** The away lines available for a phase. See `bedroomActivityOptions`. */
export function awayActivityOptions(phase: PhaseId, pools?: ActivityPools): string[] {
	const own = pools?.away?.[phase];
	return own && own.length > 0 ? [...own] : [...DEFAULT_AWAY[phase]];
}

/** The lines available in a shared space. See `bedroomActivityOptions`. */
export function sharedActivityOptions(kind: string, pool?: string[] | null): string[] {
	if (pool && pool.length > 0) return [...pool];
	const key: SpaceKind = (kind as SpaceKind) in SHARED_ACTIVITIES ? (kind as SpaceKind) : 'other';
	return [...SHARED_ACTIVITIES[key]];
}

/** Parse a space's stored pool, tolerating null and malformed data. */
export function parseSpacePool(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string' && v.trim()) : [];
	} catch {
		return [];
	}
}

/** The generic lines for a space kind, for seeding an editor. */
export function defaultSpacePool(kind: string): string[] {
	const key: SpaceKind = (kind as SpaceKind) in SHARED_ACTIVITIES ? (kind as SpaceKind) : 'other';
	return [...SHARED_ACTIVITIES[key]];
}

/** The generic lists, for seeding an editor with sensible starting values. */
export const DEFAULT_ACTIVITY_POOLS = {
	bedroom: DEFAULT_BEDROOM,
	away: DEFAULT_AWAY
} as const;
