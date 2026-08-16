/**
 * How tenants feel about **each other** — as distinct from `satisfaction`,
 * which is how they feel about the housing.
 *
 * Relations move through off-screen life: the interactions that happen between
 * housemates while the player is elsewhere. Rolled once per phase advance, so
 * the house keeps living when you aren't watching, and each phase has its own
 * flavour of event — people bicker over the bathroom in the morning, not at 2am.
 *
 * Every number lives here so the feel of the house is one file to tune.
 */

import type { PhaseId } from './phases';

export const RELATION = {
	/** Where two tenants start when they first share a house. Strangers. */
	INITIAL: 0,

	/**
	 * Chance that any given pair has an off-screen moment on a phase advance.
	 * Deliberately low: the house should feel alive, not soap-operatic, and with
	 * N tenants there are N*(N-1)/2 pairs rolling every phase.
	 */
	EVENT_CHANCE: 0.28,

	/**
	 * Cap on how many events one phase advance can produce, however many pairs
	 * exist. A wall of notifications reads as noise rather than as a house.
	 */
	MAX_EVENTS_PER_PHASE: 3,

	MIN: -100,
	MAX: 100
} as const;

/** Keep a relation score inside its bounds. */
export function clampRelation(value: number): number {
	return Math.max(RELATION.MIN, Math.min(RELATION.MAX, Math.round(value)));
}

/**
 * Relation bands. Mirrors `satisfactionLabel` — the score is the truth, the
 * band is what gets shown and (later) what a character acts on.
 */
export function relationLabel(value: number): string {
	if (value >= 60) return 'Close';
	if (value >= 25) return 'Warm';
	if (value > -25) return 'Neutral';
	if (value > -60) return 'Cool';
	return 'Hostile';
}

/** CSS custom property to colour a relation value with. */
export function relationColor(value: number): string {
	if (value >= 25) return 'var(--success)';
	if (value > -25) return 'var(--text-muted)';
	if (value > -60) return 'var(--warning)';
	return 'var(--error)';
}

/**
 * An off-screen moment between two housemates.
 *
 * `text` is a template with {a} and {b} for the two names. Keeping names out of
 * the stored string would mean re-resolving characters on every read; keeping
 * them in means the log stays readable even after someone moves out.
 */
export interface RelationEvent {
	text: string;
	/** How far this shifts the pair's score. Negative sours it. */
	delta: number;
}

/**
 * Event pools, keyed by phase. Each phase has its own rhythm — the bathroom
 * queue is a morning problem, noise complaints are a night one — so the same
 * pair reads differently depending on when you advance.
 *
 * Positive and negative live in one pool per phase and are picked together, so
 * the odds of a good or bad day fall out of the mix rather than a second roll.
 */
export const RELATION_EVENTS: Record<PhaseId, RelationEvent[]> = {
	morning: [
		{ text: '{a} made coffee for {b} without being asked.', delta: 6 },
		{ text: '{a} and {b} ended up eating breakfast together.', delta: 5 },
		{ text: '{a} left the last of the milk for {b}.', delta: 4 },
		{ text: '{a} and {b} talked in the hallway longer than either meant to.', delta: 5 },
		{ text: '{a} took a long shower while {b} was waiting.', delta: -5 },
		{ text: '{a} used the last of the hot water. {b} noticed.', delta: -6 },
		{ text: "{a}'s alarm went off six times. {b} counted.", delta: -4 },
		{ text: '{a} and {b} bickered about the state of the sink.', delta: -5 }
	],
	afternoon: [
		{ text: '{a} picked something up for {b} while they were out.', delta: 7 },
		{ text: '{a} and {b} ran into each other in town and walked back together.', delta: 6 },
		{ text: '{a} helped {b} carry something heavy up the stairs.', delta: 6 },
		{ text: '{a} covered a chore that was really {b}’s to do.', delta: 5 },
		{ text: '{a} borrowed something of {b}’s without asking.', delta: -7 },
		{ text: '{a} left a mess in the kitchen for {b} to find.', delta: -6 },
		{ text: '{a} and {b} disagreed about the thermostat. Again.', delta: -4 },
		{ text: '{a} ignored {b} entirely on the way past.', delta: -5 }
	],
	evening: [
		{ text: '{a} and {b} cooked together and it actually went well.', delta: 8 },
		{ text: '{a} and {b} stayed up talking on the couch.', delta: 7 },
		{ text: '{a} shared a drink with {b} and neither mentioned the rent.', delta: 6 },
		{ text: '{a} and {b} watched something together, half-arguing about it.', delta: 5 },
		{ text: '{a} ate the leftovers {b} was saving.', delta: -8 },
		{ text: '{a} had people over without telling {b}.', delta: -6 },
		{ text: '{a} and {b} had a short, sharp argument about the washing up.', delta: -7 },
		{ text: '{a} made a comment about {b} that did not land well.', delta: -5 }
	],
	night: [
		{ text: '{a} waited up to make sure {b} got home.', delta: 8 },
		{ text: '{a} and {b} ended up talking in the dark kitchen at 1am.', delta: 7 },
		{ text: '{a} quietly locked up after {b} forgot.', delta: 5 },
		{ text: '{a} kept {b} awake with music through the wall.', delta: -7 },
		{ text: '{a} came in loudly at 3am. {b} was already awake.', delta: -6 },
		{ text: '{a} left every light on. {b} turned them off, again.', delta: -4 },
		{ text: '{a} and {b} avoided each other on the landing.', delta: -5 }
	]
};

/** Fill {a} and {b} in an event template. */
export function formatRelationEvent(text: string, aName: string, bName: string): string {
	return text.replace(/\{a\}/g, aName).replace(/\{b\}/g, bName);
}

/**
 * What kind of thing happened. `relation` is the off-screen moment between two
 * housemates; the others are household facts that everyone living here would
 * simply know, and which characters should be able to mention.
 */
export type HouseEventKind = 'relation' | 'move_in' | 'move_out';

/**
 * How far back the events fed into scene context reach, in days. The user
 * setting (`users.eventRecallDays`) overrides this; it is the factory value.
 *
 * Days rather than a count: this is "what everyone in the house is aware of",
 * and recency is a matter of when, not how many. The log page is the archive.
 */
export const EVENT_RECALL_DAYS_DEFAULT = 3;

/** Bounds for the setting, so the slider and the API agree. */
export const EVENT_RECALL_DAYS_MAX = 14;

/**
 * Absolute ceiling on event lines in one prompt, whatever the day window.
 *
 * A full house can produce several events per phase — twelve a day is possible
 * — and every line is paid for on every message of every scene. The day window
 * decides how far back to look; this stops one wild week from swallowing the
 * context window.
 */
export const EVENT_HARD_CAP = 20;
