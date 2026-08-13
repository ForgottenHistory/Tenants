import { db } from '../db';
import { houses, bedrooms, sharedSpaces, tenants } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { House, Bedroom, SharedSpace } from '../db/schema';
import { DEFAULT_BASE_RENT, DEFAULT_STARTING_BALANCE } from '$lib/house/spacePresets';

export interface HouseSummary {
	house: House;
	bedrooms: Bedroom[];
	spaces: SharedSpace[];
	occupiedBedrooms: number;
}

export interface CreateHouseInput {
	name: string;
	address?: string | null;
	description?: string | null;
	startingBalance?: number;
	bedrooms: Array<{ name: string; baseRent?: number }>;
	spaces: Array<{
		name: string;
		kind: string;
		description?: string | null;
		capacity?: number;
	}>;
}

class HouseService {
	/**
	 * The house the player is currently living in. Null means "no session" —
	 * which is what makes the Home page show the start-a-house prompt.
	 */
	async getActiveHouse(userId: number): Promise<House | null> {
		const [house] = await db
			.select()
			.from(houses)
			.where(and(eq(houses.userId, userId), eq(houses.isActive, true)))
			.orderBy(desc(houses.updatedAt))
			.limit(1);
		return house ?? null;
	}

	async getHouseById(houseId: number, userId: number): Promise<House | null> {
		const [house] = await db
			.select()
			.from(houses)
			.where(and(eq(houses.id, houseId), eq(houses.userId, userId)))
			.limit(1);
		return house ?? null;
	}

	async getAllHouses(userId: number): Promise<House[]> {
		return await db
			.select()
			.from(houses)
			.where(eq(houses.userId, userId))
			.orderBy(desc(houses.updatedAt));
	}

	async getBedrooms(houseId: number): Promise<Bedroom[]> {
		return await db
			.select()
			.from(bedrooms)
			.where(eq(bedrooms.houseId, houseId))
			.orderBy(bedrooms.sortOrder);
	}

	async getSharedSpaces(houseId: number): Promise<SharedSpace[]> {
		return await db
			.select()
			.from(sharedSpaces)
			.where(eq(sharedSpaces.houseId, houseId))
			.orderBy(sharedSpaces.sortOrder);
	}

	/** Everything the Home page needs about the current house in one call. */
	async getHouseSummary(houseId: number, userId: number): Promise<HouseSummary | null> {
		const house = await this.getHouseById(houseId, userId);
		if (!house) return null;

		const [rooms, spaces, occupied] = await Promise.all([
			this.getBedrooms(houseId),
			this.getSharedSpaces(houseId),
			db
				.select({ id: tenants.id })
				.from(tenants)
				.where(and(eq(tenants.houseId, houseId), eq(tenants.status, 'active')))
		]);

		return {
			house,
			bedrooms: rooms,
			spaces,
			occupiedBedrooms: occupied.length
		};
	}

	/**
	 * Create a house with its bedrooms and shared spaces, and make it active.
	 *
	 * Runs in a transaction: a half-built house with no rooms would be worse
	 * than no house at all, since the player could not tell it was broken.
	 */
	async createHouse(userId: number, input: CreateHouseInput): Promise<House> {
		const name = input.name.trim();
		if (!name) {
			throw new Error('House name is required');
		}
		if (input.bedrooms.length === 0) {
			throw new Error('A house needs at least one bedroom');
		}

		return db.transaction((tx) => {
			// Starting a new house pauses any other active one, so the
			// "one active house at a time" rule holds without a second write path.
			tx.update(houses)
				.set({ isActive: false })
				.where(and(eq(houses.userId, userId), eq(houses.isActive, true)))
				.run();

			const [house] = tx
				.insert(houses)
				.values({
					userId,
					name,
					address: input.address?.trim() || null,
					description: input.description?.trim() || null,
					isActive: true,
					day: 1,
					phase: 0,
					balance: input.startingBalance ?? DEFAULT_STARTING_BALANCE,
					createdAt: new Date(),
					updatedAt: new Date()
				})
				.returning()
				.all();

			tx.insert(bedrooms)
				.values(
					input.bedrooms.map((room, i) => ({
						houseId: house.id,
						name: room.name.trim() || `Room ${i + 1}`,
						sortOrder: i,
						baseRent: room.baseRent ?? DEFAULT_BASE_RENT
					}))
				)
				.run();

			if (input.spaces.length > 0) {
				tx.insert(sharedSpaces)
					.values(
						input.spaces.map((space, i) => ({
							houseId: house.id,
							name: space.name.trim() || `Space ${i + 1}`,
							kind: space.kind,
							description: space.description?.trim() || null,
							sortOrder: i,
							capacity: space.capacity ?? 4
						}))
					)
					.run();
			}

			return house;
		});
	}

	/** Switch which house the player is in. Others become paused saves. */
	async setActiveHouse(houseId: number, userId: number): Promise<House | null> {
		const house = await this.getHouseById(houseId, userId);
		if (!house) return null;

		return db.transaction((tx) => {
			tx.update(houses)
				.set({ isActive: false })
				.where(and(eq(houses.userId, userId), eq(houses.isActive, true)))
				.run();

			const [updated] = tx
				.update(houses)
				.set({ isActive: true, updatedAt: new Date() })
				.where(eq(houses.id, houseId))
				.returning()
				.all();

			return updated;
		});
	}

	async deleteHouse(houseId: number, userId: number): Promise<boolean> {
		const house = await this.getHouseById(houseId, userId);
		if (!house) return false;
		// Bedrooms and shared spaces cascade.
		await db.delete(houses).where(eq(houses.id, houseId));
		return true;
	}
}

export const houseService = new HouseService();
