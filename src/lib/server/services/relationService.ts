import { db } from '../db';
import { relations, houseEvents, tenants, characters, users } from '../db/schema';
import { eq, and, or, desc, gte, ne, inArray } from 'drizzle-orm';
import {
	RELATION,
	RELATION_EVENTS,
	EVENT_KINDS,
	EVENT_HARD_CAP,
	EVENT_INTENSITY,
	EVENT_PACE,
	clampRelation,
	relationLabel,
	rollIntensity,
	rollDelta,
	intensityOf,
	eventPace,
	formatRelationEvent,
	type EventIntensity,
	type EventPace
} from '$lib/house/relations';
import { phaseId } from '$lib/house/phases';
import { houseDirectorService, type DirectorMoment } from './houseDirectorService';

/**
 * Read a rumour's stored audience.
 *
 * Null means "everyone" — either the row predates the column, or it was
 * recorded while the audience setting was 'everyone'. A malformed value is
 * treated the same way: losing a rumour to a parse error is worse than showing
 * it too widely, since the alternative is a line of gossip nobody ever hears.
 */
function parseHeardBy(raw: string | null): number[] | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		return parsed.filter((id): id is number => typeof id === 'number');
	} catch {
		return null;
	}
}

/** One off-screen moment, as it happened, for reporting back to the UI. */
export interface RelationEventResult {
	text: string;
	delta: number;
	characterAName: string;
	characterBName: string;
	scoreBefore: number;
	scoreAfter: number;
}

/**
 * Life in the house between the people who live there.
 *
 * Housemates get on with each other whether or not the player is in the room,
 * so a phase advance rolls a few off-screen moments: someone made coffee,
 * someone ate the leftovers. Each nudges that pair's relation and lands in the
 * event log.
 *
 * Deliberately dumb — a weighted random draw from per-phase pools, no LLM call,
 * no latency, no cost. Same reasoning as `occupancyService`: the loop stays
 * testable and free, and the House Director can replace the draw later behind
 * this same interface.
 */
class RelationService {
	/** The canonical (lower, higher) ordering, so a pair has exactly one row. */
	private orderPair(a: number, b: number): [number, number] {
		return a < b ? [a, b] : [b, a];
	}

	/** Current score for a pair. Absent means they haven't met — INITIAL. */
	async getScore(houseId: number, characterAId: number, characterBId: number): Promise<number> {
		const [lo, hi] = this.orderPair(characterAId, characterBId);
		const [row] = await db
			.select()
			.from(relations)
			.where(
				and(
					eq(relations.houseId, houseId),
					eq(relations.characterAId, lo),
					eq(relations.characterBId, hi)
				)
			)
			.limit(1);
		return row?.score ?? RELATION.INITIAL;
	}

	/**
	 * Move a pair's relation, clamped. Upserts, since a pair has no row until
	 * something actually happens between them.
	 */
	async adjust(
		houseId: number,
		characterAId: number,
		characterBId: number,
		delta: number
	): Promise<{ before: number; after: number }> {
		const [lo, hi] = this.orderPair(characterAId, characterBId);

		const [existing] = await db
			.select()
			.from(relations)
			.where(
				and(
					eq(relations.houseId, houseId),
					eq(relations.characterAId, lo),
					eq(relations.characterBId, hi)
				)
			)
			.limit(1);

		const before = existing?.score ?? RELATION.INITIAL;
		const after = clampRelation(before + delta);

		if (existing) {
			await db
				.update(relations)
				.set({ score: after, updatedAt: new Date() })
				.where(eq(relations.id, existing.id));
		} else {
			await db.insert(relations).values({
				houseId,
				characterAId: lo,
				characterBId: hi,
				score: after,
				updatedAt: new Date()
			});
		}

		return { before, after };
	}

	/**
	 * Roll off-screen moments for a phase.
	 *
	 * Every pair of active tenants gets one chance; the winners are capped so a
	 * busy house doesn't bury the player in notifications. Which pool it draws
	 * from depends on the phase, so the events match the hour.
	 *
	 * Returns what happened, so the advance response can report it rather than
	 * silently shifting numbers.
	 */
	async generateForPhase(
		houseId: number,
		day: number,
		phase: number,
		userId?: number
	): Promise<RelationEventResult[]> {
		// What the housemates call the landlord when they talk about them. Only
		// the gossip kinds use it, but it is rolled before we know which kinds
		// came up, so it is resolved once up front rather than per event.
		let landlordName = 'the landlord';
		if (userId !== undefined) {
			try {
				const { personaService } = await import('./personaService');
				const info = await personaService.getActiveUserInfo(userId);
				if (info?.name) landlordName = info.name;
			} catch {
				// A missing persona just means they stay "the landlord", which the
				// kind still reads correctly with.
			}
		}

		// The player's dials (General Settings → House Simulation). Both fall back
		// to defaults when no user is passed. 0 turns off-screen life off.
		let chance = RELATION.EVENT_CHANCE;
		let pace: EventPace = 'normal';
		if (userId !== undefined) {
			const [user] = await db
				.select({ percent: users.houseEventPercent, pace: users.houseEventPace })
				.from(users)
				.where(eq(users.id, userId))
				.limit(1);
			if (user) {
				chance = user.percent / 100;
				pace = eventPace(user.pace);
			}
		}
		if (chance <= 0) return [];

		const roster = await db
			.select({ characterId: tenants.characterId, name: characters.name })
			.from(tenants)
			.innerJoin(characters, eq(tenants.characterId, characters.id))
			.where(and(eq(tenants.houseId, houseId), eq(tenants.status, 'active')));

		// Nothing happens between fewer than two people.
		if (roster.length < 2) return [];

		const pool = RELATION_EVENTS[phaseId(phase)];
		if (!pool || pool.length === 0) return [];

		// Every unordered pair gets one roll.
		const candidates: Array<[(typeof roster)[number], (typeof roster)[number]]> = [];
		for (let i = 0; i < roster.length; i++) {
			for (let j = i + 1; j < roster.length; j++) {
				if (Math.random() < chance) {
					candidates.push([roster[i], roster[j]]);
				}
			}
		}

		// Shuffle before capping, so it isn't always the same pairs that get
		// through in a house with several tenants.
		for (let i = candidates.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[candidates[i], candidates[j]] = [candidates[j], candidates[i]];
		}

		const chosen = candidates.slice(0, RELATION.MAX_EVENTS_PER_PHASE);
		const results: RelationEventResult[] = [];

		const kinds = EVENT_KINDS[phaseId(phase)] ?? [];

		// Everything above and inside this map is the game deciding what happened:
		// which pairs, how many, who acted, whether it went well, and how much it
		// mattered. The Director only ever writes the prose for those decisions.
		const rolled = chosen.map(([a, b], index) => {
			// Which of the pair is the actor is itself a coin flip, so "{a} ate
			// {b}'s leftovers" doesn't always fall on whoever has the lower id.
			const [actor, other] = Math.random() < 0.5 ? [a, b] : [b, a];

			// Valence stays a roll rather than the Director's call: it is the half
			// of the event that actually moves the score, and the whole point of
			// the split is that the dice own the game and the LLM owns the wording.
			const positive = Math.random() < 0.5;
			const intensity = rollIntensity();

			// The fallback is drawn from the same valence and tier the roll picked,
			// so switching the Director off — or having it fail — produces an event
			// of the same weight rather than a differently-sized one. A tier with no
			// authored line of that sign falls back to the whole matching-sign pool,
			// since the pools were written before tiers existed and are thin at the
			// extremes.
			const sameSign = pool.filter((e) => e.delta > 0 === positive);
			const inTier = sameSign.filter((e) => intensityOf(e.delta) === intensity);
			const drawFrom = inTier.length > 0 ? inTier : sameSign.length > 0 ? sameSign : pool;

			return {
				// One-based, matching how the prompt numbers them: a model handed a
				// list starting at 0 tends to answer starting at 1 regardless.
				id: index + 1,
				actor,
				other,
				positive,
				intensity,
				kind:
					kinds.length > 0
						? kinds[Math.floor(Math.random() * kinds.length)].replace(
								/\{\{user\}\}/gi,
								landlordName
							)
						: '',
				fallback: drawFrom[Math.floor(Math.random() * drawFrom.length)],
				// The delta the roll intends. Used as-is for a Director line, since
				// the Director is writing to this tier as a constraint.
				delta: rollDelta(intensity, positive, pace)
			};
		});

		// Ask the House Director to write them, when the player has it on. Returns
		// only what came back usable — anything missing keeps its static line, so a
		// failed, slow or partial response costs flavour and nothing else.
		const written = await this.writeMoments(houseId, day, phase, userId, rolled);

		for (const { id, actor, other, fallback, delta: rolledDelta } of rolled) {
			const moment = written.get(id);
			const text = moment?.text ?? formatRelationEvent(fallback.text, actor.name, other.name);

			// The delta belongs to whichever line is actually used. A Director line
			// was written to the rolled tier, so it takes the rolled delta; a
			// fallback line carries its own authored number, which is what that
			// sentence was written to mean. Crossing them would attach a magnitude
			// to a moment it was not written for.
			//
			// The pace multiplier still applies to the fallback, since it is a
			// property of how fast the house moves rather than of the Director —
			// without it, a failed call or a switched-off Director would quietly
			// ignore the setting.
			const delta = moment
				? rolledDelta
				: Math.round(fallback.delta * EVENT_PACE[pace].multiplier);

			const { before, after } = await this.adjust(
				houseId,
				actor.characterId,
				other.characterId,
				delta
			);

			await db.insert(houseEvents).values({
				houseId,
				day,
				phase,
				kind: 'relation',
				characterAId: actor.characterId,
				characterBId: other.characterId,
				text,
				delta,
				createdAt: new Date()
			});

			results.push({
				text,
				delta,
				characterAName: actor.name,
				characterBName: other.name,
				scoreBefore: before,
				scoreAfter: after
			});
		}

		return results;
	}

	/**
	 * Hand the rolled pairs to the House Director, when the player has it on.
	 *
	 * Split out of `generateForPhase` so the roll above stays readable as the
	 * thing that decides the game, and this stays readable as the thing that only
	 * decides wording. Returns an empty map when the Director is off, when the
	 * call fails, or when the context can't be built — every one of which leaves
	 * the caller on the static pools.
	 */
	private async writeMoments(
		houseId: number,
		day: number,
		phase: number,
		userId: number | undefined,
		rolled: Array<{
			id: number;
			actor: { characterId: number; name: string };
			other: { characterId: number; name: string };
			positive: boolean;
			intensity: EventIntensity;
			kind: string;
		}>
	): Promise<Map<number, DirectorMoment>> {
		const empty = new Map<number, DirectorMoment>();
		if (userId === undefined || rolled.length === 0) return empty;

		const [user] = await db
			.select({ enabled: users.houseDirectorEnabled })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);
		if (!user?.enabled) return empty;

		try {
			// Imported lazily: `houseSceneService` imports this module, so a static
			// import here would close a cycle. Deferring it to the one call path that
			// needs it keeps module init order irrelevant.
			const { houseSceneService } = await import('./houseSceneService');

			// The same context a character gets in a scene, so the moments follow
			// from who these people are and what has already happened between them.
			// No exclusions: everyone in the house is fair game to write about.
			const houseContext = await houseSceneService.buildLayoutContext(houseId, [], {
				currentDay: day,
				userId
			});

			const pairs = await Promise.all(
				rolled.map(async (r) => ({
					id: r.id,
					actorName: r.actor.name,
					otherName: r.other.name,
					standing: relationLabel(
						await this.getScore(houseId, r.actor.characterId, r.other.characterId)
					).toLowerCase(),
					// Handed over as constraints, not suggestions: the Director writes a
					// line that matches this shape rather than choosing the shape.
					outcome: r.positive ? 'it went well' : 'it did not go well',
					weight: EVENT_INTENSITY[r.intensity].label,
					kind: r.kind
				}))
			);

			return await houseDirectorService.writeMoments({ day, phase, houseContext, pairs });
		} catch (error: any) {
			// Building the context is a handful of queries and can fail on its own.
			// Same rule as the Director call itself: the clock still moves.
			console.error(`❌ House Director context failed:`, error?.message ?? error);
			return empty;
		}
	}

	/**
	 * Record somebody arriving or leaving.
	 *
	 * A move-in or move-out is the most conspicuous thing that can happen in a
	 * shared house — everyone living there notices a new face at breakfast, or a
	 * room suddenly empty. Logged as an event so it shows in the house log and,
	 * more importantly, so characters know about it in scenes.
	 *
	 * `delta: 0` — arriving isn't itself good or bad for anyone's relations, it
	 * just happened.
	 */
	async recordTenancyEvent(
		houseId: number,
		day: number,
		phase: number,
		kind: 'move_in' | 'move_out',
		characterId: number,
		characterName: string,
		roomName: string | null
	): Promise<void> {
		const where = roomName ? ` into ${roomName}` : '';
		const text =
			kind === 'move_in'
				? `${characterName} moved${where ? where : ' in'}.`
				: `${characterName} moved out${roomName ? ` of ${roomName}` : ''}.`;

		await db.insert(houseEvents).values({
			houseId,
			day,
			phase,
			kind,
			characterAId: characterId,
			characterBId: null,
			text,
			delta: 0,
			createdAt: new Date()
		});
	}

	/**
	 * Record something that carried beyond the room it happened in.
	 *
	 * A scene summary is private to whoever was there. A rumour is the one line
	 * that leaked — stored as a house event so it flows through the same recall
	 * window, log and panel as everything else, but scoped by `heardBy` because
	 * unlike a move-in it is not automatically common knowledge.
	 *
	 * `delta: 0` — overhearing a row doesn't move anyone's relation with anyone;
	 * it only changes what they know.
	 */
	async recordRumour(
		houseId: number,
		day: number,
		phase: number,
		text: string,
		/** Who was in earshot, or null for "the whole house hears it". */
		heardBy: number[] | null,
		subjectId: number | null
	): Promise<void> {
		if (!text.trim()) return;

		await db.insert(houseEvents).values({
			houseId,
			day,
			phase,
			kind: 'rumour',
			// Whoever the rumour is about, so it shows on their side of the log.
			characterAId: subjectId,
			characterBId: null,
			text: text.trim(),
			delta: 0,
			heardBy: heardBy === null ? null : JSON.stringify(heardBy),
			createdAt: new Date()
		});
	}

	/**
	 * What the house has been talking about lately, oldest first.
	 *
	 * Scoped by **days back from the current day**, not a fixed count: "the last
	 * N events" spans an hour in a chaotic house and a month in a quiet one, which
	 * is the wrong shape for "what happened recently". A day window gives the same
	 * sense of recency either way.
	 *
	 * Oldest-first because it reads as a short history in the prompt, matching how
	 * scene recall is presented.
	 *
	 * `EVENT_HARD_CAP` still applies. A busy house can generate several events per
	 * phase, and this text is paid for on every message of every scene — the day
	 * window controls *how far back*, the cap stops a single wild week from
	 * swallowing the context window.
	 */
	async recentForContext(
		houseId: number,
		currentDay: number,
		daysBack: number,
		/**
		 * Who this context is being built for. Rumours are the one event kind
		 * that isn't automatically common knowledge, so they're dropped unless
		 * one of these characters was in earshot. Empty means "no audience
		 * filter" — used by the log and panels, which show the player everything.
		 */
		audience: number[] | null = null
	) {
		if (daysBack <= 0) return [];

		// Inclusive of today: daysBack = 1 means "today only".
		const earliestDay = currentDay - daysBack + 1;

		const rows = await db
			.select()
			.from(houseEvents)
			.where(and(eq(houseEvents.houseId, houseId), gte(houseEvents.day, earliestDay)))
			.orderBy(desc(houseEvents.day), desc(houseEvents.phase), desc(houseEvents.id))
			.limit(EVENT_HARD_CAP);

		const visible =
			audience === null
				? rows
				: rows.filter((row) => {
						if (row.kind !== 'rumour') return true;
						// Null heardBy means everyone — either the 'everyone' setting was
						// in force when it was recorded, or the row predates the column.
						if (!row.heardBy) return true;
						const heard = parseHeardBy(row.heardBy);
						return heard === null || audience.some((id) => heard.includes(id));
					});

		return visible.reverse();
	}

	/**
	 * Recent events, newest first, **excluding rumours**.
	 *
	 * Rumours are a different kind of thing — something the house overheard about
	 * you, not an off-screen moment between housemates — and they carry no delta,
	 * so mixed into this list they read as a neutral relation event. The house
	 * panel shows them separately via `getRecentRumours`. The log page still wants
	 * everything interleaved by day and uses `getAllEvents`.
	 */
	async getRecentEvents(houseId: number, limit = 20) {
		return await db
			.select()
			.from(houseEvents)
			.where(and(eq(houseEvents.houseId, houseId), ne(houseEvents.kind, 'rumour')))
			.orderBy(desc(houseEvents.day), desc(houseEvents.phase), desc(houseEvents.id))
			.limit(limit);
	}

	/**
	 * Rumours only, newest first — what the house has been saying about you.
	 *
	 * Unscoped by earshot on purpose: this is the player's own panel, and the
	 * player hears everything. `recentForContext` is where `heardBy` decides who
	 * among the characters actually knows.
	 */
	async getRecentRumours(houseId: number, limit = 6) {
		return await db
			.select()
			.from(houseEvents)
			.where(and(eq(houseEvents.houseId, houseId), eq(houseEvents.kind, 'rumour')))
			.orderBy(desc(houseEvents.day), desc(houseEvents.phase), desc(houseEvents.id))
			.limit(limit);
	}

	/** Every event in the house, newest first. The log page pages through this. */
	async getAllEvents(houseId: number, limit = 200, offset = 0) {
		return await db
			.select()
			.from(houseEvents)
			.where(eq(houseEvents.houseId, houseId))
			.orderBy(desc(houseEvents.day), desc(houseEvents.phase), desc(houseEvents.id))
			.limit(limit)
			.offset(offset);
	}

	/**
	 * Every known relation between the house's current tenants, with names.
	 *
	 * Only pairs who actually live here now: a score against someone long gone is
	 * still stored (they may come back) but has no place on the roster.
	 */
	async getHouseRelations(houseId: number) {
		const roster = await db
			.select({ characterId: tenants.characterId, name: characters.name })
			.from(tenants)
			.innerJoin(characters, eq(tenants.characterId, characters.id))
			.where(and(eq(tenants.houseId, houseId), eq(tenants.status, 'active')));

		if (roster.length < 2) return [];

		const ids = roster.map((r) => r.characterId);
		const rows = await db
			.select()
			.from(relations)
			.where(
				and(
					eq(relations.houseId, houseId),
					inArray(relations.characterAId, ids),
					inArray(relations.characterBId, ids)
				)
			);

		const nameOf = new Map(roster.map((r) => [r.characterId, r.name]));

		return (
			rows
				.map((row) => ({
					characterAId: row.characterAId,
					characterBId: row.characterBId,
					characterAName: nameOf.get(row.characterAId) ?? 'Someone',
					characterBName: nameOf.get(row.characterBId) ?? 'Someone',
					score: row.score
				}))
				// Alphabetical, not by score: the list is a directory you look names up
				// in, and score-ordering makes a pair move every time anything happens
				// between them — so the row you want is never where you last saw it.
				.sort((x, y) => {
					const byFirst = x.characterAName.localeCompare(y.characterAName);
					return byFirst !== 0 ? byFirst : x.characterBName.localeCompare(y.characterBName);
				})
		);
	}

	/**
	 * Every logged event involving both of these characters, newest first.
	 *
	 * Backs the per-pair history modal: "why are these two cool with each other"
	 * is answerable from the log, since each relation event records who it was
	 * between. Order-independent, because `house_events` stores whoever acted as
	 * A and the other as B — the same pair appears both ways round.
	 */
	async getEventsBetween(houseId: number, characterAId: number, characterBId: number) {
		return await db
			.select()
			.from(houseEvents)
			.where(
				and(
					eq(houseEvents.houseId, houseId),
					or(
						and(
							eq(houseEvents.characterAId, characterAId),
							eq(houseEvents.characterBId, characterBId)
						),
						and(
							eq(houseEvents.characterAId, characterBId),
							eq(houseEvents.characterBId, characterAId)
						)
					)
				)
			)
			.orderBy(desc(houseEvents.day), desc(houseEvents.phase), desc(houseEvents.id));
	}
}

export const relationService = new RelationService();
