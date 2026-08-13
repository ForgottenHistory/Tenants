import { db } from '../db';
import { tenants, applicants, bedrooms, characters, houses } from '../db/schema';
import { eq, and, notInArray, inArray } from 'drizzle-orm';
import type { Tenant, Applicant, Bedroom, Character } from '../db/schema';
import { DEFAULT_LEASE_DAYS, APPLICANTS_PER_VACANCY } from '$lib/house/tenancy';

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
	async generateApplicants(
		houseId: number,
		userId: number,
		count: number = APPLICANTS_PER_VACANCY
	): Promise<ApplicantWithCharacter[]> {
		const [house] = await db
			.select()
			.from(houses)
			.where(and(eq(houses.id, houseId), eq(houses.userId, userId)))
			.limit(1);
		if (!house) throw new Error('House not found');

		const currentTenants = await db
			.select({ characterId: tenants.characterId })
			.from(tenants)
			.where(and(eq(tenants.houseId, houseId), eq(tenants.status, 'active')));
		const livingHere = currentTenants.map((t) => t.characterId);

		// The whole library, minus anyone already under lease here.
		const pool =
			livingHere.length > 0
				? await db
						.select()
						.from(characters)
						.where(and(eq(characters.userId, userId), notInArray(characters.id, livingHere)))
				: await db.select().from(characters).where(eq(characters.userId, userId));

		if (pool.length === 0) return [];

		const vacancies = await this.getVacantBedrooms(houseId);
		// Rent expectations anchor on what the vacant rooms actually ask.
		const averageRent =
			vacancies.length > 0
				? vacancies.reduce((sum, room) => sum + room.baseRent, 0) / vacancies.length
				: 800;

		const picked = sample(pool, Math.min(count, pool.length));

		await db.delete(applicants).where(eq(applicants.houseId, houseId));

		if (picked.length === 0) return [];

		await db.insert(applicants).values(
			picked.map((character) => ({
				houseId,
				characterId: character.id,
				pitch: null, // Director writes these in Phase 6
				// ±15% around the room's asking rent, rounded to $10.
				askingRent: Math.round((averageRent * (0.85 + Math.random() * 0.3)) / 10) * 10,
				requestedDays: DEFAULT_LEASE_DAYS,
				generatedOnDay: house.day
			}))
		);

		return this.getApplicants(houseId);
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
					satisfaction: 70,
					createdAt: new Date()
				})
				.returning()
				.all();

			tx.delete(applicants).where(eq(applicants.id, applicantId)).run();

			return tenant;
		});
	}

	async rejectApplicant(applicantId: number, houseId: number): Promise<boolean> {
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
		return result.changes > 0;
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
				satisfaction: 70,
				createdAt: new Date()
			})
			.returning();

		return tenant;
	}
}

export const tenantService = new TenantService();
