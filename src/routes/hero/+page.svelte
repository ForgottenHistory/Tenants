<svelte:head>
	<title>Tenants</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
		}
		.gradient-text {
			background: linear-gradient(90deg, #e0a458, #c2703d);
			-webkit-background-clip: text;
			-webkit-text-fill-color: transparent;
			background-clip: text;
			color: transparent;
		}
	</style>
</svelte:head>

<div style="width: 1280px; height: 640px; display: flex; align-items: center; justify-content: center; overflow: hidden; background: linear-gradient(135deg, #0c0c0b 0%, #1c1b19 50%, #0c0c0b 100%);">
	<div style="text-align: center; padding: 0 64px; max-width: 100%;">
		<!-- Main Title -->
		<h1 style="font-size: 96px; font-weight: 700; margin-bottom: 24px; display: flex; align-items: center; justify-content: center; gap: 16px;">
			<span class="gradient-text">Tenants</span>
		</h1>

		<!-- Tagline -->
		<p style="font-size: 24px; color: #b3b1ac; margin-bottom: 48px;">
			Own a house. Fill the rooms. Live alongside a rotating cast of characters.
		</p>

		<!-- Features -->
		<div style="display: flex; align-items: center; justify-content: center; gap: 24px; font-size: 18px; font-weight: 600; color: #b3b1ac; flex-wrap: wrap;">
			<div style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">
				<svg style="width: 24px; height: 24px; color: #e0a458;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
				</svg>
				<span>Day Cycle</span>
			</div>
			<span style="color: #383630;">•</span>
			<div style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">
				<svg style="width: 24px; height: 24px; color: #c2703d;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
				</svg>
				<span>Rotating Cast</span>
			</div>
			<span style="color: #383630;">•</span>
			<div style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">
				<svg style="width: 24px; height: 24px; color: #edb972;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
				<span>Leases</span>
			</div>
			<span style="color: #383630;">•</span>
			<div style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">
				<svg style="width: 24px; height: 24px; color: #8fb08a;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
				</svg>
				<span>Visual Novel</span>
			</div>
		</div>
	</div>
</div>
