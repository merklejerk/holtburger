<script lang="ts">
	import UiDialog from "../app/UiDialog.svelte";
	import DeleteIcon from "../assets/icons/character-delete.svg?component";
	import RestoreIcon from "../assets/icons/character-restore.svg?component";
	import {
		characterManagementPending,
		characterConfirmationName,
		characterDeletionNameMatches,
		type CharacterSelectionActions,
	} from "./client-character-selection";
	import ClientPregameScreen from "./ClientPregameScreen.svelte";
	import { onMount } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import SelectionMarker from "../assets/icons/pregame-selection.svg?component";
	import EnterWorldIcon from "../assets/icons/hud-teleport.svg?component";
	import CreateCharacterIcon from "../assets/icons/hud-invite.svg?component";
	import DisconnectIcon from "../assets/icons/pregame-disconnect.svg?component";
	import WarningIcon from "../assets/icons/pregame-warning.svg?component";
	import ClientPregameCharacter from "./ClientPregameCharacter.svelte";
	import {
		ClientCharacterPreview,
		type CharacterPreviewState,
	} from "./client-character-preview";
	import type { ClientVisualCacheTransport } from "./client-visual-cache-transport";
	import type { ClientAppPhase } from "./client-app-lifecycle";
	import ClientCharacterCreator from "./ClientCharacterCreator.svelte";
	import { type CharacterCreationServices } from "./client-character-creation";
	import type { CharacterManagementState } from "./client-host-contract";
	import type { PregameCharacterPresentation } from "./client-pregame-character";

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
		/** Roster-only diagnostic surfaces may omit management capabilities. */
		readonly characterActions?: CharacterSelectionActions | null;
		/** Null only on diagnostic surfaces that do not provide creation capabilities. */
		readonly creation: CharacterCreationServices | null;
		readonly scene: PregameCharacterPresentation | null;
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
		characterActions = null,
		creation,
		scene,
		visualCache,
		onChoose,
		onEnter,
		onDisconnect,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	let creating = $state(false);
	// Capture identity and displayed name so selection changes cannot retarget confirmation.
	let deletion = $state<{
		readonly guid: number;
		readonly name: string;
	} | null>(null);
	let confirmation = $state("");
	// Cover the gap between transport acceptance and the authority publishing admission.
	let actionSubmission = $state.raw<{
		readonly operation: "delete" | "restore";
		readonly guid: number;
		readonly before: CharacterManagementState;
	} | null>(null);
	const actionPending = $derived(actionSubmission !== null);
	let actionError = $state<string | null>(null);
	const deletionMatches = $derived(
		deletion !== null &&
			characterDeletionNameMatches(confirmation, deletion.name),
	);
	const canEnter = $derived(
		selection.characters.some(
			(character) =>
				character.guid === selectedGuid && character.deleteTime === 0,
		),
	);
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
		entryPending || actionPending || characterManagementPending(management),
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
		if (!blocked && canEnter) void onEnter();
	}
	function openDeletion(guid: number, name: string): void {
		actionError = null;
		confirmation = "";
		deletion = { guid, name };
	}
	function cancelDeletion(): void {
		if (actionPending) return;
		deletion = null;
		actionError = null;
	}
	async function manageCharacter(
		operation: "delete" | "restore",
		guid: number,
	): Promise<void> {
		if (blocked || characterActions === null) return;
		if (operation === "delete" && (!deletionMatches || deletion?.guid !== guid))
			return;
		actionSubmission = { operation, guid, before: management };
		actionError = null;
		try {
			await characterActions[operation](guid);
			deletion = null;
		} catch (error) {
			actionSubmission = null;
			actionError = error instanceof Error ? error.message : String(error);
		}
	}
	$effect(() => {
		const submission = actionSubmission;
		if (submission === null) return;
		const target = selection.characters.find(
			(character) => character.guid === submission.guid,
		);
		const completed =
			submission.operation === "delete"
				? target === undefined || target.deleteTime !== 0
				: target !== undefined && target.deleteTime === 0;
		if (
			completed ||
			(management !== submission.before && management.kind !== "idle")
		)
			actionSubmission = null;
	});
</script>

{#if creating && creation !== null && scene !== null}
	<ClientCharacterCreator
		services={creation}
		{scene}
		{management}
		onBack={() => (creating = false)}
	/>
{:else}
	<ClientPregameScreen branding="corner" showPortalLogo={true} backdrop={true}>
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
				<h1 id="character-roster-heading">Choose a character</h1>
				<fieldset
					class="client-character-list"
					aria-labelledby="character-roster-heading"
					disabled={blocked}
					use:keyboard.scope={{
						nativeControls: true,
						keydown: navigateCharacters,
					}}
				>
					{#each selection.characters as character, index (character.guid)}
						<div class="character-row">
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
								<span class="character-selection-marker"
									><SelectionMarker /></span
								>
								<span class="character-row-label">
									<strong>{character.name}</strong>
									{#if character.deleteTime !== 0}
										<span class="character-deletion-status ui-muted"
											>Pending deletion · <time
												datetime={new Date(
													character.deleteTime * 1000,
												).toISOString()}
												>{new Date(
													character.deleteTime * 1000,
												).toLocaleString()}</time
											></span
										>
									{/if}
								</span>
							</button>
							{#if characterActions !== null}
								<button
									type="button"
									class="character-row-action ui-button ui-icon-button pregame-quiet"
									aria-label={`${character.deleteTime === 0 ? "Delete" : "Restore"} ${character.name}`}
									title={character.deleteTime === 0
										? "Delete character"
										: "Restore character"}
									onclick={() =>
										character.deleteTime === 0
											? openDeletion(character.guid, character.name)
											: void manageCharacter("restore", character.guid)}
								>
									<span class="pregame-icon" aria-hidden="true"
										>{#if character.deleteTime === 0}<DeleteIcon
											/>{:else}<RestoreIcon />{/if}</span
									>
								</button>
							{/if}
						</div>
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
						disabled={!canEnter || blocked}
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
							scene === null}
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
				{#if actionError !== null && deletion === null}<p
						class="ui-error"
						role="alert"
					>
						{actionError}
					</p>{/if}
				{#if management.kind === "rejected" && management.operation !== "create"}<p
						class="ui-error"
						role="alert"
					>
						{management.message}
					</p>{/if}
				{#if management.kind === "uncertain"}<p class="ui-error" role="alert">
						<span class="pregame-icon" aria-hidden="true"><WarningIcon /></span>
						{management.message}
					</p>{/if}
			</form>
			{#if visualCache !== null && scene !== null}
				<div class="character-preview-column">
					<div class="character-preview-viewport">
						<ClientPregameCharacter
							source={previewSource === null || previewGuid === null
								? null
								: {
										subjectId: `character:${previewGuid}`,
										visual: previewSource,
									}}
							{scene}
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
		{#if deletion !== null}
			<UiDialog
				title={`Delete ${deletion.name}?`}
				className="character-deletion-dialog"
				initialFocus="input"
				onCancel={cancelDeletion}
				dismissOnBackdrop={!actionPending}
			>
				<form
					class="character-deletion-form"
					onsubmit={(event) => {
						event.preventDefault();
						if (deletion !== null)
							void manageCharacter("delete", deletion.guid);
					}}
				>
					<label class="character-confirmation-label">
						<span
							>Type <strong>{characterConfirmationName(deletion.name)}</strong> to
							confirm deletion.</span
						>
						<input
							class="ui-input"
							aria-label="Character name to confirm deletion"
							autocomplete="off"
							spellcheck={false}
							bind:value={confirmation}
							disabled={actionPending}
						/>
					</label>
					{#if actionError !== null}<p class="ui-error" role="alert">
							{actionError}
						</p>{/if}
					<div class="ui-dialog-actions">
						<button
							type="button"
							class="ui-button"
							disabled={actionPending}
							onclick={cancelDeletion}>Cancel</button
						>
						<button
							type="submit"
							class="ui-button"
							disabled={!deletionMatches || blocked}
							>{actionPending ? "Deleting…" : "Delete character"}</button
						>
					</div>
				</form>
			</UiDialog>
		{/if}
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
			/* The heading and actions retain their size; the list owns the remaining height. */
			grid-template-rows: auto minmax(0, 1fr) auto;
			align-self: start;
			height: min(100%, 50dvh);
			gap: 24px;
			min-width: 0;
			min-height: 0;
		}
		.character-roster h1 {
			margin: 0;
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
			align-content: start;
			grid-auto-rows: max-content;
			gap: 4px;
			min-height: 0;
			overflow-y: auto;
			padding: 4px;
			margin: 0;
			border: 0;
		}
		.character-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
		}
		.character-row-label,
		.character-deletion-form,
		.character-confirmation-label {
			display: grid;
			gap: 8px;
			min-width: 0;
		}
		.character-deletion-status {
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
		}
		.character-row-action {
			visibility: hidden;
		}
		.character-row:hover .character-row-action {
			visibility: visible;
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
			.character-roster {
				grid-template-rows: auto auto auto;
				height: auto;
			}
			.client-character-list {
				max-height: 40vh;
			}
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
