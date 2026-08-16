<script lang="ts">
	import type { Character } from '$lib/server/db/schema';
	import CollapsibleSection from '../CollapsibleSection.svelte';
	import EditableTextField from '../EditableTextField.svelte';
	import { estimateTokens } from '$lib/utils/tokenCount';

	interface Props {
		character: Character;
		data: {
			description?: string;
			scenario?: string;
			personality?: string;
			creator_notes?: string;
			creator?: string;
			character_version?: string;
		};
		originalData?: {
			description?: string;
			scenario?: string;
			personality?: string;
			creator_notes?: string;
			creator?: string;
			character_version?: string;
		} | null;
		onSave: (field: string, value: string) => Promise<void>;
	}

	let { character, data, originalData, onSave }: Props = $props();

	// Section expansion states
	let personalityExpanded = $state(false);
	let creatorNotesExpanded = $state(false);
	let metadataExpanded = $state(false);

	// Rewrite states
	let rewritingDescription = $state(false);
	let generatingPersonality = $state(false);
	let generateError = $state<string | null>(null);

	// References to editable fields for setting values after rewrite
	let descriptionField: EditableTextField;
	let personalityField: EditableTextField;

	async function rewriteField(field: 'description', currentValue: string): Promise<string | null> {
		if (!currentValue.trim()) return null;

		try {
			const response = await fetch('/api/content/rewrite', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: field, input: currentValue })
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Rewrite failed');
			}

			const { rewritten } = await response.json();
			return rewritten;
		} catch (err: any) {
			console.error(`Failed to rewrite ${field}:`, err);
			alert(`Failed to rewrite: ${err.message}`);
			return null;
		}
	}

	async function handleRewriteDescription() {
		const currentValue = character.description || data.description || '';
		if (!currentValue.trim()) return;

		rewritingDescription = true;
		try {
			const rewritten = await rewriteField('description', currentValue);
			if (rewritten) {
				descriptionField?.setEditValue(rewritten);
			}
		} finally {
			rewritingDescription = false;
		}
	}

	// Built from the Description rather than the current value, so it works on a
	// card that has no personality at all — which is the usual state of an
	// imported card, and what the house layer needs filled in.
	async function handleGeneratePersonality() {
		generatingPersonality = true;
		generateError = null;
		try {
			const response = await fetch(`/api/characters/${character.id}/personality`, {
				method: 'POST'
			});
			const result = await response.json();
			if (!response.ok) {
				generateError = result.error || 'Failed to generate personality';
				return;
			}
			personalityField?.setEditValue(result.personality);
			personalityExpanded = true;
		} catch {
			generateError = 'Network error. Please try again.';
		} finally {
			generatingPersonality = false;
		}
	}

	// Computed values
	let descriptionValue = $derived(character.description || data.description || '');
	let personalityValue = $derived(data.personality || '');
	let creatorNotesValue = $derived(data.creator_notes || '');
	let creatorValue = $derived(data.creator || '');
	let versionValue = $derived(data.character_version || '');

	// Original values for reset functionality
	let originalDescription = $derived(originalData?.description);
	let originalPersonality = $derived(originalData?.personality);
	let originalCreatorNotes = $derived(originalData?.creator_notes);
	let originalCreator = $derived(originalData?.creator);
	let originalVersion = $derived(originalData?.character_version);
</script>

<div class="space-y-4">
	<h3 class="text-xl font-semibold text-[var(--text-primary)] mb-4">Character Overview</h3>

	<!-- Description -->
	<EditableTextField
		bind:this={descriptionField}
		label="Description"
		value={descriptionValue}
		originalValue={originalDescription}
		showTokenCount={true}
		showRewrite={true}
		rewriting={rewritingDescription}
		onSave={(value) => onSave('description', value)}
		onRewrite={handleRewriteDescription}
	/>

	<!-- Collapsible: Personality -->
	<CollapsibleSection
		title="Personality"
		badge="~{estimateTokens(personalityValue).toLocaleString()} tokens"
		expanded={personalityExpanded}
		onToggle={() => (personalityExpanded = !personalityExpanded)}
	>
		{#if generateError}
			<p class="text-sm text-[var(--error)] mb-2">{generateError}</p>
		{/if}
		<EditableTextField
			bind:this={personalityField}
			label="Personality"
			value={personalityValue}
			originalValue={originalPersonality}
			rows={6}
			showTokenCount={false}
			showGenerate={true}
			generating={generatingPersonality}
			generateTitle="Generate from Description"
			onSave={(value) => onSave('personality', value)}
			onGenerate={handleGeneratePersonality}
		/>
	</CollapsibleSection>

	<!-- Collapsible: Creator Notes -->
	<CollapsibleSection
		title="Creator Notes"
		expanded={creatorNotesExpanded}
		onToggle={() => (creatorNotesExpanded = !creatorNotesExpanded)}
	>
		<EditableTextField
			label="Creator Notes"
			value={creatorNotesValue}
			originalValue={originalCreatorNotes}
			rows={6}
			onSave={(value) => onSave('creator_notes', value)}
		/>
	</CollapsibleSection>

	<!-- Collapsible: Metadata -->
	<CollapsibleSection
		title="Metadata"
		expanded={metadataExpanded}
		onToggle={() => (metadataExpanded = !metadataExpanded)}
	>
		<div class="space-y-4">
			<EditableTextField
				label="Creator"
				value={creatorValue}
				originalValue={originalCreator}
				inputType="input"
				onSave={(value) => onSave('creator', value)}
			/>
			<EditableTextField
				label="Version"
				value={versionValue}
				originalValue={originalVersion}
				inputType="input"
				onSave={(value) => onSave('character_version', value)}
			/>
		</div>
	</CollapsibleSection>
</div>
