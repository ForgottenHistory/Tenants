<script lang="ts">
	import { phaseLabel, weekdayShort } from '$lib/house/phases';
	import { relationLabel, relationColor } from '$lib/house/relations';

	interface RelationRow {
		characterAId: number;
		characterBId: number;
		characterAName: string;
		characterBName: string;
		score: number;
	}

	interface HouseEvent {
		id: number;
		day: number;
		phase: number;
		text: string;
		delta: number;
	}

	interface Props {
		houseId: number;
		relation: RelationRow | null;
		onClose: () => void;
	}

	let { houseId, relation, onClose }: Props = $props();

	let events = $state<HouseEvent[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Refetch whenever a different pair is opened. Keyed on the pair rather than
	// on `relation` itself so reopening the same row doesn't refetch needlessly.
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		if (!relation) {
			loadedFor = null;
			return;
		}
		const key = `${relation.characterAId}-${relation.characterBId}`;
		if (loadedFor === key) return;
		loadedFor = key;
		load(relation.characterAId, relation.characterBId);
	});

	async function load(a: number, b: number) {
		loading = true;
		error = null;
		events = [];
		try {
			const response = await fetch(`/api/houses/${houseId}/events?between=${a},${b}`);
			const result = await response.json();
			if (!response.ok) {
				error = result.error ?? 'Failed to load history';
				return;
			}
			events = result.events ?? [];
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			loading = false;
		}
	}

	// The score is the sum of everything that ever happened, so showing the
	// running total alongside each event explains how they got here rather than
	// just asserting a number.
	let withRunningTotal = $derived.by(() => {
		// Events arrive newest-first; the running total has to accumulate from the
		// oldest, so walk a reversed copy and then flip the result back.
		const oldestFirst = [...events].reverse();
		let total = 0;
		const rows = oldestFirst.map((e) => {
			total += e.delta;
			return { ...e, running: total };
		});
		return rows.reverse();
	});
</script>

{#if relation}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70"
		role="button"
		tabindex="-1"
		onclick={(e) => e.target === e.currentTarget && onClose()}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
	>
		<div
			class="w-full max-w-lg max-h-[80vh] rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden flex flex-col"
		>
			<div
				class="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between gap-4 flex-shrink-0"
			>
				<div class="min-w-0">
					<h2 class="text-lg font-semibold text-[var(--text-primary)] truncate">
						{relation.characterAName} &amp; {relation.characterBName}
					</h2>
					<p class="text-xs mt-0.5" style="color: {relationColor(relation.score)}">
						{relationLabel(relation.score)}
						<span class="text-[var(--text-muted)] tabular-nums">
							· {relation.score > 0 ? '+' : ''}{relation.score}
						</span>
					</p>
				</div>
				<button
					onclick={onClose}
					aria-label="Close"
					class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition text-xl leading-none flex-shrink-0"
				>
					×
				</button>
			</div>

			<div class="overflow-y-auto flex-1">
				{#if loading}
					<p class="px-5 py-8 text-sm text-[var(--text-muted)] text-center">Loading history…</p>
				{:else if error}
					<p class="px-5 py-8 text-sm text-[var(--error)] text-center">{error}</p>
				{:else if withRunningTotal.length === 0}
					<p class="px-5 py-8 text-sm text-[var(--text-muted)] italic text-center">
						Nothing has happened between them yet.
					</p>
				{:else}
					{#each withRunningTotal as event (event.id)}
						<div
							class="flex items-start gap-3 px-5 py-3 border-b border-[var(--border-primary)] last:border-b-0"
						>
							<span
								class="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
								style="background: {event.delta >= 0 ? 'var(--success)' : 'var(--error)'}"
							></span>
							<div class="min-w-0 flex-1">
								<p class="text-sm text-[var(--text-secondary)] leading-snug">{event.text}</p>
								<p class="text-xs text-[var(--text-muted)] mt-0.5">
									{weekdayShort(event.day)}
									{event.day} · {phaseLabel(event.phase)}
								</p>
							</div>
							<div class="text-right flex-shrink-0">
								<span
									class="text-xs tabular-nums"
									style="color: {event.delta > 0 ? 'var(--success)' : 'var(--error)'}"
								>
									{event.delta > 0 ? '+' : ''}{event.delta}
								</span>
								<p class="text-xs text-[var(--text-muted)] tabular-nums mt-0.5">
									{event.running > 0 ? '+' : ''}{event.running}
								</p>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}
