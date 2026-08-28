<script lang="ts">
	import type { ClientLifecycleUiState } from "./client-lifecycle-state";

	type CharacterSelectionState = Extract<
		ClientLifecycleUiState,
		{ readonly kind: "character-selection" }
	>;

	interface Props {
		readonly state: CharacterSelectionState;
		readonly entryPending: boolean;
		readonly onChoose: (guid: number) => void;
		readonly onEnter: () => void | Promise<void>;
		readonly onDisconnect: () => void | Promise<void>;
	}

	let { state, entryPending, onChoose, onEnter, onDisconnect }: Props =
		$props();
</script>

<h1>Choose a character</h1>
<p class="client-status">
	Select a character, then explicitly enter the world.
</p>

<div class="client-character-list" role="listbox" aria-label="Characters">
	{#each state.characters as character (character.guid)}
		<button
			class:client-character-selected={state.selectedGuid === character.guid}
			class="client-character"
			role="option"
			aria-selected={state.selectedGuid === character.guid}
			onclick={() => onChoose(character.guid)}
			ondblclick={() => void onEnter()}
		>
			<strong>{character.name}</strong>
			<span>Slot {character.slot + 1}</span>
		</button>
	{/each}
</div>

<div class="client-actions">
	<button
		class="client-action"
		disabled={state.selectedGuid === null || entryPending}
		onclick={() => void onEnter()}
	>
		{entryPending ? "Entering…" : "Enter World"}
	</button>
	<button
		class="client-action"
		disabled={entryPending}
		onclick={() => void onDisconnect()}
	>
		Disconnect
	</button>
</div>

<style>
	.client-status {
		margin: 0;
		color: var(--ac-ink-muted);
		font-size: 1rem;
		line-height: 1.45;
		text-shadow: 1px 1px 0 #000;
	}

	.client-character-list {
		display: grid;
		gap: 6px;
		max-height: min(45vh, 360px);
		overflow-y: auto;
		padding: 2px;
	}

	.client-character {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 14px;
		min-height: 44px;
		padding: 8px 10px;
		border: 1px solid rgb(162 117 33 / 45%);
		background: rgb(37 28 12 / 74%);
		color: var(--ac-ink);
		text-align: left;
		cursor: pointer;
	}

	.client-character:hover,
	.client-character-selected {
		border-color: var(--ac-gold-bright);
		background: rgb(83 57 16 / 82%);
	}

	.client-character span {
		color: var(--ac-ink-muted);
		font-family: var(--ac-font-ui);
		font-size: var(--ac-panel-font-size);
	}

	.client-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.client-action {
		min-width: 120px;
		padding: 6px 12px;
		cursor: pointer;
	}

	.client-action:disabled {
		cursor: not-allowed;
		filter: grayscale(0.8);
		opacity: 0.45;
	}
</style>
