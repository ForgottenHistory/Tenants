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

/** Satisfaction bands, used for roster display and (later) renewal decisions. */
export function satisfactionLabel(value: number): string {
	if (value >= 80) return 'Happy';
	if (value >= 60) return 'Content';
	if (value >= 40) return 'Restless';
	if (value >= 20) return 'Unhappy';
	return 'Miserable';
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
