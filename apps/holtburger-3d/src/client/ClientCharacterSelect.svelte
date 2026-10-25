<script lang="ts">
	import ClientPregameScreen from "./ClientPregameScreen.svelte";
	import { onMount } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import SelectionMarker from "../assets/icons/pregame-selection.svg?component";
	import EnterWorldIcon from "../assets/icons/hud-teleport.svg?component";
	import CreateCharacterIcon from "../assets/icons/hud-invite.svg?component";
	import DisconnectIcon from "../assets/icons/pregame-disconnect.svg?component";
	import WarningIcon from "../assets/icons/pregame-warning.svg?component";
	import ClientModelPreview from "./ClientModelPreview.svelte";
	import {
		ClientCharacterPreview,
		type CharacterPreviewState,
	} from "./client-character-preview";
	import type { ClientVisualCacheTransport } from "./client-visual-cache-transport";
	import type { ClientAppPhase } from "./client-app-lifecycle";
	import ClientCharacterCreator from "./ClientCharacterCreator.svelte";
	import {
		characterManagementPending,
		type CharacterCreationServices,
	} from "./client-character-creation";
	import type { CharacterManagementState } from "./client-host-contract";
	import type { ClientObjectPreviewService } from "./client-object-preview-service";

	/** The authority-owned character roster and current frontend selection. */
	type CharacterSelectionState = Extract<
		ClientAppPhase,
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
	const { keyboard } = useAppInputPolicy();
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
		const selected = form.querySelector<HTMLButtonElement>(
			'button[name="character"][aria-pressed="true"]',
		);
		const first = form.querySelector<HTMLButtonElement>(
			'button[name="character"]',
		);
		(selected ?? first)?.focus({ preventScroll: true });
	}

	/** Arrow navigation selects a row; Enter/Space retain native button activation. */
	function navigateCharacters(event: KeyboardEvent): void {
		if (!(event.target instanceof HTMLButtonElement) || blocked) return;
		const focused = event.target;
		const options = Array.from(
			focused.form?.querySelectorAll<HTMLButtonElement>(
				'button[name="character"]:not(:disabled)',
			) ?? [],
		);
		const index = options.indexOf(focused);
		if (index === -1) return;
		let destination: number;
		switch (event.key) {
			case "ArrowUp":
				destination = (index + options.length - 1) % options.length;
				break;
			case "ArrowDown":
				destination = (index + 1) % options.length;
				break;
			case "Home":
				destination = 0;
				break;
			case "End":
				destination = options.length - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		const next = options[destination];
		next.focus();
		next.click();
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
		onBack={() => (creating = false)}
	/>
{:else}
	<ClientPregameScreen branding="corner" backdrop={true}>
		{#snippet footer()}
			<button
				type="button"
				class="pregame-action pregame-quiet ui-button"
				onclick={() => void onDisconnect()}
			>
				<span class="pregame-icon" aria-hidden="true"><DisconnectIcon /></span>
				Disconnect
			</button>
		{/snippet}
		<div class="character-selection-content">
			<form class="character-roster" use:focusCharacter onsubmit={handleSubmit}>
				<h1 class="sr-only">Characters</h1>
				<fieldset
					class="client-character-list"
					aria-label="Characters"
					disabled={blocked}
					use:keyboard.scope={{
						nativeControls: true,
						keydown: navigateCharacters,
					}}
				>
					{#each selection.characters as character, index (character.guid)}
						<button
							type="button"
							class="client-character ui-button ui-option"
							name="character"
							value={character.guid}
							aria-pressed={selectedGuid === character.guid}
							tabindex={selectedGuid === character.guid ||
							(selectedGuid === null && index === 0)
								? 0
								: -1}
							onclick={() => onChoose(character.guid)}
						>
							<span class="character-selection-marker"><SelectionMarker /></span
							>
							<strong>{character.name}</strong>
						</button>
					{:else}
						<p class="ui-muted">
							Your adventure starts here. Create your first character.
						</p>
					{/each}
				</fieldset>

				<div class="client-actions">
					<button
						type="submit"
						class="enter-world pregame-action ui-button"
						disabled={selectedGuid === null || blocked}
					>
						<span class="pregame-icon" aria-hidden="true"
							><EnterWorldIcon /></span
						>
						{entryPending ? "Entering…" : "Enter World"}
					</button>
					<button
						type="button"
						class="pregame-action ui-button"
						disabled={blocked ||
							selection.characters.length >= selection.maxSlots ||
							creation === null ||
							previewService === null}
						onclick={() => {
							creationBaseline = management;
							creating = true;
						}}
					>
						<span class="pregame-icon" aria-hidden="true"
							><CreateCharacterIcon /></span
						>
						Create character</button
					>
				</div>
				{#if management.kind === "uncertain"}<p class="ui-error" role="alert">
						<span class="pregame-icon" aria-hidden="true"><WarningIcon /></span>
						{management.message}
					</p>{/if}
			</form>
			{#if visualCache !== null && previewService !== null}
				<div class="character-preview-column">
					<div class="character-preview-viewport">
						<ClientModelPreview
							source={previewSource}
							emptyMessage={previewMessage}
							service={previewService}
							rotation="subject"
							keyboardNavigation={false}
							framing={{ kind: "body" }}
						/>
					</div>
					{#if previewState.kind === "unavailable" && previewState.guid === previewGuid}<p
							class="ui-error"
							role="alert"
						>
							{previewState.message}
						</p>{/if}
				</div>
			{/if}
		</div>
	</ClientPregameScreen>
{/if}

<style>
	@layer components {
		.character-selection-content {
			/* Keep the roster's backdrop behind this page's controls and preview. */
			isolation: isolate;
			display: grid;
			grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr);
			gap: 32px clamp(24px, 5vw, 80px);
			min-width: 0;
			min-height: 0;
		}
		.character-roster {
			position: relative;
			display: grid;
			align-content: center;
			gap: 24px;
			min-width: 0;
		}
		.character-roster::before {
			/* Anchor the fade to the actual roster edge; the screen clips the overscan. */
			--roster-backdrop-fade: 160px;
			content: "";
			position: absolute;
			inset: -100vh calc(-1 * var(--roster-backdrop-fade)) -100vh -100vw;
			z-index: -1;
			pointer-events: none;
		}
		.character-preview-column {
			grid-column: 2;
			grid-row: 1;
			display: grid;
			grid-template-rows: minmax(0, 1fr) auto;
			min-width: 0;
			gap: 8px;
			min-height: 0;
		}
		.character-preview-viewport {
			min-width: 0;
			min-height: 0;
		}
		.client-character-list {
			display: grid;
			gap: 4px;
			max-height: 40vh;
			overflow-y: auto;
			padding: 4px;
			margin: 0;
			border: 0;
		}
		.client-character {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			align-items: center;
			gap: 14px;
			text-align: left;
			cursor: pointer;
			user-select: none;
		}
		.client-character strong {
			overflow-wrap: anywhere;
		}
		.character-selection-marker {
			display: grid;
			place-items: center;
		}
		.client-character-list:disabled .client-character {
			cursor: not-allowed;
		}
		.client-actions {
			display: grid;
			gap: 12px;
		}
		@media (max-width: 640px) {
			.character-roster::before {
				/* Stacked controls shade their own rows rather than the preview below. */
				inset: -24px -100vw;
			}
			.character-selection-content {
				grid-template-columns: minmax(0, 1fr);
				grid-template-rows: auto auto;
				overflow: clip;
			}
			.character-preview-column {
				grid-column: 1;
				grid-row: 2;
			}
			.character-preview-viewport {
				height: 50vh;
			}
		}
	}
</style>
