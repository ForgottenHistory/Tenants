<script lang="ts">
	import type { PageData } from './$types';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import { phaseLabel, weekdayLabel, isWeekend } from '$lib/house/phases';
	import { relationLabel, relationColor } from '$lib/house/relations';
	import RelationDetailModal from '$lib/components/house/RelationDetailModal.svelte';

	let { data }: { data: PageData } = $props();

	let openRelation = $state<{
		characterAId: number;
		characterBId: number;
		characterAName: string;
		characterBName: string;
		score: number;
	} | null>(null);

	// The log is stored newest-first; grouping by day keeps it readable as a
	// history rather than an undifferentiated stream.
	//
	// Scene summaries are folded in as entries of their own, so a day reads as
	// everything that happened in it — the off-screen moments and the
	// conversations you actually played — rather than two disconnected lists.
	type LogEntry =
		| { kind: 'event'; key: string; day: number; phase: number; text: string; delta: number }
		| {
				kind: 'scene';
				key: string;
				day: number;
				phase: number;
				place: string;
				summary: string;
				conversationId: number;
				participants: { id: number; name: string }[];
		  };

	let byDay = $derived.by(() => {
		const entries: LogEntry[] = [
			...data.events.map((e) => ({
				kind: 'event' as const,
				key: `e${e.id}`,
				day: e.day,
				phase: e.phase,
				text: e.text,
				delta: e.delta
			})),
			...data.sceneSummaries.map((s) => ({
				kind: 'scene' as const,
				key: `s${s.id}`,
				day: s.day,
				phase: s.phase,
				place: s.place,
				summary: s.summary,
				conversationId: s.conversationId,
				participants: s.participants
			}))
		];

		const groups = new Map<number, LogEntry[]>();
		for (const entry of entries) {
			const list = groups.get(entry.day) ?? [];
			list.push(entry);
			groups.set(entry.day, list);
		}
		// Within a day, latest phase first — matching the newest-first ordering.
		return [...groups.entries()]
			.sort((a, b) => b[0] - a[0])
			.map(([day, list]) => ({
				day,
				entries: [...list].sort((x, y) => y.phase - x.phase)
			}));
	});
</script>

<svelte:head>
	<title>House Log | {data.house.name}</title>
</svelte:head>

<MainLayout user={data.user} currentPath="/house/log">
	<div class="h-full overflow-y-auto">
		<div class="w-full px-6 py-6 lg:px-8 lg:py-7">
			<!-- Header: matches /house and /house/tenants — all left, no far-edge actions -->
			<div class="flex items-center gap-5 flex-wrap pb-5 border-b border-[var(--border-primary)]">
				<a
					href="/house"
					class="w-9 h-9 rounded-lg border border-[var(--border-primary)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-primary)] hover:border-[var(--accent-primary)] transition flex-shrink-0"
					title="Back to the house"
				>
					&lsaquo;
				</a>
				<div class="min-w-0">
					<h1 class="text-2xl font-bold text-[var(--text-primary)] leading-tight">House Log</h1>
					<p class="text-sm text-[var(--text-muted)] mt-0.5">{data.house.name}</p>
				</div>

				<div class="flex items-center gap-8 ml-2">
					<div>
						<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Day</p>
						<p class="text-lg font-semibold text-[var(--text-primary)] tabular-nums">
							{data.house.day}
						</p>
					</div>
					<div>
						<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Events</p>
						<p class="text-lg font-semibold text-[var(--text-primary)] tabular-nums">
							{data.events.length}
						</p>
					</div>
					<div>
						<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Scenes</p>
						<p class="text-lg font-semibold text-[var(--text-primary)] tabular-nums">
							{data.sceneSummaries.length}
						</p>
					</div>
				</div>
			</div>

			<div class="flex flex-col lg:flex-row gap-8 mt-7 items-start">
				<div class="flex-1 min-w-0 w-full">
					{#if data.events.length === 0 && data.sceneSummaries.length === 0}
						<div
							class="rounded-xl border border-dashed border-[var(--border-secondary)] px-6 py-14 text-center"
						>
							<p class="text-[var(--text-secondary)]">Nothing has happened here yet.</p>
							<p class="text-sm text-[var(--text-muted)] mt-2">
								Housemates get on with each other between phases. Advance the clock and come back.
							</p>
						</div>
					{:else}
						{#each byDay as group (group.day)}
							<section class="mb-8">
								<h2 class="text-xs uppercase tracking-[0.15em] mb-3">
									<span
										class={isWeekend(group.day)
											? 'text-[var(--accent-secondary)]'
											: 'text-[var(--text-muted)]'}
									>
										{weekdayLabel(group.day)}
									</span>
									<span class="text-[var(--text-muted)]"> · Day {group.day}</span>
								</h2>

								<div
									class="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden"
								>
									{#each group.entries as entry (entry.key)}
										{#if entry.kind === 'event'}
											<div
												class="flex items-start gap-3 px-4 py-3 border-b border-[var(--border-primary)] last:border-b-0"
											>
												<span
													class="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
													style="background: {entry.delta >= 0
														? 'var(--success)'
														: 'var(--error)'}"
												></span>
												<div class="min-w-0 flex-1">
													<p class="text-sm text-[var(--text-primary)] leading-snug">{entry.text}</p>
													<p class="text-xs text-[var(--text-muted)] mt-0.5">
														{phaseLabel(entry.phase)}
													</p>
												</div>
												{#if entry.delta !== 0}
													<span
														class="text-xs tabular-nums flex-shrink-0 mt-0.5"
														style="color: {entry.delta > 0 ? 'var(--success)' : 'var(--error)'}"
													>
														{entry.delta > 0 ? '+' : ''}{entry.delta}
													</span>
												{/if}
											</div>
										{:else}
											<!-- A scene you played, as the characters remember it. Accent
											     dot and a tinted row so it reads as yours rather than as
											     background noise. -->
											<div
												class="flex items-start gap-3 px-4 py-3 border-b border-[var(--border-primary)] last:border-b-0 bg-[var(--bg-tertiary)]/40"
											>
												<span
													class="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
													style="background: var(--accent-primary)"
												></span>
												<div class="min-w-0 flex-1">
													<p class="text-sm text-[var(--text-primary)] leading-relaxed">
														{entry.summary}
													</p>
													<p class="text-xs text-[var(--text-muted)] mt-1">
														{phaseLabel(entry.phase)} · {entry.place}{entry.participants.length > 0
															? ` · ${entry.participants.map((p) => p.name).join(', ')}`
															: ''}
														<a
															href="/scene/{entry.conversationId}"
															class="ml-1 hover:text-[var(--accent-primary)] transition"
														>
															· read &rarr;
														</a>
													</p>
												</div>
											</div>
										{/if}
									{/each}
								</div>
							</section>
						{/each}
					{/if}
				</div>

				<!-- Where everyone stands, as a running tally beside the history -->
				<aside
					class="w-full lg:w-80 flex-shrink-0 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden self-start"
				>
					<div class="px-4 py-3 border-b border-[var(--border-primary)]">
						<h2 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)]">
							Between Them
						</h2>
					</div>
					{#if data.relations.length === 0}
						<p class="px-4 py-6 text-sm text-[var(--text-muted)] italic text-center">
							Nobody has formed an opinion yet.
						</p>
					{:else}
						{#each data.relations as rel (rel.characterAId + '-' + rel.characterBId)}
							<button
								type="button"
								onclick={() => (openRelation = rel)}
								class="w-full text-left px-4 py-3 border-b border-[var(--border-primary)] last:border-b-0 hover:bg-[var(--bg-tertiary)] transition"
							>
								<div class="flex items-center justify-between gap-2">
									<span class="text-sm text-[var(--text-primary)] truncate">
										{rel.characterAName} &amp; {rel.characterBName}
									</span>
									<span
										class="text-xs flex-shrink-0 tabular-nums"
										style="color: {relationColor(rel.score)}"
									>
										{rel.score > 0 ? '+' : ''}{rel.score}
									</span>
								</div>
								<p class="text-xs mt-0.5" style="color: {relationColor(rel.score)}">
									{relationLabel(rel.score)}
								</p>
							</button>
						{/each}
					{/if}
				</aside>
			</div>
		</div>
	</div>

	<RelationDetailModal
		houseId={data.house.id}
		relation={openRelation}
		onClose={() => (openRelation = null)}
	/>
</MainLayout>
