<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll, goto } from '$app/navigation';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import { satisfactionLabel, satisfactionColor, daysRemaining } from '$lib/house/tenancy';
	import { weekdayLabel } from '$lib/house/phases';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	// The room whose shortlist is open. Null = showing the rooms overview.
	let openRoomId = $state<number | null>(null);
	// Who we're about to meet, for the loading overlay — opening an interview
	// writes a narrator intro first, so it's a real wait.
	let interviewing = $state<string | null>(null);
	let shortlist = $state<any[]>([]);
	let loadingShortlist = $state(false);

	let openRoom = $derived(data.vacantBedrooms.find((r) => r.id === openRoomId) ?? null);

	/**
	 * Character descriptions are card definitions — often thousands of words of
	 * traits, formatting artifacts, and prompt directives. Until the Director
	 * writes real pitches, show a short readable opening instead of the raw card.
	 */
	function blurb(description: string): string {
		const cleaned = description
			.replace(/\{\{(char|user)\}\}/g, 'They') // template vars read as gibberish here
			.replace(/\[[^\]]*\]/g, '') // bracketed prompt directives
			.replace(/^\s*(Name|Gender|Age|Features|Clothes|Personality|Likes|Dislikes)\s*:.*$/gim, '')
			.replace(/\s+/g, ' ')
			.trim();

		if (!cleaned) return '';
		const limit = 160;
		if (cleaned.length <= limit) return cleaned;
		// Prefer cutting at a sentence, then a word, so it doesn't end mid-token.
		const window = cleaned.slice(0, limit);
		const sentenceEnd = window.lastIndexOf('. ');
		if (sentenceEnd > 60) return window.slice(0, sentenceEnd + 1);
		return window.slice(0, window.lastIndexOf(' ')) + '…';
	}

	async function call(url: string, options: RequestInit): Promise<boolean> {
		if (busy) return false;
		busy = true;
		error = null;
		try {
			const response = await fetch(url, options);
			if (!response.ok) {
				const result = await response.json().catch(() => ({}));
				error = result.error ?? 'Something went wrong';
				return false;
			}
			await invalidateAll();
			return true;
		} catch {
			error = 'Network error. Please try again.';
			return false;
		} finally {
			busy = false;
		}
	}

	/** Open a room and load who is interested in it today. */
	async function viewRoom(bedroomId: number) {
		openRoomId = bedroomId;
		shortlist = [];
		loadingShortlist = true;
		error = null;

		try {
			const response = await fetch(
				`/api/houses/${data.house.id}/bedrooms/${bedroomId}/applicants`
			);
			const result = await response.json();
			if (!response.ok) {
				error = result.error ?? 'Could not load applicants';
				return;
			}
			shortlist = result.applicants ?? [];
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			loadingShortlist = false;
		}
	}

	/** Draw a different set of candidates for the open room. */
	async function redraw() {
		if (openRoomId === null || busy) return;
		busy = true;
		error = null;
		try {
			const response = await fetch(
				`/api/houses/${data.house.id}/bedrooms/${openRoomId}/applicants`,
				{ method: 'POST' }
			);
			const result = await response.json();
			if (!response.ok) {
				error = result.error ?? 'Could not draw applicants';
				return;
			}
			shortlist = result.applicants ?? [];
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			busy = false;
		}
	}

	async function accept(applicantId: number) {
		if (openRoomId === null) return;
		const ok = await call(`/api/houses/${data.house.id}/applicants/${applicantId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ bedroomId: openRoomId })
		});
		if (ok) {
			openRoomId = null;
			shortlist = [];
		}
	}

	/** Talk to an applicant before deciding. Resumes if one is already open. */
	async function interview(applicantId: number) {
		if (busy) return;
		busy = true;
		interviewing =
			shortlist.find((e) => e.applicant.id === applicantId)?.character?.name ?? 'them';
		error = null;
		try {
			const response = await fetch(
				`/api/houses/${data.house.id}/applicants/${applicantId}/interview`,
				{ method: 'POST' }
			);
			const result = await response.json();
			if (!response.ok) {
				error = result.error ?? 'Could not start the interview';
				return;
			}
			await goto(`/scene/${result.conversationId}`);
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			busy = false;
			interviewing = null;
		}
	}

	function moveOut(tenantId: number, name: string) {
		if (!confirm(`Move ${name} out? Their room becomes vacant.`)) return;
		return call(`/api/houses/${data.house.id}/tenants/${tenantId}`, { method: 'DELETE' });
	}
</script>

<svelte:head>
	<title>Tenants | {data.house.name}</title>
</svelte:head>

<MainLayout user={data.user} currentPath="/house/tenants">
	<div class="h-full overflow-y-auto">
		<div class="w-full px-6 py-6 lg:px-8 lg:py-7">
			<!-- Header: name, state — all left, matching /house and Home -->
			<div class="flex items-center gap-10 flex-wrap pb-5 border-b border-[var(--border-primary)]">
				<div class="flex items-center gap-4 min-w-0">
					<!-- Back goes up one level: out of a room's shortlist if one is open,
					     otherwise out of this page entirely. -->
					{#if openRoom}
						<button
							onclick={() => {
								openRoomId = null;
								shortlist = [];
							}}
							aria-label="Back to all rooms"
							class="btn-secondary px-3 py-3 flex-shrink-0"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15 19l-7-7 7-7"
								/>
							</svg>
						</button>
					{:else}
						<a
							href="/house"
							aria-label="Back to {data.house.name}"
							class="btn-secondary px-3 py-3 flex-shrink-0"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M15 19l-7-7 7-7"
								/>
							</svg>
						</a>
					{/if}

					<div class="min-w-0">
						<h1 class="text-3xl font-bold text-[var(--text-primary)] leading-tight">
							{openRoom ? openRoom.name : 'Tenants'}
						</h1>
						<p class="text-sm text-[var(--text-muted)] mt-1.5">
							{#if openRoom}
								Asking ${openRoom.baseRent.toLocaleString()} · who wants it today
							{:else}
								<a href="/house" class="hover:text-[var(--accent-primary)] transition">
									{data.house.name}
								</a>
							{/if}
						</p>
					</div>
				</div>

				<div class="flex items-center gap-8">
					<div>
						<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Occupied</p>
						<p class="text-xl font-semibold text-[var(--text-primary)] tabular-nums">
							{data.tenants.length}<span class="text-[var(--text-muted)] text-base"
								>/{data.tenants.length + data.vacantBedrooms.length}</span
							>
						</p>
					</div>
					<div>
						<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Income</p>
						<p class="text-xl font-semibold text-[var(--accent-primary)] tabular-nums">
							${data.tenants.reduce((sum, e) => sum + e.tenant.rentAmount, 0).toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">
							Day {data.house.day}
						</p>
						<p class="text-xl font-semibold text-[var(--text-primary)]">
							{weekdayLabel(data.house.day)}
						</p>
					</div>
				</div>
			</div>

			{#if error}
				<div
					class="mt-6 p-4 rounded-xl border border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)]"
				>
					{error}
				</div>
			{/if}

			{#if openRoom}
				<!-- ── Viewing one room's shortlist ──
				     Filling a vacancy is a choice between named people, so the room
				     takes over the page while you decide. -->
				<section class="mt-7">
					<div class="flex items-center gap-4 flex-wrap mb-5">
						<h2 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)]">
							At the Door
							{#if shortlist.length > 0}
								<span class="text-[var(--text-secondary)] ml-1">{shortlist.length}</span>
							{/if}
						</h2>
						<button
							onclick={redraw}
							disabled={busy || data.libraryCount === 0}
							class="btn-secondary px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
						>
							Different applicants
						</button>
					</div>

					{#if loadingShortlist}
						<p class="text-sm text-[var(--text-muted)] italic">Seeing who's interested…</p>
					{:else if data.libraryCount === 0}
						<div class="rounded-xl border border-dashed border-[var(--border-secondary)] p-8">
							<p class="text-[var(--text-secondary)] mb-4">
								Your character library is empty. Applicants are drawn from it.
							</p>
							<a href="/library" class="btn-primary-solid inline-block px-5 py-2.5">
								Import Characters
							</a>
						</div>
					{:else if shortlist.length === 0}
						<p class="text-sm text-[var(--text-muted)] italic">
							Nobody is interested in this room right now. Try again tomorrow.
						</p>
					{:else}
						<div
							class="grid gap-5"
							style="grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));"
						>
							{#each shortlist as entry (entry.applicant.id)}
								<div
									class="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden flex flex-col"
								>
									<div class="relative aspect-[3/4] bg-[var(--bg-tertiary)]">
										{#if entry.character.imageData || entry.character.thumbnailData}
											<img
												src={entry.character.imageData || entry.character.thumbnailData}
												alt={entry.character.name}
												class="absolute inset-0 w-full h-full object-cover object-top"
											/>
										{:else}
											<div
												class="absolute inset-0 flex items-center justify-center text-3xl text-[var(--text-muted)]"
											>
												{entry.character.name.charAt(0)}
											</div>
										{/if}

										<div
											class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/95 via-black/60 to-transparent"
										></div>
										<div class="absolute inset-x-0 bottom-0 p-4">
											<p class="text-base font-semibold text-white truncate">
												{entry.character.name}
											</p>
											<p class="text-sm text-[var(--accent-hover)] truncate mt-0.5">
												Offers ${entry.applicant.askingRent.toLocaleString()} · {entry.applicant
													.requestedDays}d
											</p>
										</div>
									</div>

									<div class="p-4 flex-1 flex flex-col">
										{#if entry.applicant.pitch}
											<p class="text-sm text-[var(--text-secondary)] italic line-clamp-3">
												{entry.applicant.pitch}
											</p>
										{:else if entry.character.description}
											<p class="text-sm text-[var(--text-secondary)] line-clamp-3">
												{blurb(entry.character.description)}
											</p>
										{/if}

										<div class="flex items-center gap-2 mt-4">
											<button
												onclick={() => accept(entry.applicant.id)}
												disabled={busy}
												class="btn-primary-solid flex-1 px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
											>
												Move in
											</button>
											<!-- Optional: talk to them before handing over a lease. -->
											<button
												onclick={() => interview(entry.applicant.id)}
												disabled={busy}
												class="btn-secondary px-4 py-2.5 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
											>
												Interview
											</button>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{:else}
				<!-- ── Vacant rooms: pick one to see who wants it ── -->
				{#if data.vacantBedrooms.length > 0}
					<section class="mt-7">
						<h2 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)] mb-4">
							Vacant Rooms
							<span class="text-[var(--text-secondary)] ml-1">{data.vacantBedrooms.length}</span>
						</h2>
						<div class="flex flex-wrap gap-3">
							{#each data.vacantBedrooms as room (room.id)}
								<button
									onclick={() => viewRoom(room.id)}
									disabled={busy}
									class="px-5 py-4 rounded-xl border border-dashed border-[var(--border-secondary)] text-left transition hover:border-[var(--accent-primary)] disabled:opacity-40"
								>
									<p class="font-semibold text-[var(--text-primary)]">{room.name}</p>
									<p class="text-sm text-[var(--accent-primary)] mt-0.5">
										${room.baseRent.toLocaleString()} · see applicants
									</p>
								</button>
							{/each}
						</div>
					</section>
				{/if}

				<!-- ── Current roster ── -->
				<section class="mt-8 {data.vacantBedrooms.length > 0 ? 'pt-6 border-t border-[var(--border-primary)]' : ''}">
					<h2 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)] mb-4">
						Living Here
						<span class="text-[var(--text-secondary)] ml-1">{data.tenants.length}</span>
					</h2>

					{#if data.tenants.length === 0}
						<p class="text-sm text-[var(--text-muted)] italic">
							Nobody lives here yet. Open a vacant room to see who's interested.
						</p>
					{:else}
						<div
							class="grid gap-5"
							style="grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));"
						>
							{#each data.tenants as entry (entry.tenant.id)}
								{@const left = daysRemaining(entry.tenant.leaseEndDay, data.house.day)}
								<div
									class="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden flex flex-col"
								>
									<div class="relative aspect-[3/4] bg-[var(--bg-tertiary)]">
										{#if entry.character.imageData || entry.character.thumbnailData}
											<img
												src={entry.character.imageData || entry.character.thumbnailData}
												alt={entry.character.name}
												class="absolute inset-0 w-full h-full object-cover object-top"
											/>
										{:else}
											<div
												class="absolute inset-0 flex items-center justify-center text-3xl text-[var(--text-muted)]"
											>
												{entry.character.name.charAt(0)}
											</div>
										{/if}

										<!-- The room they hold, as a tag on them -->
										<div class="absolute top-3 left-3">
											<span
												class="px-2.5 py-1 rounded-md text-xs font-medium bg-black/70 text-[var(--accent-hover)] backdrop-blur-sm"
											>
												{entry.bedroom?.name ?? 'No room'}
											</span>
										</div>

										<div
											class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/95 via-black/60 to-transparent"
										></div>
										<div class="absolute inset-x-0 bottom-0 p-4">
											<p class="text-base font-semibold text-white truncate">
												{entry.character.name}
											</p>
											<p
												class="text-sm truncate mt-0.5"
												style="color: {satisfactionColor(entry.tenant.satisfaction)}"
											>
												{satisfactionLabel(entry.tenant.satisfaction)}
											</p>
										</div>
									</div>

									<div class="p-4 flex items-center justify-between gap-3">
										<div class="min-w-0">
											<p class="text-sm text-[var(--text-primary)] tabular-nums">
												${entry.tenant.rentAmount.toLocaleString()}
											</p>
											<p
												class="text-xs truncate {left <= 3
													? 'text-[var(--warning)]'
													: 'text-[var(--text-muted)]'}"
											>
												{left === 0 ? 'Lease expired' : `${left}d left`}
											</p>
										</div>
										<button
											onclick={() => moveOut(entry.tenant.id, entry.character.name)}
											disabled={busy}
											class="btn-secondary px-4 py-2 text-sm flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
										>
											Move out
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{/if}
		</div>
	</div>

	<!-- Opening an interview writes a narrator intro before the page can load. -->
	{#if interviewing}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-primary)]/85 backdrop-blur-sm"
		>
			<div class="text-center">
				<div
					class="w-10 h-10 mx-auto mb-5 rounded-full border-2 border-[var(--accent-primary)] border-t-transparent animate-spin"
				></div>
				<p class="text-lg font-medium text-[var(--text-primary)]">
					Showing {interviewing} the room…
				</p>
				<p class="text-sm text-[var(--text-muted)] mt-1.5">Setting the scene</p>
			</div>
		</div>
	{/if}
</MainLayout>
