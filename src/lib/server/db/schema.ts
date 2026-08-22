import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').unique().notNull(),
	displayName: text('display_name').notNull(),
	passwordHash: text('password_hash').notNull(),
	bio: text('bio'),
	avatarData: text('avatar_data'), // Base64 image data (full size)
	avatarThumbnail: text('avatar_thumbnail'), // Base64 thumbnail for chat messages
	activePersonaId: integer('active_persona_id'), // Currently active persona (null = use user profile)
	chatLayout: text('chat_layout').notNull().default('bubbles'), // 'bubbles' (chat app style) or 'discord' (full-width rows)
	avatarStyle: text('avatar_style').notNull().default('circle'), // 'circle' or 'rounded' (rounded square)
	textCleanupEnabled: integer('text_cleanup_enabled', { mode: 'boolean' }).notNull().default(true), // Enable asterisk normalization and quote cleanup
	autoWrapActions: integer('auto_wrap_actions', { mode: 'boolean' }).notNull().default(false), // Auto-wrap plain text with asterisks (requires textCleanupEnabled)
	// Random narration settings
	randomNarrationEnabled: integer('random_narration_enabled', { mode: 'boolean' }).notNull().default(false),
	randomNarrationMinMessages: integer('random_narration_min_messages').notNull().default(3),
	randomNarrationMaxMessages: integer('random_narration_max_messages').notNull().default(8),
	// World sidebar
	worldSidebarEnabled: integer('world_sidebar_enabled', { mode: 'boolean' }).notNull().default(false),
	// Auto world state update settings
	autoWorldStateEnabled: integer('auto_world_state_enabled', { mode: 'boolean' }).notNull().default(false),
	autoWorldStateMinMessages: integer('auto_world_state_min_messages').notNull().default(5),
	autoWorldStateMaxMessages: integer('auto_world_state_max_messages').notNull().default(12),
	// How much of the prompt to spend recalling earlier scenes, as a PERCENT of
	// the chat LLM's context window. Budgeted rather than counted: summaries vary
	// wildly in length, so "the last N scenes" spends an unpredictable amount of
	// context. Expressed as a share so it scales with the model rather than
	// needing a retune every time the context window changes. 0 disables recall.
	sceneRecallPercent: integer('scene_recall_percent').notNull().default(15),
	// How far back the house events fed into scene context reach, in DAYS.
	// Measured in days rather than a fixed count so it scales with how eventful
	// the house is: a quiet week and a chaotic one both give "what happened
	// lately" rather than an arbitrary last-N that could span an hour or a month.
	// 0 disables event recall entirely.
	eventRecallDays: integer('event_recall_days').notNull().default(3),
	// How busy the house simulation is, as PERCENT chances. Stored as integers
	// rather than floats so the sliders and the DB agree exactly, and because a
	// percent is what the settings UI actually shows.
	//
	// `houseDriftPercent` — chance per tenant per day that something goes wrong
	// and they raise a gripe. `houseEventPercent` — chance per pair per phase of
	// an off-screen moment between housemates. 0 disables that system entirely.
	houseDriftPercent: integer('house_drift_percent').notNull().default(25),
	houseEventPercent: integer('house_event_percent').notNull().default(28),
	// Whether the House Director writes the off-screen moments rather than
	// drawing them from the static pools in `$lib/house/relations.ts`.
	//
	// Purely a flavour switch: the rolls above still decide WHICH pairs have a
	// moment and how many, so turning this on changes how an event reads, never
	// how often one happens or how the game plays. Off by default because it
	// spends tokens and adds latency to every phase advance.
	houseDirectorEnabled: integer('house_director_enabled', { mode: 'boolean' })
		.notNull()
		.default(false),
	// Who overhears a rumour: 'home' (only tenants the game placed in the house
	// that phase) or 'everyone' (the whole roster, however private the room).
	//
	// Read at render time rather than baked into the row, so flipping it changes
	// what already-stored rumours reach — which is what a settings toggle should
	// do. 'home' makes a bedroom genuinely more private than the kitchen.
	rumourAudience: text('rumour_audience').notNull().default('home'),
	// Whether the summariser is asked for a rumour at all. Off means no rumour
	// line in the prompt and none stored — the scene stays entirely private.
	rumoursEnabled: integer('rumours_enabled', { mode: 'boolean' }).notNull().default(true),
	// User message color customization
	userBubbleColor: text('user_bubble_color').notNull().default('#e0a458'),
	userTextColor: text('user_text_color').notNull().default('#ffffff'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const userPersonas = sqliteTable('user_personas', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description'), // Description/bio for this persona
	avatarData: text('avatar_data'), // Base64 image data for persona (full size)
	avatarThumbnail: text('avatar_thumbnail'), // Base64 thumbnail for chat messages
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const llmSettings = sqliteTable('llm_settings', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	provider: text('provider').notNull().default('openrouter'), // 'openrouter', 'featherless', etc.
	model: text('model').notNull().default('anthropic/claude-3.5-sonnet'),
	temperature: real('temperature').notNull().default(0.7),
	maxTokens: integer('max_tokens').notNull().default(500),
	topP: real('top_p').notNull().default(1.0),
	frequencyPenalty: real('frequency_penalty').notNull().default(0.0),
	presencePenalty: real('presence_penalty').notNull().default(0.0),
	contextWindow: integer('context_window').notNull().default(8000),
	reasoningEnabled: integer('reasoning_enabled', { mode: 'boolean' }).notNull().default(false),
	// Featherless-specific parameters
	topK: integer('top_k').notNull().default(-1), // -1 means disabled
	minP: real('min_p').notNull().default(0.0),
	repetitionPenalty: real('repetition_penalty').notNull().default(1.0)
});

export const gameMasterSettings = sqliteTable('decision_engine_settings', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	provider: text('provider').notNull().default('openrouter'),
	model: text('model').notNull().default('anthropic/claude-3.5-sonnet'),
	temperature: real('temperature').notNull().default(0.3),
	maxTokens: integer('max_tokens').notNull().default(200),
	topP: real('top_p').notNull().default(1.0),
	frequencyPenalty: real('frequency_penalty').notNull().default(0.0),
	presencePenalty: real('presence_penalty').notNull().default(0.0),
	contextWindow: integer('context_window').notNull().default(4000),
	reasoningEnabled: integer('reasoning_enabled', { mode: 'boolean' }).notNull().default(false),
	// Featherless-specific parameters
	topK: integer('top_k').notNull().default(-1),
	minP: real('min_p').notNull().default(0.0),
	repetitionPenalty: real('repetition_penalty').notNull().default(1.0)
});

export const contentLlmSettings = sqliteTable('content_llm_settings', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	provider: text('provider').notNull().default('openrouter'),
	model: text('model').notNull().default('anthropic/claude-3.5-sonnet'),
	temperature: real('temperature').notNull().default(0.8),
	maxTokens: integer('max_tokens').notNull().default(2000),
	topP: real('top_p').notNull().default(1.0),
	frequencyPenalty: real('frequency_penalty').notNull().default(0.0),
	presencePenalty: real('presence_penalty').notNull().default(0.0),
	contextWindow: integer('context_window').notNull().default(16000),
	reasoningEnabled: integer('reasoning_enabled', { mode: 'boolean' }).notNull().default(false),
	// Featherless-specific parameters
	topK: integer('top_k').notNull().default(-1),
	minP: real('min_p').notNull().default(0.0),
	repetitionPenalty: real('repetition_penalty').notNull().default(1.0)
});

export const imageLlmSettings = sqliteTable('image_llm_settings', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	provider: text('provider').notNull().default('openrouter'),
	model: text('model').notNull().default('openai/gpt-4o-mini'),
	temperature: real('temperature').notNull().default(1.0),
	maxTokens: integer('max_tokens').notNull().default(1000),
	topP: real('top_p').notNull().default(1.0),
	frequencyPenalty: real('frequency_penalty').notNull().default(0.0),
	presencePenalty: real('presence_penalty').notNull().default(0.0),
	contextWindow: integer('context_window').notNull().default(4000),
	reasoningEnabled: integer('reasoning_enabled', { mode: 'boolean' }).notNull().default(false),
	// Featherless-specific parameters
	topK: integer('top_k').notNull().default(-1),
	minP: real('min_p').notNull().default(0.0),
	repetitionPenalty: real('repetition_penalty').notNull().default(1.0)
});

export const sdSettings = sqliteTable('sd_settings', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	mainPrompt: text('main_prompt').notNull().default('masterpiece, best quality, amazing quality, 1girl, solo'),
	negativePrompt: text('negative_prompt').notNull().default('lowres, bad anatomy, bad hands, text, error, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, speech bubble, multiple views'),
	model: text('model').notNull().default(''),
	steps: integer('steps').notNull().default(30),
	cfgScale: real('cfg_scale').notNull().default(7.0),
	sampler: text('sampler').notNull().default('DPM++ 2M'),
	scheduler: text('scheduler').notNull().default('Karras'),
	width: integer('width').notNull().default(832),
	height: integer('height').notNull().default(1216),
	enableHr: integer('enable_hr', { mode: 'boolean' }).notNull().default(true),
	hrScale: real('hr_scale').notNull().default(1.5),
	hrUpscaler: text('hr_upscaler').notNull().default('Latent'),
	hrSteps: integer('hr_steps').notNull().default(15),
	hrCfg: real('hr_cfg').notNull().default(5.0),
	denoisingStrength: real('denoising_strength').notNull().default(0.7),
	enableAdetailer: integer('enable_adetailer', { mode: 'boolean' }).notNull().default(false),
	adetailerModel: text('adetailer_model').notNull().default('face_yolov8n.pt')
});

export const llmPresets = sqliteTable('llm_presets', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	provider: text('provider').notNull(),
	model: text('model').notNull(),
	temperature: real('temperature').notNull(),
	maxTokens: integer('max_tokens').notNull(),
	topP: real('top_p').notNull(),
	frequencyPenalty: real('frequency_penalty').notNull(),
	presencePenalty: real('presence_penalty').notNull(),
	contextWindow: integer('context_window').notNull(),
	reasoningEnabled: integer('reasoning_enabled', { mode: 'boolean' }).notNull().default(false),
	// Featherless-specific parameters
	topK: integer('top_k').notNull().default(-1),
	minP: real('min_p').notNull().default(0.0),
	repetitionPenalty: real('repetition_penalty').notNull().default(1.0),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const characters = sqliteTable('characters', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description'),
	tags: text('tags'), // JSON array of tags
	imageData: text('image_data'), // Base64 image data (full size)
	thumbnailData: text('thumbnail_data'), // Base64 thumbnail for sidebar
	cardData: text('card_data').notNull(), // Full character card JSON (can be edited)
	originalCardData: text('original_card_data'), // Original imported card JSON (never modified after import)
	// Image generation settings (per-character)
	imageTags: text('image_tags'), // Always included tags (hair color, eye color, body type)
	contextualTags: text('contextual_tags'), // AI chooses from these based on context
	mainPromptOverride: text('main_prompt_override'), // Override global main prompt
	negativePromptOverride: text('negative_prompt_override'), // Override global negative prompt
	postHistory: text('post_history'), // Character-specific post history text (appears after conversation history)
	// What this character does in their own room, and what they do when out,
	// per phase. JSON: { bedroom: { morning: string[], ... }, away: { ... } }.
	// Lives on the character because every character has a room and can leave,
	// in any house. Shared-space activities stay generic (see $lib/house/
	// activities.ts) since spaces are defined per house.
	activityPools: text('activity_pools'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const promptPresets = sqliteTable('prompt_presets', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	prompts: text('prompts').notNull(), // JSON object of all prompts: { chat: { system: "...", impersonate: "..." }, ... }
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const lorebooks = sqliteTable('lorebooks', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description'),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true), // Quick toggle on/off
	isGlobal: integer('is_global', { mode: 'boolean' }).notNull().default(false), // Apply to all chats
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const lorebookEntries = sqliteTable('lorebook_entries', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	lorebookId: integer('lorebook_id')
		.notNull()
		.references(() => lorebooks.id, { onDelete: 'cascade' }),
	name: text('name').notNull(), // Entry name/title for organization
	keywords: text('keywords').notNull(), // JSON array of trigger keywords
	content: text('content').notNull(), // The lore content to inject
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	caseSensitive: integer('case_sensitive', { mode: 'boolean' }).notNull().default(false),
	priority: integer('priority').notNull().default(0), // Higher = inserted first
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const characterLorebooks = sqliteTable('character_lorebooks', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	characterId: integer('character_id')
		.notNull()
		.references(() => characters.id, { onDelete: 'cascade' }),
	lorebookId: integer('lorebook_id')
		.notNull()
		.references(() => lorebooks.id, { onDelete: 'cascade' })
});

export const tagLibrary = sqliteTable('tag_library', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' })
		.unique(),
	content: text('content').notNull().default(''),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const conversations = sqliteTable('conversations', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	characterId: integer('character_id') // Legacy: kept for backwards compatibility, use sceneParticipants instead
		.references(() => characters.id, { onDelete: 'cascade' }),
	primaryCharacterId: integer('primary_character_id') // Optional "main" character for this scene
		.references(() => characters.id, { onDelete: 'set null' }),
	name: text('name'), // Branch name (null for main conversation)
	parentConversationId: integer('parent_conversation_id'), // ID of conversation this branched from
	branchPointMessageId: integer('branch_point_message_id'), // Message ID where branch was created
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true), // Currently active branch for this character
	worldInfo: text('world_info'), // JSON string storing world state (clothes, etc.)
	scenario: text('scenario'), // Custom scenario override (if different from character card)
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const messages = sqliteTable('messages', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	conversationId: integer('conversation_id')
		.references(() => conversations.id, { onDelete: 'cascade' }),
	role: text('role').notNull(), // 'user' | 'assistant' | 'narrator' | 'system'
	characterId: integer('character_id') // Which character sent this (null for narrator/user/system)
		.references(() => characters.id, { onDelete: 'set null' }),
	content: text('content').notNull(),
	swipes: text('swipes'), // JSON array of alternative content variants
	currentSwipe: integer('current_swipe').default(0), // Index of currently selected swipe
	senderName: text('sender_name'), // Display name at time of message (persona or user profile)
	senderAvatar: text('sender_avatar'), // Avatar data at time of message
	reasoning: text('reasoning'), // LLM reasoning/thinking content (if available)
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const sceneParticipants = sqliteTable('scene_participants', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	conversationId: integer('conversation_id')
		.notNull()
		.references(() => conversations.id, { onDelete: 'cascade' }),
	characterId: integer('character_id')
		.notNull()
		.references(() => characters.id, { onDelete: 'cascade' }),
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true), // Currently in scene
	joinedAt: integer('joined_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	leftAt: integer('left_at', { mode: 'timestamp' }) // When character left scene (null = still present)
});

// ─────────────────────────────────────────────────────────────
// House layer — see CLAUDE.md
//
// Bedrooms and shared spaces are deliberately SEPARATE tables, not one table
// with a `kind` flag. A bedroom is a lease slot: one tenant, generates rent,
// private. A shared space is a stage: zero-to-many people, owned by the house,
// costs money, and is where most of the game happens.
// ─────────────────────────────────────────────────────────────

export const houses = sqliteTable('houses', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	address: text('address'),
	description: text('description'),
	// Only one house per user is active at a time; the rest are paused saves.
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
	// Calendar. Phase is an index into HOUSE_PHASES (see $lib/house/phases.ts).
	day: integer('day').notNull().default(1),
	phase: integer('phase').notNull().default(0),
	balance: real('balance').notNull().default(5000),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const bedrooms = sqliteTable('bedrooms', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	houseId: integer('house_id')
		.notNull()
		.references(() => houses.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	sortOrder: integer('sort_order').notNull().default(0),
	baseRent: real('base_rent').notNull().default(800),
	quality: integer('quality').notNull().default(3), // 1-5, affects rent and satisfaction
	condition: integer('condition').notNull().default(100), // 0-100, degrades over time
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const sharedSpaces = sqliteTable('shared_spaces', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	houseId: integer('house_id')
		.notNull()
		.references(() => houses.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	kind: text('kind').notNull(), // 'kitchen' | 'lounge' | 'yard' | 'utility' | 'other'
	description: text('description'), // Used by the narrator when setting a scene here
	// What tenants do in this space. JSON string[] — no phase keying, since what
	// you do in a kitchen doesn't change much with the hour. Null falls back to
	// the generic lines for this space's `kind` (see $lib/house/activities.ts).
	// Lives on the space, not the character: the room belongs to the house.
	activityPool: text('activity_pool'),
	sortOrder: integer('sort_order').notNull().default(0),
	tier: integer('tier').notNull().default(1), // 1-3, upgradeable
	capacity: integer('capacity').notNull().default(4), // Soft cap on tenants present at once
	condition: integer('condition').notNull().default(100),
	unlocked: integer('unlocked', { mode: 'boolean' }).notNull().default(true),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/**
 * A character's tenancy in a bedroom.
 *
 * The whole character library is the casting pool — importing a card is all it
 * takes to make someone eligible. A character may hold at most one ACTIVE
 * tenancy per house (enforced in tenantService, since SQLite partial unique
 * indexes are awkward through drizzle-kit push).
 */
export const tenants = sqliteTable('tenants', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	houseId: integer('house_id')
		.notNull()
		.references(() => houses.id, { onDelete: 'cascade' }),
	characterId: integer('character_id')
		.notNull()
		.references(() => characters.id, { onDelete: 'cascade' }),
	bedroomId: integer('bedroom_id').references(() => bedrooms.id, { onDelete: 'set null' }),
	status: text('status').notNull().default('active'), // 'active' | 'moved_out'
	moveInDay: integer('move_in_day').notNull().default(1),
	leaseEndDay: integer('lease_end_day').notNull(), // Absolute day the lease expires
	moveOutDay: integer('move_out_day'), // Set when they actually leave
	rentAmount: real('rent_amount').notNull(),
	satisfaction: integer('satisfaction').notNull().default(70), // 0-100, drives renewal
	// Last day a scene with this tenant credited satisfaction. Talking twice in
	// one day shouldn't farm the meter, so the gain is once per day.
	lastTalkedDay: integer('last_talked_day'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/**
 * Someone knocking on the door for a vacant room.
 *
 * Drawn at random from the character library, excluding anyone already living
 * here. Rows are consumed on accept/reject, so this table stays small.
 */
export const applicants = sqliteTable('applicants', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	houseId: integer('house_id')
		.notNull()
		.references(() => houses.id, { onDelete: 'cascade' }),
	characterId: integer('character_id')
		.notNull()
		.references(() => characters.id, { onDelete: 'cascade' }),
	// Applicants apply for a SPECIFIC room, not the house in general: picking a
	// tenant is a per-vacancy decision, and the shortlist is regenerated per room
	// per day.
	bedroomId: integer('bedroom_id')
		.notNull()
		.references(() => bedrooms.id, { onDelete: 'cascade' }),
	pitch: text('pitch'), // Why they want the room. Director-written in Phase 6.
	askingRent: real('asking_rent').notNull(),
	requestedDays: integer('requested_days').notNull().default(30), // Lease length they want
	generatedOnDay: integer('generated_on_day').notNull().default(1),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/**
 * Where every tenant is, for every phase of every day.
 *
 * One row per tenant per phase. Written by the scheduler now, by the House
 * Director later — the interface is the same either way. Because it is an
 * append-only log rather than a mutable pointer, house history comes free:
 * "who was in the kitchen on day 12" is just a query.
 *
 * `placeKind` distinguishes the three things a tenant can be doing:
 *   'bedroom' — in their own room (private; reachable)
 *   'shared'  — in a shared space (public; where the game happens)
 *   'away'    — out of the house entirely (unreachable this phase)
 */
export const occupancy = sqliteTable('occupancy', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	houseId: integer('house_id')
		.notNull()
		.references(() => houses.id, { onDelete: 'cascade' }),
	tenantId: integer('tenant_id')
		.notNull()
		.references(() => tenants.id, { onDelete: 'cascade' }),
	day: integer('day').notNull(),
	phase: integer('phase').notNull(),
	placeKind: text('place_kind').notNull(), // 'bedroom' | 'shared' | 'away'
	bedroomId: integer('bedroom_id').references(() => bedrooms.id, { onDelete: 'cascade' }),
	sharedSpaceId: integer('shared_space_id').references(() => sharedSpaces.id, {
		onDelete: 'cascade'
	}),
	activity: text('activity'), // Short flavor line: "cooking", "on the phone"
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/**
 * A conversation pinned to a place and a moment in the house.
 *
 * Deliberately a join table rather than columns on `conversations`: the chat
 * engine predates the house layer and works on conversations that have no room
 * and no clock (library chats). Keeping the house keys out here means the chat
 * tables stay untouched and a scene is additive — delete every row and the chat
 * engine still works.
 *
 * The key is (houseId, day, phase, placeKind, placeId). Walking out of a room
 * and back in during the same phase resolves to the same conversation; the next
 * phase is a new scene, so history stays browsable by day.
 */
export const scenes = sqliteTable('scenes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	houseId: integer('house_id')
		.notNull()
		.references(() => houses.id, { onDelete: 'cascade' }),
	conversationId: integer('conversation_id')
		.notNull()
		.references(() => conversations.id, { onDelete: 'cascade' }),
	day: integer('day').notNull(),
	phase: integer('phase').notNull(),
	placeKind: text('place_kind').notNull(), // 'bedroom' | 'shared' | 'interview'
	bedroomId: integer('bedroom_id').references(() => bedrooms.id, { onDelete: 'cascade' }),
	sharedSpaceId: integer('shared_space_id').references(() => sharedSpaces.id, {
		onDelete: 'cascade'
	}),
	// Interviews are scenes with an applicant rather than a room: you meet
	// someone at the door before deciding whether to hand them a lease. Set only
	// when placeKind is 'interview'. Nulled if the applicant row goes away
	// (accepted or passed) so the transcript survives the decision it informed.
	applicantId: integer('applicant_id').references(() => applicants.id, { onDelete: 'set null' }),
	// Outings are scenes that happen away from the house: you take one tenant
	// somewhere you pick and do something you pick. Both are freeform text
	// rather than ids because they are invented per outing — there is no table
	// of cafes, and inventing one would mean authoring a world instead of just
	// naming a place. Set only when placeKind is 'outing'.
	outingPlace: text('outing_place'),
	outingActivity: text('outing_activity'),
	// Written once, when the phase advances and the scene can no longer change.
	// Null means either "nothing happened here" or "not summarised yet".
	summary: text('summary'),
	summarisedAt: integer('summarised_at', { mode: 'timestamp' }),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/**
 * An open thread between the player and a tenant — something asked for,
 * promised, or left hanging in a scene.
 *
 * These are not authored: the scene summariser already writes "her request was
 * left unresolved" in prose, so the same pass emits them as rows instead of
 * letting them evaporate into a paragraph. Later summaries in the same house
 * can close one, which is how the game learns you actually followed through.
 *
 * `kind` distinguishes who owes what: a `request` is the tenant wanting
 * something from the player; a `promise` is the player having committed to
 * something. Both matter, but only the second is the player's fault when it
 * lapses.
 */
export const threads = sqliteTable('threads', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	houseId: integer('house_id')
		.notNull()
		.references(() => houses.id, { onDelete: 'cascade' }),
	characterId: integer('character_id')
		.notNull()
		.references(() => characters.id, { onDelete: 'cascade' }),
	// The scene that raised it, for provenance.
	sceneId: integer('scene_id').references(() => scenes.id, { onDelete: 'set null' }),
	kind: text('kind').notNull(), // 'request' | 'promise'
	summary: text('summary').notNull(), // "fix the dishwasher"
	openedDay: integer('opened_day').notNull(),
	// Set when the player committed to a day ("Thursday"), so a missed deadline
	// is detectable rather than merely felt.
	dueDay: integer('due_day'),
	status: text('status').notNull().default('open'), // 'open' | 'resolved' | 'dropped'
	resolvedDay: integer('resolved_day'),
	// Set when a missed deadline has already cost satisfaction, so the penalty
	// is charged once rather than every day it stays overdue.
	penaltyChargedDay: integer('penalty_charged_day'),
	// How it ended, in the resolving scene's words.
	resolution: text('resolution'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/**
 * How two characters in a house feel about each other.
 *
 * Distinct from `tenants.satisfaction`, which is about the housing. This is
 * housemate-to-housemate, and it is what makes a full house feel like a
 * household rather than four people in adjacent boxes.
 *
 * Stored **unordered**: `characterAId` is always the lower id, so a pair has
 * exactly one row however it is looked up. Feelings here are mutual — the
 * asymmetric version (A likes B more than B likes A) would double the rows and
 * the writes for a nuance nothing reads yet.
 *
 * Keyed on characters rather than tenants so a relationship survives someone
 * moving out and back in: they remember each other.
 */
export const relations = sqliteTable('relations', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	houseId: integer('house_id')
		.notNull()
		.references(() => houses.id, { onDelete: 'cascade' }),
	characterAId: integer('character_a_id')
		.notNull()
		.references(() => characters.id, { onDelete: 'cascade' }),
	characterBId: integer('character_b_id')
		.notNull()
		.references(() => characters.id, { onDelete: 'cascade' }),
	// -100..100. Bands are derived (see $lib/house/relations.ts), not stored.
	score: integer('score').notNull().default(0),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/**
 * Something that happened in the house while the player wasn't watching.
 *
 * Append-only, like `occupancy`: the log IS the history, so "what happened on
 * day 12" is a query rather than a reconstruction. Rolled on phase advance.
 *
 * The rendered text is stored rather than the template plus ids, so the log
 * stays readable after a character is deleted or moves out — a line about
 * someone who no longer lives here is still a true thing that happened.
 */
export const houseEvents = sqliteTable('house_events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	houseId: integer('house_id')
		.notNull()
		.references(() => houses.id, { onDelete: 'cascade' }),
	day: integer('day').notNull(),
	phase: integer('phase').notNull(),
	kind: text('kind').notNull().default('relation'), // room for other event kinds later
	// Who was involved. Nulled rather than cascaded-away so the line survives.
	characterAId: integer('character_a_id').references(() => characters.id, {
		onDelete: 'set null'
	}),
	characterBId: integer('character_b_id').references(() => characters.id, {
		onDelete: 'set null'
	}),
	text: text('text').notNull(),
	/** How this moved the pair's relation, for display in the log. */
	delta: integer('delta').notNull().default(0),
	// Who was in the building when this happened, as a JSON array of character
	// ids. Only set for rumours: everything else in this table is common
	// knowledge and renders for everyone.
	//
	// Stored rather than derived because occupancy for a past phase can change
	// out from under us — a tenant who moves out has their rows deleted from
	// today forward — and a rumour's audience is fixed at the moment it was
	// overheard. Null means "everyone", which is what a rumour recorded before
	// this column existed has to fall back to.
	heardBy: text('heard_by'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export type House = typeof houses.$inferSelect;
export type Relation = typeof relations.$inferSelect;
export type HouseEvent = typeof houseEvents.$inferSelect;
export type NewHouse = typeof houses.$inferInsert;
export type Scene = typeof scenes.$inferSelect;
export type NewScene = typeof scenes.$inferInsert;
export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Occupancy = typeof occupancy.$inferSelect;
export type NewOccupancy = typeof occupancy.$inferInsert;
export type Bedroom = typeof bedrooms.$inferSelect;
export type NewBedroom = typeof bedrooms.$inferInsert;
export type SharedSpace = typeof sharedSpaces.$inferSelect;
export type NewSharedSpace = typeof sharedSpaces.$inferInsert;
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Applicant = typeof applicants.$inferSelect;
export type NewApplicant = typeof applicants.$inferInsert;

export type User = typeof users.$inferSelect;
export type SafeUser = Omit<User, 'passwordHash'>; // User without sensitive data
export type NewUser = typeof users.$inferInsert;
export type UserPersona = typeof userPersonas.$inferSelect;
export type NewUserPersona = typeof userPersonas.$inferInsert;
export type LlmSettings = typeof llmSettings.$inferSelect;
export type NewLlmSettings = typeof llmSettings.$inferInsert;
export type GameMasterSettings = typeof gameMasterSettings.$inferSelect;
export type NewGameMasterSettings = typeof gameMasterSettings.$inferInsert;
export type ContentLlmSettings = typeof contentLlmSettings.$inferSelect;
export type NewContentLlmSettings = typeof contentLlmSettings.$inferInsert;
export type ImageLlmSettings = typeof imageLlmSettings.$inferSelect;
export type NewImageLlmSettings = typeof imageLlmSettings.$inferInsert;
export type SdSettings = typeof sdSettings.$inferSelect;
export type NewSdSettings = typeof sdSettings.$inferInsert;
export type LlmPreset = typeof llmPresets.$inferSelect;
export type NewLlmPreset = typeof llmPresets.$inferInsert;
export type PromptPreset = typeof promptPresets.$inferSelect;
export type NewPromptPreset = typeof promptPresets.$inferInsert;
export type Lorebook = typeof lorebooks.$inferSelect;
export type NewLorebook = typeof lorebooks.$inferInsert;
export type LorebookEntry = typeof lorebookEntries.$inferSelect;
export type NewLorebookEntry = typeof lorebookEntries.$inferInsert;
export type CharacterLorebook = typeof characterLorebooks.$inferSelect;
export type NewCharacterLorebook = typeof characterLorebooks.$inferInsert;
export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;
export type TagLibrary = typeof tagLibrary.$inferSelect;
export type NewTagLibrary = typeof tagLibrary.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type SceneParticipant = typeof sceneParticipants.$inferSelect;
export type NewSceneParticipant = typeof sceneParticipants.$inferInsert;
