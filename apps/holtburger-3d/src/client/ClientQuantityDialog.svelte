<script lang="ts">
	import { onMount } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	interface Props {
		/** Frontend-confirmed bounds; the owning operation validates again on submit. */
		readonly request: {
			readonly name: string;
			readonly maxAmount: number;
			readonly minAmount?: number;
			readonly initialAmount?: number;
		};
		readonly purpose?: "split" | "buy";
		/** Submit the entered quantity to the panel interaction owner. */
		readonly onSubmit: (amount: number) => void;
		/** Cancel without an inventory command. */
		readonly onCancel: () => void;
	}
	const { request, purpose = "split", onSubmit, onCancel }: Props = $props();
	const { keyboard } = useAppInputPolicy();
	let amount = $state<number | undefined>(1);
	$effect(() => {
		amount = request.initialAmount ?? 1;
	});
	const minimum = $derived(request.minAmount ?? 1);
	const action = $derived(purpose === "buy" ? "Add to trade" : "Split");
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

<div
	class="quantity-overlay"
	class:inventory-split-overlay={purpose === "split"}
>
	<dialog
		open
		class="quantity-dialog ui-panel"
		class:inventory-split-dialog={purpose === "split"}
		class:vendor-quantity-dialog={purpose === "buy"}
		aria-label={`${action} ${request.name}`}
		bind:this={dialog}
	>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				if (amount !== undefined) onSubmit(amount);
			}}
		>
			<strong>{action} {request.name}</strong>
			<label
				>Amount <input
					bind:this={input}
					use:keyboard.scope={{ keydown: handleKeydown }}
					bind:value={amount}
					class="ui-input"
					type="number"
					min={minimum}
					max={request.maxAmount}
					step="1"
					required
				/>{#if purpose === "split" || request.maxAmount <= 1000}<span
						class="inventory-split-maximum"
						>/ {request.maxAmount.toLocaleString()}</span
					>{/if}</label
			>
			{#if minimum === request.maxAmount}
				<p>Sold as one whole stack.</p>
			{:else if request.maxAmount <= 1000}
				<input
					type="range"
					use:keyboard.scope={{ keydown: handleKeydown }}
					aria-label={`${action} amount`}
					min={minimum}
					max={request.maxAmount}
					step="1"
					bind:value={amount}
				/>
			{/if}
			<div class="quantity-actions">
				<button
					type="button"
					class="ui-button"
					use:keyboard.scope={{ keydown: handleKeydown }}
					onclick={onCancel}>Cancel</button
				>
				<button
					type="submit"
					class="ui-button"
					use:keyboard.scope={{ keydown: handleKeydown }}>{action}</button
				>
			</div>
		</form>
	</dialog>
</div>

<style>
	@layer components {
		.quantity-overlay {
			position: absolute;
			inset: 0;
			z-index: 5;
			display: grid;
			place-items: center;
			background: color-mix(in srgb, var(--ui-color-shadow) 35%, transparent);
		}
		.quantity-dialog {
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
		.quantity-actions {
			display: flex;
			justify-content: end;
			gap: 8px;
		}
	}
</style>
