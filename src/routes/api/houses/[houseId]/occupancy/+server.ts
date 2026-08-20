import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseService } from '$lib/server/services/houseService';
import { occupancyService } from '$lib/server/services/occupancyService';

// POST /api/houses/[houseId]/occupancy - Move a tenant to a room by hand.
//
// Placement is normally a weighted roll on phase advance. This overrides it for
// the current phase only: the day and phase come from the house rather than the
// request, so a client can't rewrite history or place someone in the future.
export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	if (!Number.isFinite(houseId)) return json({ error: 'Invalid house id' }, { status: 400 });

	try {
		const house = await houseService.getHouseById(houseId, parseInt(userId));
		if (!house) return json({ error: 'House not found' }, { status: 404 });

		const { tenantId, placeKind, placeId, activity } = await request.json();

		if (!Number.isFinite(tenantId)) {
			return json({ error: 'Invalid tenant id' }, { status: 400 });
		}
		if (placeKind !== 'bedroom' && placeKind !== 'shared' && placeKind !== 'away') {
			return json({ error: 'Invalid place kind' }, { status: 400 });
		}
		if (placeKind === 'shared' && !Number.isFinite(placeId)) {
			return json({ error: 'Pick a room' }, { status: 400 });
		}

		const written = await occupancyService.placeTenant(houseId, tenantId, house.day, house.phase, {
			placeKind,
			placeId: placeKind === 'shared' ? placeId : null,
			activity: typeof activity === 'string' ? activity : ''
		});

		return json({ occupancy: written });
	} catch (error) {
		console.error('Failed to place tenant:', error);
		const message = error instanceof Error ? error.message : 'Failed to place tenant';
		if (message.includes('not found')) return json({ error: message }, { status: 404 });
		// The invariants placeTenant guards — someone else's room, a locked space,
		// a tenant with no room — are all bad requests rather than server faults.
		return json({ error: message }, { status: 400 });
	}
};
