import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { characters, conversations, messages } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { sdService } from '$lib/server/services/sdService';
import { sdSettingsService } from '$lib/server/services/sdSettingsService';
import { sceneService } from '$lib/server/services/sceneService';
import { getSocketServer } from '$lib/server/socket';
import fs from 'fs/promises';
import path from 'path';

const IMAGES_DIR = 'data/images';

// POST /api/scenes/[conversationId]/generate-sd - Render an image into a scene.
//
// Conversation-keyed for the same reason as the rest of the scene API: the
// character-keyed version resolves "the active conversation for this character",
// which never matches a room scene (they are stored with isActive false).
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
		const { tags, characterId } = await request.json();

		if (!tags || typeof tags !== 'string') {
			return json({ error: 'Tags are required' }, { status: 400 });
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

		// Whose appearance tags and prompt overrides to use. Named by the caller
		// in a shared room; the scene's primary otherwise.
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

		const userSettings = await sdSettingsService.getUserSettings(parseInt(userId));

		const result = await sdService.generateImage({
			characterTags: character.imageTags || '',
			contextTags: tags,
			settings: {
				steps: userSettings.steps,
				cfgScale: userSettings.cfgScale,
				sampler: userSettings.sampler,
				scheduler: userSettings.scheduler,
				enableHr: userSettings.enableHr,
				hrScale: userSettings.hrScale,
				hrUpscaler: userSettings.hrUpscaler,
				hrSteps: userSettings.hrSteps,
				denoisingStrength: userSettings.denoisingStrength,
				enableAdetailer: userSettings.enableAdetailer,
				adetailerModel: userSettings.adetailerModel,
				mainPrompt: userSettings.mainPrompt,
				negativePrompt: userSettings.negativePrompt,
				model: userSettings.model
			},
			mainPromptOverride: character.mainPromptOverride || undefined,
			negativePromptOverride: character.negativePromptOverride || undefined
		});

		if (!result.success) {
			return json({ error: result.error || 'Failed to generate image' }, { status: 500 });
		}

		await fs.mkdir(IMAGES_DIR, { recursive: true });

		const filename = `${conversationId}_${Date.now()}.png`;
		await fs.writeFile(path.join(IMAGES_DIR, filename), result.imageBuffer!);

		// Same marker the chat renderer already understands:
		// [SD_IMAGE]/api/images/file.png|prompt[/SD_IMAGE]
		const imageContent = `[SD_IMAGE]/api/images/${filename}|${result.prompt}[/SD_IMAGE]`;

		const [newMessage] = await db
			.insert(messages)
			.values({
				conversationId,
				role: 'assistant',
				characterId: character.id,
				content: imageContent,
				senderName: character.name,
				senderAvatar: character.thumbnailData || character.imageData
			})
			.returning();

		const io = getSocketServer();
		if (io) {
			io.to(`conversation-${conversationId}`).emit('new-message', newMessage);
		}

		return json({
			success: true,
			message: newMessage,
			generationTime: result.generationTime
		});
	} catch (error: any) {
		console.error('Failed to generate scene SD image:', error);
		return json({ error: error.message || 'Failed to generate image' }, { status: 500 });
	}
};
