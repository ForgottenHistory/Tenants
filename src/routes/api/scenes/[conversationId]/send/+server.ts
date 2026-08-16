import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { conversations, messages, characters } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { generateChatCompletion } from '$lib/server/llm';
import { emitMessage, emitTyping } from '$lib/server/socket';
import { personaService } from '$lib/server/services/personaService';
import { sceneService } from '$lib/server/services/sceneService';
import { llmSettingsFileService } from '$lib/server/services/llmSettingsFileService';

// POST /api/scenes/[conversationId]/send - Send a message in a room scene.
//
// The character-keyed /api/chat/[characterId]/send resolves "the active
// conversation for this character", which cannot address a room scene: one
// character can be in several scenes across different days and phases, and all
// of them persist. This endpoint takes the conversation directly.
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const userId = cookies.get('userId');
	if (!userId) {
		return json({ error: 'Not authenticated' }, { status: 401 });
	}

	const conversationId = parseInt(params.conversationId!);
	if (isNaN(conversationId)) {
		return json({ error: 'Invalid conversation ID' }, { status: 400 });
	}

	try {
		const { message, speakerId } = await request.json();

		if (!message || !message.trim()) {
			return json({ error: 'Message is required' }, { status: 400 });
		}

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

		const userInfo = await personaService.getActiveUserInfo(parseInt(userId));

		const [userMessage] = await db
			.insert(messages)
			.values({
				conversationId,
				role: 'user',
				content: message.trim(),
				senderName: userInfo.name,
				senderAvatar: userInfo.avatarData
			})
			.returning();

		emitMessage(conversationId, userMessage);

		// In a room with several people, the caller may name who should answer.
		// Falling back to the scene's primary keeps single-occupant rooms simple.
		let character = null;
		if (speakerId) {
			const inScene = await sceneService.isCharacterInScene(conversationId, speakerId);
			if (inScene) {
				const [named] = await db
					.select()
					.from(characters)
					.where(eq(characters.id, speakerId))
					.limit(1);
				character = named ?? null;
			}
		}

		if (!character) {
			character = await sceneService.getPrimaryCharacter(conversationId);
		}

		if (!character) {
			return json({ error: 'Nobody is here to answer' }, { status: 409 });
		}

		const conversationHistory = await db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, conversationId))
			.orderBy(messages.createdAt);

		const settings = llmSettingsFileService.getSettings('chat');
		if (!settings) {
			return json({ error: 'LLM settings not found' }, { status: 404 });
		}

		emitTyping(conversationId, true);

		let aiResult: { content: string; reasoning: string | null };
		try {
			aiResult = await generateChatCompletion(
				conversationHistory,
				character,
				settings,
				'chat',
				conversationId,
				// The house context lives here — room, hour, lease terms — and is
				// rebuilt into the system prompt on every message.
				conversation.scenario,
				parseInt(userId)
			);
		} catch (genError) {
			emitTyping(conversationId, false);
			throw genError;
		}

		emitTyping(conversationId, false);

		const [assistantMessage] = await db
			.insert(messages)
			.values({
				conversationId,
				role: 'assistant',
				characterId: character.id,
				content: aiResult.content,
				senderName: character.name,
				senderAvatar: character.thumbnailData || character.imageData,
				reasoning: aiResult.reasoning
			})
			.returning();

		emitMessage(conversationId, assistantMessage);

		const allMessages = await db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, conversationId))
			.orderBy(messages.createdAt);

		return json({ messages: allMessages });
	} catch (error) {
		console.error('Failed to send scene message:', error);
		return json({ error: 'Failed to send message' }, { status: 500 });
	}
};
