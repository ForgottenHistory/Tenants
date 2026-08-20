import { contentLlmSettingsService } from './contentLlmSettingsService';
import { weekdayLabel } from '$lib/house/phases';
import { loadWritingStyle, processConditionals } from '../llm/promptUtils';
import { callLlm } from './llmCallService';
import fs from 'fs/promises';
import path from 'path';

const PROMPTS_DIR = 'data/prompts';

export interface SceneRecord {
	summary: string;
	/**
	 * The one line that travels beyond the room, when anything does. Empty for
	 * most scenes — the prompt is explicit that silence is the usual answer.
	 */
	rumour: string;
	opened: Array<{ kind: string; who: string; what: string; due?: number }>;
	resolved: Array<{ id: number; how: string }>;
}

/**
 * Parse the scene-summary YAML: a scalar `summary`, plus two lists of objects.
 *
 * Hand-rolled for the same reason as the activity parser — the shape is fixed
 * and shallow, and a model wrapping the block in fences or trailing a sentence
 * of commentary should cost nothing. A malformed list item is dropped on its
 * own rather than failing the whole record, because losing the summary would
 * lose the scene's memory entirely.
 */
function parseSceneRecord(raw: string): SceneRecord {
	const body = raw.replace(/^\s*```(?:ya?ml)?\s*$/gim, '');
	const lines = body.split('\n');

	let summary = '';
	let rumour = '';
	const opened: SceneRecord['opened'] = [];
	const resolved: SceneRecord['resolved'] = [];

	type Section = 'summary' | 'rumour' | 'opened' | 'resolved';
	let section: Section | null = null;
	let current: Record<string, string> | null = null;

	const flush = () => {
		if (!current) return;
		if (section === 'opened' && current.what) {
			const due = Number(current.due);
			opened.push({
				kind: current.kind === 'promise' ? 'promise' : 'request',
				who: current.who ?? '',
				what: current.what,
				...(Number.isFinite(due) && due > 0 ? { due } : {})
			});
		} else if (section === 'resolved' && current.id) {
			const id = Number(current.id);
			if (Number.isFinite(id)) resolved.push({ id, how: current.how ?? '' });
		}
		current = null;
	};

	for (const line of lines) {
		if (!line.trim()) continue;

		// A new top-level key ends whatever list was being read.
		const top = line.match(/^(summary|rumour|rumor|opened|resolved)\s*:\s*(.*)$/i);
		if (top) {
			flush();
			// Accept the American spelling too: the prompt says "rumour", but a
			// model that normalises it to "rumor" shouldn't silently lose the line.
			const key = top[1].toLowerCase();
			section = (key === 'rumor' ? 'rumour' : key) as Section;
			const value = top[2].replace(/^["']|["']$/g, '').trim();
			if (section === 'summary') summary = value;
			else if (section === 'rumour') rumour = value;
			continue;
		}

		// `- kind: request` starts an item; the dash and first field share a line.
		const itemStart = line.match(/^\s*-\s*([A-Za-z_]+)\s*:\s*(.*)$/);
		if (itemStart) {
			flush();
			current = { [itemStart[1].toLowerCase()]: itemStart[2].replace(/^["']|["']$/g, '').trim() };
			continue;
		}

		const field = line.match(/^\s+([A-Za-z_]+)\s*:\s*(.*)$/);
		if (field && current) {
			current[field[1].toLowerCase()] = field[2].replace(/^["']|["']$/g, '').trim();
			continue;
		}

		// A bare continuation line belongs to whichever scalar block is open.
		if (section === 'summary' && !current) {
			summary = `${summary} ${line.trim()}`.trim();
		} else if (section === 'rumour' && !current) {
			rumour = `${rumour} ${line.trim()}`.trim();
		}
	}
	flush();

	return { summary, rumour, opened, resolved };
}

/**
 * Parse the two-level YAML the activity-pool prompt asks for:
 *
 *   bedroom:
 *     morning:
 *       - just waking up
 *
 * Deliberately hand-rolled and forgiving rather than a full YAML parser. The
 * shape is fixed and shallow, and the failure mode that matters is a model
 * wrapping the block in code fences or adding a stray line of commentary —
 * neither should lose the whole document. Indentation is used only to tell the
 * two key levels apart; list items are matched by their leading dash.
 */
function parseActivityYaml(raw: string): Record<string, Record<string, string[]>> {
	const out: Record<string, Record<string, string[]>> = {};
	let section: string | null = null;
	let phase: string | null = null;

	// Strip code fences if the model added them despite being told not to.
	const body = raw.replace(/^\s*```(?:ya?ml)?\s*$/gim, '');

	for (const line of body.split('\n')) {
		if (!line.trim()) continue;

		const listItem = line.match(/^\s*-\s+(.+?)\s*$/);
		if (listItem) {
			// Trim quotes a model may have added around the value.
			const value = listItem[1].replace(/^["']|["']$/g, '').trim();
			if (!value) continue;
			if (section && phase) {
				out[section][phase].push(value);
			} else if (section) {
				// Items directly under a top-level key (`activities:` followed by a
				// list, with no phase level). Collected under '' so a flat document
				// and a nested one can share this parser.
				out[section][''] ??= [];
				out[section][''].push(value);
			}
			continue;
		}

		const key = line.match(/^(\s*)([A-Za-z_]+)\s*:\s*(.*)$/);
		if (!key) continue;

		const [, indent, name, inline] = key;
		if (indent.length === 0) {
			section = name.toLowerCase();
			phase = null;
			out[section] ??= {};
		} else if (section) {
			phase = name.toLowerCase();
			out[section][phase] ??= [];
			// Tolerate `morning: [a, b, c]` as well as a dashed list.
			const bracketed = inline.match(/^\[(.*)\]$/);
			if (bracketed) {
				out[section][phase].push(
					...bracketed[1]
						.split(',')
						.map((v) => v.replace(/^["']|["']$/g, '').trim())
						.filter(Boolean)
				);
			}
		}
	}

	return out;
}

export type ContentType = 'description' | 'personality' | 'personality_generate' | 'scenario' | 'message_example' | 'greeting' | 'scenario_greeting' | 'scene_summary' | 'activity_pools' | 'space_activities';

class ContentLlmService {
	/**
	 * Load a content prompt from file (always reads fresh from disk)
	 */
	async loadPrompt(type: ContentType): Promise<string> {
		try {
			const content = await fs.readFile(path.join(PROMPTS_DIR, `content_${type}.txt`), 'utf-8');
			return content.trim();
		} catch (error) {
			console.error(`Failed to load content prompt for ${type}, using default:`, error);
			return `Rewrite the following ${type.replace('_', ' ')} to be clean and well-formatted:\n\n{{input}}\n\nRewritten:`;
		}
	}

	/**
	 * Generate a custom greeting based on a scenario
	 */
	async generateScenarioGreeting({
		characterName,
		characterDescription,
		characterPersonality,
		scenario,
		userName
	}: {
		characterName: string;
		characterDescription: string;
		characterPersonality: string;
		scenario: string;
		userName: string;
	}): Promise<string> {
		try {
			console.log(`📝 Content LLM generating scenario greeting for ${characterName}...`);

			// Get Content LLM settings from file
			const settings = contentLlmSettingsService.getSettings();

			// Load prompt template
			const promptTemplate = await this.loadPrompt('scenario_greeting');

			// Replace all placeholders
			// The greeting is prose the player reads in chat, so it follows the same
			// quote/asterisk convention. The template has always referenced this;
			// it was simply never substituted, leaving a literal placeholder.
			const prompt = promptTemplate
				.replace(/\{\{writing_style\}\}/gi, await loadWritingStyle())
				.replace(/\{\{char\}\}/gi, characterName)
				.replace(/\{\{description\}\}/gi, characterDescription || 'No description provided')
				.replace(/\{\{personality\}\}/gi, characterPersonality || 'No personality provided')
				.replace(/\{\{scenario\}\}/gi, scenario)
				.replace(/\{\{user\}\}/gi, userName);

			// Call LLM
			const response = await this.callContentLLM({
				messages: [{ role: 'user', content: prompt }],
				settings,
				contentType: 'scenario_greeting'
			});

			console.log(`📝 Content LLM finished generating scenario greeting`);
			return response.trim();
		} catch (error: any) {
			console.error(`❌ Content LLM failed to generate scenario greeting:`, error.message);
			throw error;
		}
	}

	/**
	 * Condense a finished room scene into something a later scene can recall.
	 *
	 * Only called once a scene can no longer change (see houseSceneService).
	 */
	async summariseScene({
		place,
		day,
		phase,
		participants,
		transcript,
		userName,
		openThreads = 'None.',
		wantRumour = true
	}: {
		place: string;
		day: number;
		phase: string;
		participants: string;
		transcript: string;
		userName: string;
		/** Rendered "id. kind — what" lines, so the model can close them by id. */
		openThreads?: string;
		/**
		 * Whether to ask for a rumour. False for scenes nobody could overhear
		 * (outings, interviews) and when the player has rumours switched off — in
		 * both cases the block is stripped from the prompt rather than the answer
		 * being discarded afterwards.
		 */
		wantRumour?: boolean;
	}): Promise<SceneRecord> {
		try {
			console.log(`📝 Content LLM summarising scene in ${place} (day ${day}, ${phase})...`);

			const settings = contentLlmSettingsService.getSettings();
			const promptTemplate = await this.loadPrompt('scene_summary');

			// Conditionals first: the rumour block is dropped entirely for scenes
			// nobody could overhear, rather than asked for and thrown away.
			const prompt = processConditionals(promptTemplate, { rumours: wantRumour })
				.replace(/\{\{place\}\}/gi, place)
				.replace(/\{\{weekday\}\}/gi, weekdayLabel(day))
				.replace(/\{\{day\}\}/gi, String(day))
				.replace(/\{\{phase\}\}/gi, phase)
				.replace(/\{\{participants\}\}/gi, participants)
				.replace(/\{\{transcript\}\}/gi, transcript)
				.replace(/\{\{open_threads\}\}/gi, openThreads)
				.replace(/\{\{user\}\}/gi, userName);

			const response = await this.callContentLLM({
				messages: [{ role: 'user', content: prompt }],
				settings,
				contentType: 'scene_summary'
			});

			const record = parseSceneRecord(response);
			console.log(
				`📝 Content LLM finished summarising scene ` +
					`(+${record.opened.length} open, -${record.resolved.length} resolved` +
					`${record.rumour ? ', rumour' : ''})`
			);
			return record;
		} catch (error: any) {
			console.error(`❌ Content LLM failed to summarise scene:`, error.message);
			throw error;
		}
	}

	/**
	 * Write per-character activity pools — what they do in their own room and
	 * while out, per phase.
	 *
	 * Asks for YAML rather than JSON: the shape is a fixed two-level nest of
	 * string lists, which YAML expresses without quoting or brace-matching, so
	 * models produce it more reliably and a malformed line costs one entry
	 * instead of the whole document.
	 */
	async generateActivityPools({
		characterName,
		characterDescription,
		characterPersonality
	}: {
		characterName: string;
		characterDescription: string;
		characterPersonality: string;
	}): Promise<Record<string, Record<string, string[]>>> {
		console.log(`📝 Content LLM writing activity pools for ${characterName}...`);

		const settings = contentLlmSettingsService.getSettings();
		const promptTemplate = await this.loadPrompt('activity_pools');

		const prompt = promptTemplate
			.replace(/\{\{char\}\}/gi, characterName)
			.replace(/\{\{description\}\}/gi, characterDescription || 'No description provided')
			.replace(/\{\{personality\}\}/gi, characterPersonality || 'No personality provided');

		const response = await this.callContentLLM({
			messages: [{ role: 'user', content: prompt }],
			settings,
			contentType: 'activity_pools'
		});

		console.log(`📝 Content LLM finished writing activity pools`);
		return parseActivityYaml(response);
	}

	/**
	 * Write the activity pool for one shared space.
	 *
	 * Flat list rather than the phase-keyed shape used for characters: what you
	 * do in a kitchen doesn't change much between morning and evening, and the
	 * room is shared, so the lines have to suit anyone who walks in.
	 */
	async generateSpaceActivities({
		spaceName,
		spaceKind,
		spaceDescription,
		houseName
	}: {
		spaceName: string;
		spaceKind: string;
		spaceDescription: string;
		houseName: string;
	}): Promise<string[]> {
		console.log(`📝 Content LLM writing activities for ${spaceName}...`);

		const settings = contentLlmSettingsService.getSettings();
		const promptTemplate = await this.loadPrompt('space_activities');

		const prompt = promptTemplate
			.replace(/\{\{space\}\}/gi, spaceName)
			.replace(/\{\{kind\}\}/gi, spaceKind)
			.replace(/\{\{description\}\}/gi, spaceDescription || 'No description provided')
			.replace(/\{\{house\}\}/gi, houseName);

		const response = await this.callContentLLM({
			messages: [{ role: 'user', content: prompt }],
			settings,
			contentType: 'space_activities'
		});

		console.log(`📝 Content LLM finished writing space activities`);
		// Reuses the character parser: `activities:` is just a one-level section
		// whose list items land under it.
		const parsed = parseActivityYaml(response);
		const lines = Object.values(parsed.activities ?? {}).flat();
		// The prompt asks for a bare list under one key, but a model may nest it
		// or use a different top-level name — take whatever list came back.
		if (lines.length > 0) return lines;
		return Object.values(parsed)
			.flatMap((section) => Object.values(section).flat())
			.filter(Boolean);
	}

	/**
	 * Write a character's profile from scratch, out of their description.
	 *
	 * Distinct from rewriting `personality`: this reads the DESCRIPTION and always
	 * builds fresh, so it works on the common case of a card that never had a
	 * personality at all — rewriting has nothing to chew on there. Whatever is in
	 * the field is ignored and replaced.
	 *
	 * Covers **appearance and manner**, because the house layer repeats this for
	 * every resident in every scene prompt: a housemate knows what the others look
	 * like as well as what they are like to live with. Two short paragraphs rather
	 * than the whole card — the source description is often thousands of tokens,
	 * and this is what someone would know about a person they live with, not
	 * everything ever written about them.
	 */
	async generatePersonality({
		characterName,
		description
	}: {
		characterName: string;
		description: string;
	}): Promise<string> {
		console.log(`📝 Content LLM writing personality for ${characterName}...`);

		const settings = contentLlmSettingsService.getSettings();
		const promptTemplate = await this.loadPrompt('personality_generate');

		const prompt = promptTemplate
			.replace(/\{\{char\}\}/gi, characterName)
			.replace(/\{\{input\}\}/gi, description);

		const response = await this.callContentLLM({
			messages: [{ role: 'user', content: prompt }],
			settings,
			contentType: 'personality_generate'
		});

		console.log(`📝 Content LLM finished writing personality`);
		return response.trim();
	}

	/**
	 * Rewrite character metadata using Content LLM
	 */
	async rewriteContent({
		type,
		input
	}: {
		type: ContentType;
		input: string;
	}): Promise<string> {
		try {
			console.log(`📝 Content LLM rewriting ${type}...`);

			// Get Content LLM settings from file
			const settings = contentLlmSettingsService.getSettings();
			console.log(`📝 Using Content LLM settings:`, {
				provider: settings.provider,
				model: settings.model,
				temperature: settings.temperature
			});

			// Load prompt template
			const promptTemplate = await this.loadPrompt(type);

			// Replace {{input}} placeholder
			const prompt = promptTemplate.replace('{{input}}', input);

			// Call LLM
			const response = await this.callContentLLM({
				messages: [{ role: 'user', content: prompt }],
				settings,
				contentType: type
			});

			console.log(`📝 Content LLM finished rewriting ${type}`);
			return response.trim();
		} catch (error: any) {
			console.error(`❌ Content LLM failed to rewrite ${type}:`, error.message);
			throw error;
		}
	}

	/**
	 * Call Content LLM with specific settings
	 */
	private async callContentLLM({
		messages,
		settings,
		contentType = 'content'
	}: {
		messages: { role: string; content: string }[];
		settings: any;
		contentType?: string;
	}): Promise<string> {
		const result = await callLlm({
			messages,
			settings,
			logType: `content-${contentType}`,
			logCharacterName: 'Content LLM'
		});
		return result.content;
	}
}

export const contentLlmService = new ContentLlmService();
