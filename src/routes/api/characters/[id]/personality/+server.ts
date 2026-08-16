import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { characters } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { contentLlmService } from '$lib/server/services/contentLlmService';

// POST /api/characters/[id]/personality - Write a personality summary from the
// character's description. Returns it for review; saving is the existing field
// save, so the player edits before it lands on the card.
export const POST: RequestHandler = async ({ cookies, params }) => {
	const userId = cookies.get('userId');
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const characterId = parseInt(params.id);
	if (!Number.isFinite(characterId)) return json({ error: 'Invalid id' }, { status: 400 });

	try {
		const [character] = await db
			.select()
			.from(characters)
			.where(and(eq(characters.id, characterId), eq(characters.userId, parseInt(userId))))
			.limit(1);

		if (!character) return json({ error: 'Character not found' }, { status: 404 });

		let cardData: any = {};
		try {
			cardData = JSON.parse(character.cardData);
			if (cardData.data) cardData = cardData.data;
		} catch {
			// A malformed card still has a name and a description column to work from.
		}

		const description = character.description || cardData.description || '';
		if (!description.trim()) {
			return json(
				{ error: 'This character has no description to build a personality from' },
				{ status: 400 }
			);
		}

		const personality = await contentLlmService.generatePersonality({
			characterName: character.name,
			description
		});

		if (!personality) {
			return json({ error: 'The model did not return a personality' }, { status: 502 });
		}

		return json({ personality });
	} catch (error) {
		console.error('Failed to generate personality:', error);
		const message = error instanceof Error ? error.message : 'Failed to generate personality';
		return json({ error: message }, { status: 500 });
	}
};
