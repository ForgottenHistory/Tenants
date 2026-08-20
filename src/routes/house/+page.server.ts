import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUserById } from '$lib/server/auth';
import { houseService } from '$lib/server/services/houseService';
import { tenantService } from '$lib/server/services/tenantService';
import { occupancyService } from '$lib/server/services/occupancyService';
import { houseSceneService } from '$lib/server/services/houseSceneService';
import { relationService } from '$lib/server/services/relationService';
import { LEASE_WARNING_DAYS } from '$lib/house/tenancy';

export const load: PageServerLoad = async ({ cookies }) => {
	const userId = cookies.get('userId');

	if (!userId) {
		throw redirect(303, '/login');
	}

	const user = await getUserById(parseInt(userId));

	if (!user) {
		cookies.delete('userId', { path: '/' });
		throw redirect(303, '/login');
	}

	const activeHouse = await houseService.getActiveHouse(user.id);

	// No house to show — Home is where you start one.
	if (!activeHouse) {
		throw redirect(303, '/');
	}

	const summary = await houseService.getHouseSummary(activeHouse.id, user.id);

	if (!summary) {
		throw redirect(303, '/');
	}

	const roster = await tenantService.getActiveTenants(activeHouse.id);

	// Fill in the current phase if it has never been placed — houses created
	// before the day cycle existed, or a phase whose tenants have changed.
	const presence =
		roster.length > 0
			? await occupancyService.ensureForPhase(activeHouse.id, activeHouse.day, activeHouse.phase)
			: { bySpace: new Map(), byBedroom: new Map(), away: [] };

	// What needs the player's attention: unfinished business, and leases running
	// out. Both are reasons to go and talk to someone.
	const openThreads = await houseSceneService.openThreadsForHouse(
		activeHouse.id,
		activeHouse.day
	);

	const expiring = roster
		.map((entry) => ({
			tenantId: entry.tenant.id,
			characterName: entry.character.name,
			characterImage: entry.character.thumbnailData || entry.character.imageData,
			room: entry.bedroom?.name ?? null,
			daysLeft: entry.tenant.leaseEndDay - activeHouse.day
		}))
		.filter((t) => t.daysLeft <= LEASE_WARNING_DAYS)
		.sort((a, b) => a.daysLeft - b.daysLeft);

	// What the housemates have been doing off-screen, where they stand, and the
	// scenes that have been condensed into memory.
	const [houseEvents, rumours, relations, sceneSummaries] = await Promise.all([
		relationService.getRecentEvents(activeHouse.id),
		relationService.getRecentRumours(activeHouse.id),
		relationService.getHouseRelations(activeHouse.id),
		houseSceneService.getSummarisedScenes(activeHouse.id, 20)
	]);

	// Maps don't survive serialisation to the client — send plain arrays.
	return {
		user,
		summary,
		tenants: roster,
		presence: {
			bySpace: Object.fromEntries(presence.bySpace),
			byBedroom: Object.fromEntries(presence.byBedroom),
			away: presence.away
		},
		openThreads,
		expiring,
		houseEvents,
		rumours,
		relations,
		sceneSummaries
	};
};
