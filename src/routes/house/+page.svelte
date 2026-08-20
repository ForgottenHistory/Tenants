<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll, goto } from '$app/navigation';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import SpaceActivitiesModal from '$lib/components/house/SpaceActivitiesModal.svelte';
	import HouseAgendaPanel from '$lib/components/house/HouseAgendaPanel.svelte';
	import HouseLifePanel from '$lib/components/house/HouseLifePanel.svelte';
	import RelationDetailModal from '$lib/components/house/RelationDetailModal.svelte';
	import GoOutModal from '$lib/components/house/GoOutModal.svelte';
	import MoveTenantModal from '$lib/components/house/MoveTenantModal.svelte';
	import { phaseLabel, PHASES_PER_DAY, weekdayLabel, isWeekend } from '$lib/house/phases';
	import { satisfactionLabel, satisfactionColor } from '$lib/house/tenancy';

	let { data }: { data: PageData } = $props();

	let house = $derived(data.summary.house);
	let bedrooms = $derived(data.summary.bedrooms);
	let spaces = $derived(data.summary.spaces);

	// Nothing happens in an empty house, so say so plainly instead of showing a
	// grid of vacant rooms with no next step.
	let isEmpty = $derived(data.tenants.length === 0);

	let advancing = $state(false);
	// The pair whose history is open, or null. Clicking a row in "Between Them"
	// answers "why are these two like this" from the event log.
	let openRelation = $state<{
		characterAId: number;
		characterBId: number;
		characterAName: string;
		characterBName: string;
		score: number;
	} | null>(null);
	let notice = $state<string | null>(null);
	let error = $state<string | null>(null);
	let closingId = $state<number | null>(null);

	/**
	 * Settle an outstanding item from the Needs You panel.
	 *
	 * The summariser closes threads it spots being resolved in conversation, but
	 * it misses some and never sees anything handled off-screen. This is the
	 * reliable way to clear one — and for a promise, the way to stop it charging
	 * an overdue penalty every day.
	 */
	async function closeThread(threadId: number, outcome: 'resolved' | 'dropped') {
		if (closingId !== null) return;
		closingId = threadId;
		error = null;

		try {
			const response = await fetch(`/api/houses/${house.id}/threads/${threadId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ outcome })
			});

			if (!response.ok) {
				const result = await response.json().catch(() => ({}));
				error = result.error ?? 'Failed to close that';
				return;
			}

			await invalidateAll();
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			closingId = null;
		}
	}
	let offscreen = $state<
		Array<{ text: string; delta: number; characterAName: string; characterBName: string }>
	>([]);

	function inSpace(spaceId: number) {
		return data.presence.bySpace[spaceId] ?? [];
	}

	function inBedroom(bedroomId: number) {
		return data.presence.byBedroom[bedroomId] ?? null;
	}

	/** Who holds the lease on a room, regardless of where they are right now. */
	function leaseholderFor(bedroomId: number) {
		return data.tenants.find((entry) => entry.tenant.bedroomId === bedroomId) ?? null;
	}

	let isLastPhase = $derived(house.phase === PHASES_PER_DAY - 1);

	/**
	 * Everyone in the house right now as one flat list, each carrying the place
	 * they're in. People are the attraction — a room only matters because
	 * somebody is standing in it — so the view renders these as portraits and
	 * treats the room as a label on the person, not a box around them.
	 */
	let peopleHere = $derived(
		[
			...spaces.flatMap((space) =>
				inSpace(space.id).map((p: any) => ({
					key: `s${p.occupancy.id}`,
					character: p.character,
					activity: p.occupancy.activity,
					satisfaction: p.tenant?.satisfaction ?? null,
					placeName: space.name,
					placeKind: 'shared' as const,
					placeId: space.id
				}))
			),
			...bedrooms.flatMap((room) => {
				const p: any = inBedroom(room.id);
				return p
					? [
							{
								key: `b${p.occupancy.id}`,
								character: p.character,
								activity: p.occupancy.activity,
								satisfaction: p.tenant?.satisfaction ?? null,
								placeName: room.name,
								placeKind: 'bedroom' as const,
								placeId: room.id
							}
						]
					: [];
			})
		].sort((a, b) => a.placeName.localeCompare(b.placeName))
	);

	/** The space whose activity pool is open for editing. */
	let editingSpace = $state<any>(null);

	/**
	 * Go and deal with something from the agenda panel: walk into whichever room
	 * that character is in. If they're out, say so rather than doing nothing —
	 * the thread stays open and they'll be back.
	 */
	function findCharacter(characterId: number) {
		const here = peopleHere.find((p) => p.character.id === characterId);
		if (here) {
			enter(here.placeKind, here.placeId);
			return;
		}
		const who =
			data.tenants.find((t) => t.character.id === characterId)?.character.name ?? 'They';
		error = `${who} is out right now. Try again after the next phase.`;
	}

	// Walking into a room resolves its scene for the current phase — creating it
	// on first entry, resuming it on every entry after that.
	let entering = $state<string | null>(null);
	// Where we're heading, for the overlay. Creating a scene runs a narrator
	// call, so this is a real wait, not a flicker.
	let enteringName = $state<string | null>(null);

	async function enter(placeKind: 'bedroom' | 'shared', placeId: number) {
		const key = `${placeKind}:${placeId}`;
		if (entering) return;
		entering = key;
		enteringName =
			placeKind === 'shared'
				? (spaces.find((s) => s.id === placeId)?.name ?? 'the room')
				: (bedrooms.find((b) => b.id === placeId)?.name ?? 'the room');
		error = null;

		try {
			const response = await fetch(`/api/houses/${house.id}/scenes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ placeKind, placeId })
			});
			const result = await response.json();

			if (!response.ok) {
				error = result.error ?? 'Could not open that room';
				return;
			}

			await goto(`/scene/${result.conversationId}`);
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			entering = null;
			enteringName = null;
		}
	}

	// Going out is the one scene the house doesn't already know the setting for:
	// the player names the place and the activity, so it starts in a modal rather
	// than from a room tile.
	let goOutOpen = $state(false);
	let goingOut = $state(false);

	async function goOut(characterId: number, place: string, activity: string) {
		if (goingOut) return;
		goingOut = true;
		error = null;

		try {
			const response = await fetch(`/api/houses/${house.id}/outings`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ characterId, place, activity })
			});
			const result = await response.json();

			if (!response.ok) {
				error = result.error ?? 'Could not head out';
				goOutOpen = false;
				return;
			}

			await goto(`/scene/${result.conversationId}`);
		} catch {
			error = 'Network error. Please try again.';
			goOutOpen = false;
		} finally {
			goingOut = false;
		}
	}

	let movePersonOpen = $state(false);
	let moving = $state(false);
	/** Set when the modal is opened from a specific person, so they start picked. */
	let moveInitialTenantId = $state<number | null>(null);

	async function movePerson(
		tenantId: number,
		placeKind: 'bedroom' | 'shared' | 'away',
		placeId: number | null,
		activity: string
	) {
		if (moving) return;
		moving = true;
		error = null;

		try {
			const response = await fetch(`/api/houses/${house.id}/occupancy`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tenantId, placeKind, placeId, activity })
			});
			const result = await response.json();

			if (!response.ok) {
				error = result.error ?? 'Could not move them';
				movePersonOpen = false;
				return;
			}

			movePersonOpen = false;
			// The whole board changes — who is in which room, and whether a bedroom
			// is now enterable — so reload rather than patching presence by hand.
			await invalidateAll();
		} catch {
			error = 'Network error. Please try again.';
			movePersonOpen = false;
		} finally {
			moving = false;
		}
	}

	async function advance() {
		if (advancing || isEmpty) return;
		advancing = true;
		error = null;
		notice = null;
		offscreen = [];

		try {
			const response = await fetch(`/api/houses/${house.id}/advance`, { method: 'POST' });
			const result = await response.json();

			if (!response.ok) {
				error = result.error ?? 'Failed to advance';
				return;
			}

			// Satisfaction moved overnight — say why, so a drop isn't a silent
			// number change the player only notices on the roster later.
			if (result.satisfactionChanges?.length > 0) {
				const drops = result.satisfactionChanges.filter(
					(c: { before: number; after: number }) => c.after < c.before
				);
				if (drops.length > 0) {
					// The reason is now a full clause ("the shower keeps running
					// cold"), so it reads as the complaint itself rather than being
					// slotted after "unhappy about".
					notice = drops
						.map(
							(c: { characterName: string; reason: string }) =>
								`${c.characterName} mentions ${c.reason}.`
						)
						.join(' ');
				}
			}

			if (result.movedOut?.length > 0) {
				const names = result.movedOut.map((m: { characterName: string }) => m.characterName);
				const moveOut =
					names.length === 1
						? `${names[0]}'s lease ended. They've moved out.`
						: `${names.join(' and ')} reached the end of their leases and moved out.`;
				// Both can happen on one rollover — don't let one silently replace
				// the other.
				notice = notice ? `${notice} ${moveOut}` : moveOut;
			}

			// What the housemates got up to while the player was elsewhere. Kept
			// separate from `notice` so it reads as a list of moments rather than
			// being run together with lease and satisfaction news.
			offscreen = result.relationEvents ?? [];

			// The switcher in the top bar shows day/phase too.
			window.dispatchEvent(new CustomEvent('houseUpdated'));
			await invalidateAll();
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			advancing = false;
		}
	}
</script>

<svelte:head>
	<title>{house.name} | Tenants</title>
</svelte:head>

<MainLayout user={data.user} currentPath="/house">
	<div class="h-full overflow-y-auto">
		<div class="w-full px-6 py-6 lg:px-8 lg:py-7">
			<!-- Header: everything left, in reading order — name, the action that
			     moves the game, then the state it produces. -->
			<div
				class="flex items-center gap-10 flex-wrap pb-5 border-b border-[var(--border-primary)]"
			>
				<div class="flex items-center gap-4 min-w-0">
					<a href="/" aria-label="Back to Home" class="btn-secondary px-3 py-3 flex-shrink-0">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15 19l-7-7 7-7"
							/>
						</svg>
					</a>
					<div class="min-w-0">
						<h1 class="text-3xl font-bold text-[var(--text-primary)] leading-tight break-words">
							{house.name}
						</h1>
						{#if house.address}
							<p class="text-sm text-[var(--text-muted)] mt-1.5">{house.address}</p>
						{/if}
					</div>
				</div>

				<div class="flex items-center gap-3">
						{#if !isEmpty}
							<button
								onclick={advance}
								disabled={advancing}
								class="btn-primary-solid px-5 py-2.5 text-lg whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
							>
								{#if advancing}
									<div
										class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
									></div>
									Advancing…
								{:else if isLastPhase}
									End Day &rarr;
								{:else}
									Next Phase &rarr;
								{/if}
							</button>
						{/if}
						<!-- The one way out of the house. Hidden when nobody lives here,
						     since an outing needs someone to go with. -->
						{#if !isEmpty}
							<button
								onclick={() => (goOutOpen = true)}
								disabled={advancing || entering !== null}
								class="btn-secondary px-5 py-2.5 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
							>
								Go Out
							</button>
						{/if}
						<!-- Overrides the placement roll for this phase. Same visibility rule
						     as Go Out: needs someone to move. -->
						{#if !isEmpty}
							<button
								onclick={() => {
									moveInitialTenantId = null;
									movePersonOpen = true;
								}}
								disabled={advancing || entering !== null}
								class="btn-secondary px-5 py-2.5 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
							>
								Move Someone
							</button>
						{/if}
						<!-- Moving tenants in and out is only reachable from here now that
						     the bedroom roster is no longer a panel on this page. -->
						<a href="/house/tenants" class="btn-secondary px-5 py-2.5 whitespace-nowrap">
							Tenants
						</a>
					</div>

				<div class="flex items-center gap-8">
					<div>
						<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">
							Day {house.day}
						</p>
						<p
							class="text-xl font-semibold {isWeekend(house.day)
								? 'text-[var(--accent-secondary)]'
								: 'text-[var(--text-primary)]'}"
						>
							{weekdayLabel(house.day)}
						</p>
					</div>
					<div>
						<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Phase</p>
						<p class="text-xl font-semibold text-[var(--accent-primary)]">
							{phaseLabel(house.phase)}
						</p>
					</div>
					<div>
						<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Balance</p>
						<p class="text-xl font-semibold text-[var(--text-primary)] tabular-nums">
							${house.balance.toLocaleString()}
						</p>
					</div>
				</div>
			</div>
			<div class="mt-7"></div>

			{#if notice}
				<div
					class="mb-6 p-4 rounded-xl border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--text-primary)] text-sm"
				>
					{notice}
				</div>
			{/if}

			<!-- What happened between housemates while you were elsewhere -->
			{#if offscreen.length > 0}
				<div
					class="mb-6 p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]"
				>
					<p class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)] mb-3">
						While you were away
					</p>
					<ul class="space-y-1.5">
						{#each offscreen as event, i (i)}
							<li class="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
								<span
									class="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
									style="background: {event.delta >= 0 ? 'var(--success)' : 'var(--error)'}"
								></span>
								<span>{event.text}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if error}
				<div
					class="mb-6 p-4 rounded-xl border border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)] text-sm"
				>
					{error}
				</div>
			{/if}

			{#if isEmpty}
				<div
					class="mb-8 p-5 rounded-xl border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/5 flex items-center justify-between gap-4 flex-wrap"
				>
					<div>
						<p class="font-medium text-[var(--text-primary)]">Nobody lives here yet</p>
						<p class="text-sm text-[var(--text-secondary)] mt-0.5">
							The house stays still until someone moves in.
						</p>
					</div>
					<a href="/house/tenants" class="btn-primary-solid px-5 py-2.5 whitespace-nowrap">
						Find a Tenant
					</a>
				</div>
			{/if}

			<!-- The house on the left, the agenda on the right. The panel is fixed
			     width so it holds its shape however full the house is. -->
			<div class="flex flex-col lg:flex-row gap-7 items-start">
				<div class="flex-1 min-w-0 w-full">
				<!-- People first, at portrait size. A room only matters because somebody
			     is in it, so the place is a label on the person rather than a box
			     drawn around them. Empty rooms are demoted to chips below. -->
			<section>
				<h2 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)] mb-4">
					In the house
					<span class="text-[var(--text-secondary)] ml-1">{peopleHere.length}</span>
				</h2>

				{#if peopleHere.length === 0}
					<p class="text-sm text-[var(--text-muted)] italic">
						Nobody is home right now. Everyone is out.
					</p>
				{:else}
					<div
						class="grid gap-5"
						style="grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));"
					>
						{#each peopleHere as person (person.key)}
							<button
								type="button"
								onclick={() => enter(person.placeKind, person.placeId)}
								disabled={entering !== null}
								class="group relative aspect-[3/4] rounded-xl overflow-hidden border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-left transition hover:border-[var(--accent-primary)] disabled:opacity-60 disabled:cursor-wait"
							>
								{#if person.character.imageData || person.character.thumbnailData}
									<img
										src={person.character.imageData || person.character.thumbnailData}
										alt={person.character.name}
										class="absolute inset-0 w-full h-full object-cover object-top transition duration-300 group-hover:scale-[1.03]"
									/>
								{:else}
									<div
										class="absolute inset-0 flex items-center justify-center text-3xl text-[var(--text-muted)]"
									>
										{person.character.name.charAt(0)}
									</div>
								{/if}

								<!-- Where they are, as a tag on the portrait -->
								<div class="absolute top-3 left-3">
									<span
										class="px-2.5 py-1 rounded-md text-xs font-medium bg-black/70 text-[var(--accent-hover)] backdrop-blur-sm"
									>
										{person.placeName}
									</span>
								</div>

								<div
									class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/95 via-black/60 to-transparent"
								></div>

								<div class="absolute inset-x-0 bottom-0 p-4">
									<p class="text-base font-semibold text-white truncate">
										{person.character.name}
									</p>
									{#if person.activity}
										<p class="text-sm text-white/70 truncate mt-0.5">{person.activity}</p>
									{/if}
									<!-- How they feel about living here, not about you. -->
									{#if person.satisfaction !== null}
										<p
											class="text-xs mt-1 truncate"
											style="color: {satisfactionColor(person.satisfaction)}"
										>
											{satisfactionLabel(person.satisfaction)}
										</p>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</section>

			<!-- Out of the house: same people, but unreachable this phase -->
			{#if data.presence.away.length > 0}
				<section class="mt-7">
					<h2 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)] mb-4">
						Out
						<span class="text-[var(--text-secondary)] ml-1">{data.presence.away.length}</span>
					</h2>
					<div class="flex flex-wrap gap-2">
						{#each data.presence.away as p (p.occupancy.id)}
							<!-- Someone being out is the usual reason to override placement,
							     so their row opens the move modal already pointed at them. -->
							<button
								type="button"
								onclick={() => {
									moveInitialTenantId = p.tenant.id;
									movePersonOpen = true;
								}}
								title="Move {p.character.name}"
								class="flex items-center gap-2.5 pl-2 pr-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-left hover:border-[var(--accent-primary)] transition"
							>
								{#if p.character.imageData || p.character.thumbnailData}
									<img
										src={p.character.imageData || p.character.thumbnailData}
										alt={p.character.name}
										class="w-9 h-9 rounded-md object-cover object-top opacity-50"
									/>
								{/if}
								<div class="min-w-0">
									<p class="text-sm text-[var(--text-secondary)] truncate">{p.character.name}</p>
									{#if p.occupancy.activity}
										<p class="text-xs text-[var(--text-muted)] truncate">{p.occupancy.activity}</p>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				</section>
			{/if}

			<!-- The house's own rooms. Listed regardless of who's in them, because
			     this is where you edit what people do in each one — a busy space
			     needs to be reachable too. -->
			{#if spaces.length > 0}
				<section class="mt-7 pt-6 border-t border-[var(--border-primary)]">
					<h2 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)] mb-4">
						Shared Spaces
					</h2>
					<div class="flex flex-wrap gap-2">
						{#each spaces as space (space.id)}
							{@const present = inSpace(space.id)}
							<div
								class="flex items-center gap-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden"
							>
								<button
									type="button"
									onclick={() => enter('shared', space.id)}
									disabled={entering !== null}
									class="pl-4 pr-2 py-2 text-sm text-[var(--text-secondary)] transition hover:text-[var(--accent-primary)] disabled:opacity-60 disabled:cursor-wait"
								>
									{space.name}
									{#if present.length > 0}
										<span class="text-[var(--accent-primary)] ml-1">{present.length}</span>
									{/if}
								</button>
								<button
									type="button"
									onclick={() => (editingSpace = space)}
									aria-label="Edit activities for {space.name}"
									title="Edit activities"
									class="px-2.5 py-2 text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition border-l border-[var(--border-primary)]"
								>
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
										/>
									</svg>
								</button>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Bedrooms nobody is in. They get a line, not a card: an empty room is
			     not something to look at. -->
			{#if bedrooms.some((r) => !inBedroom(r.id))}
				<section class="mt-7 pt-6 border-t border-[var(--border-primary)]">
					<h2 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)] mb-4">
						Empty bedrooms
					</h2>
					<div class="flex flex-wrap gap-2">
						{#each bedrooms as room (room.id)}
							{#if !inBedroom(room.id)}
								{@const leaseholder = leaseholderFor(room.id)}
								<a
									href="/house/tenants"
									class="px-4 py-2 rounded-lg border border-dashed border-[var(--border-secondary)] text-sm transition hover:border-[var(--accent-primary)]"
								>
									<span class="text-[var(--text-secondary)]">{room.name}</span>
									<span class="text-[var(--text-muted)] ml-2">
										{leaseholder ? `${leaseholder.character.name} — out` : 'Vacant'}
									</span>
								</a>
							{/if}
						{/each}
					</div>
				</section>
			{/if}
				</div>

				<div class="w-full lg:w-80 flex-shrink-0 flex flex-col gap-5 self-start">
					<HouseAgendaPanel
						day={house.day}
						openThreads={data.openThreads}
						expiring={data.expiring}
						onFind={findCharacter}
						onClose={closeThread}
						{closingId}
					/>
					<HouseLifePanel
						events={data.houseEvents}
						rumours={data.rumours}
						relations={data.relations}
						sceneSummaries={data.sceneSummaries}
						onOpenRelation={(rel) => (openRelation = rel)}
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- Walking into a room writes a narrator intro before the page can load, so
	     say what's happening rather than leaving the click looking dead. -->
	{#if entering}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-primary)]/85 backdrop-blur-sm"
		>
			<div class="text-center">
				<div
					class="w-10 h-10 mx-auto mb-5 rounded-full border-2 border-[var(--accent-primary)] border-t-transparent animate-spin"
				></div>
				<p class="text-lg font-medium text-[var(--text-primary)]">
					Stepping into {enteringName}…
				</p>
				<p class="text-sm text-[var(--text-muted)] mt-1.5">Setting the scene</p>
			</div>
		</div>
	{/if}

	<!-- Advancing waits for the phase's scenes to be summarised, which is a
	     Content LLM call per conversation. Without an overlay the page just sits
	     there looking broken for several seconds. -->
	{#if advancing}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-primary)]/85 backdrop-blur-sm"
		>
			<div class="text-center">
				<div
					class="w-10 h-10 mx-auto mb-5 rounded-full border-2 border-[var(--accent-primary)] border-t-transparent animate-spin"
				></div>
				<p class="text-lg font-medium text-[var(--text-primary)]">
					{isLastPhase ? 'Ending the day…' : 'Time passes…'}
				</p>
				<p class="text-sm text-[var(--text-muted)] mt-1.5">
					Everyone moves on, and what happened is remembered
				</p>
			</div>
		</div>
	{/if}

	<SpaceActivitiesModal
		houseId={house.id}
		space={editingSpace}
		onClose={() => (editingSpace = null)}
		onSaved={() => invalidateAll()}
	/>

	<RelationDetailModal
		houseId={house.id}
		relation={openRelation}
		onClose={() => (openRelation = null)}
	/>

	<GoOutModal
		open={goOutOpen}
		tenants={data.tenants}
		going={goingOut}
		onClose={() => (goOutOpen = false)}
		onGo={goOut}
	/>

	<MoveTenantModal
		open={movePersonOpen}
		tenants={data.tenants}
		spaces={data.summary.spaces}
		phase={house.phase}
		initialTenantId={moveInitialTenantId}
		{moving}
		onClose={() => (movePersonOpen = false)}
		onMove={movePerson}
	/>
</MainLayout>
