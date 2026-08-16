import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tenantService } from '$lib/server/services/tenantService';

// GET /api/houses/[houseId]/applicants - Everyone shortlisted across all rooms.
//
// Drawing applicants is per-room (see bedrooms/[bedroomId]/applicants): a
// vacancy is filled by choosing between named candidates for that specific
// room, so there is no house-wide draw.
export const GET: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	if (!Number.isFinite(houseId)) return json({ error: 'Invalid house id' }, { status: 400 });

	try {
		const list = await tenantService.getApplicants(houseId);
		return json({ applicants: list });
	} catch (error) {
		console.error('Failed to get applicants:', error);
		return json({ error: 'Failed to get applicants' }, { status: 500 });
	}
};
