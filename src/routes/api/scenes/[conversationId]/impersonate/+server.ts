import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { conversations, messages } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { generateImpersonation } from '$lib/server/llm';
import { sceneService } from '$lib/server/services/sceneService';
import { llmSettingsService } from '$lib/server/services/llmSettingsService';
import type { ImpersonateStyle } from '$lib/types/chat';

// POST /api/scenes/[conversationId]/impersonate - Write a message as the player.
//
// Conversation-keyed for the same reason as send: the character-keyed endpoint
// resolves "the active conversation for this character", which cannot address a
// room scene, since one character may hold several at once.
export const POST: RequestHandler = async ({ params, cookies, request }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Not authenticated' }, { status: 401 });

	const conversationId = parseInt(params.conversationId!);
	if (isNaN(conversationId)) return json({ error: 'Invalid conversation ID' }, { status: 400 });

	try {
		const body = await request.json().catch(() => ({}));
		const style: ImpersonateStyle = body?.style || 'impersonate';

		const [conversation] = await db
			.select()
			.from(conversations)
			.where(
				and(eq(conversations.id, conversationId), eq(conversations.userId, parseInt(userId)))
			)
			.limit(1);

		if (!conversation) return json({ error: 'Conversation not found' }, { status: 404 });

		// Impersonation writes the player's side, but still needs a character to
		// write *at* — whoever is currently answering in this scene.
		const character = await sceneService.getPrimaryCharacter(conversationId);
		if (!character) return json({ error: 'Nobody is here' }, { status: 409 });

		const conversationHistory = await db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, conversationId))
			.orderBy(messages.createdAt);

		const settings = llmSettingsService.getSettings();

		const content = await generateImpersonation(
			conversationHistory,
			character,
			settings,
			style,
			parseInt(userId),
			conversationId,
			// The house context, so the player's own line knows the room and hour.
			conversation.scenario
		);

		// Returned for review — the player edits before sending, never auto-sent.
		return json({ content });
	} catch (error) {
		console.error('Failed to generate impersonation:', error);
		return json({ error: 'Failed to generate impersonation' }, { status: 500 });
	}
};
