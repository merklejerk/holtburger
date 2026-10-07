<script lang="ts">
	import { onMount, untrack } from "svelte";
	import UiDialog from "../app/UiDialog.svelte";
	import type { PartyPreferences } from "./client-party-contract";
	interface Props {
		/** Retained character preferences seed this draft once, without live checkbox replacement. */
		readonly preferences: PartyPreferences;
		/** Submit the name and settings together to the session owner. */
		readonly onSubmit: (
			name: string,
			settings: Pick<PartyPreferences, "shareXp" | "shareLoot">,
		) => void;
		/** Cancel the local draft without changing character preferences. */
		readonly onCancel: () => void;
	}
	const { preferences, onSubmit, onCancel }: Props = $props();
	let name = $state("");
	let shareXp = $state(untrack(() => preferences.shareXp));
	let shareLoot = $state(untrack(() => preferences.shareLoot));
	let nameInput: HTMLInputElement;
	onMount(() => nameInput.focus());
</script>

<UiDialog
	title="Create Party"
	className="client-party-create-dialog"
	{onCancel}
>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			if (name.trim().length > 0) onSubmit(name.trim(), { shareXp, shareLoot });
		}}
	>
		<label class="name-field"
			>Party name <input
				class="ui-input"
				bind:this={nameInput}
				bind:value={name}
				required
				autocomplete="off"
			/></label
		>
		<fieldset class="ui-fieldset">
			<legend>Sharing</legend>
			<label
				><input type="checkbox" bind:checked={shareXp} />Share XP and luminance</label
			>
			<label><input type="checkbox" bind:checked={shareLoot} />Share loot</label
			>
		</fieldset>
		<p>Sharing settings apply when this party is created.</p>
		<div class="ui-dialog-actions">
			<button class="ui-button" type="button" onclick={onCancel}>Cancel</button>
			<button
				class="ui-button"
				type="submit"
				disabled={name.trim().length === 0}>Create Party</button
			>
		</div>
	</form>
</UiDialog>

<style>
	@layer components {
		form,
		fieldset,
		.name-field {
			display: grid;
			gap: 0.75rem;
		}
		label {
			display: flex;
			align-items: center;
			gap: 0.5rem;
		}
		.name-field {
			display: grid;
		}
		p {
			color: var(--ui-color-muted);
			margin: 0;
		}
	}
</style>
