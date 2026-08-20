import { db } from '../db';
import { occupancy, tenants, bedrooms, sharedSpaces, characters } from '../db/schema';
import { eq, and, inArray, gte, lte } from 'drizzle-orm';
import type { Occupancy, Bedroom, SharedSpace, Character, Tenant } from '../db/schema';
import { PHASE_PLACEMENT_WEIGHTS, phaseId } from '$lib/house/phases';
import {
	bedroomActivity,
	sharedActivity,
	awayActivity,
	parseActivityPools,
	parseSpacePool
} from '$lib/house/activities';

/** An occupancy row joined with who and where — what the house view renders. */
export interface Presence {
	occupancy: Occupancy;
	tenant: Tenant;
	character: Character;
}

export interface PhaseOccupancy {
	/** Keyed by shared space id. */
	bySpace: Map<number, Presence[]>;
	/** Keyed by bedroom id. */
	byBedroom: Map<number, Presence>;
	/** Tenants who are out of the house this phase. */
	away: Presence[];
}

/** Weighted pick over { bedroom, shared, away }. */
function pickPlaceKind(weights: { bedroom: number; shared: number; away: number }): 'bedroom' | 'shared' | 'away' {
	const total = weights.bedroom + weights.shared + weights.away;
	let roll = Math.random() * total;
	if ((roll -= weights.bedroom) < 0) return 'bedroom';
	if ((roll -= weights.shared) < 0) return 'shared';
	return 'away';
}

class OccupancyService {
	/**
	 * Place every active tenant for a given day/phase.
	 *
	 * Idempotent: re-running for the same day/phase clears and re-rolls, so
	 * advancing time twice can't double-book anyone. Returns the rows written.
	 */
	async generateForPhase(houseId: number, day: number, phase: number): Promise<Occupancy[]> {
		const [roster, rooms, spaces] = await Promise.all([
			db
				.select()
				.from(tenants)
				.where(and(eq(tenants.houseId, houseId), eq(tenants.status, 'active'))),
			db.select().from(bedrooms).where(eq(bedrooms.houseId, houseId)),
			db.select().from(sharedSpaces).where(eq(sharedSpaces.houseId, houseId))
		]);

		await db
			.delete(occupancy)
			.where(
				and(eq(occupancy.houseId, houseId), eq(occupancy.day, day), eq(occupancy.phase, phase))
			);

		if (roster.length === 0) return [];

		const id = phaseId(phase);
		const weights = PHASE_PLACEMENT_WEIGHTS[id];
		const unlockedSpaces = spaces.filter((s) => s.unlocked);

		// Bedroom and away lines are the character's own; shared-space lines are
		// generic, since the space belongs to the house rather than to them.
		const cast = await db
			.select({ id: characters.id, activityPools: characters.activityPools })
			.from(characters)
			.where(
				inArray(
					characters.id,
					roster.map((t) => t.characterId)
				)
			);
		const poolsByCharacter = new Map(
			cast.map((c) => [c.id, parseActivityPools(c.activityPools)])
		);

		const rows = roster.map((tenant) => {
			const pools = poolsByCharacter.get(tenant.characterId);
			let kind = pickPlaceKind(weights);

			// A tenant with no room can't be in one; a house with no shared
			// spaces can't host anyone. Fall back rather than write a broken row.
			const ownRoom: Bedroom | undefined = rooms.find((r) => r.id === tenant.bedroomId);
			if (kind === 'bedroom' && !ownRoom) kind = unlockedSpaces.length > 0 ? 'shared' : 'away';
			if (kind === 'shared' && unlockedSpaces.length === 0) kind = ownRoom ? 'bedroom' : 'away';

			if (kind === 'bedroom' && ownRoom) {
				return {
					houseId,
					tenantId: tenant.id,
					day,
					phase,
					placeKind: 'bedroom' as const,
					bedroomId: ownRoom.id,
					sharedSpaceId: null,
					activity: bedroomActivity(id, pools),
					createdAt: new Date()
				};
			}

			if (kind === 'shared') {
				const space: SharedSpace =
					unlockedSpaces[Math.floor(Math.random() * unlockedSpaces.length)];
				return {
					houseId,
					tenantId: tenant.id,
					day,
					phase,
					placeKind: 'shared' as const,
					bedroomId: null,
					sharedSpaceId: space.id,
					activity: sharedActivity(space.kind, parseSpacePool(space.activityPool)),
					createdAt: new Date()
				};
			}

			return {
				houseId,
				tenantId: tenant.id,
				day,
				phase,
				placeKind: 'away' as const,
				bedroomId: null,
				sharedSpaceId: null,
				activity: awayActivity(id, pools),
				createdAt: new Date()
			};
		});

		return await db.insert(occupancy).values(rows).returning();
	}

	/** Read who is where for a phase, grouped for rendering. */
	async getForPhase(houseId: number, day: number, phase: number): Promise<PhaseOccupancy> {
		const rows = await db
			.select()
			.from(occupancy)
			.innerJoin(tenants, eq(occupancy.tenantId, tenants.id))
			.innerJoin(characters, eq(tenants.characterId, characters.id))
			.where(
				and(
					eq(occupancy.houseId, houseId),
					eq(occupancy.day, day),
					eq(occupancy.phase, phase),
					// Occupancy is an append-only log, so rows survive a tenant leaving.
					// Someone who moved out is not standing in the kitchen any more,
					// even though the row recording that they once were still exists.
					eq(tenants.status, 'active')
				)
			);

		const bySpace = new Map<number, Presence[]>();
		const byBedroom = new Map<number, Presence>();
		const away: Presence[] = [];

		for (const row of rows) {
			const presence: Presence = {
				occupancy: row.occupancy,
				tenant: row.tenants,
				character: row.characters
			};

			if (row.occupancy.placeKind === 'shared' && row.occupancy.sharedSpaceId !== null) {
				const list = bySpace.get(row.occupancy.sharedSpaceId) ?? [];
				list.push(presence);
				bySpace.set(row.occupancy.sharedSpaceId, list);
			} else if (row.occupancy.placeKind === 'bedroom' && row.occupancy.bedroomId !== null) {
				byBedroom.set(row.occupancy.bedroomId, presence);
			} else {
				away.push(presence);
			}
		}

		return { bySpace, byBedroom, away };
	}

	/**
	 * Ensure a phase has been placed. Advancing time generates the new phase,
	 * but an existing house that predates the day cycle has none — so the house
	 * view calls this to fill in the current phase on first view.
	 */
	async ensureForPhase(houseId: number, day: number, phase: number): Promise<PhaseOccupancy> {
		const existing = await db
			.select({ id: occupancy.id })
			.from(occupancy)
			.where(
				and(eq(occupancy.houseId, houseId), eq(occupancy.day, day), eq(occupancy.phase, phase))
			)
			.limit(1);

		if (existing.length === 0) {
			await this.generateForPhase(houseId, day, phase);
		}

		return this.getForPhase(houseId, day, phase);
	}

	/**
	 * Put one tenant somewhere for the current phase, overriding the roll.
	 *
	 * Placement is otherwise a weighted random draw, which is fine for filling a
	 * house but useless when the player wants a specific person in a specific room
	 * — to talk to them, or to put two people together and see what happens.
	 *
	 * Rewrites that tenant's row for the day/phase and leaves everyone else's
	 * alone, so this is a correction rather than a re-roll. Delete-then-insert
	 * because a tenant has at most one row per phase and the shape differs by
	 * `placeKind` — the same reason `generateForPhase` clears before writing.
	 *
	 * The two invariants `generateForPhase` maintains are enforced here too: a
	 * tenant can only be placed in their *own* bedroom, and a shared space must be
	 * unlocked. A caller asking for anything else gets an error rather than a row
	 * the rest of the house layer would have to defend against.
	 */
	async placeTenant(
		houseId: number,
		tenantId: number,
		day: number,
		phase: number,
		target: { placeKind: 'bedroom' | 'shared' | 'away'; placeId?: number | null; activity?: string }
	): Promise<Occupancy> {
		const [tenant] = await db
			.select()
			.from(tenants)
			.where(
				and(
					eq(tenants.id, tenantId),
					eq(tenants.houseId, houseId),
					eq(tenants.status, 'active')
				)
			)
			.limit(1);

		if (!tenant) throw new Error('Tenant not found');

		const id = phaseId(phase);
		const [pools] = await db
			.select({ activityPools: characters.activityPools })
			.from(characters)
			.where(eq(characters.id, tenant.characterId))
			.limit(1);
		const parsedPools = parseActivityPools(pools?.activityPools);

		const chosen = target.activity?.trim();
		let row: typeof occupancy.$inferInsert;

		if (target.placeKind === 'bedroom') {
			// Their own room only. Someone else's bedroom would break the one-tenant
			// -per-bedroom read in `getForPhase`, which keys a single presence per
			// room, and a lease is what makes a room yours.
			if (!tenant.bedroomId) throw new Error('That tenant has no room of their own');
			if (target.placeId != null && target.placeId !== tenant.bedroomId) {
				throw new Error('A tenant can only be placed in their own bedroom');
			}
			row = {
				houseId,
				tenantId,
				day,
				phase,
				placeKind: 'bedroom',
				bedroomId: tenant.bedroomId,
				sharedSpaceId: null,
				activity: chosen || bedroomActivity(id, parsedPools),
				createdAt: new Date()
			};
		} else if (target.placeKind === 'shared') {
			const [space] = await db
				.select()
				.from(sharedSpaces)
				.where(and(eq(sharedSpaces.id, Number(target.placeId)), eq(sharedSpaces.houseId, houseId)))
				.limit(1);
			if (!space) throw new Error('Shared space not found');
			if (!space.unlocked) throw new Error('That space is not open yet');
			row = {
				houseId,
				tenantId,
				day,
				phase,
				placeKind: 'shared',
				bedroomId: null,
				sharedSpaceId: space.id,
				activity: chosen || sharedActivity(space.kind, parseSpacePool(space.activityPool)),
				createdAt: new Date()
			};
		} else {
			row = {
				houseId,
				tenantId,
				day,
				phase,
				placeKind: 'away',
				bedroomId: null,
				sharedSpaceId: null,
				activity: chosen || awayActivity(id, parsedPools),
				createdAt: new Date()
			};
		}

		await db
			.delete(occupancy)
			.where(
				and(
					eq(occupancy.houseId, houseId),
					eq(occupancy.tenantId, tenantId),
					eq(occupancy.day, day),
					eq(occupancy.phase, phase)
				)
			);

		const [written] = await db.insert(occupancy).values(row).returning();
		return written;
	}

	/**
	 * What these characters have been doing over the last few days.
	 *
	 * `occupancy` is an append-only log, so a tenant's own recent history is
	 * already sitting there — a character otherwise knows what they are doing
	 * *right now* and nothing about their own week, which makes "what have you
	 * been up to?" unanswerable.
	 *
	 * Keyed by character rather than tenant so the caller doesn't have to map
	 * back, and scoped to the days requested. The current phase is excluded by
	 * the caller passing `beforeDay`/`beforePhase` — a character doesn't need to
	 * be told what they are doing at this exact moment, since the scene already
	 * says so.
	 */
	async getRecentFor(
		houseId: number,
		characterIds: number[],
		fromDay: number,
		toDay: number
	): Promise<Map<number, Array<{ day: number; phase: number; place: string; activity: string | null }>>> {
		const result = new Map<
			number,
			Array<{ day: number; phase: number; place: string; activity: string | null }>
		>();
		if (characterIds.length === 0) return result;

		const rows = await db
			.select({
				characterId: tenants.characterId,
				day: occupancy.day,
				phase: occupancy.phase,
				placeKind: occupancy.placeKind,
				activity: occupancy.activity,
				bedroomName: bedrooms.name,
				spaceName: sharedSpaces.name
			})
			.from(occupancy)
			.innerJoin(tenants, eq(occupancy.tenantId, tenants.id))
			.leftJoin(bedrooms, eq(occupancy.bedroomId, bedrooms.id))
			.leftJoin(sharedSpaces, eq(occupancy.sharedSpaceId, sharedSpaces.id))
			.where(
				and(
					eq(occupancy.houseId, houseId),
					inArray(tenants.characterId, characterIds),
					gte(occupancy.day, fromDay),
					lte(occupancy.day, toDay)
				)
			)
			.orderBy(occupancy.day, occupancy.phase);

		for (const row of rows) {
			const place =
				row.placeKind === 'away'
					? 'out'
					: (row.bedroomName ?? row.spaceName ?? 'the house');
			const list = result.get(row.characterId) ?? [];
			list.push({ day: row.day, phase: row.phase, place, activity: row.activity });
			result.set(row.characterId, list);
		}

		return result;
	}
}

export const occupancyService = new OccupancyService();
