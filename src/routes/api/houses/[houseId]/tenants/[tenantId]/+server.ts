import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tenantService } from '$lib/server/services/tenantService';
import { houseService } from '$lib/server/services/houseService';

// DELETE /api/houses/[houseId]/tenants/[tenantId] - Move a tenant out
export const DELETE: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	const tenantId = parseInt(params.tenantId);
	if (!Number.isFinite(houseId) || !Number.isFinite(tenantId)) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	try {
		const house = await houseService.getHouseById(houseId, parseInt(userId));
		if (!house) return json({ error: 'House not found' }, { status: 404 });

		const moved = await tenantService.moveOut(tenantId, houseId, house.day);
		if (!moved) return json({ error: 'Tenant not found' }, { status: 404 });

		return json({ success: true });
	} catch (error) {
		console.error('Failed to move tenant out:', error);
		return json({ error: 'Failed to move tenant out' }, { status: 500 });
	}
};
