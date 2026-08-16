import { db } from '../db';
import { tenants, threads, characters } from '../db/schema';
import { eq, and, lt, inArray } from 'drizzle-orm';
import { SATISFACTION, clampSatisfaction } from '$lib/house/tenancy';

/** One tenant's satisfaction moving, with why — so the UI can report it. */
export interface SatisfactionChange {
	tenantId: number;
	characterName: string;
	before: number;
	after: number;
	reason: string;
}

/**
 * How tenants feel about living here.
 *
 * Satisfaction is about the **housing**, not the landlord personally: it drops
 * when things quietly go wrong and rise when they get dealt with. Every number
 * lives in `SATISFACTION` (`$lib/house/tenancy.ts`) so difficulty is one file to
 * tune.
 *
 * All movement funnels through `adjust()`, which clamps and reports, so nothing
 * can push a value out of range or change it silently.
 */
class SatisfactionService {
	/** Move one tenant's satisfaction, clamped. Returns null if nothing changed. */
	private async adjust(
		tenantId: number,
		delta: number,
		reason: string
	): Promise<SatisfactionChange | null> {
		const [row] = await db
			.select({ tenant: tenants, name: characters.name })
			.from(tenants)
			.innerJoin(characters, eq(tenants.characterId, characters.id))
			.where(eq(tenants.id, tenantId))
			.limit(1);

		if (!row || row.tenant.status !== 'active') return null;

		const before = row.tenant.satisfaction;
		const after = clampSatisfaction(before + delta);
		if (after === before) return null;

		await db.update(tenants).set({ satisfaction: after }).where(eq(tenants.id, tenantId));

		return { tenantId, characterName: row.name, before, after, reason };
	}

	/**
	 * The daily drift, rolled once per tenant on day rollover.
	 *
	 * A chance rather than a fixed decay: a house that degrades on a timer is a
	 * treadmill, but one where things *sometimes* go wrong reads as upkeep. The
	 * tenant with no complaints this week simply got lucky.
	 */
	async applyDailyDrift(houseId: number): Promise<SatisfactionChange[]> {
		const roster = await db
			.select({ id: tenants.id })
			.from(tenants)
			.where(and(eq(tenants.houseId, houseId), eq(tenants.status, 'active')));

		const changes: SatisfactionChange[] = [];

		for (const t of roster) {
			if (Math.random() >= SATISFACTION.DAILY_DROP_CHANCE) continue;

			const span = SATISFACTION.DAILY_DROP_MAX - SATISFACTION.DAILY_DROP_MIN + 1;
			const drop = SATISFACTION.DAILY_DROP_MIN + Math.floor(Math.random() * span);

			const change = await this.adjust(t.id, -drop, 'something around the house');
			if (change) changes.push(change);
		}

		return changes;
	}

	/**
	 * Credit a scene. Once per day per tenant — talking three times in one day is
	 * not three times the attention, and letting it stack would make phase-spam
	 * the optimal strategy.
	 */
	async creditScene(
		houseId: number,
		characterIds: number[],
		day: number
	): Promise<SatisfactionChange[]> {
		if (characterIds.length === 0) return [];

		const roster = await db
			.select({ id: tenants.id, lastTalkedDay: tenants.lastTalkedDay })
			.from(tenants)
			.where(
				and(
					eq(tenants.houseId, houseId),
					eq(tenants.status, 'active'),
					inArray(tenants.characterId, characterIds)
				)
			);

		const changes: SatisfactionChange[] = [];

		for (const t of roster) {
			if (t.lastTalkedDay === day) continue;

			await db.update(tenants).set({ lastTalkedDay: day }).where(eq(tenants.id, t.id));

			const change = await this.adjust(t.id, SATISFACTION.SCENE_GAIN, 'you stopped by');
			if (change) changes.push(change);
		}

		return changes;
	}

	/**
	 * Credit settling something. Promises are worth more than requests: you chose
	 * to commit, so following through counts for more than merely answering.
	 */
	async creditResolvedThread(
		houseId: number,
		characterId: number,
		kind: string
	): Promise<SatisfactionChange | null> {
		const [tenant] = await db
			.select({ id: tenants.id })
			.from(tenants)
			.where(
				and(
					eq(tenants.houseId, houseId),
					eq(tenants.characterId, characterId),
					eq(tenants.status, 'active')
				)
			)
			.limit(1);

		if (!tenant) return null;

		const gain =
			kind === 'promise'
				? SATISFACTION.RESOLVED_PROMISE_GAIN
				: SATISFACTION.RESOLVED_REQUEST_GAIN;

		return this.adjust(
			tenant.id,
			gain,
			kind === 'promise' ? 'you kept your word' : 'you sorted it out'
		);
	}

	/**
	 * Charge promises that went past their day, once each.
	 *
	 * `dueDay < day` and not yet charged. The sting is missing the deadline, not
	 * the ongoing state — charging every day after would spiral a single
	 * forgotten repair into a move-out.
	 */
	async chargeBrokenPromises(houseId: number, day: number): Promise<SatisfactionChange[]> {
		const overdue = await db
			.select({ thread: threads })
			.from(threads)
			.where(
				and(
					eq(threads.houseId, houseId),
					eq(threads.status, 'open'),
					eq(threads.kind, 'promise'),
					lt(threads.dueDay, day)
				)
			);

		const changes: SatisfactionChange[] = [];

		for (const { thread } of overdue) {
			if (thread.penaltyChargedDay !== null) continue;

			const [tenant] = await db
				.select({ id: tenants.id })
				.from(tenants)
				.where(
					and(
						eq(tenants.houseId, houseId),
						eq(tenants.characterId, thread.characterId),
						eq(tenants.status, 'active')
					)
				)
				.limit(1);

			await db
				.update(threads)
				.set({ penaltyChargedDay: day })
				.where(eq(threads.id, thread.id));

			if (!tenant) continue;

			const change = await this.adjust(
				tenant.id,
				-SATISFACTION.BROKEN_PROMISE_PENALTY,
				`you didn't ${thread.summary}`
			);
			if (change) changes.push(change);
		}

		return changes;
	}
}

export const satisfactionService = new SatisfactionService();
