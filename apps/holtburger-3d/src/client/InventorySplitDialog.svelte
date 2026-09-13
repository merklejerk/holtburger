<script lang="ts">
	import { onMount } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type { InventorySplitRequest } from "./client-inventory-split";
	interface Props {
		/** Preflighted source and amount bound. */
		readonly request: InventorySplitRequest;
		/** Submit the entered quantity to the panel interaction owner. */
		readonly onSubmit: (amount: number) => void;
		/** Cancel without an inventory command. */
		readonly onCancel: () => void;
	}
	const { request, onSubmit, onCancel }: Props = $props();
	const { keyboard } = useAppInputPolicy();
	let amount = $state<number | undefined>(1);
	let input: HTMLInputElement;
	let dialog: HTMLDialogElement;
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			onCancel();
		} else if (event.key === "Tab") {
			// App input policy suppresses native Tab traversal; this local dialog owns its controls.
			event.preventDefault();
			const controls = [
				...dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
					"input, button",
				),
			];
			const current = controls.findIndex(
				(control) => control === document.activeElement,
			);
			const next =
				(current + (event.shiftKey ? -1 : 1) + controls.length) %
				controls.length;
			const control = controls[next];
			if (control !== undefined) keyboard.activate(control);
		} else if (
			(event.key === "Enter" || event.key === " ") &&
			event.target instanceof HTMLButtonElement
		) {
			event.preventDefault();
			if (!event.repeat) event.target.click();
		}
	}
	onMount(() => {
		input.focus();
		input.select();
	});
</script>

<div class="inventory-split-overlay">
	<dialog
		open
		class="inventory-split-dialog ui-panel"
		aria-label={`Split ${request.name}`}
		bind:this={dialog}
	>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				if (amount !== undefined) onSubmit(amount);
			}}
		>
			<strong>Split {request.name}</strong>
			<label
				>Amount <input
					bind:this={input}
					use:keyboard.scope={{ keydown: handleKeydown }}
					bind:value={amount}
					class="ui-input"
					type="number"
					min="1"
					max={request.maxAmount}
					step="1"
					required
				/><span class="inventory-split-maximum"
					>/ {request.maxAmount.toLocaleString()}</span
				></label
			>
			<input
				type="range"
				use:keyboard.scope={{ keydown: handleKeydown }}
				aria-label="Split amount"
				min="1"
				max={request.maxAmount}
				step="1"
				bind:value={amount}
			/>
			<div class="inventory-split-actions">
				<button
					type="button"
					class="ui-button"
					use:keyboard.scope={{ keydown: handleKeydown }}
					onclick={onCancel}>Cancel</button
				>
				<button
					type="submit"
					class="ui-button"
					use:keyboard.scope={{ keydown: handleKeydown }}>Split</button
				>
			</div>
		</form>
	</dialog>
</div>

<style>
	@layer components {
		.inventory-split-overlay {
			position: absolute;
			inset: 0;
			z-index: 5;
			display: grid;
			place-items: center;
			background: rgb(0 0 0 / 35%);
		}
		.inventory-split-dialog {
			position: relative;
			margin: 8px;
			max-width: calc(100% - 16px);
			color: var(--ui-color-text);
		}
		form {
			display: grid;
			gap: 12px;
			padding: 12px;
		}
		label {
			display: flex;
			align-items: center;
			gap: 8px;
		}
		input {
			min-width: 0;
			width: 8em;
		}
		input[type="range"] {
			width: 100%;
		}
		.inventory-split-actions {
			display: flex;
			justify-content: end;
			gap: 8px;
		}
	}
</style>
