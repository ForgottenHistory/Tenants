import { gameMasterSettingsService } from './gameMasterSettingsService';
import { callLlm } from './llmCallService';
import { weekdayLabel, phaseLabel } from '$lib/house/phases';
import fs from 'fs/promises';
import path from 'path';

const PROMPTS_DIR = 'data/prompts';


/** One pair the roll already picked out, waiting for the Director to describe it. */
export interface DirectorPairRequest {
	/** Position in the request list; the model echoes it back to match them up. */
	id: number;
	/** Whoever acted — the coin flip has already happened. */
	actorName: string;
	otherName: string;
	/** Their standing as a band ("warm", "cool"), so the moment follows from it. */
	standing: string;
	/** Whether the roll made this a good moment or a bad one. Not negotiable. */
	outcome: string;
	/** How much it mattered, as the tier's phrasing. Also not negotiable. */
	weight: string;
	/** The shape of the moment — "the state of the kitchen", "a small favour". */
	kind: string;
}

/**
 * A written moment, or nothing if the model didn't produce a usable one.
 *
 * Text only. The magnitude was rolled before the call and handed to the
 * Director as a constraint to write against, so there is nothing for it to
 * report back — asking it for a number again would only let it contradict the
 * tier it was given.
 */
export interface DirectorMoment {
	id: number;
	text: string;
}

/**
 * Parse the moments YAML.
 *
 * Hand-rolled and forgiving, matching `parseSceneRecord` and
 * `parseActivityYaml` — the shape is a flat list of three-field items, and a
 * model wrapping the block in fences or trailing a sentence of commentary
 * should cost nothing. A malformed item is dropped on its own: the caller falls
 * back to the static pool for whichever ids didn't come back, so one bad entry
 * costs one generic line rather than the whole advance.
 */
function parseMoments(raw: string): DirectorMoment[] {
	const body = raw.replace(/^\s*```(?:ya?ml)?\s*$/gim, '');
	const lines = body.split('\n');

	const moments: DirectorMoment[] = [];
	let current: Record<string, string> | null = null;
	/** Which key a bare continuation line belongs to. Only `text` wraps. */
	let lastKey: string | null = null;

	const flush = () => {
		if (!current) return;
		const id = Number(current.id);
		const text = (current.text ?? '').trim();
		if (Number.isFinite(id) && text) moments.push({ id, text });
		current = null;
		lastKey = null;
	};

	for (const line of lines) {
		if (!line.trim()) continue;

		// `- id: 1` starts an item; the dash and first field share a line.
		const itemStart = line.match(/^\s*-\s*([A-Za-z_]+)\s*:\s*(.*)$/);
		if (itemStart) {
			flush();
			lastKey = itemStart[1].toLowerCase();
			current = { [lastKey]: itemStart[2].replace(/^["']|["']$/g, '').trim() };
			continue;
		}

		const field = line.match(/^\s+([A-Za-z_]+)\s*:\s*(.*)$/);
		if (field && current) {
			lastKey = field[1].toLowerCase();
			current[lastKey] = field[2].replace(/^["']|["']$/g, '').trim();
			continue;
		}

		// A bare continuation line belongs to whichever scalar is open. The prompt
		// asks for one sentence, but YAML wraps long ones across lines.
		if (current && lastKey === 'text') {
			current.text = `${current.text} ${line.trim()}`.trim();
		}
	}
	flush();

	return moments;
}

/**
 * The House Director: the LLM that writes the house's off-screen life.
 *
 * **Flavour only.** Every gameplay decision is still made by the random rolls in
 * `relationService` — which pairs have a moment, how many, who acted. The
 * Director receives those decisions as given and writes the prose for them. It
 * cannot create a moment that wasn't rolled, skip one that was, or change who is
 * involved, so turning it on changes how the house *reads*, never how it plays.
 *
 * One call per phase advance, not one per event: a phase produces at most
 * `MAX_EVENTS_PER_PHASE` moments and they share the same house context, so
 * batching them costs one request instead of three and lets the model avoid
 * writing three variations on the same moment.
 *
 * Every failure path returns what it has and lets the caller fall back to the
 * static pools. A phase advance must never block or break on an LLM call.
 */
class HouseDirectorService {
	private async loadPrompt(): Promise<string> {
		return (await fs.readFile(path.join(PROMPTS_DIR, 'gameMaster_house_event.txt'), 'utf-8')).trim();
	}

	/**
	 * Write the moments for the pairs the roll picked out.
	 *
	 * Returns a map from request id to moment, holding only the entries that came
	 * back usable. Ids the model skipped, malformed, or hallucinated are simply
	 * absent, and the caller uses the static pool for those — so a partial
	 * response degrades one line at a time rather than all-or-nothing.
	 */
	async writeMoments({
		day,
		phase,
		houseContext,
		pairs
	}: {
		day: number;
		phase: number;
		/** Rendered house context — rooms, residents, standings, recent events. */
		houseContext: string;
		pairs: DirectorPairRequest[];
	}): Promise<Map<number, DirectorMoment>> {
		const out = new Map<number, DirectorMoment>();
		if (pairs.length === 0) return out;

		try {
			console.log(`🏠 House Director writing ${pairs.length} moment(s) for day ${day}...`);

			const settings = gameMasterSettingsService.getSettings();
			const promptTemplate = await this.loadPrompt();

			const rendered = pairs
				.map((p) =>
					[
						`${p.id}. ${p.actorName} and ${p.otherName} — currently ${p.standing}.`,
						`   About: ${p.kind || 'anything that fits the hour'}`,
						`   Outcome: ${p.outcome}`,
						`   Weight: ${p.weight}`
					].join('\n')
				)
				.join('\n\n');

			const prompt = promptTemplate
				.replace(/\{\{weekday\}\}/gi, weekdayLabel(day))
				.replace(/\{\{day\}\}/gi, String(day))
				.replace(/\{\{phase\}\}/gi, phaseLabel(phase))
				.replace(/\{\{house\}\}/gi, houseContext.trim() || 'No further detail.')
				.replace(/\{\{pairs\}\}/gi, rendered);

			const result = await callLlm({
				messages: [{ role: 'user', content: prompt }],
				settings,
				logType: 'gamemaster-house-event',
				logCharacterName: 'House Director'
			});

			const requested = new Set(pairs.map((p) => p.id));
			for (const moment of parseMoments(result.content)) {
				// Only ids we actually asked about: a hallucinated id would otherwise
				// write a moment between people the roll never selected.
				if (!requested.has(moment.id) || out.has(moment.id)) continue;
				out.set(moment.id, moment);
			}

			console.log(`🏠 House Director wrote ${out.size}/${pairs.length} moment(s)`);
		} catch (error: any) {
			// Never rethrow. The clock must move whether or not the Director answered;
			// the caller falls back to the static pools for everything missing.
			console.error(`❌ House Director failed to write moments:`, error?.message ?? error);
		}

		return out;
	}
}

export const houseDirectorService = new HouseDirectorService();
