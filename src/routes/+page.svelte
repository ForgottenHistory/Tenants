<script lang="ts">
	import type { PageData } from './$types';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import { phaseLabel } from '$lib/house/phases';

	let { data }: { data: PageData } = $props();

	let summary = $derived(data.summary);
	let house = $derived(summary?.house ?? null);
</script>

<svelte:head>
	<title>Tenants</title>
</svelte:head>

<MainLayout user={data.user} currentPath="/">
	<div class="h-full overflow-y-auto">
		<div class="max-w-5xl mx-auto px-8 py-12">
			{#if house && summary}
				<!-- ── Active house: resume is the primary action ── -->
				<div
					class="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-primary)] shadow-xl overflow-hidden"
				>
					<div class="p-8 border-b border-[var(--border-primary)]">
						<div class="flex items-start justify-between gap-6 flex-wrap">
							<div>
								<p
									class="text-xs font-semibold uppercase tracking-wider text-[var(--accent-primary)] mb-2"
								>
									Current House
								</p>
								<h2 class="text-3xl font-bold text-[var(--text-primary)]">{house.name}</h2>
								{#if house.address}
									<p class="text-[var(--text-muted)] mt-1">{house.address}</p>
								{/if}
							</div>
							<a href="/house" class="btn-primary-solid px-6 py-3 text-base whitespace-nowrap">
								Continue &rarr;
							</a>
						</div>
					</div>

					<!-- At-a-glance state -->
					<div class="grid grid-cols-2 md:grid-cols-4 divide-x divide-[var(--border-primary)]">
						<div class="p-6">
							<p class="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-1">Day</p>
							<p class="text-2xl font-semibold text-[var(--text-primary)]">{house.day}</p>
						</div>
						<div class="p-6">
							<p class="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-1">Phase</p>
							<p class="text-2xl font-semibold text-[var(--text-primary)]">
								{phaseLabel(house.phase)}
							</p>
						</div>
						<div class="p-6">
							<p class="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-1">Tenants</p>
							<p class="text-2xl font-semibold text-[var(--text-primary)]">
								{summary.occupiedBedrooms}<span class="text-[var(--text-muted)] text-lg"
									>/{summary.bedrooms.length}</span
								>
							</p>
						</div>
						<div class="p-6">
							<p class="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-1">Balance</p>
							<p class="text-2xl font-semibold text-[var(--accent-primary)]">
								${house.balance.toLocaleString()}
							</p>
						</div>
					</div>

					{#if summary.spaces.length > 0}
						<div class="px-6 pb-6 pt-2">
							<p class="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-3">
								Shared Spaces
							</p>
							<div class="flex flex-wrap gap-2">
								{#each summary.spaces as space (space.id)}
									<span
										class="px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-secondary)]"
									>
										{space.name}
									</span>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<div class="mt-4 flex items-center justify-between text-sm gap-4 flex-wrap">
					<div class="flex items-center gap-4">
						<a
							href="/house/tenants"
							class="text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
						>
							Tenants
						</a>
						<a
							href="/houses"
							class="text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
						>
							{data.houseCount > 1 ? `Switch house (${data.houseCount})` : 'Manage houses'}
						</a>
					</div>
					<a
						href="/house/new"
						class="text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
					>
						Start a new house
					</a>
				</div>
			{:else}
				<!-- ── No house yet: starting one is the only thing on offer ── -->
				<div
					class="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-primary)] shadow-xl p-12 text-center"
				>
					<div
						class="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[var(--accent-primary)]/15 flex items-center justify-center"
					>
						<svg
							class="w-8 h-8 text-[var(--accent-primary)]"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
							/>
						</svg>
					</div>

					<h2 class="text-3xl font-bold text-[var(--text-primary)] mb-3">No house yet</h2>
					<p class="text-[var(--text-secondary)] max-w-md mx-auto mb-8">
						Set up a property, decide how many bedrooms it has, and choose the shared spaces where
						your tenants will cross paths.
					</p>

					<a href="/house/new" class="btn-primary-solid inline-block px-8 py-4 text-base">
						Start a New House
					</a>

					{#if data.houseCount > 0}
						<p class="mt-6 text-sm text-[var(--text-muted)]">
							or <a href="/houses" class="text-[var(--accent-primary)] hover:underline"
								>resume a paused house ({data.houseCount})</a
							>
						</p>
					{/if}
				</div>
			{/if}

		</div>
	</div>
</MainLayout>
