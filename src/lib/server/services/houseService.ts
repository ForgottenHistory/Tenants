import { db } from '../db';
import {
	houses,
	bedrooms,
	sharedSpaces,
	tenants,
	characters,
	applicants,
	occupancy,
	scenes,
	threads,
	conversations,
	relations,
	houseEvents
} from '../db/schema';
import { eq, and, desc, lte } from 'drizzle-orm';
import type { House, Bedroom, SharedSpace } from '../db/schema';
import { DEFAULT_BASE_RENT, DEFAULT_STARTING_BALANCE } from '$lib/house/spacePresets';
import { nextPhase } from '$lib/house/phases';
import { occupancyService } from './occupancyService';
import { satisfactionService, type SatisfactionChange } from './satisfactionService';
import { relationService, type RelationEventResult } from './relationService';

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

	/**
	 * Advance the clock by one phase, rolling into the next day as needed.
	 *
	 * On a day rollover, leases that have reached their end day are settled:
	 * those tenants move out and their rooms open up. Returns what happened so
	 * the UI can report it rather than silently changing the roster.
	 */
	async advancePhase(
		houseId: number,
		userId: number
	): Promise<{
		house: House;
		rolledOver: boolean;
		movedOut: Array<{ tenantId: number; characterName: string }>;
		satisfactionChanges: SatisfactionChange[];
		relationEvents: RelationEventResult[];
	}> {
		const house = await this.getHouseById(houseId, userId);
		if (!house) throw new Error('House not found');

		const next = nextPhase(house.day, house.phase);
		const rolledOver = next.day !== house.day;

		const movedOut: Array<{ tenantId: number; characterName: string }> = [];
		const satisfactionChanges: SatisfactionChange[] = [];

		if (rolledOver) {
			// Satisfaction moves on the day boundary, before leases are settled —
			// a missed promise should be able to sour someone on the same day their
			// lease comes up, not the day after.
			satisfactionChanges.push(...(await satisfactionService.chargeBrokenPromises(houseId, next.day)));
			satisfactionChanges.push(
				...(await satisfactionService.applyDailyDrift(houseId, next.day, userId))
			);

			// Leases are checked once per day, not per phase, so a lease ends on
			// a day rather than at some arbitrary hour.
			const expiring = await db
				.select({
					id: tenants.id,
					characterId: tenants.characterId,
					name: characters.name,
					roomName: bedrooms.name
				})
				.from(tenants)
				.innerJoin(characters, eq(tenants.characterId, characters.id))
				.leftJoin(bedrooms, eq(tenants.bedroomId, bedrooms.id))
				.where(
					and(
						eq(tenants.houseId, houseId),
						eq(tenants.status, 'active'),
						lte(tenants.leaseEndDay, next.day)
					)
				);

			for (const row of expiring) {
				await db
					.update(tenants)
					.set({ status: 'moved_out', moveOutDay: next.day, bedroomId: null })
					.where(eq(tenants.id, row.id));
				movedOut.push({ tenantId: row.id, characterName: row.name });

				// A lease running out empties a room just as visibly as walking out
				// does, so it belongs in the house's history too.
				await relationService.recordTenancyEvent(
					houseId,
					next.day,
					next.phase,
					'move_out',
					row.characterId,
					row.name,
					row.roomName
				);
			}
		}

		const [updated] = await db
			.update(houses)
			.set({ day: next.day, phase: next.phase, updatedAt: new Date() })
			.where(eq(houses.id, houseId))
			.returning();

		// Place everyone for the phase we just moved into.
		await occupancyService.generateForPhase(houseId, next.day, next.phase);

		// The house keeps living while the player is elsewhere: housemates get on
		// with each other between phases. Rolled after placement so the events
		// belong to the phase being entered, not the one just left.
		const relationEvents = await relationService.generateForPhase(
			houseId,
			next.day,
			next.phase,
			userId
		);

		return { house: updated, rolledOver, movedOut, satisfactionChanges, relationEvents };
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

	/**
	 * Wipe a house back to move-in day: day 1, first phase, starting balance,
	 * nobody living here.
	 *
	 * The rooms survive — the property is what you built, and rebuilding it to
	 * play again would be busywork. Everything that accumulated *inside* it goes:
	 * tenancies (including moved-out history, since day 1 has no past),
	 * applicants, placements, scenes and threads.
	 *
	 * Scene conversations are deleted explicitly. `scenes` cascades from the
	 * house, but the `conversations` rows it points at do not, so dropping the
	 * scenes alone would leave orphaned transcripts sitting in chat history with
	 * no room and no clock to reach them by.
	 */
	async resetHouse(houseId: number, userId: number): Promise<House | null> {
		const house = await this.getHouseById(houseId, userId);
		if (!house) return null;

		// Collected before the transaction: the scene rows are about to go, and
		// with them the only pointer to their conversations.
		const sceneConversations = await db
			.select({ conversationId: scenes.conversationId })
			.from(scenes)
			.where(eq(scenes.houseId, houseId));

		return db.transaction((tx) => {
			// Order matters only for the conversations, which nothing cascades
			// from the house; the rest are house-scoped deletes.
			tx.delete(threads).where(eq(threads.houseId, houseId)).run();
			tx.delete(scenes).where(eq(scenes.houseId, houseId)).run();

			for (const row of sceneConversations) {
				// Messages and sceneParticipants cascade from the conversation.
				tx.delete(conversations).where(eq(conversations.id, row.conversationId)).run();
			}

			tx.delete(houseEvents).where(eq(houseEvents.houseId, houseId)).run();
			tx.delete(relations).where(eq(relations.houseId, houseId)).run();
			tx.delete(occupancy).where(eq(occupancy.houseId, houseId)).run();
			tx.delete(applicants).where(eq(applicants.houseId, houseId)).run();
			tx.delete(tenants).where(eq(tenants.houseId, houseId)).run();

			const [updated] = tx
				.update(houses)
				.set({
					day: 1,
					phase: 0,
					balance: DEFAULT_STARTING_BALANCE,
					updatedAt: new Date()
				})
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
