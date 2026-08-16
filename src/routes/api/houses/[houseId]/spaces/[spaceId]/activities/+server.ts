import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { sharedSpaces, houses } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { contentLlmService } from '$lib/server/services/contentLlmService';

/** Load a space, checking it belongs to a house this user owns. */
async function loadSpace(houseId: number, spaceId: number, userId: number) {
	const [row] = await db
		.select({ space: sharedSpaces, house: houses })
		.from(sharedSpaces)
		.innerJoin(houses, eq(sharedSpaces.houseId, houses.id))
		.where(
			and(
				eq(sharedSpaces.id, spaceId),
				eq(sharedSpaces.houseId, houseId),
				eq(houses.userId, userId)
			)
		)
		.limit(1);
	return row ?? null;
}

// POST - Write activities for this space with the Content LLM. Returns them for
// review; saving is the separate PUT below.
export const POST: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	const spaceId = parseInt(params.spaceId);
	if (!Number.isFinite(houseId) || !Number.isFinite(spaceId)) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	try {
		const row = await loadSpace(houseId, spaceId, parseInt(userId));
		if (!row) return json({ error: 'Space not found' }, { status: 404 });

		const activities = await contentLlmService.generateSpaceActivities({
			spaceName: row.space.name,
			spaceKind: row.space.kind,
			spaceDescription: row.space.description ?? '',
			houseName: row.house.name
		});

		const cleaned = activities.map((a) => String(a).trim()).filter(Boolean);
		if (cleaned.length === 0) {
			return json({ error: 'The model did not return any usable activities' }, { status: 502 });
		}

		return json({ activities: cleaned });
	} catch (error) {
		console.error('Failed to generate space activities:', error);
		const message = error instanceof Error ? error.message : 'Failed to generate activities';
		return json({ error: message }, { status: 500 });
	}
};

// PUT - Save this space's activity pool. An empty list clears it, falling back
// to the generic lines for the space's kind.
export const PUT: RequestHandler = async ({ cookies, params, request }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const houseId = parseInt(params.houseId);
	const spaceId = parseInt(params.spaceId);
	if (!Number.isFinite(houseId) || !Number.isFinite(spaceId)) {
		return json({ error: 'Invalid id' }, { status: 400 });
	}

	try {
		const row = await loadSpace(houseId, spaceId, parseInt(userId));
		if (!row) return json({ error: 'Space not found' }, { status: 404 });

		const body = await request.json();
		const lines = Array.isArray(body?.activities)
			? body.activities.map((a: unknown) => String(a).trim()).filter(Boolean)
			: [];

		await db
			.update(sharedSpaces)
			.set({ activityPool: lines.length > 0 ? JSON.stringify(lines) : null })
			.where(eq(sharedSpaces.id, spaceId));

		return json({ activities: lines });
	} catch (error) {
		console.error('Failed to save space activities:', error);
		return json({ error: 'Failed to save activities' }, { status: 500 });
	}
};
