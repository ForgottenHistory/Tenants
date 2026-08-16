import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseService } from '$lib/server/services/houseService';
import { tenantService } from '$lib/server/services/tenantService';
import { houseSceneService } from '$lib/server/services/houseSceneService';

// POST /api/houses/[houseId]/advance - Move the clock forward one phase
export const POST: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	if (!Number.isFinite(houseId)) return json({ error: 'Invalid house id' }, { status: 400 });

	try {
		// Time only moves in a house someone lives in — an empty house has
		// nothing to advance and would strand the player on a dead screen.
		const roster = await tenantService.getActiveTenants(houseId);
		if (roster.length === 0) {
			return json({ error: 'Nobody lives here yet' }, { status: 409 });
		}

		const result = await houseService.advancePhase(houseId, parseInt(userId));

		// The phase just ended, so every scene in it is now immutable and can be
		// condensed exactly once. Deliberately NOT awaited: the clock should move
		// the instant the player clicks, with summaries filling in behind it. A
		// summary that fails or lags is picked up on the next advance.
		houseSceneService
			.summariseFinishedScenes(houseId, parseInt(userId))
			.catch((error) => console.error('Scene summarisation failed:', error));

		return json(result);
	} catch (error) {
		console.error('Failed to advance phase:', error);
		const message = error instanceof Error ? error.message : 'Failed to advance phase';
		if (message.includes('not found')) return json({ error: message }, { status: 404 });
		return json({ error: message }, { status: 500 });
	}
};
