import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { tenantService } from '$lib/server/services/tenantService';

// POST /api/houses/[houseId]/applicants/[applicantId] - Accept into a bedroom
export const POST: RequestHandler = async ({ cookies, params, request }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	const applicantId = parseInt(params.applicantId);
	if (!Number.isFinite(houseId) || !Number.isFinite(applicantId)) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	try {
		const body = await request.json();
		const bedroomId = parseInt(body?.bedroomId);
		if (!Number.isFinite(bedroomId)) {
			return json({ error: 'A bedroom must be chosen' }, { status: 400 });
		}

		const tenant = await tenantService.acceptApplicant(
			applicantId,
			bedroomId,
			houseId,
			parseInt(userId)
		);
		return json({ tenant }, { status: 201 });
	} catch (error) {
		console.error('Failed to accept applicant:', error);
		const message = error instanceof Error ? error.message : 'Failed to accept applicant';
		// These are user-correctable conflicts, not server faults.
		const isConflict =
			message.includes('already occupied') || message.includes('already lives here');
		if (isConflict) return json({ error: message }, { status: 409 });
		if (message.includes('not found')) return json({ error: message }, { status: 404 });
		return json({ error: message }, { status: 500 });
	}
};

// DELETE /api/houses/[houseId]/applicants/[applicantId] - Turn them away
export const DELETE: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	const applicantId = parseInt(params.applicantId);
	if (!Number.isFinite(houseId) || !Number.isFinite(applicantId)) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	try {
		const removed = await tenantService.rejectApplicant(applicantId, houseId);
		if (!removed) return json({ error: 'Applicant not found' }, { status: 404 });
		return json({ success: true });
	} catch (error) {
		console.error('Failed to reject applicant:', error);
		return json({ error: 'Failed to reject applicant' }, { status: 500 });
	}
};
