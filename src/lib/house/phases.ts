/**
 * The day cycle. `houses.phase` is an index into this array.
 *
 * Kept as shared client/server constants so the setup form, the house view, and
 * the eventual House Director all agree on what a "phase" is.
 */
export const HOUSE_PHASES = [
	{ id: 'morning', label: 'Morning' },
	{ id: 'afternoon', label: 'Afternoon' },
	{ id: 'evening', label: 'Evening' },
	{ id: 'night', label: 'Night' }
] as const;

export type PhaseId = (typeof HOUSE_PHASES)[number]['id'];

export const PHASES_PER_DAY = HOUSE_PHASES.length;

export function phaseLabel(phase: number): string {
	return HOUSE_PHASES[phase]?.label ?? 'Unknown';
}

export function phaseId(phase: number): PhaseId {
	return HOUSE_PHASES[phase]?.id ?? 'morning';
}

/**
 * The week. Day 1 of a house is a Monday, so the counter and the weekday stay
 * in step without storing anything extra: the weekday is derived from `day`.
 *
 * Kept as a derived value rather than a column so existing houses gain weekdays
 * for free, and there is no way for the two to drift apart.
 */
export const WEEKDAYS = [
	{ id: 'monday', label: 'Monday', short: 'Mon' },
	{ id: 'tuesday', label: 'Tuesday', short: 'Tue' },
	{ id: 'wednesday', label: 'Wednesday', short: 'Wed' },
	{ id: 'thursday', label: 'Thursday', short: 'Thu' },
	{ id: 'friday', label: 'Friday', short: 'Fri' },
	{ id: 'saturday', label: 'Saturday', short: 'Sat' },
	{ id: 'sunday', label: 'Sunday', short: 'Sun' }
] as const;

export type WeekdayId = (typeof WEEKDAYS)[number]['id'];

export const DAYS_PER_WEEK = WEEKDAYS.length;

/** Which weekday a given day number falls on. Day 1 is Monday. */
export function weekday(day: number): (typeof WEEKDAYS)[number] {
	// Guard against day 0 or negatives so a malformed value can't wrap oddly.
	const index = ((Math.max(1, day) - 1) % DAYS_PER_WEEK + DAYS_PER_WEEK) % DAYS_PER_WEEK;
	return WEEKDAYS[index];
}

export function weekdayLabel(day: number): string {
	return weekday(day).label;
}

export function weekdayShort(day: number): string {
	return weekday(day).short;
}

/** Which week the house is in. Day 1-7 is week 1. */
export function weekNumber(day: number): number {
	return Math.floor((Math.max(1, day) - 1) / DAYS_PER_WEEK) + 1;
}

export function isWeekend(day: number): boolean {
	const id = weekday(day).id;
	return id === 'saturday' || id === 'sunday';
}

/**
 * Advance one phase, rolling over into the next day.
 * Returns the new { day, phase } without mutating anything.
 */
export function nextPhase(day: number, phase: number): { day: number; phase: number } {
	const next = phase + 1;
	if (next >= PHASES_PER_DAY) {
		return { day: day + 1, phase: 0 };
	}
	return { day, phase: next };
}

/**
 * How likely a tenant is to be in each kind of place, per phase.
 *
 * Random placement alone reads as noise — people teleporting around the house
 * with no rhythm. Weighting by time of day is what makes a day feel like a day:
 * mornings are quiet, afternoons empty out, evenings are social, nights send
 * everyone to bed. The House Director replaces this later with mood- and
 * relationship-aware placement, but the shape of a day should stay recognisable.
 *
 * Weights are relative, not percentages.
 */
export const PHASE_PLACEMENT_WEIGHTS: Record<PhaseId, { bedroom: number; shared: number; away: number }> = {
	morning: { bedroom: 4, shared: 4, away: 2 },
	afternoon: { bedroom: 2, shared: 3, away: 5 },
	evening: { bedroom: 2, shared: 6, away: 2 },
	night: { bedroom: 7, shared: 2, away: 1 }
};
