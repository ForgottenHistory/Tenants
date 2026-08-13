<script lang="ts">
	import type { PageData } from './$types';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import { phaseLabel } from '$lib/house/phases';

	let { data }: { data: PageData } = $props();

	let house = $derived(data.summary.house);
	let bedrooms = $derived(data.summary.bedrooms);
	let spaces = $derived(data.summary.spaces);

	function occupantFor(bedroomId: number) {
		return data.tenants.find((entry) => entry.tenant.bedroomId === bedroomId) ?? null;
	}
</script>

<svelte:head>
	<title>{house.name} | Tenants</title>
</svelte:head>

<MainLayout user={data.user} currentPath="/house">
	<div class="h-full overflow-y-auto">
		<div class="max-w-5xl mx-auto px-8 py-10">
			<!-- Header: where and when -->
			<div class="flex items-end justify-between gap-4 mb-8 flex-wrap">
				<div>
					<a
						href="/"
						class="text-sm text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
					>
						&larr; Home
					</a>
					<h1 class="text-3xl font-bold text-[var(--text-primary)] mt-3">{house.name}</h1>
					{#if house.address}
						<p class="text-[var(--text-muted)] mt-1">{house.address}</p>
					{/if}
				</div>
				<div class="text-right">
					<p class="text-sm uppercase tracking-wider text-[var(--text-muted)]">
						Day {house.day}
					</p>
					<p class="text-2xl font-semibold text-[var(--accent-primary)]">
						{phaseLabel(house.phase)}
					</p>
					<p class="text-sm text-[var(--text-muted)] mt-1">
						${house.balance.toLocaleString()}
					</p>
				</div>
			</div>

			<!-- Shared spaces first: this is where the game happens -->
			<section class="mb-8">
				<h2
					class="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3"
				>
					Shared
				</h2>
				{#if spaces.length === 0}
					<p class="text-[var(--text-muted)] text-sm">This house has no shared spaces.</p>
				{:else}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{#each spaces as space (space.id)}
							<div
								class="p-5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]"
							>
								<div class="flex items-baseline justify-between gap-3">
									<h3 class="font-semibold text-[var(--text-primary)]">{space.name}</h3>
									<span class="text-xs text-[var(--text-muted)] capitalize">{space.kind}</span>
								</div>
								{#if space.description}
									<p class="text-sm text-[var(--text-secondary)] mt-2 line-clamp-2">
										{space.description}
									</p>
								{/if}
								<p class="text-sm text-[var(--text-muted)] mt-3 italic">Empty</p>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<!-- Bedrooms: the lease roster -->
			<section class="mb-8">
				<div class="flex items-baseline justify-between gap-3 mb-3">
					<h2 class="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
						Bedrooms
					</h2>
					<a href="/house/tenants" class="text-sm text-[var(--accent-primary)] hover:underline">
						Manage tenants
					</a>
				</div>
				<div class="rounded-xl border border-[var(--border-primary)] overflow-hidden">
					{#each bedrooms as room, i (room.id)}
						{@const occupant = occupantFor(room.id)}
						<div
							class="flex items-center justify-between gap-4 px-5 py-4 bg-[var(--bg-secondary)] {i > 0
								? 'border-t border-[var(--border-primary)]'
								: ''}"
						>
							<div class="flex items-center gap-3 min-w-0">
								{#if occupant?.character.thumbnailData}
									<img
										src={occupant.character.thumbnailData}
										alt={occupant.character.name}
										class="w-10 h-10 rounded-lg object-cover flex-shrink-0"
									/>
								{/if}
								<div class="min-w-0">
									<p class="font-medium text-[var(--text-primary)]">{room.name}</p>
									<p class="text-sm text-[var(--text-muted)]">
										${room.baseRent.toLocaleString()} / period
									</p>
								</div>
							</div>
							{#if occupant}
								<span class="text-sm text-[var(--text-secondary)]">
									{occupant.character.name}
								</span>
							{:else}
								<a
									href="/house/tenants"
									class="text-sm text-[var(--accent-primary)] hover:underline italic"
								>
									Vacant
								</a>
							{/if}
						</div>
					{/each}
				</div>
			</section>

			<div
				class="p-5 rounded-xl border border-dashed border-[var(--border-secondary)] text-center"
			>
				<p class="text-sm text-[var(--text-muted)]">
					The day cycle and room scenes arrive in the next phases.
				</p>
			</div>
		</div>
	</div>
</MainLayout>
