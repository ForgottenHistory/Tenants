import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { characters } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { contentLlmService } from '$lib/server/services/contentLlmService';
import { HOUSE_PHASES } from '$lib/house/phases';

// POST /api/characters/[id]/activity-pools - Write activity pools with the
// Content LLM. Returns them for review; saving is a separate PUT so the player
// can edit first.
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
			// A malformed card still has a name and description to work from.
		}

		const generated = await contentLlmService.generateActivityPools({
			characterName: character.name,
			characterDescription: character.description || cardData.description || '',
			characterPersonality: cardData.personality || ''
		});

		// Keep only the keys the game actually uses. A model that invents a
		// "dawn" phase or a "kitchen" section shouldn't be able to write it into
		// stored data.
		const validPhases = new Set(HOUSE_PHASES.map((p) => p.id));
		const pools: Record<string, Record<string, string[]>> = {};

		for (const section of ['bedroom', 'away'] as const) {
			const from = generated[section];
			if (!from) continue;
			for (const [phase, lines] of Object.entries(from)) {
				if (!validPhases.has(phase as never)) continue;
				const cleaned = (Array.isArray(lines) ? lines : [])
					.map((l) => String(l).trim())
					.filter(Boolean);
				if (cleaned.length > 0) {
					pools[section] ??= {};
					pools[section][phase] = cleaned;
				}
			}
		}

		if (Object.keys(pools).length === 0) {
			return json({ error: 'The model did not return any usable activities' }, { status: 502 });
		}

		return json({ pools });
	} catch (error) {
		console.error('Failed to generate activity pools:', error);
		const message = error instanceof Error ? error.message : 'Failed to generate activities';
		return json({ error: message }, { status: 500 });
	}
};
