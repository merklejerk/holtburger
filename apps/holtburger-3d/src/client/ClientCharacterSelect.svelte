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
			class="client-character ui-button"
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
		class="client-action ui-button"
		disabled={state.selectedGuid === null || entryPending}
		onclick={() => void onEnter()}
	>
		{entryPending ? "Entering…" : "Enter World"}
	</button>
	<button
		class="client-action ui-button"
		disabled={entryPending}
		onclick={() => void onDisconnect()}
	>
		Disconnect
	</button>
</div>

<style>
	.client-status {
		margin: 0;
		color: var(--ui-color-muted);
		line-height: 1.45;
	}
	.client-character-list {
		display: grid;
		gap: 6px;
		max-height: min(45vh, 360px);
		overflow-y: auto;
		padding: 6px;
	}
	.client-character {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 14px;
		min-height: 32px;
		padding: 4px 8px;
		text-align: left;
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
</style>
