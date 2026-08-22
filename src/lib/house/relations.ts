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
 * How much a moment mattered.
 *
 * Rolled, not chosen: a model asked to pick its own magnitude drifts to the
 * middle, so left to itself the Director produces an endless run of 5s and
 * nobody ever reaches a band. Rolling the tier first and handing it over as a
 * constraint is what makes a genuine blowup — or a real kindness — possible.
 */
export type EventIntensity = 'minor' | 'notable' | 'major';

/**
 * The tiers, their delta ranges, and how often each comes up.
 *
 * `major` deliberately reaches past the old ceiling of 8. Under a flat 4-8
 * spread, positives and negatives cancel and a pair drifts around Neutral
 * forever — the Close and Hostile bands at ±60 were effectively unreachable.
 * The rare big event is what actually moves a pair somewhere.
 *
 * Weights are symmetric across valence: a major event is as likely to be a row
 * as a kindness, so a house can genuinely go bad if the dice run cold. That is
 * what makes Hostile mean something when you see it.
 */
export const EVENT_INTENSITY: Record<
	EventIntensity,
	{ min: number; max: number; weight: number; label: string }
> = {
	minor: { min: 2, max: 4, weight: 55, label: 'small — barely worth mentioning' },
	notable: { min: 5, max: 8, weight: 33, label: 'notable — they will both remember it' },
	major: { min: 10, max: 15, weight: 12, label: 'major — a real row, or real generosity' }
};

/**
 * How fast the house's relationships move.
 *
 * Scales every delta, so pairs reach Warm, Close, Cool and Hostile in
 * proportionally fewer events. Nothing else changes: the same moments happen
 * just as often, and the same tier comes up just as often — they simply count
 * for more.
 *
 * Note this scales the tier *ranges*, which is why the tier a delta belongs to
 * is worked out from scaled bounds rather than raw numbers. A "small" moment in
 * Fast mode is small relative to Fast mode. Scaling the number while leaving
 * the Director's label alone would have it write "barely worth mentioning" for
 * something worth as much as a major row.
 */
export type EventPace = 'normal' | 'fast';

export const EVENT_PACE: Record<EventPace, { multiplier: number; label: string }> = {
	normal: { multiplier: 1, label: 'Normal' },
	fast: { multiplier: 2.5, label: 'Fast' }
};

/** Read a stored pace, treating anything unrecognised as the default. */
export function eventPace(value: string | null | undefined): EventPace {
	return value === 'fast' ? 'fast' : 'normal';
}

/** A tier's delta range at this pace. */
export function intensityRange(
	intensity: EventIntensity,
	pace: EventPace = 'normal'
): { min: number; max: number } {
	const { multiplier } = EVENT_PACE[pace];
	const { min, max } = EVENT_INTENSITY[intensity];
	return { min: Math.round(min * multiplier), max: Math.round(max * multiplier) };
}

/** Draw an intensity tier by weight. */
export function rollIntensity(): EventIntensity {
	const tiers = Object.entries(EVENT_INTENSITY) as Array<
		[EventIntensity, (typeof EVENT_INTENSITY)[EventIntensity]]
	>;
	const total = tiers.reduce((sum, [, t]) => sum + t.weight, 0);
	let roll = Math.random() * total;
	for (const [id, tier] of tiers) {
		roll -= tier.weight;
		if (roll <= 0) return id;
	}
	return 'minor';
}

/** A delta for this tier and direction, rolled within the tier's range. */
export function rollDelta(
	intensity: EventIntensity,
	positive: boolean,
	pace: EventPace = 'normal'
): number {
	const { min, max } = intensityRange(intensity, pace);
	const magnitude = min + Math.floor(Math.random() * (max - min + 1));
	return positive ? magnitude : -magnitude;
}

/**
 * Which tier an authored delta belongs to, so the static pools sort themselves.
 *
 * Always judged at normal pace: the pools are authored numbers written to the
 * unscaled ranges, and a pace setting shouldn't retroactively promote every
 * existing line to `minor`.
 */
export function intensityOf(delta: number): EventIntensity {
	const magnitude = Math.abs(delta);
	if (magnitude >= EVENT_INTENSITY.major.min) return 'major';
	if (magnitude >= EVENT_INTENSITY.notable.min) return 'notable';
	return 'minor';
}

/**
 * What kind of thing happened, as a prompt for the Director rather than a line
 * of text.
 *
 * The static pools carry ~8 finished sentences per phase, so the same coffee
 * and the same leftovers come round every few days. Handing the Director a
 * *type* instead lets it write a different specific moment each time while
 * still being told what shape the moment takes.
 *
 * Keyed by phase for the same reason the pools are: the bathroom queue is a
 * morning problem and noise through the wall is a night one.
 */
export const EVENT_KINDS: Record<PhaseId, string[]> = {
	morning: [
		'a conversation over breakfast',
		'the bathroom or the hot water',
		'a small favour, done or not done',
		'noise, timing, or someone still asleep',
		'the state of the kitchen',
		'leaving the house at the same time',
		'talking about another housemate who was not there',
		'talking about {{user}}, the landlord'
	],
	afternoon: [
		'running into each other out of the house',
		'a favour asked or returned',
		'chores, or whose turn it was',
		'borrowing something',
		'a conversation that went somewhere unexpected',
		'shared space being used by one of them',
		'talking about another housemate who was not there',
		'talking about {{user}}, the landlord'
	],
	evening: [
		'cooking, or food',
		'a long conversation on the couch',
		'plans, guests, or someone having people over',
		'something they watched or did together',
		'a disagreement that had been building',
		'one of them needing something from the other',
		'talking about another housemate who was not there',
		'talking about {{user}}, the landlord'
	],
	night: [
		'noise late at night',
		'one of them getting home late',
		'a quiet conversation neither expected to have',
		'locking up, lights, or the state of the house',
		'crossing paths on the landing',
		'one of them waiting up, or worrying',
		'talking about another housemate who was not there',
		'talking about {{user}}, the landlord'
	]
};

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
