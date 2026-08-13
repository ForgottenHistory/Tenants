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
