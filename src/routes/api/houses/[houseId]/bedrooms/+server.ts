import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseService } from '$lib/server/services/houseService';

// POST /api/houses/[houseId]/bedrooms - Build another bedroom, charged to the
// house balance. The price is worked out server-side from the room count; the
// body only carries what the room is called and what it asks in rent.
export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const userId = cookies.get('userId');
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const houseId = parseInt(params.houseId);
	if (!Number.isFinite(houseId)) {
		return json({ error: 'Invalid house id' }, { status: 400 });
	}

	try {
		const body = await request.json().catch(() => ({}));

		const name = typeof body?.name === 'string' ? body.name : null;

		let baseRent: number | undefined;
		if (body?.baseRent !== undefined && body?.baseRent !== null && body?.baseRent !== '') {
			baseRent = Number(body.baseRent);
			if (!Number.isFinite(baseRent) || baseRent < 0) {
				return json({ error: 'Rent must be a positive number' }, { status: 400 });
			}
		}

		const result = await houseService.buildBedroom(houseId, parseInt(userId), { name, baseRent });
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to build the room';

		if (message === 'House not found') {
			return json({ error: message }, { status: 404 });
		}
		// Too poor, or the house is already full — both are the player's state,
		// not a server fault.
		if (message.startsWith('Not enough money') || message.includes('at most')) {
			return json({ error: message }, { status: 400 });
		}

		console.error('Failed to build bedroom:', error);
		return json({ error: 'Failed to build the room' }, { status: 500 });
	}
};
