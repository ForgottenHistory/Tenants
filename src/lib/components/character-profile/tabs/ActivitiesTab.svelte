<script lang="ts">
	import { HOUSE_PHASES, type PhaseId } from '$lib/house/phases';
	import {
		parseActivityPools,
		DEFAULT_ACTIVITY_POOLS,
		type ActivityPools
	} from '$lib/house/activities';

	interface Props {
		characterId: number;
		activityPools: string | null;
		onSave: (pools: ActivityPools | null) => void;
	}

	let { characterId, activityPools, onSave }: Props = $props();

	let generating = $state(false);
	let error = $state<string | null>(null);

	// One textarea per phase, one line per activity. Lines are the whole editing
	// model — no add/remove buttons to fight with.
	let bedroom = $state<Record<string, string>>({});
	let away = $state<Record<string, string>>({});
	let saving = $state(false);

	// Seed from what's stored, once per character. Re-running on every change
	// would wipe unsaved edits — including AI-written lines waiting for review.
	let seededFor = $state<number | null>(null);
	$effect(() => {
		if (seededFor === characterId) return;
		seededFor = characterId;

		const pools = parseActivityPools(activityPools);
		const nextBedroom: Record<string, string> = {};
		const nextAway: Record<string, string> = {};
		for (const phase of HOUSE_PHASES) {
			nextBedroom[phase.id] = (pools.bedroom?.[phase.id] ?? []).join('\n');
			nextAway[phase.id] = (pools.away?.[phase.id] ?? []).join('\n');
		}
		bedroom = nextBedroom;
		away = nextAway;
	});

	function toLines(text: string): string[] {
		return text
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	function collect(): ActivityPools | null {
		const pools: ActivityPools = { bedroom: {}, away: {} };
		let any = false;

		for (const phase of HOUSE_PHASES) {
			const b = toLines(bedroom[phase.id] ?? '');
			const a = toLines(away[phase.id] ?? '');
			if (b.length > 0) {
				pools.bedroom![phase.id as PhaseId] = b;
				any = true;
			}
			if (a.length > 0) {
				pools.away![phase.id as PhaseId] = a;
				any = true;
			}
		}

		// Nothing written anywhere means "fall back to the generic lines".
		return any ? pools : null;
	}

	async function save() {
		saving = true;
		try {
			await onSave(collect());
		} finally {
			saving = false;
		}
	}

	/**
	 * Have the Content LLM write pools from the character's own card. Fills the
	 * textareas rather than saving, so they can be edited before committing.
	 */
	async function generateWithAi() {
		if (generating) return;
		generating = true;
		error = null;

		try {
			const response = await fetch(`/api/characters/${characterId}/activity-pools`, {
				method: 'POST'
			});
			const result = await response.json();

			if (!response.ok) {
				error = result.error ?? 'Could not write activities';
				return;
			}

			const nextBedroom = { ...bedroom };
			const nextAway = { ...away };
			for (const phase of HOUSE_PHASES) {
				const b = result.pools?.bedroom?.[phase.id];
				const a = result.pools?.away?.[phase.id];
				if (Array.isArray(b) && b.length > 0) nextBedroom[phase.id] = b.join('\n');
				if (Array.isArray(a) && a.length > 0) nextAway[phase.id] = a.join('\n');
			}
			bedroom = nextBedroom;
			away = nextAway;
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			generating = false;
		}
	}

	/** Fill empty phases with the generic lines, as a starting point to edit. */
	function seedDefaults() {
		const nextBedroom = { ...bedroom };
		const nextAway = { ...away };
		for (const phase of HOUSE_PHASES) {
			if (!nextBedroom[phase.id]?.trim()) {
				nextBedroom[phase.id] = DEFAULT_ACTIVITY_POOLS.bedroom[phase.id as PhaseId].join('\n');
			}
			if (!nextAway[phase.id]?.trim()) {
				nextAway[phase.id] = DEFAULT_ACTIVITY_POOLS.away[phase.id as PhaseId].join('\n');
			}
		}
		bedroom = nextBedroom;
		away = nextAway;
	}
</script>

<div class="p-5 space-y-6">
	<div class="flex items-start justify-between gap-4 flex-wrap">
		<p class="text-sm text-[var(--text-secondary)] max-w-2xl">
			What this character does in their own room, and while out of the house — one line per
			activity, picked at random. Leave a phase empty to use the generic lines instead.
			<span class="text-[var(--text-muted)]">
				Shared-space activities (kitchen, lounge, yard) stay generic, since those rooms belong to
				the house rather than to any character.
			</span>
		</p>
		<div class="flex items-center gap-2 flex-shrink-0">
			<!-- Writes from the character's own card, into the boxes rather than
			     straight to the database, so they can be edited before saving. -->
			<button
				onclick={generateWithAi}
				disabled={generating || saving}
				class="btn-secondary px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
			>
				{generating ? 'Writing…' : '✨ Write with AI'}
			</button>
			<button onclick={seedDefaults} disabled={generating} class="btn-secondary px-4 py-2 text-sm disabled:opacity-40">
				Fill from defaults
			</button>
			<button onclick={save} disabled={saving || generating} class="btn-primary-solid px-5 py-2 text-sm disabled:opacity-40">
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</div>

	{#if error}
		<div
			class="p-3 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)] text-sm"
		>
			{error}
		</div>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<section>
			<h3 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)] mb-3">
				In their room
			</h3>
			<div class="space-y-3">
				{#each HOUSE_PHASES as phase (phase.id)}
					<div>
						<label
							for="bedroom-{phase.id}"
							class="block text-sm text-[var(--text-secondary)] mb-1.5"
						>
							{phase.label}
						</label>
						<textarea
							id="bedroom-{phase.id}"
							bind:value={bedroom[phase.id]}
							rows="4"
							placeholder={DEFAULT_ACTIVITY_POOLS.bedroom[phase.id as PhaseId].join('\n')}
							class="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] resize-y"
						></textarea>
					</div>
				{/each}
			</div>
		</section>

		<section>
			<h3 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)] mb-3">
				Out of the house
			</h3>
			<div class="space-y-3">
				{#each HOUSE_PHASES as phase (phase.id)}
					<div>
						<label for="away-{phase.id}" class="block text-sm text-[var(--text-secondary)] mb-1.5">
							{phase.label}
						</label>
						<textarea
							id="away-{phase.id}"
							bind:value={away[phase.id]}
							rows="4"
							placeholder={DEFAULT_ACTIVITY_POOLS.away[phase.id as PhaseId].join('\n')}
							class="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] resize-y"
						></textarea>
					</div>
				{/each}
			</div>
		</section>
	</div>
</div>
