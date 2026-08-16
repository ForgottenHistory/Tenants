<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import type { House } from '$lib/server/db/schema';
	import { phaseLabel, weekdayShort } from '$lib/house/phases';

	interface Props {
		houses: House[];
	}

	let { houses }: Props = $props();

	let open = $state(false);
	let switching = $state<number | null>(null);

	let active = $derived(houses.find((h) => h.isActive) ?? null);
	let others = $derived(houses.filter((h) => !h.isActive));

	async function switchTo(houseId: number) {
		if (switching !== null) return;
		switching = houseId;
		try {
			const response = await fetch(`/api/houses/${houseId}/activate`, { method: 'POST' });
			if (response.ok) {
				open = false;
				// Refresh the layout's house list, then the page's own data.
				window.dispatchEvent(new CustomEvent('houseUpdated'));
				await invalidateAll();
				await goto('/house');
			}
		} catch (error) {
			console.error('Failed to switch house:', error);
		} finally {
			switching = null;
		}
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.house-switcher')) {
			open = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="relative house-switcher">
	{#if active}
		<button
			onclick={() => (open = !open)}
			class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition hover:bg-[var(--bg-tertiary)] max-w-[15rem]"
			title="Switch house"
		>
			<svg
				class="w-4 h-4 text-[var(--accent-primary)] flex-shrink-0"
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
			<span class="flex-1 min-w-0">
				<span class="block text-sm font-medium text-[var(--text-primary)] truncate">
					{active.name}
				</span>
				<span class="block text-xs text-[var(--text-muted)] truncate">
					{weekdayShort(active.day)} {active.day} &middot; {phaseLabel(active.phase)}
				</span>
			</span>
			<svg
				class="w-4 h-4 text-[var(--text-muted)] flex-shrink-0 transition-transform {open
					? 'rotate-180'
					: ''}"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
		</button>
	{:else}
		<a
			href="/house/new"
			class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition"
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 6v6m0 0v6m0-6h6m-6 0H6"
				/>
			</svg>
			Start a house
		</a>
	{/if}

	{#if open && active}
		<div
			class="absolute right-0 top-full mt-2 w-72 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl shadow-xl overflow-hidden z-50"
		>
			<!-- Current house actions -->
			<div class="px-4 py-3 border-b border-[var(--border-primary)]">
				<p class="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-1">Current</p>
				<p class="font-medium text-[var(--text-primary)] truncate">{active.name}</p>
				<p class="text-xs text-[var(--text-muted)] mt-0.5">
					{weekdayShort(active.day)}, Day {active.day} &middot; {phaseLabel(active.phase)} &middot; ${active.balance.toLocaleString()}
				</p>
			</div>

			<div class="p-1.5 border-b border-[var(--border-primary)]">
				<a
					href="/house"
					onclick={() => (open = false)}
					class="block px-3 py-2 rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition"
				>
					The House
				</a>
				<a
					href="/house/tenants"
					onclick={() => (open = false)}
					class="block px-3 py-2 rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition"
				>
					Tenants
				</a>
			</div>

			{#if others.length > 0}
				<div class="p-1.5 border-b border-[var(--border-primary)]">
					<p class="px-3 pt-1.5 pb-1 text-xs uppercase tracking-wider text-[var(--text-muted)]">
						Switch to
					</p>
					{#each others as house (house.id)}
						<button
							onclick={() => switchTo(house.id)}
							disabled={switching !== null}
							class="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition disabled:opacity-40 disabled:cursor-not-allowed"
						>
							<span class="block text-sm text-[var(--text-primary)] truncate">{house.name}</span>
							<span class="block text-xs text-[var(--text-muted)]">
								{switching === house.id
									? 'Switching…'
									: `${weekdayShort(house.day)} ${house.day} · ${phaseLabel(house.phase)}`}
							</span>
						</button>
					{/each}
				</div>
			{/if}

			<div class="p-1.5">
				<a
					href="/houses"
					onclick={() => (open = false)}
					class="block px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition"
				>
					Manage houses
				</a>
				<a
					href="/house/new"
					onclick={() => (open = false)}
					class="block px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition"
				>
					Start a new house
				</a>
			</div>
		</div>
	{/if}
</div>
