/**
 * Tenancy constants shared by client and server.
 */

/** Default lease length in days when signing someone in. */
export const DEFAULT_LEASE_DAYS = 30;

/** How many applicants to draw when refreshing the door. */
export const APPLICANTS_PER_VACANCY = 3;

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
