<script lang="ts">
	import { parseSpacePool, defaultSpacePool } from '$lib/house/activities';
	import type { SharedSpace } from '$lib/server/db/schema';

	interface Props {
		houseId: number;
		space: SharedSpace | null;
		onClose: () => void;
		onSaved: () => void;
	}

	let { houseId, space, onClose, onSaved }: Props = $props();

	// One line per activity, same editing model as the character tab.
	let text = $state('');
	let saving = $state(false);
	let generating = $state(false);
	let error = $state<string | null>(null);

	// Seed once per space, so generated lines aren't wiped by a re-run.
	let seededFor = $state<number | null>(null);
	$effect(() => {
		if (!space || seededFor === space.id) return;
		seededFor = space.id;
		text = parseSpacePool(space.activityPool).join('\n');
		error = null;
	});

	function toLines(value: string): string[] {
		return value
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
	}

	async function generate() {
		if (!space || generating) return;
		generating = true;
		error = null;
		try {
			const response = await fetch(
				`/api/houses/${houseId}/spaces/${space.id}/activities`,
				{ method: 'POST' }
			);
			const result = await response.json();
			if (!response.ok) {
				error = result.error ?? 'Could not write activities';
				return;
			}
			text = (result.activities ?? []).join('\n');
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			generating = false;
		}
	}

	async function save() {
		if (!space || saving) return;
		saving = true;
		error = null;
		try {
			const response = await fetch(
				`/api/houses/${houseId}/spaces/${space.id}/activities`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ activities: toLines(text) })
				}
			);
			if (!response.ok) {
				const result = await response.json().catch(() => ({}));
				error = result.error ?? 'Could not save';
				return;
			}
			onSaved();
			onClose();
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			saving = false;
		}
	}
</script>

{#if space}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70"
		role="button"
		tabindex="-1"
		onclick={(e) => e.target === e.currentTarget && onClose()}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
	>
		<div
			class="w-full max-w-lg rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden"
		>
			<div class="px-5 py-4 border-b border-[var(--border-primary)] flex items-center justify-between gap-4">
				<div class="min-w-0">
					<h2 class="text-lg font-semibold text-[var(--text-primary)] truncate">
						{space.name}
					</h2>
					<p class="text-xs text-[var(--text-muted)] capitalize mt-0.5">{space.kind}</p>
				</div>
				<button
					onclick={onClose}
					aria-label="Close"
					class="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition text-xl leading-none"
				>
					×
				</button>
			</div>

			<div class="p-5 space-y-4">
				<p class="text-sm text-[var(--text-secondary)]">
					What tenants do in here — one line per activity, picked at random. Leave empty to use the
					generic lines for a {space.kind}.
				</p>

				{#if error}
					<div
						class="p-3 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)] text-sm"
					>
						{error}
					</div>
				{/if}

				<textarea
					bind:value={text}
					rows="10"
					placeholder={defaultSpacePool(space.kind).join('\n')}
					aria-label="Activities for {space.name}"
					class="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] resize-y"
				></textarea>

				<div class="flex items-center gap-2 flex-wrap">
					<button
						onclick={generate}
						disabled={generating || saving}
						class="btn-secondary px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{generating ? 'Writing…' : '✨ Write with AI'}
					</button>
					<button
						onclick={() => (text = defaultSpacePool(space.kind).join('\n'))}
						disabled={generating || saving}
						class="btn-secondary px-4 py-2 text-sm disabled:opacity-40"
					>
						Fill from defaults
					</button>
					<div class="flex-1"></div>
					<button
						onclick={save}
						disabled={saving || generating}
						class="btn-primary-solid px-5 py-2 text-sm disabled:opacity-40"
					>
						{saving ? 'Saving…' : 'Save'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
