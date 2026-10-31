<script lang="ts">
	import ChevronIcon from "../assets/icons/dropdown-chevron.svg?component";
	import UiRange from "./UiRange.svelte";

	/** Zero-based authored choices with bounded previous/next and direct slider selection. */
	interface Props {
		/** Visible label used by the step buttons. */
		readonly label: string;
		/** Existing label element naming the slider. */
		readonly labelledBy: string;
		/** Selected zero-based ordinal. */
		readonly value: number;
		/** Number of authored choices. */
		readonly count: number;
		/** Feature submission state locks all three controls. */
		readonly disabled: boolean;
		/** Optional feature chrome, such as the creator's round buttons. */
		readonly buttonClass?: string;
		/** One semantic selection shared by buttons and slider. */
		readonly onchange: (value: number) => void;
	}
	const {
		label,
		labelledBy,
		value,
		count,
		disabled,
		buttonClass,
		onchange,
	}: Props = $props();
</script>

<div class="ordinal-range">
	<button
		type="button"
		class={["ui-button ui-icon-button", buttonClass]}
		aria-label={`Previous ${label}`}
		title={`Previous ${label}`}
		disabled={disabled || value === 0}
		onclick={() => onchange(value - 1)}
		><span class="step-icon decrease" aria-hidden="true"><ChevronIcon /></span
		></button
	>
	<UiRange
		aria-labelledby={labelledBy}
		min={0}
		max={count - 1}
		step="1"
		{value}
		{disabled}
		aria-valuetext={`${value + 1} of ${count}`}
		oninput={(event) => onchange(event.currentTarget.valueAsNumber)}
	/>
	<button
		type="button"
		class={["ui-button ui-icon-button", buttonClass]}
		aria-label={`Next ${label}`}
		title={`Next ${label}`}
		disabled={disabled || value === count - 1}
		onclick={() => onchange(value + 1)}
		><span class="step-icon increase" aria-hidden="true"><ChevronIcon /></span
		></button
	>
	<span class="ordinal-value ui-muted" aria-hidden="true"
		>{value + 1} / {count}</span
	>
</div>

<style>
	@layer components {
		.ordinal-range {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) auto auto;
			align-items: center;
			gap: 4px;
			min-width: 0;
		}
		.ordinal-range :global(input) {
			width: 100%;
			min-width: 0;
			margin: 0;
		}
		.ordinal-value {
			min-width: 6ch;
			text-align: right;
			font-variant-numeric: tabular-nums;
		}
		button {
			width: 24px;
			height: 24px;
		}
		.step-icon {
			display: inline-grid;
			place-items: center;
			width: 1em;
			height: 1em;
		}
		.step-icon :global(svg) {
			width: 100%;
			height: 100%;
		}
		.decrease {
			transform: rotate(90deg);
		}
		.increase {
			transform: rotate(-90deg);
		}
	}
</style>
