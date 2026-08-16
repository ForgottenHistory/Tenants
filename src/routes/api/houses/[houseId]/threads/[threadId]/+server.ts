import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseService } from '$lib/server/services/houseService';
import { houseSceneService } from '$lib/server/services/houseSceneService';

// POST /api/houses/[houseId]/threads/[threadId] - Close an open thread by hand.
//
// Body: { outcome: 'resolved' | 'dropped', resolution?: string }
//
// The summariser closes threads it notices being settled in conversation, but
// it misses things and never sees anything you dealt with off-screen. This is
// the reliable path.
export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	const threadId = parseInt(params.threadId);
	if (!Number.isFinite(houseId) || !Number.isFinite(threadId)) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	try {
		const house = await houseService.getHouseById(houseId, parseInt(userId));
		if (!house) return json({ error: 'House not found' }, { status: 404 });

		const body = await request.json().catch(() => ({}));
		const outcome = body?.outcome === 'dropped' ? 'dropped' : 'resolved';

		const closed = await houseSceneService.closeThread(
			threadId,
			houseId,
			house.day,
			outcome,
			typeof body?.resolution === 'string' ? body.resolution : undefined
		);

		// Already closed, or not this house's — either way there is nothing to do
		// and the panel should refresh rather than show an error.
		if (!closed) {
			return json({ error: 'That is no longer open' }, { status: 409 });
		}

		return json({ success: true, outcome });
	} catch (error) {
		console.error('Failed to close thread:', error);
		return json({ error: 'Failed to close thread' }, { status: 500 });
	}
};
