import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { conversations, messages } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { worldInfoService } from '$lib/server/services/worldInfoService';
import { worldStateGenerationService } from '$lib/server/services/clothesGenerationService';
import { sceneService } from '$lib/server/services/sceneService';
import { personaService } from '$lib/server/services/personaService';

/** Load the scene's conversation, checking it belongs to this user. */
async function loadConversation(conversationId: number, userId: number) {
	const [conversation] = await db
		.select()
		.from(conversations)
		.where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
		.limit(1);
	return conversation ?? null;
}

// GET /api/scenes/[conversationId]/world - Current world state for this scene.
export const GET: RequestHandler = async ({ params, cookies }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Not authenticated' }, { status: 401 });

	const conversationId = parseInt(params.conversationId!);
	if (isNaN(conversationId)) return json({ error: 'Invalid conversation ID' }, { status: 400 });

	try {
		const conversation = await loadConversation(conversationId, parseInt(userId));
		if (!conversation) return json({ error: 'Scene not found' }, { status: 404 });

		const worldState = await worldInfoService.getWorldState(conversationId);
		return json({ worldState });
	} catch (error) {
		console.error('Failed to get world state:', error);
		return json({ error: 'Failed to get world state' }, { status: 500 });
	}
};

// POST - Regenerate world state from the scene so far.
//
// Conversation-keyed like the rest of the scene API: one character can be in
// several scenes at once, so "the active conversation for this character"
// cannot address a room.
export const POST: RequestHandler = async ({ params, cookies }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Not authenticated' }, { status: 401 });

	const conversationId = parseInt(params.conversationId!);
	if (isNaN(conversationId)) return json({ error: 'Invalid conversation ID' }, { status: 400 });

	try {
		const conversation = await loadConversation(conversationId, parseInt(userId));
		if (!conversation) return json({ error: 'Scene not found' }, { status: 404 });

		// Everyone in the room, not just whoever is answering — a scene can hold
		// several people and the panel tracks all of them.
		const cast = await sceneService.getActiveCharacters(conversationId);
		if (cast.length === 0) return json({ error: 'Nobody is here' }, { status: 409 });

		const history = await db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, conversationId))
			.orderBy(messages.createdAt);

		const userInfo = await personaService.getActiveUserInfo(parseInt(userId));

		const chatHistory = history
			.slice(-20)
			.map((m) => {
				const who =
					m.role === 'user'
						? userInfo.name
						: m.role === 'narrator'
							? 'Narrator'
							: (m.senderName ?? 'Someone');
				return `${who}: ${m.content}`;
			})
			.join('\n\n');

		const worldState = await worldStateGenerationService.generateWorldState({
			characters: cast.map((c) => {
				let cardData: any = {};
				try {
					cardData = JSON.parse(c.cardData);
					if (cardData.data) cardData = cardData.data;
				} catch {
					// A malformed card still has a name to work from.
				}
				return { name: c.name, description: c.description || cardData.description || '' };
			}),
			// The house context — room, hour, who lives here — so state is grounded
			// in the scene rather than invented.
			scenario: conversation.scenario ?? '',
			userName: userInfo.name,
			chatHistory,
			previousState: await worldInfoService.getWorldState(conversationId)
		});

		await worldInfoService.updateWorldState(conversationId, worldState);

		return json({ worldState });
	} catch (error) {
		console.error('Failed to generate world state:', error);
		const message = error instanceof Error ? error.message : 'Failed to generate world state';
		return json({ error: message }, { status: 500 });
	}
};
