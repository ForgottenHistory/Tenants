/**
 * What money is for.
 *
 * The house is a thing you spend on, not just a thing you collect rent from.
 * Costs live here rather than in the service because the upgrade page has to
 * quote the price before the player commits, and quoting a different number
 * than the server charges would be worse than not quoting one at all.
 */

/** Price of the first bedroom added to a house that already has none. */
export const BEDROOM_BUILD_BASE_COST = 2000;

/**
 * Each existing bedroom makes the next one this much more expensive.
 *
 * Flat pricing makes expansion trivial the moment rent outpaces it — one good
 * week and the only decision left is how fast you click. Scaling keeps the
 * fourth room a choice and the tenth a project.
 */
export const BEDROOM_BUILD_COST_GROWTH = 1.35;

/** Costs are rounded to this, so the quoted price reads as a price. */
export const BEDROOM_BUILD_COST_ROUNDING = 50;

/**
 * What it costs to build the next bedroom in a house that has `existing` of
 * them. Pure and shared: the page quotes it, the service charges it.
 */
export function bedroomBuildCost(existing: number): number {
	const raw = BEDROOM_BUILD_BASE_COST * Math.pow(BEDROOM_BUILD_COST_GROWTH, Math.max(0, existing));
	return Math.round(raw / BEDROOM_BUILD_COST_ROUNDING) * BEDROOM_BUILD_COST_ROUNDING;
}
