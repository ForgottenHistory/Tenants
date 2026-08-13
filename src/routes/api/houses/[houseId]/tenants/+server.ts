import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tenantService } from '$lib/server/services/tenantService';

// GET /api/houses/[houseId]/tenants - Current roster
export const GET: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	if (!Number.isFinite(houseId)) return json({ error: 'Invalid house id' }, { status: 400 });

	try {
		const [roster, vacancies] = await Promise.all([
			tenantService.getActiveTenants(houseId),
			tenantService.getVacantBedrooms(houseId)
		]);
		return json({ tenants: roster, vacantBedrooms: vacancies });
	} catch (error) {
		console.error('Failed to get tenants:', error);
		return json({ error: 'Failed to get tenants' }, { status: 500 });
	}
};

// POST /api/houses/[houseId]/tenants - Place a library character directly
export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	if (!Number.isFinite(houseId)) return json({ error: 'Invalid house id' }, { status: 400 });

	try {
		const body = await request.json();
		const characterId = parseInt(body?.characterId);
		const bedroomId = parseInt(body?.bedroomId);

		if (!Number.isFinite(characterId) || !Number.isFinite(bedroomId)) {
			return json({ error: 'characterId and bedroomId are required' }, { status: 400 });
		}

		const rent = Number(body?.rentAmount);
		const tenant = await tenantService.placeCharacter(
			characterId,
			bedroomId,
			houseId,
			parseInt(userId),
			Number.isFinite(rent) && rent >= 0 ? rent : undefined
		);

		return json({ tenant }, { status: 201 });
	} catch (error) {
		console.error('Failed to place tenant:', error);
		const message = error instanceof Error ? error.message : 'Failed to place tenant';
		const isConflict =
			message.includes('already occupied') || message.includes('already lives here');
		if (isConflict) return json({ error: message }, { status: 409 });
		if (message.includes('not found')) return json({ error: message }, { status: 404 });
		return json({ error: message }, { status: 500 });
	}
};
