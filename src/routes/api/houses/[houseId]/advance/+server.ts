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
		// condensed exactly once.
		//
		// Awaited, unlike the original fire-and-forget: `recallFor()` reads
		// `scenes.summary`, so returning before the write lands means walking
		// straight back into a room and finding the character has forgotten the
		// conversation you just had. Waiting a few seconds is better than the
		// house quietly losing its memory.
		//
		// Still fault-tolerant: a failure leaves `summary` null and the next
		// advance picks it up, so a bad Content LLM call costs a summary rather
		// than blocking the clock.
		let summarised = 0;
		try {
			summarised = await houseSceneService.summariseFinishedScenes(houseId, parseInt(userId));
		} catch (error) {
			console.error('Scene summarisation failed:', error);
		}

		return json({ ...result, summarised });
	} catch (error) {
		console.error('Failed to advance phase:', error);
		const message = error instanceof Error ? error.message : 'Failed to advance phase';
		if (message.includes('not found')) return json({ error: message }, { status: 404 });
		return json({ error: message }, { status: 500 });
	}
};
