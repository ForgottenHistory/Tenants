import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { conversations, messages, characters } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { generateChatCompletion } from '$lib/server/llm';
import { emitMessage, emitTyping } from '$lib/server/socket';
import { personaService } from '$lib/server/services/personaService';
import { sceneService } from '$lib/server/services/sceneService';
import { llmSettingsFileService } from '$lib/server/services/llmSettingsFileService';

/**
 * The first character named in the message, or null if nobody is.
 *
 * "First" is by position in the text, not by roster order — "I asked Okayu but
 * Zara said no" is addressed at Okayu. Matching is whole-word and
 * case-insensitive so a name inside another word can't trigger it, and each
 * name's first token is accepted too, since people write "Nicole" rather than
 * "Nicole Demara" in conversation.
 */
function findFirstNamed<T extends { id: number; name: string }>(
	message: string,
	present: T[]
): T | null {
	const haystack = message.toLowerCase();
	let best: { index: number; character: T } | null = null;

	for (const character of present) {
		// Longest first: for "Nicole Demara" prefer the full name's position, but
		// still match a bare "Nicole".
		const aliases = [character.name, character.name.split(/\s+/)[0]]
			.map((a) => a.trim().toLowerCase())
			.filter(Boolean);

		for (const alias of aliases) {
			// Word boundaries via lookaround rather than \b, which treats accented
			// and non-latin characters as boundaries and would break those names.
			const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const match = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, 'u').exec(
				haystack
			);
			if (!match) continue;

			const index = match.index;
			if (!best || index < best.index) {
				best = { index, character };
			}
		}
	}

	return best?.character ?? null;
}

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

		// An empty message is valid when a speaker is named: that is "let this
		// character say something", nudging them to speak without the player
		// putting words in first. Without a speaker there is nothing to act on.
		const text = typeof message === 'string' ? message.trim() : '';
		if (!text && !speakerId) {
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

		// Only record a player turn when they actually said something. Prompting
		// a character to speak is not the player speaking, and a blank user
		// message would pollute the transcript and every summary built from it.
		if (text) {
			const userInfo = await personaService.getActiveUserInfo(parseInt(userId));

			const [userMessage] = await db
				.insert(messages)
				.values({
					conversationId,
					role: 'user',
					content: text,
					senderName: userInfo.name,
					senderAvatar: userInfo.avatarData
				})
				.returning();

			emitMessage(conversationId, userMessage);
		}

		// Who answers, in priority order:
		//   1. An explicit `speakerId` — scene actions target a named character.
		//   2. The first character NAMED in the message. Saying "Zara, can you
		//      look at the sink?" in a room with three people should get Zara,
		//      not whoever happens to be primary.
		//   3. Random among those present, so a room without a name addressed
		//      doesn't always answer in the same voice.
		const present = await sceneService.getActiveCharacters(conversationId);
		if (present.length === 0) {
			return json({ error: 'Nobody is here to answer' }, { status: 409 });
		}

		let character: (typeof present)[number] | null = null;

		if (speakerId) {
			character = present.find((c) => c.id === speakerId) ?? null;
		}

		if (!character && text) {
			character = findFirstNamed(text, present);
		}

		if (!character) {
			character = present[Math.floor(Math.random() * present.length)];
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
