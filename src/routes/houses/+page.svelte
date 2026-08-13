<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll, goto } from '$app/navigation';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import { phaseLabel } from '$lib/house/phases';

	let { data }: { data: PageData } = $props();

	let switching = $state<number | null>(null);
	let error = $state<string | null>(null);

	async function activate(houseId: number) {
		if (switching !== null) return;
		switching = houseId;
		error = null;

		try {
			const response = await fetch(`/api/houses/${houseId}/activate`, { method: 'POST' });
			if (!response.ok) {
				const result = await response.json();
				error = result.error ?? 'Failed to switch house';
				return;
			}
			await invalidateAll();
			await goto('/');
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			switching = null;
		}
	}
</script>

<svelte:head>
	<title>Houses | Tenants</title>
</svelte:head>

<MainLayout user={data.user} currentPath="/houses">
	<div class="h-full overflow-y-auto">
		<div class="max-w-3xl mx-auto px-8 py-10">
			<div class="flex items-start justify-between gap-4 mb-8 flex-wrap">
				<div>
					<a
						href="/"
						class="text-sm text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
					>
						&larr; Back
					</a>
					<h1 class="text-3xl font-bold text-[var(--text-primary)] mt-3">Your Houses</h1>
					<p class="text-[var(--text-secondary)] mt-2">
						One house is active at a time. The rest are paused where you left them.
					</p>
				</div>
				<a href="/house/new" class="btn-primary-solid px-5 py-2.5 whitespace-nowrap">New House</a>
			</div>

			{#if error}
				<div
					class="mb-6 p-4 rounded-xl border border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)]"
				>
					{error}
				</div>
			{/if}

			{#if data.houses.length === 0}
				<div
					class="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-12 text-center"
				>
					<p class="text-[var(--text-secondary)] mb-6">You haven't set up a house yet.</p>
					<a href="/house/new" class="btn-primary-solid inline-block px-6 py-3"
						>Start a New House</a
					>
				</div>
			{:else}
				<div class="space-y-3">
					{#each data.houses as house (house.id)}
						<div
							class="rounded-xl border p-5 transition {house.isActive
								? 'border-[var(--accent-primary)]/50 bg-[var(--bg-secondary)]'
								: 'border-[var(--border-primary)] bg-[var(--bg-secondary)]/60'}"
						>
							<div class="flex items-center justify-between gap-4 flex-wrap">
								<div>
									<div class="flex items-center gap-3">
										<h2 class="text-lg font-semibold text-[var(--text-primary)]">{house.name}</h2>
										{#if house.isActive}
											<span
												class="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider rounded-md bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]"
											>
												Active
											</span>
										{/if}
									</div>
									<p class="text-sm text-[var(--text-muted)] mt-1">
										{#if house.address}{house.address} &middot; {/if}Day {house.day},
										{phaseLabel(house.phase)} &middot; ${house.balance.toLocaleString()}
									</p>
								</div>

								{#if house.isActive}
									<a href="/house" class="btn-primary-solid px-5 py-2 text-sm">Continue</a>
								{:else}
									<button
										onclick={() => activate(house.id)}
										disabled={switching !== null}
										class="btn-secondary px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
									>
										{switching === house.id ? 'Switching…' : 'Resume'}
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</MainLayout>
