<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import { satisfactionLabel, satisfactionColor, daysRemaining } from '$lib/house/tenancy';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	// Which room each applicant would move into. Defaults to the first vacancy.
	let roomChoice = $state<Record<number, number>>({});

	let hasVacancy = $derived(data.vacantBedrooms.length > 0);

	function chosenRoom(applicantId: number): number | null {
		return roomChoice[applicantId] ?? data.vacantBedrooms[0]?.id ?? null;
	}

	async function call(url: string, options: RequestInit): Promise<boolean> {
		if (busy) return false;
		busy = true;
		error = null;
		try {
			const response = await fetch(url, options);
			if (!response.ok) {
				const result = await response.json().catch(() => ({}));
				error = result.error ?? 'Something went wrong';
				return false;
			}
			await invalidateAll();
			return true;
		} catch {
			error = 'Network error. Please try again.';
			return false;
		} finally {
			busy = false;
		}
	}

	const refreshApplicants = () =>
		call(`/api/houses/${data.house.id}/applicants`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		});

	function accept(applicantId: number) {
		const bedroomId = chosenRoom(applicantId);
		if (bedroomId === null) return;
		return call(`/api/houses/${data.house.id}/applicants/${applicantId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ bedroomId })
		});
	}

	const reject = (applicantId: number) =>
		call(`/api/houses/${data.house.id}/applicants/${applicantId}`, { method: 'DELETE' });

	function moveOut(tenantId: number, name: string) {
		if (!confirm(`Move ${name} out? Their room becomes vacant.`)) return;
		return call(`/api/houses/${data.house.id}/tenants/${tenantId}`, { method: 'DELETE' });
	}
</script>

<svelte:head>
	<title>Tenants | {data.house.name}</title>
</svelte:head>

<MainLayout user={data.user} currentPath="/house/tenants">
	<div class="h-full overflow-y-auto">
		<div class="max-w-4xl mx-auto px-8 py-10">
			<div class="mb-8">
				<a
					href="/house"
					class="text-sm text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
				>
					&larr; {data.house.name}
				</a>
				<h1 class="text-3xl font-bold text-[var(--text-primary)] mt-3">Tenants</h1>
				<p class="text-[var(--text-secondary)] mt-2">
					{data.tenants.length} of {data.tenants.length + data.vacantBedrooms.length} rooms filled
					&middot; Day {data.house.day}
				</p>
			</div>

			{#if error}
				<div
					class="mb-6 p-4 rounded-xl border border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)]"
				>
					{error}
				</div>
			{/if}

			<!-- ── Current roster ── -->
			<section class="mb-10">
				<h2 class="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
					Living Here
				</h2>

				{#if data.tenants.length === 0}
					<div
						class="rounded-xl border border-dashed border-[var(--border-secondary)] p-8 text-center"
					>
						<p class="text-[var(--text-secondary)]">
							Nobody lives here yet. Review applicants below to fill a room.
						</p>
					</div>
				{:else}
					<div class="space-y-3">
						{#each data.tenants as entry (entry.tenant.id)}
							{@const left = daysRemaining(entry.tenant.leaseEndDay, data.house.day)}
							<div
								class="flex items-center gap-4 p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]"
							>
								{#if entry.character.thumbnailData}
									<img
										src={entry.character.thumbnailData}
										alt={entry.character.name}
										class="w-14 h-14 rounded-xl object-cover flex-shrink-0"
									/>
								{:else}
									<div
										class="w-14 h-14 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center flex-shrink-0 text-[var(--text-muted)] text-lg font-semibold"
									>
										{entry.character.name.charAt(0)}
									</div>
								{/if}

								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 flex-wrap">
										<h3 class="font-semibold text-[var(--text-primary)]">
											{entry.character.name}
										</h3>
										<span class="text-sm text-[var(--text-muted)]">
											{entry.bedroom?.name ?? 'No room'}
										</span>
									</div>
									<div class="flex items-center gap-3 mt-1 text-sm flex-wrap">
										<span style="color: {satisfactionColor(entry.tenant.satisfaction)}">
											{satisfactionLabel(entry.tenant.satisfaction)}
										</span>
										<span class="text-[var(--text-muted)]">
											${entry.tenant.rentAmount.toLocaleString()}
										</span>
										<span class="text-[var(--text-muted)]">
											{left === 0 ? 'Lease expired' : `${left}d left on lease`}
										</span>
									</div>
								</div>

								<button
									onclick={() => moveOut(entry.tenant.id, entry.character.name)}
									disabled={busy}
									class="btn-secondary px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
								>
									Move out
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<!-- ── Applicants ── -->
			<section>
				<div class="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
					<h2 class="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
						At the Door
					</h2>
					<button
						onclick={refreshApplicants}
						disabled={busy || data.libraryCount === 0}
						class="text-sm text-[var(--accent-primary)] hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
					>
						{data.applicants.length > 0 ? 'Draw new applicants' : 'Find applicants'}
					</button>
				</div>

				{#if data.libraryCount === 0}
					<div
						class="rounded-xl border border-dashed border-[var(--border-secondary)] p-8 text-center"
					>
						<p class="text-[var(--text-secondary)] mb-4">
							Your character library is empty. Applicants are drawn from it.
						</p>
						<a href="/library" class="btn-primary-solid inline-block px-5 py-2.5 text-sm">
							Import Characters
						</a>
					</div>
				{:else if !hasVacancy}
					<div
						class="rounded-xl border border-dashed border-[var(--border-secondary)] p-8 text-center"
					>
						<p class="text-[var(--text-secondary)]">
							Every room is full. Move someone out to take applications.
						</p>
					</div>
				{:else if data.applicants.length === 0}
					<div
						class="rounded-xl border border-dashed border-[var(--border-secondary)] p-8 text-center"
					>
						<p class="text-[var(--text-secondary)]">
							Nobody at the door. Draw applicants to see who's interested.
						</p>
					</div>
				{:else}
					<div class="space-y-3">
						{#each data.applicants as entry (entry.applicant.id)}
							<div
								class="p-4 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]"
							>
								<div class="flex items-center gap-4">
									{#if entry.character.thumbnailData}
										<img
											src={entry.character.thumbnailData}
											alt={entry.character.name}
											class="w-14 h-14 rounded-xl object-cover flex-shrink-0"
										/>
									{:else}
										<div
											class="w-14 h-14 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center flex-shrink-0 text-[var(--text-muted)] text-lg font-semibold"
										>
											{entry.character.name.charAt(0)}
										</div>
									{/if}

									<div class="flex-1 min-w-0">
										<h3 class="font-semibold text-[var(--text-primary)]">
											{entry.character.name}
										</h3>
										<p class="text-sm text-[var(--text-muted)]">
											Offers ${entry.applicant.askingRent.toLocaleString()} &middot;
											{entry.applicant.requestedDays}d lease
										</p>
									</div>
								</div>

								{#if entry.applicant.pitch}
									<p class="text-sm text-[var(--text-secondary)] mt-3 pl-18 italic">
										"{entry.applicant.pitch}"
									</p>
								{:else if entry.character.description}
									<p class="text-sm text-[var(--text-secondary)] mt-3 line-clamp-2">
										{entry.character.description}
									</p>
								{/if}

								<div class="flex items-center gap-2 mt-4 flex-wrap">
									<select
										value={chosenRoom(entry.applicant.id)}
										onchange={(e) =>
											(roomChoice[entry.applicant.id] = parseInt(e.currentTarget.value))}
										aria-label={`Room for ${entry.character.name}`}
										class="px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] text-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
									>
										{#each data.vacantBedrooms as room (room.id)}
											<option value={room.id}>{room.name}</option>
										{/each}
									</select>

									<button
										onclick={() => accept(entry.applicant.id)}
										disabled={busy}
										class="btn-primary-solid px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
									>
										Accept
									</button>
									<button
										onclick={() => reject(entry.applicant.id)}
										disabled={busy}
										class="btn-secondary px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
									>
										Pass
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	</div>
</MainLayout>
