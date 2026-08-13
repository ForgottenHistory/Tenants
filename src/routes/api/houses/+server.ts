import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseService } from '$lib/server/services/houseService';
import {
	MIN_BEDROOMS,
	MAX_BEDROOMS,
	SPACE_KINDS,
	DEFAULT_STARTING_BALANCE
} from '$lib/house/spacePresets';

// GET /api/houses - List all houses for the current user
export const GET: RequestHandler = async ({ cookies }) => {
	const userId = cookies.get('userId');
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const allHouses = await houseService.getAllHouses(parseInt(userId));
		const active = allHouses.find((h) => h.isActive) ?? null;

		return json({ houses: allHouses, activeHouseId: active?.id ?? null });
	} catch (error) {
		console.error('Failed to get houses:', error);
		return json({ error: 'Failed to get houses' }, { status: 500 });
	}
};

// POST /api/houses - Create a house and make it the active one
export const POST: RequestHandler = async ({ cookies, request }) => {
	const userId = cookies.get('userId');
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const data = await request.json();

		if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
			return json({ error: 'House name is required' }, { status: 400 });
		}

		if (!Array.isArray(data.bedrooms) || data.bedrooms.length < MIN_BEDROOMS) {
			return json({ error: `A house needs at least ${MIN_BEDROOMS} bedroom` }, { status: 400 });
		}

		if (data.bedrooms.length > MAX_BEDROOMS) {
			return json({ error: `A house can have at most ${MAX_BEDROOMS} bedrooms` }, { status: 400 });
		}

		const spaces = Array.isArray(data.spaces) ? data.spaces : [];
		for (const space of spaces) {
			if (!space.name || typeof space.name !== 'string' || !space.name.trim()) {
				return json({ error: 'Every shared space needs a name' }, { status: 400 });
			}
			if (!SPACE_KINDS.includes(space.kind)) {
				return json({ error: `Unknown space kind: ${space.kind}` }, { status: 400 });
			}
		}

		const balance = Number(data.startingBalance);

		const house = await houseService.createHouse(parseInt(userId), {
			name: data.name,
			address: data.address ?? null,
			description: data.description ?? null,
			startingBalance:
				Number.isFinite(balance) && balance >= 0 ? balance : DEFAULT_STARTING_BALANCE,
			bedrooms: data.bedrooms.map((room: { name?: string; baseRent?: number }) => ({
				name: typeof room?.name === 'string' ? room.name : '',
				baseRent: Number.isFinite(Number(room?.baseRent)) ? Number(room.baseRent) : undefined
			})),
			spaces: spaces.map(
				(space: { name: string; kind: string; description?: string; capacity?: number }) => ({
					name: space.name,
					kind: space.kind,
					description: space.description ?? null,
					capacity: Number.isFinite(Number(space?.capacity)) ? Number(space.capacity) : undefined
				})
			)
		});

		return json({ house }, { status: 201 });
	} catch (error) {
		console.error('Failed to create house:', error);
		const message = error instanceof Error ? error.message : 'Failed to create house';
		return json({ error: message }, { status: 500 });
	}
};
