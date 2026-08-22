<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import { MAX_BEDROOMS, DEFAULT_BASE_RENT } from '$lib/house/spacePresets';
	import { bedroomBuildCost } from '$lib/house/upgrades';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);
	let notice = $state<string | null>(null);

	let newRoomName = $state('');
	let newRoomRent = $state<number>(DEFAULT_BASE_RENT);

	let roomCount = $derived(data.bedrooms.length);
	let atMax = $derived(roomCount >= MAX_BEDROOMS);
	// Quoted from the same function the server charges with, so the price on
	// screen is the price taken.
	let cost = $derived(bedroomBuildCost(roomCount));
	let affordable = $derived(data.house.balance >= cost);

	async function buildRoom() {
		if (busy || atMax || !affordable) return;
		busy = true;
		error = null;
		notice = null;

		try {
			const response = await fetch(`/api/houses/${data.house.id}/bedrooms`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newRoomName, baseRent: newRoomRent })
			});
			const result = await response.json();

			if (!response.ok) {
				error = result.error ?? 'Could not build the room';
				return;
			}

			notice = `${result.bedroom.name} is built. $${result.cost.toLocaleString()} spent.`;
			newRoomName = '';
			newRoomRent = DEFAULT_BASE_RENT;

			// The nav's house switcher shows house state too.
			window.dispatchEvent(new CustomEvent('houseUpdated'));
			await invalidateAll();
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Upgrade | {data.house.name}</title>
</svelte:head>

<MainLayout user={data.user} currentPath="/house/upgrade">
	<div class="h-full overflow-y-auto">
		<div class="w-full px-6 py-6 lg:px-8 lg:py-7">
			<!-- Header: back, name, balance — matching /house and /house/tenants -->
			<div class="flex items-center gap-10 flex-wrap pb-5 border-b border-[var(--border-primary)]">
				<div class="flex items-center gap-4 min-w-0">
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
					<div class="min-w-0">
						<h1 class="text-3xl font-bold text-[var(--text-primary)] leading-tight break-words">
							Upgrade the House
						</h1>
						<p class="text-sm text-[var(--text-muted)] mt-1.5">{data.house.name}</p>
					</div>
				</div>

				<div class="flex items-center gap-8">
					<div>
						<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Balance</p>
						<p class="text-xl font-semibold text-[var(--text-primary)] tabular-nums">
							${data.house.balance.toLocaleString()}
						</p>
					</div>
					<div>
						<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Bedrooms</p>
						<p class="text-xl font-semibold text-[var(--text-primary)] tabular-nums">
							{roomCount} <span class="text-[var(--text-muted)] text-base">/ {MAX_BEDROOMS}</span>
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

			{#if error}
				<div
					class="mb-6 p-4 rounded-xl border border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)] text-sm"
				>
					{error}
				</div>
			{/if}

			<!-- ── Build a bedroom ── -->
			<section
				class="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-6 mb-6"
			>
				<div class="flex items-baseline justify-between mb-2 gap-4 flex-wrap">
					<h2 class="text-lg font-semibold text-[var(--text-primary)]">Build a Bedroom</h2>
					<span class="text-sm text-[var(--text-muted)] tabular-nums">
						Next room: <span
							class={affordable
								? 'text-[var(--accent-primary)] font-semibold'
								: 'text-[var(--error)] font-semibold'}>${cost.toLocaleString()}</span
						>
					</span>
				</div>
				<p class="text-sm text-[var(--text-muted)] mb-5">
					Another lease slot — one tenant, one rent. Each room you add makes the next one more
					expensive to build.
				</p>

				{#if atMax}
					<p class="text-sm text-[var(--text-secondary)]">
						There's no room left to build on. The house is at its maximum of {MAX_BEDROOMS} bedrooms.
					</p>
				{:else}
					<div class="flex items-center gap-2 flex-wrap">
						<input
							type="text"
							bind:value={newRoomName}
							placeholder={`Room ${roomCount + 1}`}
							aria-label="New bedroom name"
							class="flex-1 min-w-[12rem] px-4 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
						/>
						<div class="relative">
							<span class="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm"
								>$</span
							>
							<input
								type="number"
								bind:value={newRoomRent}
								min="0"
								step="50"
								aria-label="New bedroom rent"
								class="w-28 pl-7 pr-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
							/>
						</div>
						<button
							onclick={buildRoom}
							disabled={busy || !affordable}
							class="btn-primary-solid px-5 py-2.5 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
						>
							{#if busy}
								<div
									class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
								></div>
								Building…
							{:else}
								Build &mdash; ${cost.toLocaleString()}
							{/if}
						</button>
					</div>

					{#if !affordable}
						<p class="text-sm text-[var(--error)] mt-3">
							You're ${(cost - data.house.balance).toLocaleString()} short. Collect some rent first.
						</p>
					{/if}
				{/if}
			</section>

			<!-- ── What the house already has ── -->
			<section
				class="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-6 mb-6"
			>
				<h2 class="text-lg font-semibold text-[var(--text-primary)] mb-5">Existing Bedrooms</h2>

				{#if data.bedrooms.length === 0}
					<p class="text-sm text-[var(--text-muted)]">This house has no bedrooms yet.</p>
				{:else}
					<div class="space-y-2">
						{#each data.bedrooms as room (room.id)}
							<div
								class="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)]"
							>
								<div class="min-w-0">
									<p class="text-[var(--text-primary)] font-medium truncate">{room.name}</p>
									<p class="text-xs text-[var(--text-muted)] mt-0.5">
										{#if data.occupantByBedroom[room.id]}
											Leased to {data.occupantByBedroom[room.id]}
										{:else}
											Vacant
										{/if}
									</p>
								</div>
								<p class="text-sm text-[var(--text-secondary)] tabular-nums whitespace-nowrap">
									${room.baseRent.toLocaleString()}<span class="text-[var(--text-muted)]">/day</span>
								</p>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	</div>
</MainLayout>
