import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUserById } from '$lib/server/auth';
import { houseService } from '$lib/server/services/houseService';
import { tenantService } from '$lib/server/services/tenantService';
import { occupancyService } from '$lib/server/services/occupancyService';
import { db } from '$lib/server/db';
import { characters } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ cookies }) => {
	const userId = cookies.get('userId');

	if (!userId) {
		throw redirect(303, '/login');
	}

	const user = await getUserById(parseInt(userId));

	if (!user) {
		// Invalid session, clear cookie and redirect
		cookies.delete('userId', { path: '/' });
		throw redirect(303, '/login');
	}

	// Home has three states, and they need different data:
	//   no house          → start one
	//   house, no tenants → find the first tenant (a house with nobody in it
	//                       has nothing to do, so this is a hard gate)
	//   house + tenants   → resume
	const activeHouse = await houseService.getActiveHouse(user.id);
	const summary = activeHouse ? await houseService.getHouseSummary(activeHouse.id, user.id) : null;
	const houseCount = (await houseService.getAllHouses(user.id)).length;

	// Only needed for the empty-house state: whether there are applicants
	// waiting, and whether the library can even supply any.
	let applicantCount = 0;
	let libraryCount = 0;
	if (activeHouse && summary?.occupiedBedrooms === 0) {
		const [applicants, library] = await Promise.all([
			tenantService.getApplicants(activeHouse.id),
			db.select({ id: characters.id }).from(characters).where(eq(characters.userId, user.id))
		]);
		applicantCount = applicants.length;
		libraryCount = library.length;
	}

	// The cast is the point of the game, so Home shows who lives here and where
	// they are right now — not just a bedroom count.
	let residents: Array<{
		id: number;
		name: string;
		image: string | null;
		room: string | null;
		activity: string | null;
		where: string | null;
	}> = [];

	if (activeHouse && summary && summary.occupiedBedrooms > 0) {
		const roster = await tenantService.getActiveTenants(activeHouse.id);
		const presence = await occupancyService.getForPhase(
			activeHouse.id,
			activeHouse.day,
			activeHouse.phase
		);

		// Flatten placement into "where is this tenant" so the view doesn't have
		// to reason about three different maps.
		const placeByTenant = new Map<number, { where: string; activity: string | null }>();
		for (const [spaceId, list] of presence.bySpace) {
			const space = summary.spaces.find((s) => s.id === spaceId);
			for (const p of list) {
				placeByTenant.set(p.tenant.id, {
					where: space?.name ?? 'a shared space',
					activity: p.occupancy.activity
				});
			}
		}
		for (const [bedroomId, p] of presence.byBedroom) {
			const room = summary.bedrooms.find((b) => b.id === bedroomId);
			placeByTenant.set(p.tenant.id, {
				where: room?.name ?? 'their room',
				activity: p.occupancy.activity
			});
		}
		for (const p of presence.away) {
			placeByTenant.set(p.tenant.id, { where: 'Out', activity: p.occupancy.activity });
		}

		residents = roster.map((entry) => {
			const placed = placeByTenant.get(entry.tenant.id);
			return {
				id: entry.character.id,
				name: entry.character.name,
				// Full image, not the thumbnail: these render as large portrait cards.
				// thumbnailData is 128x170 and visibly blurs when scaled up (the
				// library follows the same rule — big card = imageData).
				image: entry.character.imageData || entry.character.thumbnailData,
				room: entry.bedroom?.name ?? null,
				activity: placed?.activity ?? null,
				where: placed?.where ?? null
			};
		});
	}

	return {
		user,
		summary,
		houseCount,
		applicantCount,
		libraryCount,
		residents
	};
};
