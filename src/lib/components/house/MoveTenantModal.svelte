<script lang="ts">
	import type { Character, Tenant, Bedroom, SharedSpace } from '$lib/server/db/schema';
	import { phaseId } from '$lib/house/phases';
	import {
		parseActivityPools,
		parseSpacePool,
		bedroomActivityOptions,
		awayActivityOptions,
		sharedActivityOptions
	} from '$lib/house/activities';

	interface Props {
		open: boolean;
		/** Everyone living here — only active tenants can be placed. */
		tenants: Array<{ tenant: Tenant; character: Character; bedroom?: Bedroom | null }>;
		spaces: SharedSpace[];
		/** Drives which slice of the activity pools is offered. */
		phase: number;
		/** Preselected when opened from a specific person's row. */
		initialTenantId?: number | null;
		onClose: () => void;
		onMove: (
			tenantId: number,
			placeKind: 'bedroom' | 'shared' | 'away',
			placeId: number | null,
			activity: string
		) => Promise<void>;
		moving: boolean;
	}

	let {
		open,
		tenants,
		spaces,
		phase,
		initialTenantId = null,
		onClose,
		onMove,
		moving
	}: Props = $props();

	let tenantId = $state<number | null>(null);
	let placeKind = $state<'bedroom' | 'shared' | 'away'>('shared');
	let placeId = $state<number | null>(null);
	let activity = $state('');
	let error = $state<string | null>(null);

	// Declared before the reset effect that reads it — a `$derived` is a real
	// binding, so referencing it earlier in the module body would throw.
	let unlockedSpaces = $derived(spaces.filter((s) => s.unlocked));

	// Reset on open so a previous move isn't half-carried into the next one.
	let wasOpen = $state(false);
	$effect(() => {
		if (open === wasOpen) return;
		wasOpen = open;
		if (open) {
			tenantId = initialTenantId ?? (tenants.length === 1 ? tenants[0].tenant.id : null);
			placeKind = 'shared';
			placeId = unlockedSpaces.length > 0 ? unlockedSpaces[0].id : null;
			activity = '';
			error = null;
		}
	});

	let chosen = $derived(tenants.find((t) => t.tenant.id === tenantId) ?? null);

	// A tenant with no lease has no room to be sent to, so the option is hidden
	// rather than offered and then rejected by the server.
	let canUseBedroom = $derived(!!chosen?.tenant.bedroomId);

	/**
	 * The lines the roll itself would have drawn from, for this phase and place.
	 *
	 * Same source and same fallbacks as `occupancyService`, so what is offered is
	 * exactly what could have come up naturally — the point is to choose from
	 * their pool, not to invent something outside it.
	 */
	let activityOptions = $derived.by(() => {
		if (!chosen) return [];
		const id = phaseId(phase);
		const pools = parseActivityPools(chosen.character.activityPools);
		if (placeKind === 'bedroom') return bedroomActivityOptions(id, pools);
		if (placeKind === 'away') return awayActivityOptions(id, pools);
		const space = unlockedSpaces.find((s) => s.id === placeId);
		if (!space) return [];
		return sharedActivityOptions(space.kind, parseSpacePool(space.activityPool));
	});

	async function submit() {
		if (moving) return;
		if (tenantId === null) {
			error = 'Pick who you are moving.';
			return;
		}
		if (placeKind === 'shared' && placeId === null) {
			error = 'Pick a room.';
			return;
		}
		error = null;
		await onMove(tenantId, placeKind, placeKind === 'shared' ? placeId : null, activity.trim());
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70"
		role="button"
		tabindex="-1"
		onclick={(e) => e.target === e.currentTarget && !moving && onClose()}
		onkeydown={(e) => e.key === 'Escape' && !moving && onClose()}
	>
		<div
			class="w-full max-w-lg rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden max-h-[90vh] flex flex-col"
		>
			<div
				class="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between gap-4"
			>
				<div class="min-w-0">
					<h2 class="text-lg font-semibold text-[var(--text-primary)]">Move Someone</h2>
					<p class="text-xs text-[var(--text-muted)] mt-0.5">
						Put a tenant where you want them for this phase
					</p>
				</div>
				<button
					onclick={onClose}
					disabled={moving}
					aria-label="Close"
					class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition text-xl leading-none disabled:opacity-40"
				>
					×
				</button>
			</div>

			<div class="p-5 space-y-5 overflow-y-auto">
				{#if error}
					<div
						class="p-3 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)] text-sm"
					>
						{error}
					</div>
				{/if}

				{#if tenants.length === 0}
					<p class="text-sm text-[var(--text-secondary)]">
						Nobody lives here yet, so there is nobody to move.
					</p>
				{:else}
					<div class="space-y-2">
						<span class="block text-sm font-medium text-[var(--text-secondary)]">Who</span>
						<div class="flex gap-3 flex-wrap">
							{#each tenants as entry (entry.tenant.id)}
								<button
									type="button"
									onclick={() => (tenantId = entry.tenant.id)}
									disabled={moving}
									class="w-20 rounded-xl overflow-hidden border text-left transition disabled:opacity-40 {tenantId ===
									entry.tenant.id
										? 'border-[var(--accent-primary)]'
										: 'border-[var(--border-primary)] hover:border-[var(--text-muted)]'}"
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
												class="absolute inset-0 flex items-center justify-center text-2xl text-[var(--text-muted)]"
											>
												{entry.character.name.charAt(0)}
											</div>
										{/if}
									</div>
									<div
										class="px-1.5 py-1 text-[11px] text-[var(--text-secondary)] truncate text-center"
									>
										{entry.character.name}
									</div>
								</button>
							{/each}
						</div>
					</div>

					<div class="space-y-2">
						<span class="block text-sm font-medium text-[var(--text-secondary)]">Where</span>
						<div class="flex flex-col gap-1.5">
							{#each unlockedSpaces as space (space.id)}
								<button
									type="button"
									onclick={() => {
										placeKind = 'shared';
										placeId = space.id;
										activity = '';
									}}
									disabled={moving}
									class="px-3 py-2 rounded-xl border text-left text-sm transition disabled:opacity-40 {placeKind ===
										'shared' && placeId === space.id
										? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
										: 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'}"
								>
									{space.name}
								</button>
							{/each}

							{#if canUseBedroom}
								<button
									type="button"
									onclick={() => {
										placeKind = 'bedroom';
										placeId = null;
										activity = '';
									}}
									disabled={moving}
									class="px-3 py-2 rounded-xl border text-left text-sm transition disabled:opacity-40 {placeKind ===
									'bedroom'
										? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
										: 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'}"
								>
									{chosen?.bedroom?.name ?? 'Their room'}
									<span class="text-[var(--text-muted)]"> · their own room</span>
								</button>
							{/if}

							<button
								type="button"
								onclick={() => {
									placeKind = 'away';
									placeId = null;
									activity = '';
								}}
								disabled={moving}
								class="px-3 py-2 rounded-xl border text-left text-sm transition disabled:opacity-40 {placeKind ===
								'away'
									? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
									: 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'}"
							>
								Out of the house
							</button>
						</div>
					</div>

					<div class="space-y-2">
						<label
							for="move-activity"
							class="block text-sm font-medium text-[var(--text-secondary)]"
						>
							What they are doing
							<span class="text-[var(--text-muted)] font-normal">(optional)</span>
						</label>
						<input
							id="move-activity"
							bind:value={activity}
							disabled={moving}
							placeholder="left blank, one is picked from their pool"
							class="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] disabled:opacity-40"
						/>
						{#if activityOptions.length > 0}
							<div class="flex gap-1.5 flex-wrap">
								{#each activityOptions as option (option)}
									<button
										type="button"
										onclick={() => (activity = option)}
										disabled={moving}
										class="px-2.5 py-1 rounded-lg border text-[11px] transition disabled:opacity-40 {activity ===
										option
											? 'border-[var(--accent-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
											: 'border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-primary)]'}"
									>
										{option}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			{#if tenants.length > 0}
				<div
					class="px-5 py-4 border-t border-[var(--border-primary)] flex items-center gap-2 justify-end"
				>
					<button
						onclick={onClose}
						disabled={moving}
						class="btn-secondary px-4 py-2 text-sm disabled:opacity-40"
					>
						Cancel
					</button>
					<button
						onclick={submit}
						disabled={moving}
						class="btn-primary-solid px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
					>
						{#if moving}
							<div
								class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
							></div>
							Moving…
						{:else}
							Move
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
