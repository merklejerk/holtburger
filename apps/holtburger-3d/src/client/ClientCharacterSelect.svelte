<script lang="ts">
	import { onMount } from "svelte";
	import ClientModelPreview from "./ClientModelPreview.svelte";
	import {
		ClientCharacterPreview,
		type CharacterPreviewState,
	} from "./client-character-preview";
	import type { ClientVisualCacheTransport } from "./client-visual-cache-transport";
	import type { ClientLifecycleUiState } from "./client-lifecycle-state";
	import ClientCharacterCreator from "./ClientCharacterCreator.svelte";
	import {
		characterManagementPending,
		type CharacterCreationServices,
	} from "./client-character-creation";
	import type { CharacterManagementState } from "./client-host-contract";
	import type { ClientObjectPreviewService } from "./client-object-preview-service";

	/** The authority-owned character roster and current frontend selection. */
	type CharacterSelectionState = Extract<
		ClientLifecycleUiState,
		{ readonly kind: "character-selection" }
	>;

	/** Selection remains separate from the explicit world-entry action. */
	interface Props {
		/** Current roster and selection. */
		readonly state: CharacterSelectionState;
		/** Blocks selection and duplicate activation while entry is being requested. */
		readonly entryPending: boolean;
		readonly management: CharacterManagementState;
		/** Null only on diagnostic surfaces that do not provide creation capabilities. */
		readonly creation: CharacterCreationServices | null;
		readonly previewService: ClientObjectPreviewService | null;
		/** Optional only on roster-only diagnostic surfaces. */
		readonly visualCache: ClientVisualCacheTransport | null;
		/** Publish selection without entering the world. */
		readonly onChoose: (guid: number) => void;
		/** Enter the currently selected character. */
		readonly onEnter: () => void | Promise<void>;
		/** Leave character selection and disconnect. */
		readonly onDisconnect: () => void | Promise<void>;
	}

	let {
		state: selection,
		entryPending,
		management,
		creation,
		previewService,
		visualCache,
		onChoose,
		onEnter,
		onDisconnect,
	}: Props = $props();
	let creating = $state(false);
	let previewState = $state.raw<CharacterPreviewState>({ kind: "none" });
	let previewOwner: ClientCharacterPreview | null = null;
	const selectedGuid = $derived(
		selection.characters.some((entry) => entry.guid === selection.selectedGuid)
			? selection.selectedGuid
			: null,
	);
	const previewGuid = $derived(
		!creating && !entryPending ? selectedGuid : null,
	);
	// Identity gating hides A synchronously with selecting B, before B's async read begins.
	const previewSource = $derived(
		previewState.kind === "ready" && previewState.guid === previewGuid
			? previewState.source
			: null,
	);
	const previewMessage = $derived(
		previewState.kind === "unavailable" && previewState.guid === previewGuid
			? "Saved appearance unavailable"
			: previewState.kind === "missing" && previewState.guid === previewGuid
				? "Enter this character to save an appearance preview."
				: previewGuid === null
					? "Select a character to preview."
					: "Loading saved appearance…",
	);
	onMount(() => {
		if (visualCache === null) return;
		const owner = new ClientCharacterPreview(
			visualCache,
			(state) => (previewState = state),
		);
		previewOwner = owner;
		owner.select(previewGuid);
		return () => {
			previewOwner = null;
			owner.destroy();
		};
	});
	$effect(() => {
		previewOwner?.select(previewGuid);
	});
	let creationBaseline: CharacterManagementState | null = null;
	const blocked = $derived(
		entryPending || characterManagementPending(management),
	);
	$effect(() => {
		if (
			creating &&
			management !== creationBaseline &&
			management.kind === "created" &&
			selection.characters.some(
				(character) => character.guid === management.guid,
			)
		) {
			creating = false;
			onChoose(management.guid);
		}
	});
	function focusCharacter(form: HTMLFormElement): void {
		const selected = form.querySelector<HTMLInputElement>(
			'input[name="character"]:checked',
		);
		const first = form.querySelector<HTMLInputElement>(
			'input[name="character"]',
		);
		(selected ?? first)?.focus({ preventScroll: true });
	}

	function handleSubmit(event: SubmitEvent): void {
		event.preventDefault();
		if (!blocked && selectedGuid !== null) void onEnter();
	}
</script>

{#if creating && creation !== null && previewService !== null}
	<ClientCharacterCreator
		services={creation}
		{previewService}
		{management}
		onCancel={() => (creating = false)}
	/>
	<button class="ui-button" type="button" onclick={() => void onDisconnect()}
		>Disconnect</button
	>
{:else}
	<h1>Choose a character</h1>
	<p class="client-status">
		Select a character, then explicitly enter the world.
	</p>

	<div class="character-selection-content">
		{#if visualCache !== null && previewService !== null}
			<div class="character-preview-column">
				<div class="character-preview-viewport">
					<ClientModelPreview
						source={previewSource}
						emptyMessage={previewMessage}
						service={previewService}
						rotation="subject"
						framing={{ kind: "body" }}
					/>
				</div>
				{#if previewSource !== null}<p class="client-status">
						Last observed appearance
					</p>{/if}
				{#if previewState.kind === "unavailable" && previewState.guid === previewGuid}<p
						class="ui-error"
						role="alert"
					>
						{previewState.message}
					</p>{/if}
			</div>
		{/if}
		<form use:focusCharacter onsubmit={handleSubmit}>
			<fieldset
				class="client-character-list"
				aria-label="Characters"
				disabled={blocked}
			>
				{#each selection.characters as character (character.guid)}
					<label class="client-character ui-option">
						<input
							type="radio"
							name="character"
							value={character.guid}
							checked={selection.selectedGuid === character.guid}
							onchange={() => onChoose(character.guid)}
						/>
						<strong>{character.name}</strong>
						<span>Slot {character.slot + 1}</span>
					</label>
				{/each}
			</fieldset>

			<div class="client-actions">
				<button
					type="submit"
					class="client-action ui-button"
					disabled={selectedGuid === null || blocked}
				>
					{entryPending ? "Entering…" : "Enter World"}
				</button>
				<button
					type="button"
					class="client-action ui-button"
					disabled={blocked ||
						selection.characters.length >= selection.maxSlots ||
						creation === null ||
						previewService === null}
					onclick={() => {
						creationBaseline = management;
						creating = true;
					}}>Create character</button
				>
				<button
					type="button"
					class="client-action ui-button"
					disabled={entryPending}
					onclick={() => void onDisconnect()}
				>
					Disconnect
				</button>
			</div>
		</form>
	</div>
	{#if management.kind === "uncertain"}<p class="ui-error" role="alert">
			{management.message}
		</p>{/if}
{/if}

<style>
	@layer components {
		.character-selection-content {
			display: flex;
			gap: 24px;
			align-items: start;
		}
		.character-selection-content > form {
			flex: 1;
			min-width: 260px;
		}
		.character-preview-column {
			width: min(36vw, 360px);
			display: grid;
			gap: 8px;
		}
		.character-preview-viewport {
			width: 100%;
			aspect-ratio: 3 / 4;
		}
		.client-status {
			margin: 0;
			color: var(--ui-color-muted);
			line-height: 1.45;
		}
		.client-character-list {
			display: grid;
			gap: 0;
			max-height: min(45vh, 360px);
			overflow-y: auto;
			padding: 6px;
			margin: 0;
			border: 0;
		}
		.client-character {
			display: grid;
			grid-template-columns: auto 1fr auto;
			align-items: baseline;
			gap: 14px;
			min-height: 32px;
			padding: 4px 8px;
			text-align: left;
			border-bottom: 1px solid
				var(--ui-option-border-color, var(--ui-color-border));
			cursor: pointer;
			user-select: none;
		}
		.client-character:has(input:checked) {
			background: var(--ui-option-background, var(--ui-color-control));
			border-color: var(--ui-option-border-color, var(--ui-color-accent));
		}
		.client-character:has(input:focus-visible) {
			outline: 2px solid var(--ui-color-accent);
			outline-offset: -2px;
		}
		.client-character-list:disabled .client-character {
			cursor: not-allowed;
		}
		.client-character span {
			color: var(--ui-color-muted);
		}
		.client-actions {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
		}
		.client-action {
			min-width: 120px;
		}
	}
</style>
