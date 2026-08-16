import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseSceneService } from '$lib/server/services/houseSceneService';

// POST /api/houses/[houseId]/applicants/[applicantId]/interview
// Meet an applicant before deciding whether to offer them the lease. Creates the
// interview on first call and resumes it on every call after.
export const POST: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	const applicantId = parseInt(params.applicantId);
	if (!Number.isFinite(houseId) || !Number.isFinite(applicantId)) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	try {
		const resolved = await houseSceneService.resolveInterview(
			parseInt(userId),
			houseId,
			applicantId
		);
		return json({
			conversationId: resolved.conversationId,
			created: resolved.created,
			placeName: resolved.placeName
		});
	} catch (error) {
		console.error('Failed to open interview:', error);
		const message = error instanceof Error ? error.message : 'Failed to open interview';
		if (message.includes('not found')) return json({ error: message }, { status: 404 });
		return json({ error: message }, { status: 500 });
	}
};
