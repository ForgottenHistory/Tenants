import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tenantService } from '$lib/server/services/tenantService';
import { APPLICANTS_PER_VACANCY } from '$lib/house/tenancy';

// GET /api/houses/[houseId]/applicants - Who is currently at the door
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

// POST /api/houses/[houseId]/applicants - Draw a fresh set from the library
export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	if (!Number.isFinite(houseId)) return json({ error: 'Invalid house id' }, { status: 400 });

	try {
		let count = APPLICANTS_PER_VACANCY;
		try {
			const body = await request.json();
			if (Number.isFinite(Number(body?.count))) {
				count = Math.max(1, Math.min(10, Number(body.count)));
			}
		} catch {
			// No body is fine — use the default.
		}

		const list = await tenantService.generateApplicants(houseId, parseInt(userId), count);
		return json({ applicants: list });
	} catch (error) {
		console.error('Failed to generate applicants:', error);
		const message = error instanceof Error ? error.message : 'Failed to generate applicants';
		// A house the user doesn't own is a 404, not a server fault.
		const notFound = message.includes('not found');
		return json({ error: message }, { status: notFound ? 404 : 500 });
	}
};
