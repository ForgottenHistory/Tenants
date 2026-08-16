<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import {
		SPACE_PRESETS,
		MIN_BEDROOMS,
		MAX_BEDROOMS,
		DEFAULT_BEDROOMS,
		DEFAULT_STARTING_BALANCE,
		DEFAULT_BASE_RENT,
		type SpacePreset
	} from '$lib/house/spacePresets';

	let { data }: { data: PageData } = $props();

	interface BedroomDraft {
		name: string;
		baseRent: number;
	}

	interface SpaceDraft {
		name: string;
		kind: SpacePreset['kind'];
		description: string;
		capacity: number;
		enabled: boolean;
	}

	let name = $state('');
	let address = $state('');
	let description = $state('');
	let startingBalance = $state(DEFAULT_STARTING_BALANCE);

	// Bedrooms are a list, not just a count, so names and rent stay editable.
	let bedroomDrafts = $state<BedroomDraft[]>(
		Array.from({ length: DEFAULT_BEDROOMS }, (_, i) => ({
			name: `Room ${i + 1}`,
			baseRent: DEFAULT_BASE_RENT
		}))
	);

	let spaceDrafts = $state<SpaceDraft[]>(
		SPACE_PRESETS.map((preset) => ({
			name: preset.name,
			kind: preset.kind,
			description: preset.description,
			capacity: preset.capacity,
			enabled: preset.defaultOn
		}))
	);

	let submitting = $state(false);
	let error = $state<string | null>(null);

	let enabledSpaces = $derived(spaceDrafts.filter((s) => s.enabled));
	let canSubmit = $derived(name.trim().length > 0 && bedroomDrafts.length >= MIN_BEDROOMS);

	function addBedroom() {
		if (bedroomDrafts.length >= MAX_BEDROOMS) return;
		bedroomDrafts = [
			...bedroomDrafts,
			{ name: `Room ${bedroomDrafts.length + 1}`, baseRent: DEFAULT_BASE_RENT }
		];
	}

	function removeBedroom(index: number) {
		if (bedroomDrafts.length <= MIN_BEDROOMS) return;
		bedroomDrafts = bedroomDrafts.filter((_, i) => i !== index);
	}

	function addCustomSpace() {
		spaceDrafts = [
			...spaceDrafts,
			{ name: '', kind: 'other', description: '', capacity: 4, enabled: true }
		];
	}

	function removeSpace(index: number) {
		spaceDrafts = spaceDrafts.filter((_, i) => i !== index);
	}

	async function createHouse() {
		if (!canSubmit || submitting) return;

		submitting = true;
		error = null;

		try {
			const response = await fetch('/api/houses', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name,
					address,
					description,
					startingBalance,
					bedrooms: bedroomDrafts.map((room, i) => ({
						name: room.name.trim() || `Room ${i + 1}`,
						baseRent: room.baseRent
					})),
					spaces: enabledSpaces.map((space) => ({
						name: space.name,
						kind: space.kind,
						description: space.description,
						capacity: space.capacity
					}))
				})
			});

			const result = await response.json();

			if (!response.ok) {
				error = result.error ?? 'Failed to create house';
				return;
			}

			window.dispatchEvent(new CustomEvent('houseUpdated'));
			// A new house is empty, and the next step is always finding someone to
			// live in it — go straight there rather than via Home.
			await goto('/house/tenants');
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>New House | Tenants</title>
</svelte:head>

<MainLayout user={data.user} currentPath="/house/new">
	<div class="h-full overflow-y-auto">
		<div class="max-w-3xl mx-auto px-8 py-10">
			<div class="mb-8">
				<a
					href="/"
					class="text-sm text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
				>
					&larr; Back
				</a>
				<h1 class="text-3xl font-bold text-[var(--text-primary)] mt-3">Start a New House</h1>
				<p class="text-[var(--text-secondary)] mt-2">
					Everything here can be changed later. Sensible defaults are already filled in.
				</p>
			</div>

			{#if error}
				<div
					class="mb-6 p-4 rounded-xl border border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)]"
				>
					{error}
				</div>
			{/if}

			<!-- ── The property ── -->
			<section
				class="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-6 mb-6"
			>
				<h2 class="text-lg font-semibold text-[var(--text-primary)] mb-5">The Property</h2>

				<div class="space-y-4">
					<div>
						<label
							for="house-name"
							class="block text-sm font-medium text-[var(--text-secondary)] mb-2">House name</label
						>
						<input
							id="house-name"
							type="text"
							bind:value={name}
							placeholder="Maple Street"
							class="w-full px-4 py-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
						/>
					</div>

					<div>
						<label
							for="house-address"
							class="block text-sm font-medium text-[var(--text-secondary)] mb-2"
							>Address <span class="text-[var(--text-muted)] font-normal">(optional)</span></label
						>
						<input
							id="house-address"
							type="text"
							bind:value={address}
							placeholder="14 Maple St"
							class="w-full px-4 py-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
						/>
					</div>

					<div>
						<label
							for="house-description"
							class="block text-sm font-medium text-[var(--text-secondary)] mb-2"
							>Description <span class="text-[var(--text-muted)] font-normal"
								>(optional — sets the tone for scenes)</span
							></label
						>
						<textarea
							id="house-description"
							bind:value={description}
							rows="3"
							placeholder="A narrow two-storey terrace with worn floorboards and good light in the afternoon."
							class="w-full px-4 py-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] resize-none"
						></textarea>
					</div>

					<div>
						<label
							for="house-balance"
							class="block text-sm font-medium text-[var(--text-secondary)] mb-2"
							>Starting balance</label
						>
						<input
							id="house-balance"
							type="number"
							bind:value={startingBalance}
							min="0"
							step="500"
							class="w-full px-4 py-2.5 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
						/>
					</div>
				</div>
			</section>

			<!-- ── Bedrooms ── -->
			<section
				class="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-6 mb-6"
			>
				<div class="flex items-baseline justify-between mb-2">
					<h2 class="text-lg font-semibold text-[var(--text-primary)]">Bedrooms</h2>
					<span class="text-sm text-[var(--text-muted)]"
						>{bedroomDrafts.length} of {MAX_BEDROOMS} max</span
					>
				</div>
				<p class="text-sm text-[var(--text-muted)] mb-5">
					Each bedroom is a lease slot — one tenant, one rent.
				</p>

				<div class="space-y-2">
					{#each bedroomDrafts as room, i (i)}
						<div class="flex items-center gap-2">
							<span class="w-6 text-sm text-[var(--text-muted)] tabular-nums">{i + 1}</span>
							<input
								type="text"
								bind:value={room.name}
								placeholder={`Room ${i + 1}`}
								aria-label={`Bedroom ${i + 1} name`}
								class="flex-1 px-4 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
							/>
							<div class="relative">
								<span
									class="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm"
									>$</span
								>
								<input
									type="number"
									bind:value={room.baseRent}
									min="0"
									step="50"
									aria-label={`Bedroom ${i + 1} rent`}
									class="w-28 pl-7 pr-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
								/>
							</div>
							<button
								onclick={() => removeBedroom(i)}
								disabled={bedroomDrafts.length <= MIN_BEDROOMS}
								aria-label={`Remove bedroom ${i + 1}`}
								class="p-2 text-[var(--text-muted)] hover:text-[var(--error)] disabled:opacity-25 disabled:cursor-not-allowed transition rounded-lg"
							>
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
									/>
								</svg>
							</button>
						</div>
					{/each}
				</div>

				<button
					onclick={addBedroom}
					disabled={bedroomDrafts.length >= MAX_BEDROOMS}
					class="btn-secondary mt-4 px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
				>
					+ Add bedroom
				</button>
			</section>

			<!-- ── Shared spaces ── -->
			<section
				class="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-primary)] p-6 mb-6"
			>
				<div class="flex items-baseline justify-between mb-2">
					<h2 class="text-lg font-semibold text-[var(--text-primary)]">Shared Spaces</h2>
					<span class="text-sm text-[var(--text-muted)]">{enabledSpaces.length} selected</span>
				</div>
				<p class="text-sm text-[var(--text-muted)] mb-5">
					Where tenants cross paths. Most of the game happens in these rooms — you can expand and
					improve them later.
				</p>

				<div class="space-y-2">
					{#each spaceDrafts as space, i (i)}
						<div
							class="rounded-xl border transition {space.enabled
								? 'border-[var(--accent-primary)]/40 bg-[var(--bg-tertiary)]'
								: 'border-[var(--border-primary)] bg-[var(--bg-primary)]/40'}"
						>
							<div class="flex items-center gap-3 p-3">
								<input
									type="checkbox"
									bind:checked={space.enabled}
									aria-label={`Include ${space.name || 'custom space'}`}
									class="w-5 h-5 rounded accent-[var(--accent-primary)] flex-shrink-0"
								/>
								<input
									type="text"
									bind:value={space.name}
									placeholder="Space name"
									aria-label="Space name"
									class="flex-1 px-3 py-1.5 bg-transparent border border-transparent hover:border-[var(--border-primary)] focus:border-[var(--border-primary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] font-medium"
								/>
								<select
									bind:value={space.kind}
									aria-label="Space kind"
									class="px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-secondary)] text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
								>
									<option value="kitchen">Kitchen</option>
									<option value="lounge">Lounge</option>
									<option value="yard">Outdoor</option>
									<option value="utility">Utility</option>
									<option value="other">Other</option>
								</select>
								<button
									onclick={() => removeSpace(i)}
									aria-label={`Remove ${space.name || 'space'}`}
									class="p-2 text-[var(--text-muted)] hover:text-[var(--error)] transition rounded-lg"
								>
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
								</button>
							</div>

							{#if space.enabled}
								<div class="px-3 pb-3 pl-11">
									<textarea
										bind:value={space.description}
										rows="2"
										placeholder="How this room feels — the narrator uses this when setting a scene here."
										aria-label="Space description"
										class="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-secondary)] text-sm placeholder-[var(--text-muted)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] resize-none"
									></textarea>
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<button onclick={addCustomSpace} class="btn-secondary mt-4 px-4 py-2 text-sm">
					+ Add custom space
				</button>
			</section>

			<!-- ── Submit ── -->
			<div class="flex items-center justify-between gap-4 pb-8">
				<p class="text-sm text-[var(--text-muted)]">
					{bedroomDrafts.length}
					{bedroomDrafts.length === 1 ? 'bedroom' : 'bedrooms'} &middot; {enabledSpaces.length} shared
					{enabledSpaces.length === 1 ? 'space' : 'spaces'}
				</p>
				<button
					onclick={createHouse}
					disabled={!canSubmit || submitting}
					class="btn-primary-solid px-8 py-3 disabled:opacity-40 disabled:cursor-not-allowed"
				>
					{submitting ? 'Creating…' : 'Create House'}
				</button>
			</div>
		</div>
	</div>
</MainLayout>
