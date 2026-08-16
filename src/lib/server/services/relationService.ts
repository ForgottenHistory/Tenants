import { db } from '../db';
import { relations, houseEvents, tenants, characters, users } from '../db/schema';
import { eq, and, or, desc, gte, inArray } from 'drizzle-orm';
import {
	RELATION,
	RELATION_EVENTS,
	EVENT_HARD_CAP,
	clampRelation,
	formatRelationEvent
} from '$lib/house/relations';
import { phaseId } from '$lib/house/phases';

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
		// The player's dial (General Settings → House Simulation). Falls back to
		// the constant when no user is passed. 0 turns off-screen life off.
		let chance = RELATION.EVENT_CHANCE;
		if (userId !== undefined) {
			const [user] = await db
				.select({ percent: users.houseEventPercent })
				.from(users)
				.where(eq(users.id, userId))
				.limit(1);
			if (user) chance = user.percent / 100;
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

		for (const [a, b] of chosen) {
			const event = pool[Math.floor(Math.random() * pool.length)];

			// Which of the pair is the actor is itself a coin flip, so "{a} ate
			// {b}'s leftovers" doesn't always fall on whoever has the lower id.
			const [actor, other] = Math.random() < 0.5 ? [a, b] : [b, a];
			const text = formatRelationEvent(event.text, actor.name, other.name);

			const { before, after } = await this.adjust(
				houseId,
				actor.characterId,
				other.characterId,
				event.delta
			);

			await db.insert(houseEvents).values({
				houseId,
				day,
				phase,
				kind: 'relation',
				characterAId: actor.characterId,
				characterBId: other.characterId,
				text,
				delta: event.delta,
				createdAt: new Date()
			});

			results.push({
				text,
				delta: event.delta,
				characterAName: actor.name,
				characterBName: other.name,
				scoreBefore: before,
				scoreAfter: after
			});
		}

		return results;
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
	async recentForContext(houseId: number, currentDay: number, daysBack: number) {
		if (daysBack <= 0) return [];

		// Inclusive of today: daysBack = 1 means "today only".
		const earliestDay = currentDay - daysBack + 1;

		const rows = await db
			.select()
			.from(houseEvents)
			.where(and(eq(houseEvents.houseId, houseId), gte(houseEvents.day, earliestDay)))
			.orderBy(desc(houseEvents.day), desc(houseEvents.phase), desc(houseEvents.id))
			.limit(EVENT_HARD_CAP);
		return rows.reverse();
	}

	/** Recent events, newest first. Backs both the house panel and the log page. */
	async getRecentEvents(houseId: number, limit = 20) {
		return await db
			.select()
			.from(houseEvents)
			.where(eq(houseEvents.houseId, houseId))
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
