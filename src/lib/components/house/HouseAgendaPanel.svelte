<script lang="ts">
	import { weekdayLabel } from '$lib/house/phases';

	interface Thread {
		id: number;
		kind: string;
		summary: string;
		openedDay: number;
		dueDay: number | null;
		overdueBy: number | null;
		characterId: number;
		characterName: string;
		characterImage: string | null;
	}

	interface Expiring {
		tenantId: number;
		characterName: string;
		characterImage: string | null;
		room: string | null;
		daysLeft: number;
	}

	interface Props {
		day: number;
		openThreads: Thread[];
		expiring: Expiring[];
		/** Called with a character id when a row is clicked, to go find them. */
		onFind?: (characterId: number) => void;
		/**
		 * Close a thread without needing a scene. `resolved` means you actually
		 * dealt with it and credits satisfaction; `dropped` just clears it.
		 */
		onClose?: (threadId: number, outcome: 'resolved' | 'dropped') => void;
		/** Thread currently being closed, for the spinner. */
		closingId?: number | null;
	}

	let { day, openThreads, expiring, onFind, onClose, closingId = null }: Props = $props();

	// Overdue first, then oldest — the things that have been waiting longest are
	// the ones most worth chasing.
	let sorted = $derived(
		[...openThreads].sort((a, b) => {
			const ao = a.overdueBy ?? -Infinity;
			const bo = b.overdueBy ?? -Infinity;
			if (ao !== bo) return bo - ao;
			return a.openedDay - b.openedDay;
		})
	);

	let nothingToDo = $derived(openThreads.length === 0 && expiring.length === 0);

	function age(thread: Thread): string {
		if (thread.overdueBy !== null && thread.overdueBy > 0) {
			return `${thread.overdueBy}d overdue`;
		}
		if (thread.overdueBy !== null && thread.overdueBy === 0) return 'due today';
		if (thread.dueDay !== null) return `due ${weekdayLabel(thread.dueDay)}`;
		const waiting = day - thread.openedDay;
		if (waiting <= 0) return 'today';
		return waiting === 1 ? '1 day' : `${waiting} days`;
	}

	function isLate(thread: Thread): boolean {
		return thread.overdueBy !== null && thread.overdueBy >= 0;
	}
</script>

<aside
	class="w-full lg:w-80 flex-shrink-0 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden self-start"
>
	<div class="px-4 py-3 border-b border-[var(--border-primary)]">
		<h2 class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)]">Needs You</h2>
	</div>

	{#if nothingToDo}
		<p class="px-4 py-6 text-sm text-[var(--text-muted)] italic text-center">
			Nothing outstanding. The house is settled.
		</p>
	{:else}
		<!-- Unfinished business: things asked for or promised and not yet closed -->
		{#each sorted as thread (thread.id)}
			<!-- The row itself walks you to the character; the actions close it
			     without needing a scene. Nested buttons are invalid HTML, so the
			     row is a group rather than one big button. -->
			<div
				class="group flex items-start gap-3 px-4 py-3 border-b border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] transition"
			>
				<button
					type="button"
					onclick={() => onFind?.(thread.characterId)}
					class="flex items-start gap-3 text-left min-w-0 flex-1"
					title="Go find {thread.characterName}"
				>
					{#if thread.characterImage}
						<img
							src={thread.characterImage}
							alt={thread.characterName}
							class="w-8 h-8 rounded-md object-cover object-top flex-shrink-0 mt-0.5"
						/>
					{:else}
						<div
							class="w-8 h-8 rounded-md bg-[var(--bg-tertiary)] flex items-center justify-center flex-shrink-0 mt-0.5 text-xs text-[var(--text-muted)]"
						>
							{thread.characterName.charAt(0)}
						</div>
					{/if}

					<div class="min-w-0 flex-1">
						<p class="text-sm text-[var(--text-primary)] leading-snug">
							{thread.summary}
						</p>
						<p class="text-xs text-[var(--text-muted)] mt-0.5 truncate">
							{thread.kind === 'promise' ? 'You promised' : thread.characterName + ' asked'}
							<span class={isLate(thread) ? 'text-[var(--warning)]' : ''}>· {age(thread)}</span>
						</p>
					</div>
				</button>

				<div class="flex items-center gap-1 flex-shrink-0 mt-0.5">
					<button
						type="button"
						onclick={() => onClose?.(thread.id, 'resolved')}
						disabled={closingId === thread.id}
						title="Mark as done"
						aria-label="Mark {thread.summary} as done"
						class="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--success)] hover:bg-[var(--success)]/10 transition disabled:opacity-40"
					>
						{#if closingId === thread.id}
							<div
								class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
							></div>
						{:else}
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
							</svg>
						{/if}
					</button>
					<button
						type="button"
						onclick={() => onClose?.(thread.id, 'dropped')}
						disabled={closingId === thread.id}
						title="Dismiss — no longer matters"
						aria-label="Dismiss {thread.summary}"
						class="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition disabled:opacity-40"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			</div>
		{/each}

		<!-- Leases running out: the other reason to go and talk to someone -->
		{#each expiring as lease (lease.tenantId)}
			<div
				class="flex items-start gap-3 px-4 py-3 border-b border-[var(--border-primary)] last:border-b-0"
			>
				{#if lease.characterImage}
					<img
						src={lease.characterImage}
						alt={lease.characterName}
						class="w-8 h-8 rounded-md object-cover object-top flex-shrink-0 mt-0.5"
					/>
				{/if}
				<div class="min-w-0 flex-1">
					<p class="text-sm text-[var(--text-primary)] leading-snug">
						{lease.characterName}'s lease
						{lease.daysLeft <= 0 ? 'has expired' : 'is nearly up'}
					</p>
					<p class="text-xs mt-0.5 {lease.daysLeft <= 2 ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'}">
						{lease.room ?? 'No room'} ·
						{lease.daysLeft <= 0
							? 'expired'
							: lease.daysLeft === 1
								? '1 day left'
								: `${lease.daysLeft} days left`}
					</p>
				</div>
			</div>
		{/each}
	{/if}
</aside>
