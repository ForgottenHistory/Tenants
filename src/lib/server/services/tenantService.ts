import { db } from '../db';
import { tenants, applicants, bedrooms, characters, houses, occupancy, scenes } from '../db/schema';
import { eq, and, notInArray, inArray, gte, or } from 'drizzle-orm';
import type { Tenant, Applicant, Bedroom, Character } from '../db/schema';
import { DEFAULT_LEASE_DAYS, APPLICANTS_PER_VACANCY, SATISFACTION } from '$lib/house/tenancy';

/** A tenancy joined with the character it belongs to — what the UI actually needs. */
export interface TenantWithCharacter {
	tenant: Tenant;
	character: Character;
	bedroom: Bedroom | null;
}

export interface ApplicantWithCharacter {
	applicant: Applicant;
	character: Character;
}

/**
 * Pick a pseudo-random subset without mutating the input.
 * Fisher-Yates on a copy, then slice.
 */
function sample<T>(items: T[], count: number): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy.slice(0, count);
}

class TenantService {
	/** Everyone currently living in the house. */
	async getActiveTenants(houseId: number): Promise<TenantWithCharacter[]> {
		const rows = await db
			.select()
			.from(tenants)
			.innerJoin(characters, eq(tenants.characterId, characters.id))
			.leftJoin(bedrooms, eq(tenants.bedroomId, bedrooms.id))
			.where(and(eq(tenants.houseId, houseId), eq(tenants.status, 'active')));

		return rows.map((row) => ({
			tenant: row.tenants,
			character: row.characters,
			bedroom: row.bedrooms ?? null
		}));
	}

	/** Bedrooms with nobody in them. */
	async getVacantBedrooms(houseId: number): Promise<Bedroom[]> {
		const allRooms = await db.select().from(bedrooms).where(eq(bedrooms.houseId, houseId));
		const occupied = await db
			.select({ bedroomId: tenants.bedroomId })
			.from(tenants)
			.where(and(eq(tenants.houseId, houseId), eq(tenants.status, 'active')));

		const takenIds = new Set(occupied.map((o) => o.bedroomId).filter((id): id is number => id !== null));
		return allRooms.filter((room) => !takenIds.has(room.id));
	}

	async getApplicants(houseId: number): Promise<ApplicantWithCharacter[]> {
		const rows = await db
			.select()
			.from(applicants)
			.innerJoin(characters, eq(applicants.characterId, characters.id))
			.where(eq(applicants.houseId, houseId));

		return rows.map((row) => ({ applicant: row.applicants, character: row.characters }));
	}

	/**
	 * Draw a fresh set of applicants from the character library.
	 *
	 * The entire library is the casting pool — the only exclusions are people
	 * already living here and anyone already in the current applicant list.
	 * Replaces any existing applicants for this house.
	 */
	/**
	 * Draw a shortlist of candidates for ONE vacant room.
	 *
	 * Scoped to a bedroom rather than the house so that filling a vacancy is a
	 * real choice between named people, not a lucky dip from a global pool. The
	 * shortlist is stable for the rest of the day — see `ensureApplicantsFor`,
	 * which regenerates it when the day rolls over.
	 *
	 * Excludes anyone already leasing here AND anyone shortlisted for another
	 * room today, so the same character can't be offered two rooms at once.
	 */
	async generateApplicantsForRoom(
		houseId: number,
		bedroomId: number,
		userId: number,
		count: number = APPLICANTS_PER_VACANCY
	): Promise<ApplicantWithCharacter[]> {
		const [house] = await db
			.select()
			.from(houses)
			.where(and(eq(houses.id, houseId), eq(houses.userId, userId)))
			.limit(1);
		if (!house) throw new Error('House not found');

		const [room] = await db
			.select()
			.from(bedrooms)
			.where(and(eq(bedrooms.id, bedroomId), eq(bedrooms.houseId, houseId)))
			.limit(1);
		if (!room) throw new Error('Room not found');

		// Current residents, plus anyone who left today. Somebody who just walked
		// out does not turn up at the door an hour later asking for a room — they
		// become eligible again from the next day.
		const barred = await db
			.select({ characterId: tenants.characterId })
			.from(tenants)
			.where(
				and(
					eq(tenants.houseId, houseId),
					or(
						eq(tenants.status, 'active'),
						and(eq(tenants.status, 'moved_out'), gte(tenants.moveOutDay, house.day))
					)
				)
			);

		// Anyone on another room's list today is spoken for.
		const otherLists = await db
			.select({ characterId: applicants.characterId })
			.from(applicants)
			.where(
				and(
					eq(applicants.houseId, houseId),
					eq(applicants.generatedOnDay, house.day),
					notInArray(applicants.bedroomId, [bedroomId])
				)
			);

		const unavailable = [
			...barred.map((t) => t.characterId),
			...otherLists.map((a) => a.characterId)
		];

		// The whole library, minus anyone unavailable.
		const pool =
			unavailable.length > 0
				? await db
						.select()
						.from(characters)
						.where(and(eq(characters.userId, userId), notInArray(characters.id, unavailable)))
				: await db.select().from(characters).where(eq(characters.userId, userId));

		// Replace only this room's list; other rooms keep theirs.
		await db
			.delete(applicants)
			.where(and(eq(applicants.houseId, houseId), eq(applicants.bedroomId, bedroomId)));

		if (pool.length === 0) return [];

		// Fewer than `count` candidates is fine — a small library just means a
		// shorter list rather than an error.
		const picked = sample(pool, Math.min(count, pool.length));

		await db.insert(applicants).values(
			picked.map((character) => ({
				houseId,
				bedroomId,
				characterId: character.id,
				pitch: null, // Director writes these in Phase 6
				// ±15% around this room's asking rent, rounded to $10.
				askingRent: Math.round((room.baseRent * (0.85 + Math.random() * 0.3)) / 10) * 10,
				requestedDays: DEFAULT_LEASE_DAYS,
				generatedOnDay: house.day
			}))
		);

		return this.getApplicantsForRoom(houseId, bedroomId);
	}

	/** The shortlist for one room. */
	async getApplicantsForRoom(
		houseId: number,
		bedroomId: number
	): Promise<ApplicantWithCharacter[]> {
		const rows = await db
			.select()
			.from(applicants)
			.innerJoin(characters, eq(applicants.characterId, characters.id))
			.where(and(eq(applicants.houseId, houseId), eq(applicants.bedroomId, bedroomId)));

		return rows.map((row) => ({ applicant: row.applicants, character: row.characters }));
	}

	/**
	 * The shortlist for a room, drawing a fresh one if today's is missing or
	 * stale. **Applications refresh daily**: yesterday's candidates have moved on,
	 * so the same room shows different faces tomorrow.
	 */
	async ensureApplicantsFor(
		houseId: number,
		bedroomId: number,
		userId: number
	): Promise<ApplicantWithCharacter[]> {
		const [house] = await db
			.select()
			.from(houses)
			.where(and(eq(houses.id, houseId), eq(houses.userId, userId)))
			.limit(1);
		if (!house) throw new Error('House not found');

		const existing = await this.getApplicantsForRoom(houseId, bedroomId);
		const isToday =
			existing.length > 0 && existing.every((e) => e.applicant.generatedOnDay === house.day);

		if (isToday) {
			// Today's list can still go stale within the day: a candidate may have
			// taken another room, or moved out of one, since it was drawn. Drop
			// them rather than offering someone who is no longer available.
			const barred = await db
				.select({ characterId: tenants.characterId })
				.from(tenants)
				.where(
					and(
						eq(tenants.houseId, houseId),
						or(
							eq(tenants.status, 'active'),
							and(eq(tenants.status, 'moved_out'), gte(tenants.moveOutDay, house.day))
						)
					)
				);
			const barredIds = new Set(barred.map((t) => t.characterId));

			const stale = existing.filter((e) => barredIds.has(e.character.id));
			if (stale.length === 0) return existing;

			await db.delete(applicants).where(
				inArray(
					applicants.id,
					stale.map((e) => e.applicant.id)
				)
			);
			return existing.filter((e) => !barredIds.has(e.character.id));
		}

		return this.generateApplicantsForRoom(houseId, bedroomId, userId);
	}

	/**
	 * Sign an applicant into a bedroom.
	 *
	 * Transactional: the applicant row is consumed and the tenancy created
	 * together, so a failure can't leave a ghost applicant or a double-booked
	 * room.
	 */
	async acceptApplicant(
		applicantId: number,
		bedroomId: number,
		houseId: number,
		userId: number
	): Promise<Tenant> {
		const [house] = await db
			.select()
			.from(houses)
			.where(and(eq(houses.id, houseId), eq(houses.userId, userId)))
			.limit(1);
		if (!house) throw new Error('House not found');

		const [applicant] = await db
			.select()
			.from(applicants)
			.where(and(eq(applicants.id, applicantId), eq(applicants.houseId, houseId)))
			.limit(1);
		if (!applicant) throw new Error('Applicant not found');

		const [room] = await db
			.select()
			.from(bedrooms)
			.where(and(eq(bedrooms.id, bedroomId), eq(bedrooms.houseId, houseId)))
			.limit(1);
		if (!room) throw new Error('Bedroom not found');

		// Guard both invariants before writing: the room must be free, and the
		// character must not already hold an active tenancy here.
		const vacant = await this.getVacantBedrooms(houseId);
		if (!vacant.some((r) => r.id === bedroomId)) {
			throw new Error('That room is already occupied');
		}

		const [existing] = await db
			.select()
			.from(tenants)
			.where(
				and(
					eq(tenants.houseId, houseId),
					eq(tenants.characterId, applicant.characterId),
					eq(tenants.status, 'active')
				)
			)
			.limit(1);
		if (existing) throw new Error('That character already lives here');

		return db.transaction((tx) => {
			const [tenant] = tx
				.insert(tenants)
				.values({
					houseId,
					characterId: applicant.characterId,
					bedroomId,
					status: 'active',
					moveInDay: house.day,
					leaseEndDay: house.day + applicant.requestedDays,
					rentAmount: applicant.askingRent,
					satisfaction: SATISFACTION.INITIAL,
					createdAt: new Date()
				})
				.returning()
				.all();

			// Interview transcripts outlive the applicant row they came from — the
			// conversation is what informed the decision, so it stays as history.
			// Detaching explicitly rather than relying on `on delete set null`:
			// SQLite cannot add a foreign key to an existing table, so the
			// constraint drizzle-kit declared was never actually created.
			const doomed = tx
				.select({ id: applicants.id })
				.from(applicants)
				.where(and(eq(applicants.houseId, houseId), eq(applicants.bedroomId, bedroomId)))
				.all()
				.map((a) => a.id);

			if (doomed.length > 0) {
				tx.update(scenes)
					.set({ applicantId: null })
					.where(inArray(scenes.applicantId, doomed))
					.run();
			}

			// Choosing one candidate turns the others away: the room is taken, so
			// its whole shortlist goes, not just the person who got it.
			tx.delete(applicants)
				.where(and(eq(applicants.houseId, houseId), eq(applicants.bedroomId, bedroomId)))
				.run();

			return tenant;
		});
	}

	async rejectApplicant(applicantId: number, houseId: number): Promise<boolean> {
		// Keep any interview transcript, detached — see acceptApplicant for why
		// this is explicit rather than an `on delete set null`.
		await db
			.update(scenes)
			.set({ applicantId: null })
			.where(eq(scenes.applicantId, applicantId));

		const result = await db
			.delete(applicants)
			.where(and(eq(applicants.id, applicantId), eq(applicants.houseId, houseId)));
		return result.changes > 0;
	}

	/** End a tenancy. The room becomes vacant; history is kept. */
	async moveOut(tenantId: number, houseId: number, day: number): Promise<boolean> {
		const result = await db
			.update(tenants)
			.set({ status: 'moved_out', moveOutDay: day, bedroomId: null })
			.where(and(eq(tenants.id, tenantId), eq(tenants.houseId, houseId)));

		if (result.changes === 0) return false;

		// Drop their placement from today onward. History before today is kept —
		// occupancy is the record of where people were, and them having been in
		// the kitchen on day 3 stays true after they leave.
		await db
			.delete(occupancy)
			.where(and(eq(occupancy.tenantId, tenantId), gte(occupancy.day, day)));

		return true;
	}

	/** Directly place a library character into a room, bypassing applications. */
	async placeCharacter(
		characterId: number,
		bedroomId: number,
		houseId: number,
		userId: number,
		rentAmount?: number
	): Promise<Tenant> {
		const [house] = await db
			.select()
			.from(houses)
			.where(and(eq(houses.id, houseId), eq(houses.userId, userId)))
			.limit(1);
		if (!house) throw new Error('House not found');

		const [character] = await db
			.select()
			.from(characters)
			.where(and(eq(characters.id, characterId), eq(characters.userId, userId)))
			.limit(1);
		if (!character) throw new Error('Character not found');

		const [room] = await db
			.select()
			.from(bedrooms)
			.where(and(eq(bedrooms.id, bedroomId), eq(bedrooms.houseId, houseId)))
			.limit(1);
		if (!room) throw new Error('Bedroom not found');

		const vacant = await this.getVacantBedrooms(houseId);
		if (!vacant.some((r) => r.id === bedroomId)) {
			throw new Error('That room is already occupied');
		}

		const [existing] = await db
			.select()
			.from(tenants)
			.where(
				and(
					eq(tenants.houseId, houseId),
					eq(tenants.characterId, characterId),
					eq(tenants.status, 'active')
				)
			)
			.limit(1);
		if (existing) throw new Error('That character already lives here');

		const [tenant] = await db
			.insert(tenants)
			.values({
				houseId,
				characterId,
				bedroomId,
				status: 'active',
				moveInDay: house.day,
				leaseEndDay: house.day + DEFAULT_LEASE_DAYS,
				rentAmount: rentAmount ?? room.baseRent,
				satisfaction: SATISFACTION.INITIAL,
				createdAt: new Date()
			})
			.returning();

		return tenant;
	}
}

export const tenantService = new TenantService();
