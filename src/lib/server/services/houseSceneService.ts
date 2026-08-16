import { db } from '../db';
import {
	scenes,
	conversations,
	messages,
	houses,
	bedrooms,
	sharedSpaces,
	tenants,
	characters,
	occupancy,
	sceneParticipants,
	applicants,
	users,
	threads
} from '../db/schema';
import { eq, and, isNull, isNotNull, inArray, desc } from 'drizzle-orm';
import type { House, Bedroom, SharedSpace, Scene, Character, Tenant, Occupancy } from '../db/schema';
import { phaseLabel, weekdayLabel } from '$lib/house/phases';
import { estimateTokens } from '$lib/house/tenancy';
import { llmSettingsFileService } from './llmSettingsFileService';
import { sceneService } from './sceneService';
import { personaService } from './personaService';
import { generateSceneNarration } from '../llm';
import { contentLlmService } from './contentLlmService';
import { satisfactionService } from './satisfactionService';

/** Room scenes take a place; an interview takes an applicant. */
export type PlaceKind = 'bedroom' | 'shared' | 'interview';

/** Who is in the room right now, with the lease facts the prompt needs. */
export interface ScenePresence {
	character: Character;
	tenant: Tenant;
	occupancy: Occupancy;
}

export interface ResolvedScene {
	scene: Scene;
	conversationId: number;
	house: House;
	placeName: string;
	placeKind: PlaceKind;
	/** True when this call created the scene rather than resuming one. */
	created: boolean;
	present: ScenePresence[];
}

class HouseSceneService {
	/**
	 * Everyone placed in a given room for a day/phase, joined to their tenancy.
	 *
	 * Reads `occupancy` — the record of where people actually are — not
	 * `tenants.bedroomId`, which only says who holds the lease. A tenant can hold
	 * Room 2 and be standing in the kitchen.
	 */
	async getPresentIn(
		houseId: number,
		day: number,
		phase: number,
		placeKind: PlaceKind,
		placeId: number
	): Promise<ScenePresence[]> {
		const placeMatch =
			placeKind === 'bedroom'
				? eq(occupancy.bedroomId, placeId)
				: eq(occupancy.sharedSpaceId, placeId);

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
					eq(occupancy.placeKind, placeKind),
					// A tenant who moved out isn't in the room any more, even though
					// the append-only occupancy row saying they were still exists.
					eq(tenants.status, 'active'),
					placeMatch
				)
			);

		return rows.map((row) => ({
			character: row.characters,
			tenant: row.tenants,
			occupancy: row.occupancy
		}));
	}

	/**
	 * The house framing written into `conversations.scenario`.
	 *
	 * This lands in the `{{scenario}}` template variable, which
	 * `generateChatCompletion` rebuilds on EVERY message — so the room, the hour
	 * and the lease terms stay in context for the whole scene rather than
	 * decaying out of the history window after the intro.
	 *
	 * Everything here is already-known data (occupancy, tenants, bedrooms). No
	 * LLM call, no latency, no cost.
	 */
	buildHouseContext(
		house: House,
		placeName: string,
		placeKind: PlaceKind,
		placeDescription: string | null,
		present: ScenePresence[],
		userName: string,
		recall: Array<{ day: number; phase: number; place: string; summary: string }> = [],
		openThreads: Array<{
			kind: string;
			summary: string;
			openedDay: number;
			dueDay: number | null;
			characterName: string;
		}> = []
	): string {
		const lines: string[] = [];

		const where = house.address ? `${house.name} (${house.address})` : house.name;
		// Shared spaces read as "the Kitchen"; a bedroom is a proper name ("Room 1"),
		// so an article in front of it reads wrong.
		const place = placeKind === 'bedroom' ? placeName : `the ${placeName}`;
		lines.push(
			`${where} — ${place}. ${weekdayLabel(house.day)}, day ${house.day}, ` +
				`${phaseLabel(house.phase)}.`
		);

		if (placeDescription) {
			lines.push(placeDescription);
		}

		lines.push(
			placeKind === 'bedroom'
				? `${placeName} is a private bedroom rented out to a tenant.`
				: `The ${placeName} is a shared space — anyone living here may walk in.`
		);

		if (present.length === 0) {
			lines.push('Nobody is here right now.');
		} else {
			lines.push('');
			lines.push('Present:');
			for (const p of present) {
				const room = p.occupancy.activity ? ` — currently ${p.occupancy.activity}` : '';
				const remaining = Math.max(0, p.tenant.leaseEndDay - house.day);
				lines.push(
					`- ${p.character.name}${room}. Pays $${p.tenant.rentAmount.toLocaleString()} per period; ` +
						`${remaining} day${remaining === 1 ? '' : 's'} left on the lease.`
				);
			}
		}

		// What these people already went through with the landlord. Without this a
		// tenant greets you like a stranger every phase, no matter what was said
		// an hour ago.
		if (recall.length > 0) {
			lines.push('');
			lines.push('Earlier:');
			for (const entry of recall) {
				lines.push(
					`- ${weekdayLabel(entry.day)} (day ${entry.day}), ${phaseLabel(entry.phase)}, ` +
						`${entry.place}: ${entry.summary}`
				);
			}
		}

		// Unfinished business. Listed after recall because it's the live reason a
		// character has something to say — not history, but a standing grievance.
		if (openThreads.length > 0) {
			lines.push('');
			lines.push('Unresolved:');
			for (const t of openThreads) {
				const age = house.day - t.openedDay;
				const when =
					age <= 0 ? 'today' : age === 1 ? 'since yesterday' : `for ${age} days`;
				const overdue =
					t.dueDay !== null && t.dueDay < house.day
						? ` — was due ${weekdayLabel(t.dueDay)} (day ${t.dueDay}), now overdue`
						: t.dueDay !== null
							? ` — due ${weekdayLabel(t.dueDay)} (day ${t.dueDay})`
							: '';
				lines.push(
					t.kind === 'promise'
						? `- ${userName} promised: ${t.summary}. Outstanding ${when}${overdue}.`
						: `- ${t.characterName} asked for: ${t.summary}. Unanswered ${when}${overdue}.`
				);
			}
		}

		lines.push('');
		lines.push(
			`${userName} owns this house and lives here. ${userName} is the landlord — ` +
				`rent, repairs and leases are theirs to decide.`
		);

		return lines.join('\n');
	}

	/**
	 * Find the scene for a room in the current phase, or create it.
	 *
	 * Resume-by-default is what makes leaving a room and coming back land in the
	 * same conversation. A new phase produces a new scene, keeping scenes short
	 * and history browsable by day.
	 */
	async resolveScene(
		userId: number,
		houseId: number,
		placeKind: PlaceKind,
		placeId: number
	): Promise<ResolvedScene> {
		const [house] = await db
			.select()
			.from(houses)
			.where(and(eq(houses.id, houseId), eq(houses.userId, userId)))
			.limit(1);

		if (!house) throw new Error('House not found');

		// Resolve the place and its name up front — a scene in a room that does
		// not belong to this house is a bad request, not an empty room.
		let placeName: string;
		let placeDescription: string | null = null;

		if (placeKind === 'bedroom') {
			const [room] = await db
				.select()
				.from(bedrooms)
				.where(and(eq(bedrooms.id, placeId), eq(bedrooms.houseId, houseId)))
				.limit(1);
			if (!room) throw new Error('Room not found');
			placeName = room.name;
		} else {
			const [space] = await db
				.select()
				.from(sharedSpaces)
				.where(and(eq(sharedSpaces.id, placeId), eq(sharedSpaces.houseId, houseId)))
				.limit(1);
			if (!space) throw new Error('Room not found');
			placeName = space.name;
			placeDescription = space.description;
		}

		const present = await this.getPresentIn(houseId, house.day, house.phase, placeKind, placeId);

		const placeMatch =
			placeKind === 'bedroom' ? eq(scenes.bedroomId, placeId) : eq(scenes.sharedSpaceId, placeId);

		const [existing] = await db
			.select()
			.from(scenes)
			.where(
				and(
					eq(scenes.houseId, houseId),
					eq(scenes.day, house.day),
					eq(scenes.phase, house.phase),
					eq(scenes.placeKind, placeKind),
					placeMatch
				)
			)
			.limit(1);

		if (existing) {
			// Context is frozen into conversation.scenario at creation, but summaries
			// of *earlier* scenes may have landed since (they generate in the
			// background after a phase advance). Rebuild so a resumed scene recalls
			// everything a fresh one would.
			const userInfo = await personaService.getActiveUserInfo(userId);
			const recall = await this.recallFor(
				houseId,
				present.map((p) => p.character.id),
				userId,
				existing.id
			);
			const open = await this.openThreadsFor(
				houseId,
				present.map((p) => p.character.id)
			);
			await db
				.update(conversations)
				.set({
					scenario: this.buildHouseContext(
						house,
						placeName,
						placeKind,
						placeDescription,
						present,
						userInfo.name,
						recall,
						open
					)
				})
				.where(eq(conversations.id, existing.conversationId));

			return {
				scene: existing,
				conversationId: existing.conversationId,
				house,
				placeName,
				placeKind,
				created: false,
				present
			};
		}

		const userInfo = await personaService.getActiveUserInfo(userId);
		const recall = await this.recallFor(
			houseId,
			present.map((p) => p.character.id),
			userId
		);
		const open = await this.openThreadsFor(
			houseId,
			present.map((p) => p.character.id)
		);
		const houseContext = this.buildHouseContext(
			house,
			placeName,
			placeKind,
			placeDescription,
			present,
			userInfo.name,
			recall,
			open
		);

		// The first person present anchors the scene; the chat engine uses
		// primaryCharacterId to decide who replies.
		const primary = present[0]?.character ?? null;

		const [conversation] = await db
			.insert(conversations)
			.values({
				userId,
				characterId: primary?.id ?? null,
				primaryCharacterId: primary?.id ?? null,
				// Scenes are not the character's "active" library chat — flagging them
				// active would hijack the chat page's character-keyed lookup.
				isActive: false,
				scenario: houseContext
			})
			.returning();

		for (const p of present) {
			await sceneService.addCharacterToScene(conversation.id, p.character.id);
		}

		// Narrator sets the room. It reads conversation.scenario, so the house
		// context above is already in its prompt — it knows the hour and who is
		// here. An empty room gets no intro; there is nothing to describe yet.
		if (present.length > 0) {
			try {
				const intro = await generateSceneNarration(userId, conversation.id, 'scene_intro', {
					characterNames: present.map((p) => p.character.name)
				});
				await db.insert(messages).values({
					conversationId: conversation.id,
					role: 'narrator',
					content: intro.content,
					senderName: 'Narrator',
					reasoning: intro.reasoning
				});
			} catch (error) {
				// A missing narrator should not block walking into a room.
				console.error('Failed to generate scene intro:', error);
			}
		}

		const [scene] = await db
			.insert(scenes)
			.values({
				houseId,
				conversationId: conversation.id,
				day: house.day,
				phase: house.phase,
				placeKind,
				bedroomId: placeKind === 'bedroom' ? placeId : null,
				sharedSpaceId: placeKind === 'shared' ? placeId : null
			})
			.returning();

		return {
			scene,
			conversationId: conversation.id,
			house,
			placeName,
			placeKind,
			created: true,
			present
		};
	}

	/** Load a scene by conversation id, checking it belongs to this user. */
	async getSceneByConversation(
		conversationId: number,
		userId: number
	): Promise<{ scene: Scene; house: House; placeName: string } | null> {
		const [row] = await db
			.select({ scene: scenes, house: houses })
			.from(scenes)
			.innerJoin(houses, eq(scenes.houseId, houses.id))
			.innerJoin(conversations, eq(scenes.conversationId, conversations.id))
			.where(and(eq(scenes.conversationId, conversationId), eq(conversations.userId, userId)))
			.limit(1);

		if (!row) return null;

		let placeName = 'the house';
		if (row.scene.placeKind === 'interview') {
			// The scene is about the person, not the room they are asking for.
			const [who] = await db
				.select({ name: characters.name })
				.from(conversations)
				.innerJoin(characters, eq(conversations.primaryCharacterId, characters.id))
				.where(eq(conversations.id, conversationId))
				.limit(1);
			placeName = who ? `Interview · ${who.name}` : 'Interview';
		} else if (row.scene.placeKind === 'bedroom' && row.scene.bedroomId) {
			const [room] = await db
				.select()
				.from(bedrooms)
				.where(eq(bedrooms.id, row.scene.bedroomId))
				.limit(1);
			if (room) placeName = room.name;
		} else if (row.scene.sharedSpaceId) {
			const [space] = await db
				.select()
				.from(sharedSpaces)
				.where(eq(sharedSpaces.id, row.scene.sharedSpaceId))
				.limit(1);
			if (space) placeName = space.name;
		}

		return { scene: row.scene, house: row.house, placeName };
	}

	/**
	 * Summarise every finished scene in a house that has not been summarised yet.
	 *
	 * **Why phase boundaries, not scene exits.** Walking out of a room is not an
	 * ending — you can walk straight back in, and the scene keeps accepting
	 * messages. Summarising on exit would re-summarise the same conversation
	 * every time the player crossed the doorway. A scene only becomes immutable
	 * when the clock moves past its phase, so that is the one moment a summary is
	 * guaranteed correct and needs writing exactly once.
	 *
	 * Call this AFTER the clock has moved, never before: the day should advance
	 * instantly, with summaries filling in behind it.
	 */
	async summariseFinishedScenes(houseId: number, userId: number): Promise<number> {
		const [house] = await db
			.select()
			.from(houses)
			.where(and(eq(houses.id, houseId), eq(houses.userId, userId)))
			.limit(1);
		if (!house) return 0;

		// Anything not in the current day+phase can no longer receive messages.
		const pending = await db
			.select()
			.from(scenes)
			.where(and(eq(scenes.houseId, houseId), isNull(scenes.summary)));

		const finished = pending.filter((s) => s.day !== house.day || s.phase !== house.phase);
		if (finished.length === 0) return 0;

		const userInfo = await personaService.getActiveUserInfo(userId);
		let written = 0;

		for (const scene of finished) {
			try {
				const history = await this.getMessages(scene.conversationId);

				// A scene the player opened and walked out of has a narrator intro and
				// nothing else. There is nothing to remember, so don't pay to find out.
				const hasExchange =
					history.some((m) => m.role === 'user') &&
					history.some((m) => m.role === 'assistant');
				if (!hasExchange) continue;

				const cast = await sceneService.getActiveCharacters(scene.conversationId);

				const transcript = history
					.map((m) => {
						const who =
							m.role === 'user'
								? userInfo.name
								: m.role === 'narrator'
									? 'Narrator'
									: (m.senderName ?? 'Someone');
						return `${who}: ${m.content}`;
					})
					.join('\n\n');

				let placeName = 'the house';
				if (scene.placeKind === 'interview') {
					// Summarised like any other scene, but labelled by what it was:
					// a conversation at the door, not a moment in a room.
					placeName = `an interview for ${
						scene.bedroomId
							? ((
									await db
										.select({ name: bedrooms.name })
										.from(bedrooms)
										.where(eq(bedrooms.id, scene.bedroomId))
										.limit(1)
								)[0]?.name ?? 'a room')
							: 'a room'
					}`;
				} else if (scene.placeKind === 'bedroom' && scene.bedroomId) {
					const [room] = await db
						.select()
						.from(bedrooms)
						.where(eq(bedrooms.id, scene.bedroomId))
						.limit(1);
					if (room) placeName = room.name;
				} else if (scene.sharedSpaceId) {
					const [space] = await db
						.select()
						.from(sharedSpaces)
						.where(eq(sharedSpaces.id, scene.sharedSpaceId))
						.limit(1);
					if (space) placeName = space.name;
				}

				// What these people are already owed, so the model can close items
				// rather than re-opening the same thread every scene.
				const castIds = cast.map((c) => c.id);
				const open =
					castIds.length > 0
						? await db
								.select()
								.from(threads)
								.where(
									and(
										eq(threads.houseId, houseId),
										eq(threads.status, 'open'),
										inArray(threads.characterId, castIds)
									)
								)
						: [];

				const openThreads =
					open.length > 0
						? open.map((t) => `${t.id}. ${t.kind} — ${t.summary}`).join('\n')
						: 'None.';

				const record = await contentLlmService.summariseScene({
					place: placeName,
					day: scene.day,
					phase: phaseLabel(scene.phase),
					participants: cast.map((c) => c.name).join(', ') || 'nobody',
					transcript,
					userName: userInfo.name,
					openThreads
				});

				if (record.summary) {
					await db
						.update(scenes)
						.set({ summary: record.summary, summarisedAt: new Date() })
						.where(eq(scenes.id, scene.id));
					written++;
				}

				// New threads. Attributed to a character in the scene — a thread
				// belongs to the person it's with, even when the player made the
				// promise, so it surfaces when you next see them.
				// Normalised text of what's already tracked, so a thread mentioned
				// again in a later scene doesn't become a second row. The prompt
				// asks the model not to re-open these, but it sometimes does, and a
				// duplicate would nag twice and never fully close.
				const alreadyOpen = new Set(
					open.map((t) => t.summary.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim())
				);

				for (const item of record.opened) {
					const key = item.what.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
					if (alreadyOpen.has(key)) continue;
					alreadyOpen.add(key);

					const named = cast.find(
						(c) => c.name.toLowerCase() === item.who?.toLowerCase()
					);
					// A promise by the player is still *about* someone: fall back to
					// whoever the scene was with.
					const owner = named ?? cast[0];
					if (!owner) continue;

					await db.insert(threads).values({
						houseId,
						characterId: owner.id,
						sceneId: scene.id,
						kind: item.kind === 'promise' ? 'promise' : 'request',
						summary: item.what,
						openedDay: scene.day,
						dueDay: item.due ?? null,
						status: 'open'
					});
				}

				// Closures. Guarded by id AND house so a hallucinated id can't
				// resolve someone else's thread.
				for (const item of record.resolved) {
					const [closed] = await db
						.update(threads)
						.set({
							status: 'resolved',
							resolvedDay: scene.day,
							resolution: item.how || null
						})
						.where(
							and(
								eq(threads.id, item.id),
								eq(threads.houseId, houseId),
								eq(threads.status, 'open')
							)
						)
						.returning();

					// Only credit a thread that was actually open — a repeated id
					// shouldn't pay out twice.
					if (closed) {
						await satisfactionService.creditResolvedThread(
							houseId,
							closed.characterId,
							closed.kind
						);
					}
				}

				// The scene itself. After closures so a visit that settled something
				// counts for both, and once per day per tenant.
				await satisfactionService.creditScene(houseId, castIds, scene.day);
			} catch (error) {
				// One bad summary must not block the rest, and must never break the
				// day cycle — the scene stays unsummarised and gets picked up again.
				console.error(`Failed to summarise scene ${scene.id}:`, error);
			}
		}

		return written;
	}

	/**
	 * What the people in this room remember, newest last.
	 *
	 * Scoped to the characters present: a tenant should recall what they were
	 * part of, not everything that ever happened in the house. This is what makes
	 * a scene feel continuous with the last one instead of resetting each phase.
	 */
	async recallFor(
		houseId: number,
		characterIds: number[],
		userId: number,
		excludeSceneId?: number
	): Promise<Array<{ day: number; phase: number; place: string; summary: string }>> {
		if (characterIds.length === 0) return [];

		// Budget is a share of the chat model's context window, so switching to a
		// bigger model gives characters longer memories with no retuning.
		const [user] = await db
			.select({ percent: users.sceneRecallPercent })
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);

		const percent = user?.percent ?? 15;
		if (percent <= 0) return [];

		const chatSettings = llmSettingsFileService.getSettings('chat');
		const contextWindow = chatSettings?.contextWindow ?? 8000;
		const budget = Math.floor((contextWindow * percent) / 100);

		const rows = await db
			.select({
				scene: scenes,
				characterId: sceneParticipants.characterId,
				bedroomName: bedrooms.name,
				spaceName: sharedSpaces.name
			})
			.from(scenes)
			.innerJoin(sceneParticipants, eq(sceneParticipants.conversationId, scenes.conversationId))
			.leftJoin(bedrooms, eq(scenes.bedroomId, bedrooms.id))
			.leftJoin(sharedSpaces, eq(scenes.sharedSpaceId, sharedSpaces.id))
			.where(
				and(
					eq(scenes.houseId, houseId),
					isNotNull(scenes.summary),
					inArray(sceneParticipants.characterId, characterIds)
				)
			)
			.orderBy(desc(scenes.day), desc(scenes.phase));

		// One scene may match several present characters — keep it once.
		const seen = new Set<number>();
		const recalled: Array<{ day: number; phase: number; place: string; summary: string }> = [];
		let spent = 0;

		// Walking newest-first and stopping at the budget means the most recent
		// history always survives; the oldest is what falls off the end.
		for (const row of rows) {
			// A scene never recalls itself — that would feed its own summary back in.
			if (row.scene.id === excludeSceneId) continue;
			if (seen.has(row.scene.id)) continue;
			seen.add(row.scene.id);

			const entry = {
				day: row.scene.day,
				phase: row.scene.phase,
				place: row.bedroomName ?? row.spaceName ?? 'the house',
				summary: row.scene.summary!
			};

			// Count the rendered line, not just the summary — the date and place
			// prefix is part of what this costs.
			const cost = estimateTokens(
				`- ${weekdayLabel(entry.day)} (day ${entry.day}), ${phaseLabel(entry.phase)}, ` +
					`${entry.place}: ${entry.summary}`
			);

			// Always keep at least the most recent scene, even if one long summary
			// would blow the whole budget on its own — no memory at all is worse.
			if (spent + cost > budget && recalled.length > 0) break;

			recalled.push(entry);
			spent += cost;
		}

		// Oldest first reads as a timeline in the prompt.
		return recalled.reverse();
	}

	/**
	 * Open (or resume) an interview with an applicant.
	 *
	 * An interview is a scene keyed to an applicant rather than a room — you are
	 * meeting someone at the door to decide whether to hand them a lease, so the
	 * room they want and the terms they are asking for are the whole subject.
	 * Reuses the same `scenes` table so summarisation and history work unchanged.
	 */
	async resolveInterview(
		userId: number,
		houseId: number,
		applicantId: number
	): Promise<ResolvedScene> {
		const [house] = await db
			.select()
			.from(houses)
			.where(and(eq(houses.id, houseId), eq(houses.userId, userId)))
			.limit(1);
		if (!house) throw new Error('House not found');

		const [row] = await db
			.select({ applicant: applicants, character: characters, room: bedrooms })
			.from(applicants)
			.innerJoin(characters, eq(applicants.characterId, characters.id))
			.innerJoin(bedrooms, eq(applicants.bedroomId, bedrooms.id))
			.where(and(eq(applicants.id, applicantId), eq(applicants.houseId, houseId)))
			.limit(1);
		if (!row) throw new Error('Applicant not found');

		// Resume an interview already in progress with this applicant.
		const [existing] = await db
			.select()
			.from(scenes)
			.where(and(eq(scenes.houseId, houseId), eq(scenes.applicantId, applicantId)))
			.limit(1);

		if (existing) {
			return {
				scene: existing,
				conversationId: existing.conversationId,
				house,
				placeName: `Interview · ${row.character.name}`,
				placeKind: 'interview',
				created: false,
				present: []
			};
		}

		const userInfo = await personaService.getActiveUserInfo(userId);
		const context = this.buildInterviewContext(
			house,
			row.character.name,
			row.room.name,
			row.applicant.askingRent,
			row.applicant.requestedDays,
			userInfo.name
		);

		const [conversation] = await db
			.insert(conversations)
			.values({
				userId,
				characterId: row.character.id,
				primaryCharacterId: row.character.id,
				isActive: false,
				scenario: context
			})
			.returning();

		await sceneService.addCharacterToScene(conversation.id, row.character.id);

		try {
			const intro = await generateSceneNarration(userId, conversation.id, 'scene_intro', {
				characterNames: [row.character.name]
			});
			await db.insert(messages).values({
				conversationId: conversation.id,
				role: 'narrator',
				content: intro.content,
				senderName: 'Narrator',
				reasoning: intro.reasoning
			});
		} catch (error) {
			console.error('Failed to generate interview intro:', error);
		}

		const [scene] = await db
			.insert(scenes)
			.values({
				houseId,
				conversationId: conversation.id,
				day: house.day,
				phase: house.phase,
				placeKind: 'interview',
				bedroomId: row.applicant.bedroomId,
				sharedSpaceId: null,
				applicantId
			})
			.returning();

		return {
			scene,
			conversationId: conversation.id,
			house,
			placeName: `Interview · ${row.character.name}`,
			placeKind: 'interview',
			created: true,
			present: []
		};
	}

	/**
	 * Prompt context for an interview. Unlike a room scene this is a negotiation:
	 * the character wants the room, knows what they are asking, and knows the
	 * decision is not theirs.
	 */
	buildInterviewContext(
		house: House,
		characterName: string,
		roomName: string,
		askingRent: number,
		requestedDays: number,
		userName: string
	): string {
		const where = house.address ? `${house.name} (${house.address})` : house.name;
		return [
			`${where}. ${weekdayLabel(house.day)}, day ${house.day}, ${phaseLabel(house.phase)}.`,
			'',
			// Explicit about who arrives: the scene-intro prompt otherwise assumes
			// the player walked in, which is backwards for an interview.
			`${characterName} has just arrived to look at ${roomName} and is being ` +
				`interviewed by ${userName}, who owns the house and lives here. ` +
				`${characterName} is the one who came to the door.`,
			`They are offering $${askingRent.toLocaleString()} per period for a ` +
				`${requestedDays}-day lease.`,
			'',
			`${characterName} wants the room and is trying to make a good impression, in ` +
				`whatever way suits them — charming, blunt, nervous, indifferent. They can ` +
				`answer questions about themselves, ask their own about the house and the ` +
				`other tenants, and push back on the terms.`,
			`Nothing is settled here: ${userName} decides afterwards whether to offer the ` +
				`lease. Do not narrate them moving in or being accepted.`
		].join('\n');
	}

	/**
	 * What the people in this room are still owed, or still owe.
	 *
	 * Scoped to who is present for the same reason as recall: a tenant raises
	 * their own unfinished business, not someone else's.
	 */
	async openThreadsFor(houseId: number, characterIds: number[]) {
		if (characterIds.length === 0) return [];

		const rows = await db
			.select({ thread: threads, characterName: characters.name })
			.from(threads)
			.innerJoin(characters, eq(threads.characterId, characters.id))
			.where(
				and(
					eq(threads.houseId, houseId),
					eq(threads.status, 'open'),
					inArray(threads.characterId, characterIds)
				)
			)
			.orderBy(threads.openedDay);

		return rows.map((r) => ({
			kind: r.thread.kind,
			summary: r.thread.summary,
			openedDay: r.thread.openedDay,
			dueDay: r.thread.dueDay,
			characterName: r.characterName
		}));
	}

	/**
	 * Every open thread in the house, with who it's with and how overdue it is.
	 *
	 * Unlike `openThreadsFor` this is not scoped to a scene — it backs the house
	 * panel, which answers "what needs me today" across the whole roster.
	 */
	async openThreadsForHouse(houseId: number, day: number) {
		const rows = await db
			.select({ thread: threads, character: characters })
			.from(threads)
			.innerJoin(characters, eq(threads.characterId, characters.id))
			.where(and(eq(threads.houseId, houseId), eq(threads.status, 'open')))
			.orderBy(threads.openedDay);

		return rows.map((r) => ({
			id: r.thread.id,
			kind: r.thread.kind,
			summary: r.thread.summary,
			openedDay: r.thread.openedDay,
			dueDay: r.thread.dueDay,
			// Negative = days left, positive = days late. Null when no deadline
			// was ever named, which is most requests.
			overdueBy: r.thread.dueDay === null ? null : day - r.thread.dueDay,
			characterId: r.character.id,
			characterName: r.character.name,
			characterImage: r.character.thumbnailData || r.character.imageData
		}));
	}

	/** Messages for a scene, oldest first. */
	async getMessages(conversationId: number) {
		return await db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, conversationId))
			.orderBy(messages.createdAt);
	}
}

export const houseSceneService = new HouseSceneService();
