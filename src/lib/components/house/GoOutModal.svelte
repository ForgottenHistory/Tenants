<script lang="ts">
	import type { Character, Tenant } from '$lib/server/db/schema';

	interface Props {
		open: boolean;
		/** Everyone currently living here — an outing is a tenant thing. */
		tenants: Array<{ tenant: Tenant; character: Character }>;
		onClose: () => void;
		/** Hand the resolved scene back; the page owns navigation. */
		onGo: (characterId: number, place: string, activity: string) => Promise<void>;
		going: boolean;
	}

	let { open, tenants, onClose, onGo, going }: Props = $props();

	let characterId = $state<number | null>(null);
	let place = $state('');
	let activity = $state('');
	let error = $state<string | null>(null);

	// Reset each time the modal opens, so last night's outing isn't pre-filled
	// into tonight's.
	let wasOpen = $state(false);
	$effect(() => {
		if (open === wasOpen) return;
		wasOpen = open;
		if (open) {
			characterId = tenants.length === 1 ? tenants[0].character.id : null;
			place = '';
			activity = '';
			error = null;
		}
	});

	let chosen = $derived(tenants.find((t) => t.character.id === characterId) ?? null);

	/**
	 * A few places to start from. Not a fixed list of destinations — the field is
	 * free text and these just fill it in, so the player who wants somewhere
	 * specific types it and the player who wants to get moving clicks one.
	 */
	const PLACE_SUGGESTIONS = [
		'a quiet cafe in town',
		'the night market',
		'a bar down the road',
		'the park by the river',
		'the cinema',
		'a long walk, nowhere in particular'
	];

	async function submit() {
		if (going) return;
		if (characterId === null) {
			error = 'Pick who you are going with.';
			return;
		}
		if (!place.trim()) {
			error = 'Say where you are going.';
			return;
		}
		error = null;
		await onGo(characterId, place.trim(), activity.trim());
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70"
		role="button"
		tabindex="-1"
		onclick={(e) => e.target === e.currentTarget && !going && onClose()}
		onkeydown={(e) => e.key === 'Escape' && !going && onClose()}
	>
		<div
			class="w-full max-w-lg rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden max-h-[90vh] flex flex-col"
		>
			<div
				class="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between gap-4"
			>
				<div class="min-w-0">
					<h2 class="text-lg font-semibold text-[var(--text-primary)]">Go Out</h2>
					<p class="text-xs text-[var(--text-muted)] mt-0.5">
						Take someone out of the house for the evening
					</p>
				</div>
				<button
					onclick={onClose}
					disabled={going}
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
						Nobody lives here yet, so there is nobody to go out with.
					</p>
				{:else}
					<div class="space-y-2">
						<span class="block text-sm font-medium text-[var(--text-secondary)]">Who with</span>
						<div class="flex gap-3 flex-wrap">
							{#each tenants as entry (entry.character.id)}
								<button
									type="button"
									onclick={() => (characterId = entry.character.id)}
									disabled={going}
									class="w-20 rounded-xl overflow-hidden border text-left transition disabled:opacity-40 {characterId ===
									entry.character.id
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
						<label for="outing-place" class="block text-sm font-medium text-[var(--text-secondary)]">
							Where
						</label>
						<input
							id="outing-place"
							bind:value={place}
							disabled={going}
							placeholder="a quiet cafe in town"
							class="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] disabled:opacity-40"
						/>
						<div class="flex gap-1.5 flex-wrap">
							{#each PLACE_SUGGESTIONS as suggestion (suggestion)}
								<button
									type="button"
									onclick={() => (place = suggestion)}
									disabled={going}
									class="px-2.5 py-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-primary)] transition disabled:opacity-40"
								>
									{suggestion}
								</button>
							{/each}
						</div>
					</div>

					<div class="space-y-2">
						<label
							for="outing-activity"
							class="block text-sm font-medium text-[var(--text-secondary)]"
						>
							What you are doing <span class="text-[var(--text-muted)] font-normal">(optional)</span>
						</label>
						<textarea
							id="outing-activity"
							bind:value={activity}
							disabled={going}
							rows="3"
							placeholder="catching up over a long lunch, no agenda"
							class="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] resize-y disabled:opacity-40"
						></textarea>
						<p class="text-xs text-[var(--text-muted)]">
							{#if chosen}
								{chosen.character.name} comes along as agreed — the scene starts with the two of you
								already there.
							{:else}
								The scene starts with the two of you already there.
							{/if}
						</p>
					</div>
				{/if}
			</div>

			{#if tenants.length > 0}
				<div
					class="px-5 py-4 border-t border-[var(--border-primary)] flex items-center gap-2 justify-end"
				>
					<button
						onclick={onClose}
						disabled={going}
						class="btn-secondary px-4 py-2 text-sm disabled:opacity-40"
					>
						Cancel
					</button>
					<button
						onclick={submit}
						disabled={going}
						class="btn-primary-solid px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
					>
						{#if going}
							<div
								class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
							></div>
							Heading out…
						{:else}
							Go Out &rarr;
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
