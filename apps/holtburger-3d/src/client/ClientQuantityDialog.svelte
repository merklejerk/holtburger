<script lang="ts">
	import { onMount } from "svelte";
	import UiPanelDialog from "../app/UiPanelDialog.svelte";
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
	let amount = $state<number | undefined>(1);
	$effect(() => {
		amount = request.initialAmount ?? 1;
	});
	const minimum = $derived(request.minAmount ?? 1);
	const action = $derived(purpose === "buy" ? "Add to trade" : "Split");
	let input: HTMLInputElement;

	onMount(() => {
		input.focus();
		input.select();
	});
</script>

<UiPanelDialog
	title={`${action} ${request.name}`}
	className={`quantity-dialog ${purpose === "split" ? "inventory-split-dialog" : "vendor-quantity-dialog"}`}
	overlayClassName={`quantity-overlay ${purpose === "split" ? "inventory-split-overlay" : ""}`}
	{onCancel}
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
				aria-label={`${action} amount`}
				min={minimum}
				max={request.maxAmount}
				step="1"
				bind:value={amount}
			/>
		{/if}
		<div class="ui-dialog-actions">
			<button type="button" class="ui-button" onclick={onCancel}>Cancel</button>
			<button type="submit" class="ui-button">{action}</button>
		</div>
	</form>
</UiPanelDialog>

<style>
	@layer components {
		label {
			display: flex;
			align-items: center;
			gap: var(--ui-overlay-gap);
		}
		input {
			min-width: 0;
			width: 8em;
		}
		input[type="range"] {
			width: 100%;
		}
	}
</style>
