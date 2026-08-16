<script lang="ts">
	import type { Message } from '$lib/server/db/schema';
	import MessageBubble from './MessageBubble.svelte';
	import MessageRow from './MessageRow.svelte';

	// Palette of distinct colors for different characters.
	// Spread across hues so several tenants in one room stay easy to tell apart
	// at a glance, and kept clear of the amber accent so speaker names don't read
	// as UI chrome.
	//
	// Characters who are only MENTIONED draw from the same palette: two different
	// people sharing one colour defeats the point of colouring names at all. They
	// are simply assigned after everyone in the room, so present speakers take the
	// earlier, most distinct hues.
	const CHARACTER_COLORS = [
		'#8fb08a', // sage
		'#d98a8a', // dusty rose
		'#7fa8c9', // muted slate blue
		'#e0a458', // amber
		'#b89ac9', // soft lilac
		'#d9b356', // gold
		'#e08b5c', // warm coral
		'#6fae9f', // seafoam
		'#d4849c', // mauve pink
		'#9aab6b', // olive
	];

	// Parse hex color to RGB
	function hexToRgb(hex: string): [number, number, number] {
		const h = hex.replace('#', '');
		return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
	}

	// Simple RGB distance — threshold of 80 filters out perceptually similar colors
	function colorDistance(a: string, b: string): number {
		const [r1, g1, b1] = hexToRgb(a);
		const [r2, g2, b2] = hexToRgb(b);
		return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
	}

	interface Props {
		messages: Message[];
		loading: boolean;
		isTyping: boolean;
		generating: boolean;
		charName: string | undefined;
		userName: string | undefined;
		charAvatar?: string | null;
		userAvatar?: string | null;
		chatLayout?: 'bubbles' | 'discord';
		avatarStyle?: 'circle' | 'rounded';
		textCleanupEnabled?: boolean;
		autoWrapActions?: boolean;
		userBubbleColor?: string;
		sceneCharacters?: { id: number; name: string }[];
		/**
		 * People who exist but are not in this scene — other tenants in the house.
		 *
		 * Highlighted when mentioned, so "Zara said she'd fix it" reads as a person
		 * rather than a word, without them having to be in the room. Each gets its
		 * own palette colour, assigned after everyone present.
		 */
		knownCharacters?: { id: number; name: string }[];
		onSwipe: (messageId: number, direction: 'left' | 'right') => void;
		onSaveEdit: (messageId: number, index: number, content: string) => void;
		onDelete: (messageId: number, index: number) => void;
		onBranch?: (messageId: number) => void;
	}

	let { messages, loading, isTyping, generating, charName, userName, charAvatar, userAvatar, chatLayout = 'bubbles', avatarStyle = 'circle', textCleanupEnabled = true, autoWrapActions = false, userBubbleColor = '#e0a458', sceneCharacters, knownCharacters, onSwipe, onSaveEdit, onDelete, onBranch }: Props = $props();

	// Filter palette to exclude colors too similar to the user's bubble color.
	// Must be declared AFTER $props(): a $derived that reads a prop before the
	// binding exists throws "Cannot access before initialization" during SSR.
	const availableColors = $derived(
		CHARACTER_COLORS.filter(c => colorDistance(c, userBubbleColor) > 80)
	);

	// Build a stable color map: characterId → color, assigned in order of first appearance
	// Also seeds from sceneCharacters so characters get colors before they speak
	// Uses availableColors which excludes colors too similar to userBubbleColor
	const characterColorMap = $derived.by(() => {
		const colors = availableColors;
		const map = new Map<number, string>();
		let colorIndex = 0;
		// First, assign colors from message history (stable ordering)
		for (const msg of messages) {
			if (msg.characterId && !map.has(msg.characterId)) {
				map.set(msg.characterId, colors[colorIndex % colors.length]);
				colorIndex++;
			}
		}
		// Then, assign colors to scene characters who haven't spoken yet
		if (sceneCharacters) {
			for (const char of sceneCharacters) {
				if (!map.has(char.id)) {
					map.set(char.id, colors[colorIndex % colors.length]);
					colorIndex++;
				}
			}
		}
		// Finally the rest of the house — people who get mentioned but aren't in
		// this room. Last in line so the people actually here take the earlier
		// hues, but they still get a colour of their own: two housemates sharing
		// one is exactly what colouring names is supposed to prevent.
		if (knownCharacters) {
			for (const char of knownCharacters) {
				if (!map.has(char.id)) {
					map.set(char.id, colors[colorIndex % colors.length]);
					colorIndex++;
				}
			}
		}
		return map;
	});

	// Build name → color map for inline text highlighting (used by ChatMessage)
	const characterNameColorMap = $derived.by(() => {
		const map = new Map<string, string>();
		// From messages
		for (const msg of messages) {
			if (msg.characterId && msg.senderName && !map.has(msg.senderName)) {
				const color = characterColorMap.get(msg.characterId);
				if (color) {
					map.set(msg.senderName, color);
				}
			}
		}
		// From scene characters who haven't spoken yet
		if (sceneCharacters) {
			for (const char of sceneCharacters) {
				if (!map.has(char.name)) {
					const color = characterColorMap.get(char.id);
					if (color) {
						map.set(char.name, color);
					}
				}
			}
		}
		// People who live here but aren't in this room, each with their own colour
		// from the same map.
		if (knownCharacters) {
			for (const char of knownCharacters) {
				if (!map.has(char.name)) {
					const color = characterColorMap.get(char.id);
					if (color) {
						map.set(char.name, color);
					}
				}
			}
		}
		return map;
	});

	let container: HTMLDivElement | undefined = $state();

	/**
	 * Whether the view is pinned to the bottom.
	 *
	 * Tracked so auto-scroll only follows new content when the reader is already
	 * at the end — scrolling someone back down while they are reading earlier
	 * messages is worse than not following at all. The threshold is generous
	 * because "close enough to the bottom" is what the reader perceives as being
	 * at the bottom.
	 */
	let pinned = $state(true);

	function updatePinned() {
		if (!container) return;
		pinned = container.scrollHeight - container.clientHeight - container.scrollTop < 120;
	}

	/**
	 * Follow content growth while pinned.
	 *
	 * The typing indicator, new messages, streamed text and late-loading images
	 * all grow the content *after* the messages prop settles, so scrolling once
	 * on send lands short — the "…" pushes the box down and the view stays put.
	 *
	 * A **MutationObserver on the subtree** rather than a ResizeObserver: the
	 * scroll container itself never changes size (it is `flex-1` in a fixed
	 * layout), so observing it fires nothing. What changes is `scrollHeight`, as
	 * nodes appear *inside* it — and those nodes don't exist yet at mount, so
	 * observing the children up front misses everything that matters.
	 *
	 * `characterData` and `attributes` are watched too, since a message being
	 * edited in place grows without adding nodes.
	 */
	$effect(() => {
		if (!container) return;

		const follow = () => {
			if (!pinned || !container) return;
			container.scrollTop = container.scrollHeight;
		};

		const observer = new MutationObserver(follow);
		observer.observe(container, {
			childList: true,
			subtree: true,
			characterData: true
		});

		// Images settle after their node lands, so the height jumps again once
		// they decode. `capture` because `load` does not bubble.
		container.addEventListener('load', follow, true);

		return () => {
			observer.disconnect();
			container?.removeEventListener('load', follow, true);
		};
	});

	export function scrollToBottom() {
		pinned = true;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	}

	export function getContainer() {
		return container;
	}
</script>

<div
	class="flex-1 overflow-y-auto pl-6 pr-24 py-6"
	bind:this={container}
	onscroll={updatePinned}
>
	{#if loading}
		<div class="flex items-center justify-center h-full">
			<div class="text-[var(--text-muted)]">Loading conversation...</div>
		</div>
	{:else if messages.length === 0}
		<div class="flex items-center justify-center h-full">
			<div class="text-center">
				<p class="text-[var(--text-secondary)] mb-2">No messages yet</p>
				<p class="text-sm text-[var(--text-muted)]">Start a conversation!</p>
			</div>
		</div>
	{:else}
		<div class="{chatLayout === 'discord' ? 'space-y-3' : 'space-y-4'}">
			{#each messages as message, index (message.id)}
				{#if chatLayout === 'discord'}
					<MessageRow
						{message}
						{index}
						isLast={index === messages.length - 1}
						{charName}
						{userName}
						{charAvatar}
						{userAvatar}
						{avatarStyle}
						{textCleanupEnabled}
						{autoWrapActions}
						{userBubbleColor}
						{characterColorMap}
						characterColors={characterNameColorMap}
						{generating}
						onSwipe={(direction) => onSwipe(message.id, direction)}
						onSaveEdit={(content) => onSaveEdit(message.id, index, content)}
						onDelete={() => onDelete(message.id, index)}
						onBranch={onBranch ? () => onBranch(message.id) : undefined}
					/>
				{:else}
					<MessageBubble
						{message}
						{index}
						isLast={index === messages.length - 1}
						{charName}
						{userName}
						{textCleanupEnabled}
						{autoWrapActions}
						{userBubbleColor}
						{characterColorMap}
						characterColors={characterNameColorMap}
						{generating}
						onSwipe={(direction) => onSwipe(message.id, direction)}
						onSaveEdit={(content) => onSaveEdit(message.id, index, content)}
						onDelete={() => onDelete(message.id, index)}
						onBranch={onBranch ? () => onBranch(message.id) : undefined}
					/>
				{/if}
			{/each}
		</div>

		<!-- Typing Indicator (only show when not regenerating and no placeholder message) -->
		{#if isTyping && !generating && messages.at(-1)?.content}
			<div class="mt-4">
				{#if chatLayout === 'discord'}
					<!-- Discord-style typing indicator -->
					<div class="flex gap-4 px-2 py-1">
						<div class="w-10 h-10 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center flex-shrink-0">
							<svg class="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
							</svg>
						</div>
						<div class="flex items-center gap-1">
							<div class="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style="animation-delay: 0s"></div>
							<div class="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
							<div class="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style="animation-delay: 0.4s"></div>
						</div>
					</div>
				{:else}
					<!-- Bubble-style typing indicator -->
					<div class="flex justify-start">
						<div class="flex items-center gap-2 bg-[var(--assistant-bubble)] border border-[var(--assistant-border)] rounded-2xl px-4 py-3">
							<div class="flex gap-1">
								<div class="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style="animation-delay: 0s"></div>
								<div class="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
								<div class="w-2 h-2 bg-[var(--text-muted)] rounded-full animate-bounce" style="animation-delay: 0.4s"></div>
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>
