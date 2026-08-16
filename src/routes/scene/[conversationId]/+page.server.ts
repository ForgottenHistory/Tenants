import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getUserById } from '$lib/server/auth';
import { houseSceneService } from '$lib/server/services/houseSceneService';
import { sceneService } from '$lib/server/services/sceneService';
import { tenantService } from '$lib/server/services/tenantService';

export const load: PageServerLoad = async ({ params, cookies }) => {
	const userId = cookies.get('userId');

	if (!userId) {
		throw redirect(303, '/login');
	}

	const user = await getUserById(parseInt(userId));

	if (!user) {
		cookies.delete('userId', { path: '/' });
		throw redirect(303, '/login');
	}

	const conversationId = parseInt(params.conversationId);
	if (!Number.isFinite(conversationId)) {
		throw error(400, 'Invalid scene');
	}

	// Resolving by conversation id — not character id — is the whole point of
	// this route: one character can hold several scenes at once.
	const found = await houseSceneService.getSceneByConversation(conversationId, user.id);
	if (!found) {
		throw error(404, 'Scene not found');
	}

	const [messages, participants, roster] = await Promise.all([
		houseSceneService.getMessages(conversationId),
		sceneService.getActiveCharacters(conversationId),
		tenantService.getActiveTenants(found.house.id)
	]);

	// Everyone who lives here but isn't in this room. Characters talk about their
	// housemates now that the prompt tells them who those are, so their names
	// should read as people in the transcript rather than as plain words.
	const presentIds = new Set(participants.map((c) => c.id));
	const knownCharacters = roster
		.filter((entry) => !presentIds.has(entry.character.id))
		.map((entry) => ({ id: entry.character.id, name: entry.character.name }));

	return {
		user,
		conversationId,
		scene: found.scene,
		house: found.house,
		placeName: found.placeName,
		messages,
		participants: participants.map((c) => ({
			id: c.id,
			name: c.name,
			thumbnailData: c.thumbnailData,
			imageData: c.imageData
		})),
		knownCharacters
	};
};
