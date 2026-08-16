import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { characters, conversations, messages } from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { imageTagGenerationService } from '$lib/server/services/imageTagGenerationService';
import { sceneService } from '$lib/server/services/sceneService';

// POST /api/scenes/[conversationId]/generate-image - Danbooru tags for the scene.
//
// The character-keyed /api/chat/[characterId]/generate-image resolves "the
// ACTIVE conversation for this character", which can never find a room scene:
// scene conversations are deliberately written with isActive false so they don't
// hijack that lookup. This takes the conversation directly, same as
// /api/scenes/[conversationId]/send.
export const POST: RequestHandler = async ({ params, cookies, request }) => {
	const userId = cookies.get('userId');
	if (!userId) {
		return json({ error: 'Not authenticated' }, { status: 401 });
	}

	const conversationId = parseInt(params.conversationId!);
	if (isNaN(conversationId)) {
		return json({ error: 'Invalid conversation ID' }, { status: 400 });
	}

	try {
		const { type, characterId } = await request.json();

		const [conversation] = await db
			.select()
			.from(conversations)
			.where(
				and(eq(conversations.id, conversationId), eq(conversations.userId, parseInt(userId)))
			)
			.limit(1);

		if (!conversation) {
			return json({ error: 'Conversation not found' }, { status: 404 });
		}

		// A room can hold several people, so the caller names who the image is
		// of. Falling back to the scene's primary keeps single-occupant rooms
		// working without the client having to care.
		let character = null;
		if (characterId) {
			const inScene = await sceneService.isCharacterInScene(conversationId, characterId);
			if (inScene) {
				const [named] = await db
					.select()
					.from(characters)
					.where(eq(characters.id, characterId))
					.limit(1);
				character = named ?? null;
			}
		}
		if (!character) {
			character = await sceneService.getPrimaryCharacter(conversationId);
		}
		if (!character) {
			return json({ error: 'Nobody is here to draw' }, { status: 409 });
		}

		let characterData: any = {};
		try {
			characterData = JSON.parse(character.cardData);
			if (characterData.data) characterData = characterData.data;
		} catch {
			// A malformed card still has a name and description column to work from.
		}

		const history = await db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, conversationId))
			.orderBy(desc(messages.createdAt))
			.limit(10);
		history.reverse();

		const conversationContext = history
			.map((m) => `${m.role === 'user' ? 'User' : (m.senderName ?? character.name)}: ${m.content}`)
			.join('\n\n');

		const result = await imageTagGenerationService.generateTags({
			conversationContext,
			characterName: character.name,
			characterDescription: character.description || characterData.description || '',
			// The house context — room, hour, who else is present — is a far better
			// scenario for an image than the character card's, which describes a
			// situation this scene has nothing to do with.
			characterScenario: conversation.scenario || characterData.scenario || '',
			imageTags: character.imageTags || '',
			contextualTags: character.contextualTags || '',
			type: (type ?? 'scene') as 'all' | 'character' | 'user' | 'scene',
			userId: parseInt(userId),
			conversationId
		});

		return json({
			tags: result.generatedTags,
			alwaysTags: result.alwaysTags,
			breakdown: result.breakdown,
			characterId: character.id,
			type
		});
	} catch (error: any) {
		console.error('Failed to generate scene image tags:', error);
		return json({ error: error.message || 'Failed to generate tags' }, { status: 500 });
	}
};
