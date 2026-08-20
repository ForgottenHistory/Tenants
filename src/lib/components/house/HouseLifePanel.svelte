<script lang="ts">
	import { phaseLabel, weekdayShort } from '$lib/house/phases';
	import { relationLabel, relationColor } from '$lib/house/relations';

	interface HouseEvent {
		id: number;
		day: number;
		phase: number;
		text: string;
		delta: number;
	}

	interface RelationRow {
		characterAId: number;
		characterBId: number;
		characterAName: string;
		characterBName: string;
		score: number;
	}

	interface SceneSummary {
		id: number;
		conversationId: number;
		day: number;
		phase: number;
		place: string;
		summary: string;
		participants: { id: number; name: string }[];
	}

	interface Props {
		events: HouseEvent[];
		/** What the house overheard about you. Distinct from events: a rumour is
		    about the player, carries no delta, and is the only thing here that came
		    out of a scene you actually played. */
		rumours?: HouseEvent[];
		relations: RelationRow[];
		/** Condensed scenes — what the characters actually remember. */
		sceneSummaries?: SceneSummary[];
		/** Set when there is more history than the panel shows. */
		showAllHref?: string;
		/** Clicking a pair opens their history. */
		onOpenRelation?: (relation: RelationRow) => void;
	}

	let {
		events,
		rumours = [],
		relations,
		sceneSummaries = [],
		showAllHref = '/house/log',
		onOpenRelation
	}: Props = $props();

	// The panel is a glance, not the archive — the log page is the archive.
	let recent = $derived(events.slice(0, 6));

	// Summaries are paragraphs, not one-liners, so they stay folded until asked
	// for. Clicking a row opens that one rather than expanding the whole list.
	let openSummaryId = $state<number | null>(null);
	let recentSummaries = $derived(sceneSummaries.slice(0, 5));
	let recentRumours = $derived(rumours.slice(0, 4));
</script>

<aside
	class="w-full lg:w-80 flex-shrink-0 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden self-start"
>
	<div class="px-4 py-3 border-b border-[var(--border-primary)] flex items-center justify-between gap-2">
		<h2 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)]">House Life</h2>
		{#if events.length > 0}
			<a
				href={showAllHref}
				class="text-xs text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
			>
				All
			</a>
		{/if}
	</div>

	{#if recent.length === 0}
		<p class="px-4 py-6 text-sm text-[var(--text-muted)] italic text-center">
			Nothing has happened yet. Advance the day and see.
		</p>
	{:else}
		{#each recent as event (event.id)}
			<div class="flex items-start gap-2.5 px-4 py-2.5 border-b border-[var(--border-primary)]">
				<span
					class="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
					style="background: {event.delta >= 0 ? 'var(--success)' : 'var(--error)'}"
				></span>
				<div class="min-w-0 flex-1">
					<p class="text-sm text-[var(--text-secondary)] leading-snug">{event.text}</p>
					<p class="text-xs text-[var(--text-muted)] mt-0.5">
						{weekdayShort(event.day)} {event.day} · {phaseLabel(event.phase)}
					</p>
				</div>
			</div>
		{/each}
	{/if}

	<!-- Word Going Around: rumours the summariser pulled out of your own scenes.
	     Kept out of the event list above because they are about you rather than
	     between housemates, and because a delta-coloured dot would paint a rumour
	     green — they carry no delta. Burnt orange throughout, matching /house/log. -->
	{#if recentRumours.length > 0}
		<div class="border-t border-[var(--border-primary)]">
			<h3 class="px-4 py-3 text-xs uppercase tracking-[0.15em] text-[var(--accent-secondary)]">
				Word Going Around
			</h3>
			{#each recentRumours as rumour (rumour.id)}
				<div
					class="flex items-start gap-2.5 px-4 py-2.5 border-b border-[var(--border-primary)] last:border-b-0"
				>
					<span
						class="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
						style="background: var(--accent-secondary)"
					></span>
					<div class="min-w-0 flex-1">
						<p class="text-sm text-[var(--text-secondary)] leading-snug">{rumour.text}</p>
						<p class="text-xs text-[var(--text-muted)] mt-0.5">
							{weekdayShort(rumour.day)} {rumour.day} · {phaseLabel(rumour.phase)}
						</p>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- What the characters remember: the condensed version of scenes you played,
	     which is literally what gets fed back into their prompts. Folded because
	     these are paragraphs. -->
	{#if recentSummaries.length > 0}
		<div class="border-t border-[var(--border-primary)]">
			<h3
				class="px-4 py-3 text-xs uppercase tracking-[0.15em] text-[var(--text-muted)]"
			>
				Remembered
			</h3>
			{#each recentSummaries as scene (scene.id)}
				<div class="border-b border-[var(--border-primary)] last:border-b-0">
					<button
						type="button"
						onclick={() => (openSummaryId = openSummaryId === scene.id ? null : scene.id)}
						class="w-full text-left px-4 py-2.5 hover:bg-[var(--bg-tertiary)] transition"
					>
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0 flex-1">
								<p class="text-sm text-[var(--text-primary)] truncate">
									{scene.place}
								</p>
								<p class="text-xs text-[var(--text-muted)] mt-0.5 truncate">
									{weekdayShort(scene.day)}
									{scene.day} · {phaseLabel(scene.phase)}{scene.participants.length > 0
										? ` · ${scene.participants.map((p) => p.name).join(', ')}`
										: ''}
								</p>
							</div>
							<span
								class="text-[var(--text-muted)] text-xs flex-shrink-0 mt-0.5 transition-transform {openSummaryId ===
								scene.id
									? 'rotate-90'
									: ''}"
							>
								›
							</span>
						</div>
					</button>
					{#if openSummaryId === scene.id}
						<div class="px-4 pb-3">
							<p class="text-sm text-[var(--text-secondary)] leading-relaxed">
								{scene.summary}
							</p>
							<a
								href="/scene/{scene.conversationId}"
								class="inline-block mt-2 text-xs text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
							>
								Read the scene →
							</a>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Where everyone stands with each other. Only shown once anything has
	     actually moved, so a fresh house isn't a wall of "Neutral". -->
	{#if relations.length > 0}
		<div class="px-4 py-3 border-t border-[var(--border-primary)]">
			<h3 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)] mb-2.5">
				Between Them
			</h3>
			<div class="space-y-0.5">
				{#each relations as rel (rel.characterAId + '-' + rel.characterBId)}
					<button
						type="button"
						onclick={() => onOpenRelation?.(rel)}
						class="w-full flex items-center justify-between gap-2 text-sm text-left -mx-2 px-2 py-1 rounded-lg hover:bg-[var(--bg-tertiary)] transition"
					>
						<span class="text-[var(--text-secondary)] truncate">
							{rel.characterAName} &amp; {rel.characterBName}
						</span>
						<span
							class="text-xs flex-shrink-0 tabular-nums"
							style="color: {relationColor(rel.score)}"
						>
							{relationLabel(rel.score)}
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</aside>
