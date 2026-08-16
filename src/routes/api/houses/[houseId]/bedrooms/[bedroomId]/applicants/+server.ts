import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tenantService } from '$lib/server/services/tenantService';

// GET /api/houses/[houseId]/bedrooms/[bedroomId]/applicants
// Today's shortlist for one room, drawing a fresh one if the day has rolled.
export const GET: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	const bedroomId = parseInt(params.bedroomId);
	if (!Number.isFinite(houseId) || !Number.isFinite(bedroomId)) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	try {
		const applicants = await tenantService.ensureApplicantsFor(
			houseId,
			bedroomId,
			parseInt(userId)
		);
		return json({ applicants });
	} catch (error) {
		console.error('Failed to load applicants:', error);
		const message = error instanceof Error ? error.message : 'Failed to load applicants';
		if (message.includes('not found')) return json({ error: message }, { status: 404 });
		return json({ error: message }, { status: 500 });
	}
};

// POST - Force a new shortlist for this room, ignoring today's.
export const POST: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	const bedroomId = parseInt(params.bedroomId);
	if (!Number.isFinite(houseId) || !Number.isFinite(bedroomId)) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	try {
		const applicants = await tenantService.generateApplicantsForRoom(
			houseId,
			bedroomId,
			parseInt(userId)
		);
		return json({ applicants });
	} catch (error) {
		console.error('Failed to draw applicants:', error);
		const message = error instanceof Error ? error.message : 'Failed to draw applicants';
		if (message.includes('not found')) return json({ error: message }, { status: 404 });
		return json({ error: message }, { status: 500 });
	}
};
