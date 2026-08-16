import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseSceneService } from '$lib/server/services/houseSceneService';
import { sceneService } from '$lib/server/services/sceneService';

// GET /api/scenes/[conversationId] - Re-read a scene after a server-side change
// (regenerate, delete) without a full page navigation.
export const GET: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const conversationId = parseInt(params.conversationId);
	if (!Number.isFinite(conversationId)) {
		return json({ error: 'Invalid conversation id' }, { status: 400 });
	}

	const found = await houseSceneService.getSceneByConversation(conversationId, parseInt(userId));
	if (!found) return json({ error: 'Scene not found' }, { status: 404 });

	const [messages, participants] = await Promise.all([
		houseSceneService.getMessages(conversationId),
		sceneService.getActiveCharacters(conversationId)
	]);

	return json({
		messages,
		participants: participants.map((c) => ({
			id: c.id,
			name: c.name,
			thumbnailData: c.thumbnailData,
			imageData: c.imageData
		}))
	});
};
