import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseSceneService, type PlaceKind } from '$lib/server/services/houseSceneService';

// POST /api/houses/[houseId]/scenes - Walk into a room.
//
// Resolves the scene for the current day/phase, creating it on first entry and
// resuming it on every entry after that.
export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	if (!Number.isFinite(houseId)) return json({ error: 'Invalid house id' }, { status: 400 });

	try {
		const { placeKind, placeId } = await request.json();

		if (placeKind !== 'bedroom' && placeKind !== 'shared') {
			return json({ error: 'Invalid place kind' }, { status: 400 });
		}
		if (!Number.isFinite(placeId)) {
			return json({ error: 'Invalid place id' }, { status: 400 });
		}

		const resolved = await houseSceneService.resolveScene(
			parseInt(userId),
			houseId,
			placeKind as PlaceKind,
			placeId
		);

		return json({
			conversationId: resolved.conversationId,
			created: resolved.created,
			placeName: resolved.placeName,
			present: resolved.present.map((p) => ({
				id: p.character.id,
				name: p.character.name,
				activity: p.occupancy.activity
			}))
		});
	} catch (error) {
		console.error('Failed to open scene:', error);
		const message = error instanceof Error ? error.message : 'Failed to open scene';
		if (message.includes('not found')) return json({ error: message }, { status: 404 });
		return json({ error: message }, { status: 500 });
	}
};
