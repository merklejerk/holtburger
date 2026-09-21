<script lang="ts">
	import { onMount } from "svelte";
	import type { ClientLifecycleUiState } from "./client-lifecycle-state";

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
		/** Publish selection without entering the world. */
		readonly onChoose: (guid: number) => void;
		/** Enter the currently selected character. */
		readonly onEnter: () => void | Promise<void>;
		/** Leave character selection and disconnect. */
		readonly onDisconnect: () => void | Promise<void>;
	}

	let { state, entryPending, onChoose, onEnter, onDisconnect }: Props =
		$props();
	let formElement: HTMLFormElement;
	onMount(() => {
		const selected = formElement.querySelector<HTMLInputElement>(
			'input[name="character"]:checked',
		);
		const first = formElement.querySelector<HTMLInputElement>(
			'input[name="character"]',
		);
		(selected ?? first)?.focus({ preventScroll: true });
	});

	function handleSubmit(event: SubmitEvent): void {
		event.preventDefault();
		if (!entryPending && state.selectedGuid !== null) void onEnter();
	}
</script>

<h1>Choose a character</h1>
<p class="client-status">
	Select a character, then explicitly enter the world.
</p>

<form bind:this={formElement} onsubmit={handleSubmit}>
	<fieldset
		class="client-character-list"
		aria-label="Characters"
		disabled={entryPending}
	>
		{#each state.characters as character (character.guid)}
			<label class="client-character ui-option">
				<input
					type="radio"
					name="character"
					value={character.guid}
					checked={state.selectedGuid === character.guid}
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
			disabled={state.selectedGuid === null || entryPending}
		>
			{entryPending ? "Entering…" : "Enter World"}
		</button>
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

<style>
	@layer components {
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
