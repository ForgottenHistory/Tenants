<script lang="ts">
	import type { PageData } from './$types';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import { phaseLabel, weekdayLabel } from '$lib/house/phases';

	let { data }: { data: PageData } = $props();

	let summary = $derived(data.summary);
	let house = $derived(summary?.house ?? null);

	// A house with nobody in it has nothing to do — no scenes, no rent, no
	// reason to advance the day. Treat it as an unfinished setup step rather
	// than a resumable game.
	let needsFirstTenant = $derived(!!house && summary?.occupiedBedrooms === 0);
	let ready = $derived(!!house && !needsFirstTenant);

	let vacancies = $derived(summary ? summary.bedrooms.length - summary.occupiedBedrooms : 0);

</script>

<svelte:head>
	<title>Tenants</title>
</svelte:head>

<MainLayout user={data.user} currentPath="/">
	<div class="h-full overflow-y-auto">
		<div class="min-h-full flex flex-col px-6 py-6 lg:px-8 lg:py-7">
			{#if house && summary && needsFirstTenant}
				<!-- ── House exists but is empty: filling it is the only real action ── -->
				<div class="flex-1 flex flex-col justify-center max-w-6xl w-full mx-auto">
					<p
						class="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent-primary)] mb-4"
					>
						{house.name}
					</p>
					<h1
						class="text-5xl lg:text-6xl font-bold text-[var(--text-primary)] leading-[1.05] max-w-3xl"
					>
						The house is empty.
					</h1>
					<p class="text-lg lg:text-xl text-[var(--text-secondary)] mt-6 max-w-2xl leading-relaxed">
						{#if data.libraryCount === 0}
							Tenants are drawn from your character library, and it's empty. Import a character card
							to get someone through the door.
						{:else if data.applicantCount > 0}
							{data.applicantCount}
							{data.applicantCount === 1 ? 'person is' : 'people are'} waiting at the door. Move someone
							in and the house comes alive.
						{:else}
							Nothing happens in a house with nobody in it. Find your first tenant and the days start
							to matter.
						{/if}
					</p>

					<div class="mt-10 flex items-center gap-4 flex-wrap">
						{#if data.libraryCount === 0}
							<a href="/library" class="btn-primary-solid px-8 py-4 text-lg">Import Characters</a>
						{:else}
							<a href="/house/tenants" class="btn-primary-solid px-8 py-4 text-lg">
								{data.applicantCount > 0 ? 'Review Applicants' : 'Find a Tenant'}
							</a>
						{/if}
						<a href="/house" class="btn-secondary px-6 py-4 text-lg">Look Around</a>
					</div>

					<!-- Empty rooms, shown as rooms rather than a number -->
					<div class="mt-14">
						<p class="text-xs uppercase tracking-[0.15em] text-[var(--text-muted)] mb-4">
							{summary.bedrooms.length} empty {summary.bedrooms.length === 1 ? 'room' : 'rooms'}
						</p>
						<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
							{#each summary.bedrooms as room (room.id)}
								<div
									class="aspect-[3/4] rounded-2xl border border-dashed border-[var(--border-secondary)] flex flex-col items-center justify-center gap-2 text-center px-2"
								>
									<span class="text-sm text-[var(--text-secondary)]">{room.name}</span>
									<span class="text-xs text-[var(--text-muted)]">
										${room.baseRent.toLocaleString()}
									</span>
								</div>
							{/each}
						</div>
					</div>

					<div class="mt-12 flex items-center gap-6 text-sm flex-wrap">
						<a
							href="/houses"
							class="text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
						>
							{data.houseCount > 1 ? `Switch house (${data.houseCount})` : 'Manage houses'}
						</a>
						<a
							href="/house/new"
							class="text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
						>
							Start a new house
						</a>
					</div>
				</div>
			{:else if ready && house && summary}
				<!-- ── Active house ──
				     Home is a HOUSES screen: which property you're in, its headline
				     numbers, the way back in, and who lives there. Managing the house
				     itself happens inside /house, not here. -->
				<div class="w-full">
					<!-- Everything sits left, in reading order: the title, then its own
					     actions right beside it. Nothing is parked at the far edge of a
					     wide screen where the pointer has to travel to reach it. -->
					<div
						class="flex items-center gap-4 flex-wrap pb-5 border-b border-[var(--border-primary)]"
					>
						<h2 class="text-2xl font-bold text-[var(--text-primary)]">
							Your Houses
							<span class="text-[var(--text-muted)] font-normal ml-1">{data.houseCount}</span>
						</h2>
						<a href="/houses" class="btn-secondary px-5 py-2.5 text-sm whitespace-nowrap">
							Manage Houses
						</a>
						<a href="/house/new" class="btn-secondary px-5 py-2.5 text-sm whitespace-nowrap">
							Start a New House
						</a>
					</div>

					<!-- The house you're in: identity, the way in, then its numbers -->
					<div class="mt-8 flex items-center gap-10 flex-wrap">
						<div class="min-w-0">
							<h1 class="text-3xl font-bold text-[var(--text-primary)] leading-tight break-words">
								{house.name}
							</h1>
							<p class="text-sm text-[var(--text-muted)] mt-1.5">
								{weekdayLabel(house.day)} · Day {house.day} · {phaseLabel(house.phase)}{house.address
									? ` · ${house.address}`
									: ''}
							</p>
						</div>

						<a href="/house" class="btn-primary-solid px-5 py-2.5 text-lg whitespace-nowrap">
							Continue &rarr;
						</a>

						<!-- Constant size regardless of how many tenants there are -->
						<div class="flex items-center gap-8">
							<div>
								<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">
									Balance
								</p>
								<p class="text-xl font-semibold text-[var(--accent-primary)] tabular-nums">
									${house.balance.toLocaleString()}
								</p>
							</div>
							<div>
								<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">
									Occupied
								</p>
								<p class="text-xl font-semibold text-[var(--text-primary)] tabular-nums">
									{summary.occupiedBedrooms}<span class="text-[var(--text-muted)] text-base"
										>/{summary.bedrooms.length}</span
									>
								</p>
							</div>
							<div>
								<p class="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Rent</p>
								<p class="text-xl font-semibold text-[var(--text-primary)] tabular-nums">
									${summary.bedrooms.reduce((sum, r) => sum + r.baseRent, 0).toLocaleString()}
								</p>
							</div>
						</div>
					</div>

					<!-- The cast, left to right. Fills the row, wraps at any size. -->
					<div class="mt-8">
						<div
							class="grid gap-5"
							style="grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));"
						>
							{#each data.residents as person (person.id)}
								{@const away = !person.where || person.where === 'Out'}
								<a
									href="/house"
									class="group relative aspect-[3/4] rounded-xl overflow-hidden border border-[var(--border-primary)] bg-[var(--bg-tertiary)] hover:border-[var(--accent-primary)] transition"
								>
									{#if person.image}
										<img
											src={person.image}
											alt={person.name}
											class="absolute inset-0 w-full h-full object-cover object-top transition duration-300 group-hover:scale-[1.03] {away
												? 'opacity-45 grayscale'
												: ''}"
										/>
									{:else}
										<div
											class="absolute inset-0 flex items-center justify-center text-3xl text-[var(--text-muted)]"
										>
											{person.name.charAt(0)}
										</div>
									{/if}

									<div
										class="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/95 via-black/60 to-transparent"
									></div>

									<div class="absolute inset-x-0 bottom-0 p-4">
										<p class="text-base font-semibold text-white truncate">{person.name}</p>
										<p
											class="text-sm truncate mt-0.5 {away
												? 'text-white/50 italic'
												: 'text-[var(--accent-hover)]'}"
										>
											{#if away}
												{person.activity ?? 'out of the house'}
											{:else}
												{person.where}{person.activity ? ` — ${person.activity}` : ''}
											{/if}
										</p>
									</div>
								</a>
							{/each}

							<!-- Vacancy sits with the cast: it's a person-shaped hole -->
							{#if vacancies > 0}
								<a
									href="/house/tenants"
									class="aspect-[3/4] rounded-xl border border-dashed border-[var(--border-secondary)] flex flex-col items-center justify-center gap-1.5 text-center px-3 text-[var(--text-muted)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] transition"
								>
									<span class="text-2xl font-light">+</span>
									<span class="text-sm">
										{vacancies}
										{vacancies === 1 ? 'room' : 'rooms'} free
									</span>
								</a>
							{/if}
						</div>
					</div>
				</div>
			{:else}
				<!-- ── No house yet: starting one is the only thing on offer ── -->
				<div class="flex-1 flex flex-col justify-center max-w-6xl w-full mx-auto">
					<div class="max-w-2xl">
						<p
							class="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent-primary)] mb-4"
						>
							Tenants
						</p>
						<h1
							class="text-5xl lg:text-7xl font-bold text-[var(--text-primary)] leading-[1.03]"
						>
							Somebody has to<br />live here.
						</h1>
						<p class="text-lg lg:text-xl text-[var(--text-secondary)] mt-7 leading-relaxed">
							Set up a property, decide how many bedrooms it has, and choose the shared spaces where
							your tenants will cross paths.
						</p>

						<div class="mt-10 flex items-center gap-4 flex-wrap">
							<a href="/house/new" class="btn-primary-solid px-8 py-4 text-lg">
								Start a New House
							</a>
							{#if data.houseCount > 0}
								<a href="/houses" class="btn-secondary px-6 py-4 text-lg">
									Resume a house ({data.houseCount})
								</a>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</MainLayout>
