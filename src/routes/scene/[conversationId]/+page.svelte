<script lang="ts">
	import type { PageData } from './$types';
	import { onMount, onDestroy } from 'svelte';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import ChatMessages from '$lib/components/chat/ChatMessages.svelte';
	import ChatInput from '$lib/components/chat/ChatInput.svelte';
	import ChatWorldPanel from '$lib/components/chat/ChatWorldPanel.svelte';
	import { phaseLabel, weekdayLabel } from '$lib/house/phases';
	import {
		initSocket,
		joinConversation,
		leaveConversation,
		onNewMessage,
		onTyping,
		removeAllListeners
	} from '$lib/stores/socket';
	import type { Message } from '$lib/server/db/schema';
	import type { ImpersonateStyle } from '$lib/types/chat';

	let { data }: { data: PageData } = $props();

	// svelte-ignore non_reactive_update
	let chatMessages: ChatMessages | undefined;
	// svelte-ignore non_reactive_update
	let chatInput: ChatInput | undefined;

	let impersonating = $state(false);

	// World state: what the room and the people in it currently look like.
	let worldState = $state<any>(null);
	let worldStateLoading = $state(false);
	let worldSidebarEnabled = $state(false);

	let messages = $state<Message[]>(data.messages as Message[]);
	let sending = $state(false);
	let isTyping = $state(false);
	let error = $state<string | null>(null);

	// Who answers when several people share a room. Null = the scene's primary.
	let speakerId = $state<number | null>(null);

	let participants = $derived(data.participants);
	let isInterview = $derived(data.scene.placeKind === 'interview');
	let activeSpeaker = $derived(
		participants.find((p) => p.id === speakerId) ?? participants[0] ?? null
	);

	// Settings the chat page also reads, so scenes look like the rest of the app.
	let chatLayout = $state<'bubbles' | 'discord'>('bubbles');
	let avatarStyle = $state<'circle' | 'rounded'>('circle');
	let textCleanupEnabled = $state(true);
	let autoWrapActions = $state(false);
	let userBubbleColor = $state('#e0a458');
	let userAvatar = $state<string | null>(null);
	let userName = $state<string | null>(null);

	async function loadSettings() {
		try {
			const response = await fetch('/api/settings');
			if (!response.ok) return;
			const result = await response.json();
			chatLayout = result.chatLayout || 'bubbles';
			avatarStyle = result.avatarStyle || 'circle';
			textCleanupEnabled = result.textCleanupEnabled ?? true;
			autoWrapActions = result.autoWrapActions ?? false;
			userBubbleColor = result.userBubbleColor ?? '#e0a458';
			userAvatar = result.userAvatar || null;
			userName = result.userName || null;
			worldSidebarEnabled = result.worldSidebarEnabled ?? false;
		} catch {
			// Defaults are fine — the scene still works.
		}
	}

	onMount(() => {
		initSocket();
		joinConversation(data.conversationId);

		// Show whatever was last recorded straight away, then refresh it: the
		// clock has usually moved since you were last in this room, so a stale
		// panel would describe a moment that has passed. Chained onto settings
		// because the panel is gated on worldSidebarEnabled, which isn't known
		// until they load.
		loadWorldState();
		loadSettings().then(() => {
			if (worldSidebarEnabled && participants.length > 0) generateWorldState();
		});

		onNewMessage((message: Message) => {
			if (message.conversationId !== data.conversationId) return;
			if (messages.some((m) => m.id === message.id)) return;
			messages = [...messages, message];
			chatMessages?.scrollToBottom();
		});

		onTyping((typing: boolean) => {
			isTyping = typing;
		});
	});

	onDestroy(() => {
		removeAllListeners();
		leaveConversation(data.conversationId);
	});

	function swipesOf(message: Message): string[] {
		if (!message.swipes) return [message.content];
		try {
			const parsed = JSON.parse(message.swipes);
			return Array.isArray(parsed) ? parsed : [message.content];
		} catch {
			return [message.content];
		}
	}

	/**
	 * Cycle between alternative responses, regenerating past the last one.
	 * These endpoints are already conversation-keyed, so scenes reuse them
	 * unchanged.
	 */
	async function swipe(messageId: number, direction: 'left' | 'right') {
		const index = messages.findIndex((m) => m.id === messageId);
		if (index === -1) return;

		const message = messages[index];
		const swipes = swipesOf(message);
		const current = message.currentSwipe ?? 0;

		let target: number;
		if (direction === 'right') {
			target = current + 1;
			if (target >= swipes.length) {
				// Past the last variant — ask for a new one, unless this is the
				// narrator's opening line, which has nothing before it to rebuild from.
				if (index === 0) {
					target = 0;
				} else {
					await regenerate(messageId);
					return;
				}
			}
		} else {
			target = current - 1;
			if (target < 0) target = swipes.length - 1;
		}

		const response = await fetch(`/api/chat/messages/${messageId}/swipe`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ swipeIndex: target })
		});

		if (!response.ok) return;

		const updated = [...messages];
		updated[index] = { ...message, content: swipes[target], currentSwipe: target };
		messages = updated;
	}

	async function regenerate(messageId: number) {
		sending = true;
		try {
			const response = await fetch(`/api/chat/messages/${messageId}/regenerate`, {
				method: 'POST'
			});
			if (!response.ok) {
				error = 'Failed to regenerate';
				return;
			}
			await refresh();
		} finally {
			sending = false;
		}
	}

	async function saveEdit(messageId: number, index: number, content: string) {
		const response = await fetch(`/api/chat/messages/${messageId}/edit`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ content })
		});

		if (!response.ok) {
			error = 'Failed to save edit';
			return;
		}

		const result = await response.json();
		const updated = [...messages];
		updated[index] = result.message;
		messages = updated;
	}

	async function deleteFrom(messageId: number, index: number) {
		const response = await fetch(`/api/chat/messages/${messageId}/delete`, {
			method: 'DELETE'
		});

		if (!response.ok) {
			error = 'Failed to delete';
			return;
		}

		messages = messages.slice(0, index);
	}

	/**
	 * Have the AI write the player's next line. The result lands in the input
	 * box, never sent automatically — it's a draft to edit.
	 */
	async function impersonate(style: ImpersonateStyle) {
		if (impersonating || sending) return;
		impersonating = true;
		error = null;

		try {
			const response = await fetch(`/api/scenes/${data.conversationId}/impersonate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ style })
			});
			const result = await response.json();

			if (!response.ok) {
				error = result.error ?? 'Could not write a message';
				return;
			}

			if (result.content) chatInput?.setInput(result.content);
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			impersonating = false;
		}
	}

	/** Re-roll the last reply as a new swipe on that message. */
	async function regenerateLast() {
		const last = [...messages].reverse().find((m) => m.role === 'assistant');
		if (!last || sending) return;
		await regenerate(last.id);
	}

	/** Load any world state already recorded for this scene. */
	async function loadWorldState() {
		try {
			const response = await fetch(`/api/scenes/${data.conversationId}/world`);
			if (!response.ok) return;
			const result = await response.json();
			worldState = result.worldState ?? null;
		} catch {
			// The panel is supplementary — a failure here shouldn't break the scene.
		}
	}

	/** Re-read the room: what everyone is wearing, where they are, how they seem. */
	async function generateWorldState() {
		if (worldStateLoading) return;
		worldStateLoading = true;
		error = null;
		try {
			const response = await fetch(`/api/scenes/${data.conversationId}/world`, {
				method: 'POST'
			});
			const result = await response.json();
			if (!response.ok) {
				error = result.error ?? 'Could not read the room';
				return;
			}
			worldState = result.worldState ?? null;
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			worldStateLoading = false;
		}
	}

	/**
	 * Look at something, narrate, or examine a character. The scene-action
	 * endpoint is already conversation-keyed, so scenes use it unchanged; the
	 * reply arrives over the socket as a narrator message.
	 */
	async function sceneAction(
		actionType: string,
		context?: { characterId?: number; characterName?: string; owner?: string; itemName?: string; itemDescription?: string }
	) {
		if (sending) return;
		sending = true;
		error = null;
		try {
			const itemContext =
				context?.itemName !== undefined
					? {
							owner: context.owner ?? '',
							itemName: context.itemName,
							itemDescription: context.itemDescription ?? ''
						}
					: undefined;

			const response = await fetch('/api/scene-action', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					actionType,
					conversationId: data.conversationId,
					characterId: context?.characterId ?? speakerId ?? undefined,
					itemContext
				})
			});

			if (!response.ok) {
				const result = await response.json().catch(() => ({}));
				error = result.error ?? 'That did not work';
				return;
			}

			await refresh();
			chatMessages?.scrollToBottom();
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			sending = false;
		}
	}

	/** Re-read the scene after a server-side change. */
	async function refresh() {
		const response = await fetch(`/api/scenes/${data.conversationId}`);
		if (!response.ok) return;
		const result = await response.json();
		messages = result.messages;
	}

	async function send(text: string) {
		if (sending || !text.trim()) return;
		sending = true;
		error = null;

		try {
			const response = await fetch(`/api/scenes/${data.conversationId}/send`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: text, speakerId })
			});

			const result = await response.json();

			if (!response.ok) {
				error = result.error ?? 'Failed to send';
				return;
			}

			messages = result.messages;
			chatMessages?.scrollToBottom();
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>{data.placeName} | Tenants</title>
</svelte:head>

<MainLayout user={data.user} currentPath="/house">
	<div class="h-full flex flex-col bg-[var(--bg-primary)]">
		<!-- Where and when: a scene is pinned to a room and a phase -->
		<div
			class="flex items-center justify-between gap-4 px-6 py-4 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] flex-wrap"
		>
			<div class="flex items-center gap-4 min-w-0">
				<!-- Back goes where you came from: screening for an interview, the
				     house for a room scene. -->
				<a
					href={isInterview ? '/house/tenants' : '/house'}
					aria-label={isInterview ? 'Back to screening' : 'Back to the house'}
					class="btn-secondary px-3 py-3 flex-shrink-0"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 19l-7-7 7-7"
						/>
					</svg>
				</a>
				<h1 class="text-xl font-semibold text-[var(--text-primary)] truncate">
					{data.placeName}
				</h1>
			</div>

			<div class="flex items-center gap-4">
				{#if isInterview}
					<!-- An interview is a conversation at the door, not a moment in a
					     room, so it doesn't go stale when the clock moves. -->
					<span class="text-sm text-[var(--text-muted)]">Interview</span>
				{:else if data.scene.day !== data.house.day || data.scene.phase !== data.house.phase}
					<!-- Time has moved on. The scene is still readable, but it is history
					     now — sending into it would be talking to a past moment. -->
					<span
						class="text-sm px-3 py-1.5 rounded-lg border border-[var(--border-secondary)] text-[var(--text-muted)]"
					>
						{weekdayLabel(data.scene.day)}, Day {data.scene.day}, {phaseLabel(data.scene.phase)} — past
					</span>
				{:else}
					<span class="text-sm text-[var(--text-muted)]">
						{weekdayLabel(data.house.day)}, Day {data.house.day}, {phaseLabel(data.house.phase)}
					</span>
				{/if}
			</div>
		</div>

		{#if participants.length > 1}
			<!-- Several people in the room: pick who you are addressing. -->
			<div
				class="flex items-center gap-2 px-6 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] flex-wrap"
			>
				<span class="text-xs uppercase tracking-wider text-[var(--text-muted)] mr-1">
					Talking to
				</span>
				{#each participants as person (person.id)}
					<button
						onclick={() => (speakerId = person.id)}
						class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition {activeSpeaker?.id ===
						person.id
							? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--text-primary)]'
							: 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--border-secondary)]'}"
					>
						{#if person.thumbnailData}
							<img
								src={person.thumbnailData}
								alt={person.name}
								class="w-5 h-5 rounded object-cover"
							/>
						{/if}
						{person.name}
					</button>
				{/each}
			</div>
		{/if}

		{#if error}
			<div class="mx-6 mt-4 p-3 rounded-lg border border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--error)] text-sm">
				{error}
			</div>
		{/if}

		<div class="flex-1 flex min-h-0">
			<!-- Chat column -->
			<div class="flex-1 flex flex-col min-h-0 p-4 gap-4">
				{#if participants.length === 0}
					<div class="flex-1 flex items-center justify-center">
						<div class="text-center max-w-sm">
							<p class="text-[var(--text-primary)] font-medium">Nobody is here</p>
							<p class="text-sm text-[var(--text-muted)] mt-2">
								The {data.placeName} is empty this phase. Come back later, or find someone
								elsewhere in the house.
							</p>
							<a href="/house" class="btn-primary-solid inline-block px-5 py-2.5 mt-5">
								Back to the house
							</a>
						</div>
					</div>
				{:else}
					<ChatMessages
						bind:this={chatMessages}
						{messages}
						loading={false}
						{isTyping}
						generating={false}
						charName={activeSpeaker?.name}
						userName={userName || data.user?.displayName}
						charAvatar={activeSpeaker?.thumbnailData || activeSpeaker?.imageData}
						{userAvatar}
						{chatLayout}
						{avatarStyle}
						{textCleanupEnabled}
						{autoWrapActions}
						{userBubbleColor}
						sceneCharacters={participants}
						onSwipe={swipe}
						onSaveEdit={saveEdit}
						onDelete={deleteFrom}
					/>

					<ChatInput
						bind:this={chatInput}
						disabled={sending}
						{impersonating}
						hasAssistantMessages={messages.some((m) => m.role === 'assistant')}
						sceneCharacters={participants}
						onSend={send}
						onImpersonate={impersonate}
						onRegenerate={regenerateLast}
						onSceneAction={(type, context) => sceneAction(type, context)}
					/>
				{/if}
			</div>

			<!-- Right: what the room and the people in it currently look like -->
			{#if worldSidebarEnabled && participants.length > 0}
				<ChatWorldPanel
					characterName={activeSpeaker?.name ?? 'Character'}
					{worldState}
					loading={worldStateLoading}
					onRegenerate={generateWorldState}
					onLookAtItem={(owner, itemName, itemDescription) =>
						sceneAction('look_item', { owner, itemName, itemDescription })}
				/>
			{/if}
		</div>
	</div>
</MainLayout>
