/**
 * Tenancy constants shared by client and server.
 */

/** Default lease length in days when signing someone in. */
/**
 * Rough token count for a string.
 *
 * ~4 characters per token is the usual English approximation. Deliberately not
 * a real tokenizer: this only decides how many scene summaries fit in a recall
 * budget, so being a little conservative costs a sentence of history, not
 * correctness. A real tokenizer would mean a dependency and a per-model table
 * for something that never needs to be exact.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export const DEFAULT_LEASE_DAYS = 30;

/**
 * Whether a lease running out actually moves the tenant out on day rollover.
 *
 * Off for now. Expiry was the only automatic departure in the game, and it
 * fired unconditionally: a tenant at 95 satisfaction left on the same day as
 * one at 5, with no renewal step and nothing the player could do about it, so
 * everyone housed simply vanished within DEFAULT_LEASE_DAYS. Until there is a
 * renewal decision to run at that moment, leases are kept as a displayed term
 * rather than a hard eviction — moving out stays a deliberate act via
 * `tenantService.moveOut()`.
 *
 * Turning this back on restores the old behaviour exactly; the expiry code is
 * gated, not removed.
 */
export const LEASE_EXPIRY_ENABLED = false;

/**
 * How close a lease has to be to expiry before the house panel flags it.
 * Roughly a week's notice — long enough to do something about it.
 */
export const LEASE_WARNING_DAYS = 7;

/** How many applicants to draw when refreshing the door. */
export const APPLICANTS_PER_VACANCY = 3;

/**
 * Satisfaction is how a tenant feels about **living here** — the room, the
 * upkeep, whether things get dealt with. It is not a relationship meter: being
 * liked is not the same as being a good landlord, and nothing here should read
 * as affection.
 *
 * All movement is gathered here so difficulty is one file to tune.
 */
export const SATISFACTION = {
	/** Where a new tenant starts. Mildly positive — they chose to move in. */
	INITIAL: 70,

	/**
	 * Chance per day that something goes quietly wrong for a tenant, and how far
	 * it knocks them. Small and random so the house feels like it needs upkeep
	 * without being a treadmill.
	 */
	DAILY_DROP_CHANCE: 0.25,
	DAILY_DROP_MIN: 2,
	DAILY_DROP_MAX: 5,

	/**
	 * Spending a scene with someone. Once per day per tenant: talking twice in
	 * one day shouldn't farm the meter, and it stops phase-spam being optimal.
	 */
	SCENE_GAIN: 3,

	/** Settling something they asked for, or a promise you made them. */
	RESOLVED_REQUEST_GAIN: 8,
	RESOLVED_PROMISE_GAIN: 10,

	/**
	 * Letting a dated promise lapse. Charged once, on the day it goes overdue,
	 * not every day after — the sting is missing it, not the ongoing state.
	 */
	BROKEN_PROMISE_PENALTY: 12,

	MIN: 0,
	MAX: 100
} as const;

/** Keep satisfaction inside its bounds. */
export function clampSatisfaction(value: number): number {
	return Math.max(SATISFACTION.MIN, Math.min(SATISFACTION.MAX, Math.round(value)));
}

/**
 * What actually went wrong when the daily drift fires.
 *
 * The drift used to record "something around the house", which meant a tenant
 * lost satisfaction over nothing nameable — and since the reason never reached
 * the prompt, mentioning it to them got a blank look. These are concrete enough
 * for a character to raise unprompted and for the player to do something about.
 *
 * Written from the tenant's point of view, since that is how they land in the
 * prompt: "the shower runs cold" not "shower is broken".
 */
export const HOUSE_GRIPES = [
	'the shower keeps running cold',
	'a tap has started dripping and nobody has looked at it',
	'the heating is uneven — some rooms never warm up',
	'the wifi keeps dropping out',
	'a window latch is loose and rattles in the wind',
	'the kitchen bin is overflowing again',
	'there is damp starting in one corner',
	'a light fitting flickers and nobody has changed it',
	'the front door sticks and needs shoving',
	'the fridge is making a noise at night',
	'a radiator is cold no matter what the thermostat says',
	'the bathroom lock does not catch properly',
	'the stairs creak badly enough to wake people',
	'the hot water runs out if two people shower',
	'a drain is slow and starting to smell'
] as const;

/** Pick a gripe at random. */
export function randomGripe(): string {
	return HOUSE_GRIPES[Math.floor(Math.random() * HOUSE_GRIPES.length)];
}

/** Satisfaction bands, used for roster display and (later) renewal decisions. */
export function satisfactionLabel(value: number): string {
	if (value >= 80) return 'Happy';
	if (value >= 60) return 'Content';
	if (value >= 40) return 'Restless';
	if (value >= 20) return 'Unhappy';
	return 'Miserable';
}

/**
 * Satisfaction as a sentence for the prompt, rather than the one-word band the
 * UI shows.
 *
 * Deliberately about **living here**, not about the landlord personally — the
 * same distinction the whole satisfaction system rests on. Phrased as how they
 * feel and how they'd behave, because a bare number or label gives a model
 * nothing to act on.
 */
export function satisfactionMood(value: number): string {
	if (value >= 80) {
		return 'They are happy living here and have no complaints worth raising.';
	}
	if (value >= 60) {
		return 'They are content enough here, with nothing serious on their mind.';
	}
	if (value >= 40) {
		return 'They are restless about the place — willing to say so if asked directly.';
	}
	if (value >= 20) {
		return 'They are unhappy with the state of the place and will not hide it if it comes up.';
	}
	return 'They are miserable here and close to giving up on the place; it colours everything they say.';
}

/** CSS custom property to colour a satisfaction value with. */
export function satisfactionColor(value: number): string {
	if (value >= 60) return 'var(--success)';
	if (value >= 40) return 'var(--warning)';
	return 'var(--error)';
}

/** Days remaining on a lease, given the house's current day. */
export function daysRemaining(leaseEndDay: number, currentDay: number): number {
	return Math.max(0, leaseEndDay - currentDay);
}
