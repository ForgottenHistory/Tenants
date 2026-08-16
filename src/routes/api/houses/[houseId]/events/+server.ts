import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseService } from '$lib/server/services/houseService';
import { relationService } from '$lib/server/services/relationService';

// GET /api/houses/[houseId]/events - What has been happening in the house.
// `limit` and `offset` page the log; `relations` also returns current standings.
export const GET: RequestHandler = async ({ cookies, params, url }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	if (!Number.isFinite(houseId)) return json({ error: 'Invalid house id' }, { status: 400 });

	try {
		const house = await houseService.getHouseById(houseId, parseInt(userId));
		if (!house) return json({ error: 'House not found' }, { status: 404 });

		// `between=<idA>,<idB>` narrows to one pair's history, for the relation
		// detail modal. Everything else is the full log.
		const between = url.searchParams.get('between');
		if (between) {
			const [a, b] = between.split(',').map((n) => parseInt(n));
			if (!Number.isFinite(a) || !Number.isFinite(b)) {
				return json({ error: 'Invalid character ids' }, { status: 400 });
			}
			const events = await relationService.getEventsBetween(houseId, a, b);
			return json({ events });
		}

		const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50') || 50, 200);
		const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0') || 0, 0);

		const [events, relations] = await Promise.all([
			relationService.getAllEvents(houseId, limit, offset),
			relationService.getHouseRelations(houseId)
		]);

		return json({ events, relations });
	} catch (error) {
		console.error('Failed to load house events:', error);
		return json({ error: 'Failed to load house events' }, { status: 500 });
	}
};
