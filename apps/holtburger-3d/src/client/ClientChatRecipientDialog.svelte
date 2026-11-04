<script lang="ts">
	import { onMount } from "svelte";
	import UiPanelDialog from "../app/UiPanelDialog.svelte";
	interface Props {
		/** Commit a player-name destination without submitting the message draft. */
		readonly onSubmit: (name: string) => void;
		/** Retain the previous destination and message draft. */
		readonly onCancel: () => void;
	}
	const { onSubmit, onCancel }: Props = $props();
	let name = $state("");
	let input: HTMLInputElement;
	onMount(() => input.focus());
</script>

<UiPanelDialog
	title="Tell recipient"
	className="chat-recipient-dialog"
	overlayClassName="chat-recipient-overlay"
	{onCancel}
>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			if (name.trim().length > 0) onSubmit(name.trim());
		}}
	>
		<strong>Tell recipient</strong>
		<label
			>Player name <input
				class="ui-input"
				aria-label="Tell recipient"
				bind:this={input}
				bind:value={name}
				autocomplete="off"
				required
			/></label
		>
		<div class="ui-dialog-actions">
			<button type="button" class="ui-button" onclick={onCancel}>Cancel</button>
			<button
				type="submit"
				class="ui-button"
				disabled={name.trim().length === 0}>Choose</button
			>
		</div>
	</form>
</UiPanelDialog>

<style>
	@layer components {
		label {
			display: grid;
			gap: var(--ui-overlay-gap);
		}
		input {
			box-sizing: border-box;
			min-width: 0;
			width: 100%;
		}
	}
</style>
