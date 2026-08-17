# Tenants

A management sim. You own a house, tenants arrive and leave
on leases, and the game is about living alongside a rotating cast of characters.

Screen applicants, interview them at the door, decide who gets the spare room
then live with the consequences. Tenants have their own routines, form opinions
about each other while you aren't looking, remember your conversations, and hold
you to what you promised.

Derived from my AI chat template: https://github.com/ForgottenHistory/AI-Chat-Template

Similar RP app for a digital dating experience: https://github.com/ForgottenHistory/Cupid-AI

## Why

This project is meant to capture that slice of life or romcom type energy. Drama unfolds from simple events, long held grudges or relationships, promises kept or broken. It's not deadly serious but it's not low stakes either. Characters comment about the house, you and others in a natural way.

Characters just live and go about their day. The isolated nature of a house environment means you'll hear and see things yet some of it is off screen. You can ask around and build a simple story relatively easily. I think this nicely captures a middle between full roleplay and purely chatting.

## Main Features

- **A Living House** - Characters lease a room, move about and have complaints
- **Natural relationships** - Tenants bond and form friendships & enemies over time
- **Satisfication System** - How a tenant feels about living here. Naturally finds complaints and become mad if ignored
- **Summaries & Promises** - Summaries are generated from talks, with explicit questions and promises remembered as important information
- **Common knowledge** - The house layout, housemate personalities and recent events are known to everyone living there.
- **Personal memories** - Recall, routines and open threads are scoped to the people actually in the room

### World State Tracking

- **Dynamic State** - Tracks mood, position, clothes, and other attributes for characters and user
- **Auto-Generation** - Optionally regenerate world state periodically or on demand
- **Configurable Attributes** - Define what to track via `data/config/world_attributes.json`

### Character System

- **Character Cards** - Import V1/V2 character card formats
- **Character Profile** - View and edit all character metadata with AI-powered rewrite functionality
- **Activity Pools** - What a character does in their own room and while out, per phase. Shared spaces carry their own activity lists instead, since the room belongs to the house. Both can be written with AI
- **Per-Character Image Settings** - Customize image generation per character:
  - Always-included tags (appearance)
  - Contextual tags (AI chooses based on conversation)
  - Prompt overrides

### Chat Features

- **Conversation Management** - Multiple conversations per character with full message history
- **Swipes** - Generate alternative responses and swipe between them
- **Impersonate** - Generate responses as the user character
- **Reasoning Display** - View LLM reasoning/thinking when available
- **QoL Buttons** - Quick copy, regenerate, and other convenience features

### Layout & Appearance

- **Chat Layouts** - Choose between bubble style (chat app) or Discord style (full-width rows)
- **Avatar Styles** - Circle or rounded square avatars
- **Dark Theme** - Consistent dark UI throughout

### Multi-LLM Architecture

Separate LLM configurations for different purposes:

| LLM Type | Purpose |
|----------|---------|
| **Chat** | Main conversation engine |
| **Content** | Scene summaries, threads, character metadata, world state |
| **Image** | Generates Danbooru-style tags for image generation |

### LLM Configuration

- **LLM Presets** - Save and load LLM configurations
- **Model Pools** - Select several models for an engine and one is drawn at random per request, useful for varying prose voice across a long roleplay
- **Reasoning Support** - Enable extended thinking for supported models
- **Provider Support** - OpenRouter, NanoGPT and Featherless AI providers
- **Per-Engine Settings** - Temperature, max tokens, context window, etc.

### Image Generation

- **Stable Diffusion Integration** - Generate character images via local SD WebUI API
- **Global Tag Library** - Define tags available for AI to choose from
- **ADetailer Support** - Optional face enhancement

### Other Features

- **File-Based Prompts** - Edit system prompts through the UI or directly in `data/prompts/`
- **Logging** - View last 5 prompts/responses per LLM type for debugging
- **Multiple Houses** - Switch the active house from any page, one is active at a time

## Tech Stack

- **Framework**: SvelteKit 2 with Svelte 5
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4, dark theme
- **Database**: SQLite with Drizzle ORM
- **Real-time**: Socket.IO
- **LLM Providers**: OpenRouter, Featherless, NanoGPT
- **Image Generation**: Stable Diffusion WebUI API
- **Image Processing**: Sharp

## Setup

`run.bat` does this automatically on Windows.

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and add your API keys:
   ```
   OPENROUTER_API_KEY=sk-or-v1-...
   FEATHERLESS_API_KEY=...        # optional
   SD_SERVER_URL=http://127.0.0.1:7860  # optional, for image generation
   ```
4. Initialize the database:
   ```bash
   npm run db:push
   ```
5. Start the dev server:
   ```bash
   npm run dev
   ```

As for LLMs, personally I use NanoGPT with a mix of Kimi-K2 and GLM-4.7

## Commands

```bash
npm run dev        # Start dev server
npm run build      # Production build
npm run check      # Type check
npm run db:push    # Push schema to database
npm run db:studio  # Open Drizzle Studio
```

## Inspirations

SillyTavern: https://github.com/SillyTavern/SillyTavern

Talemate: https://github.com/vegu-ai/talemate

## License

MIT
