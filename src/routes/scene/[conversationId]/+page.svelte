<script lang="ts">
	import type { PageData } from './$types';
	import { onMount, onDestroy, tick } from 'svelte';
	import MainLayout from '$lib/components/MainLayout.svelte';
	import ChatMessages from '$lib/components/chat/ChatMessages.svelte';
	import ChatInput from '$lib/components/chat/ChatInput.svelte';
	import ChatWorldPanel from '$lib/components/chat/ChatWorldPanel.svelte';
	import ImageGenerateModal from '$lib/components/chat/ImageGenerateModal.svelte';
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

	// Random narration and auto world-state updates. Both were built for the
	// library chat and never wired into scenes, so the settings appeared to do
	// nothing here. Same counter-and-threshold model as `chatState.svelte.ts`:
	// count messages, fire on a random count within the configured range, then
	// pick a new threshold so it doesn't settle into a rhythm.
	let randomNarrationEnabled = $state(false);
	let randomNarrationMinMessages = $state(3);
	let randomNarrationMaxMessages = $state(8);
	let messagesSinceLastNarration = $state(0);
	let nextNarrationThreshold = $state(0);
	let randomNarrationPending = $state(false);

	let autoWorldStateEnabled = $state(false);
	let autoWorldStateMinMessages = $state(5);
	let autoWorldStateMaxMessages = $state(12);
	let messagesSinceLastWorldUpdate = $state(0);
	let nextWorldUpdateThreshold = $state(0);
	let worldUpdatePending = $state(false);

	function pickNextNarrationThreshold() {
		return (
			Math.floor(Math.random() * (randomNarrationMaxMessages - randomNarrationMinMessages + 1)) +
			randomNarrationMinMessages
		);
	}

	function pickNextWorldUpdateThreshold() {
		return (
			Math.floor(Math.random() * (autoWorldStateMaxMessages - autoWorldStateMinMessages + 1)) +
			autoWorldStateMinMessages
		);
	}

	let messages = $state<Message[]>(data.messages as Message[]);
	let sending = $state(false);
	let isTyping = $state(false);
	let error = $state<string | null>(null);

	// Who replies is decided server-side: the first character you name in the
	// message, or a random one present if you name nobody. Scene actions still
	// target a specific character by passing an explicit id.
	let speakerId = $state<number | null>(null);
	// Set while waiting on a character prompted from the room row.
	let promptingId = $state<number | null>(null);

	// Image generation. Two steps, same as the library chat: the Image LLM writes
	// Danbooru tags, you review/edit them in the modal, then Stable Diffusion
	// renders. Both endpoints are conversation-keyed rather than character-keyed,
	// since a scene is never the character's "active" conversation.
	let showImageModal = $state(false);
	let imageModalLoading = $state(false);
	let imageModalTags = $state('');
	let imageModalType = $state<'character' | 'user' | 'scene' | 'raw'>('scene');
	let generatingImage = $state(false);
	let generatingSD = $state(false);

	async function fetchImageTags(type: 'character' | 'user' | 'scene' | 'raw') {
		const response = await fetch(`/api/scenes/${data.conversationId}/generate-image`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			// Whoever is answering is who the image is of. In a shared room that
			// is the character you last addressed.
			body: JSON.stringify({ type, characterId: activeSpeaker?.id })
		});
		if (!response.ok) {
			const result = await response.json().catch(() => ({}));
			error = result.error ?? 'Failed to write image tags';
			return null;
		}
		const result = await response.json();
		return result.tags as string;
	}

	async function generateImage(type: 'character' | 'user' | 'scene' | 'raw') {
		if (generatingImage) return;

		imageModalType = type;
		imageModalTags = '';
		showImageModal = true;
		error = null;

		// "Raw" is you writing the prompt yourself — no LLM pass.
		if (type === 'raw') {
			imageModalLoading = false;
			return;
		}

		imageModalLoading = true;
		generatingImage = true;
		try {
			const tags = await fetchImageTags(type);
			if (tags) {
				imageModalTags = tags;
			} else {
				showImageModal = false;
			}
		} finally {
			imageModalLoading = false;
			generatingImage = false;
		}
	}

	async function handleImageGenerate(tags: string) {
		if (generatingSD) return;
		generatingSD = true;
		error = null;

		try {
			const response = await fetch(`/api/scenes/${data.conversationId}/generate-sd`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tags, characterId: activeSpeaker?.id })
			});

			if (!response.ok) {
				const result = await response.json().catch(() => ({}));
				error = result.error ?? 'Failed to generate image';
				return;
			}

			showImageModal = false;
			imageModalTags = '';
			await refresh();
			await scrollAfterRender();
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			generatingSD = false;
		}
	}

	async function handleImageRegenerate() {
		imageModalTags = '';
		imageModalLoading = true;
		try {
			const tags = await fetchImageTags(imageModalType);
			if (tags) imageModalTags = tags;
		} finally {
			imageModalLoading = false;
		}
	}

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
			randomNarrationEnabled = result.randomNarrationEnabled ?? false;
			randomNarrationMinMessages = result.randomNarrationMinMessages ?? 3;
			randomNarrationMaxMessages = result.randomNarrationMaxMessages ?? 8;
			autoWorldStateEnabled = result.autoWorldStateEnabled ?? false;
			autoWorldStateMinMessages = result.autoWorldStateMinMessages ?? 5;
			autoWorldStateMaxMessages = result.autoWorldStateMaxMessages ?? 12;

			// Seed the first thresholds once settings are known — they are picked
			// from the configured range, which isn't available before this returns.
			if (randomNarrationEnabled && nextNarrationThreshold === 0) {
				nextNarrationThreshold = pickNextNarrationThreshold();
			}
			if (autoWorldStateEnabled && nextWorldUpdateThreshold === 0) {
				nextWorldUpdateThreshold = pickNextWorldUpdateThreshold();
			}
		} catch {
			// Defaults are fine — the scene still works.
		}
	}

	/**
	 * A spontaneous look or narration beat, so a scene doesn't sit completely
	 * still between the player's messages.
	 */
	async function triggerRandomNarration() {
		if (randomNarrationPending || sending) return;
		randomNarrationPending = true;
		try {
			const actionTypes = ['look_character', 'look_scene', 'narrate'];
			let pick = actionTypes[Math.floor(Math.random() * actionTypes.length)];

			// look_character needs someone to look at. With nobody resolvable the
			// action would be meaningless, so fall back to the room instead.
			let context: { characterId: number; characterName: string } | undefined;
			if (pick === 'look_character') {
				if (activeSpeaker) {
					context = { characterId: activeSpeaker.id, characterName: activeSpeaker.name };
				} else {
					pick = 'look_scene';
				}
			}

			await sceneAction(pick, context);
		} catch (err) {
			console.error('Failed to trigger random narration:', err);
		} finally {
			randomNarrationPending = false;
		}
	}

	async function triggerWorldStateUpdate() {
		if (worldUpdatePending || worldStateLoading) return;
		worldUpdatePending = true;
		try {
			await generateWorldState();
		} catch (err) {
			console.error('Failed to trigger world state update:', err);
		} finally {
			worldUpdatePending = false;
		}
	}

	onMount(() => {
		initSocket();
		joinConversation(data.conversationId);

		// Walk into a scene at the newest message, not the oldest. Resuming a room
		// you have been talking in for a while otherwise opens at the top, showing
		// the narrator intro rather than where the conversation actually is.
		scrollAfterRender();

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
			scrollAfterRender();

			// Count toward a random narration beat. Only real turns count —
			// narrator output would otherwise trigger more narration.
			if (randomNarrationEnabled && (message.role === 'user' || message.role === 'assistant')) {
				messagesSinceLastNarration++;
				// Fire only after a character has spoken, so the beat lands between
				// exchanges rather than interrupting the player's turn.
				if (messagesSinceLastNarration >= nextNarrationThreshold && message.role === 'assistant') {
					messagesSinceLastNarration = 0;
					nextNarrationThreshold = pickNextNarrationThreshold();
					// Let the message render before the beat lands on top of it.
					setTimeout(() => triggerRandomNarration(), 500);
				}
			}

			// Keep the world panel current. Gated on the panel being on, since
			// regenerating state nobody can see is a wasted Content LLM call.
			if (autoWorldStateEnabled && worldSidebarEnabled) {
				if (message.role === 'narrator') {
					setTimeout(() => triggerWorldStateUpdate(), 500);
				} else if (message.role === 'user' || message.role === 'assistant') {
					messagesSinceLastWorldUpdate++;
					if (
						messagesSinceLastWorldUpdate >= nextWorldUpdateThreshold &&
						message.role === 'assistant'
					) {
						messagesSinceLastWorldUpdate = 0;
						nextWorldUpdateThreshold = pickNextWorldUpdateThreshold();
						setTimeout(() => triggerWorldStateUpdate(), 500);
					}
				}
			}
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
			await scrollAfterRender();
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			sending = false;
		}
	}

	/**
	 * Scroll after Svelte has rendered the new messages.
	 *
	 * `scrollToBottom` reads `scrollHeight`, so calling it in the same tick as the
	 * `messages` assignment measures the OLD height and lands short — the new
	 * message stays below the fold. `tick()` waits for the DOM update exactly,
	 * rather than guessing with a timeout.
	 */
	async function scrollAfterRender() {
		await tick();
		chatMessages?.scrollToBottom();
	}

	/** Re-read the scene after a server-side change. */
	async function refresh() {
		const response = await fetch(`/api/scenes/${data.conversationId}`);
		if (!response.ok) return;
		const result = await response.json();
		messages = result.messages;
	}

	/**
	 * Nudge one character to speak, without the player saying anything.
	 *
	 * Clicking someone in the room row is "your turn" — useful when two people
	 * are present and you want to hear from the quiet one, or to let them react
	 * to what was just said. No user message is written, so the transcript stays
	 * a record of what was actually said.
	 */
	async function promptCharacter(characterId: number) {
		if (sending) return;
		sending = true;
		promptingId = characterId;
		error = null;

		try {
			const response = await fetch(`/api/scenes/${data.conversationId}/send`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ speakerId: characterId })
			});

			const result = await response.json();

			if (!response.ok) {
				error = result.error ?? 'Failed to get a reply';
				return;
			}

			messages = result.messages;
			await scrollAfterRender();
		} catch {
			error = 'Network error. Please try again.';
		} finally {
			sending = false;
			promptingId = null;
		}
	}

	async function send(text: string) {
		if (sending || !text.trim()) return;
		sending = true;
		error = null;

		try {
			const response = await fetch(`/api/scenes/${data.conversationId}/send`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				// No speakerId: the server picks who replies — the first character
				// named in the message, or a random one present.
				body: JSON.stringify({ message: text })
			});

			const result = await response.json();

			if (!response.ok) {
				error = result.error ?? 'Failed to send';
				return;
			}

			messages = result.messages;
			await scrollAfterRender();
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

		{#if participants.length > 0 && !isInterview}
			<!-- Who is here, and a way to hand any of them the turn. Not a picker:
			     a normal message goes to whoever you name (or a random one), and
			     clicking a face just asks that person to speak. Shown even with one
			     person, since "say something" is useful on its own. -->
			<div
				class="flex items-center gap-2 px-6 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] flex-wrap"
			>
				<span class="text-xs uppercase tracking-wider text-[var(--text-muted)] mr-1">
					In the room
				</span>
				{#each participants as person (person.id)}
					<button
						type="button"
						onclick={() => promptCharacter(person.id)}
						disabled={sending}
						title="Let {person.name} say something"
						class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition disabled:opacity-40 disabled:cursor-not-allowed {promptingId ===
						person.id
							? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--text-primary)]'
							: 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]'}"
					>
						{#if person.thumbnailData}
							<img
								src={person.thumbnailData}
								alt={person.name}
								class="w-5 h-5 rounded object-cover"
							/>
						{/if}
						{person.name}
						{#if promptingId === person.id}
							<div
								class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"
							></div>
						{/if}
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
						knownCharacters={data.knownCharacters}
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
						{generatingImage}
						onSend={send}
						onImpersonate={impersonate}
						onRegenerate={regenerateLast}
						onGenerateImage={generateImage}
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

<ImageGenerateModal
	bind:show={showImageModal}
	loading={imageModalLoading}
	generating={generatingSD}
	tags={imageModalTags}
	type={imageModalType}
	onGenerate={handleImageGenerate}
	onRegenerate={handleImageRegenerate}
	onCancel={() => (imageModalTags = '')}
/>
