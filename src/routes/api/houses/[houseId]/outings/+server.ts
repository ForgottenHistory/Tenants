import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseSceneService } from '$lib/server/services/houseSceneService';

// POST /api/houses/[houseId]/outings - Go out with a tenant.
//
// Unlike walking into a room, the setting here is the player's invention: they
// name where they are going and what they are doing. Creates the outing on
// first call for this phase and resumes it on every call after.
export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	if (!Number.isFinite(houseId)) return json({ error: 'Invalid house id' }, { status: 400 });

	try {
		const { characterId, place, activity } = await request.json();

		if (!Number.isFinite(characterId)) {
			return json({ error: 'Invalid character id' }, { status: 400 });
		}
		if (typeof place !== 'string' || !place.trim()) {
			return json({ error: 'Where are you going?' }, { status: 400 });
		}

		const resolved = await houseSceneService.resolveOuting(
			parseInt(userId),
			houseId,
			characterId,
			place,
			typeof activity === 'string' ? activity : ''
		);

		return json({
			conversationId: resolved.conversationId,
			created: resolved.created,
			placeName: resolved.placeName
		});
	} catch (error) {
		console.error('Failed to open outing:', error);
		const message = error instanceof Error ? error.message : 'Failed to open outing';
		if (message.includes('not found')) return json({ error: message }, { status: 404 });
		return json({ error: message }, { status: 500 });
	}
};
