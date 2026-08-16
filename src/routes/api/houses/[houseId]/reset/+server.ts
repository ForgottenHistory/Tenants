import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseService } from '$lib/server/services/houseService';

// POST /api/houses/[houseId]/reset - Back to day 1 with nobody living here
export const POST: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const houseId = parseInt(params.houseId);
	if (!Number.isFinite(houseId)) {
		return json({ error: 'Invalid house id' }, { status: 400 });
	}

	try {
		const house = await houseService.resetHouse(houseId, parseInt(userId));
		if (!house) {
			return json({ error: 'House not found' }, { status: 404 });
		}
		return json({ house });
	} catch (error) {
		console.error('Failed to reset house:', error);
		return json({ error: 'Failed to reset house' }, { status: 500 });
	}
};
