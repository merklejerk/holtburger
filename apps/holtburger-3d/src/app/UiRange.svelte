<script lang="ts">
	import type { HTMLInputAttributes } from "svelte/elements";

	/** Native range attributes plus the numeric contract used to paint its filled portion. */
	interface Props extends Omit<
		HTMLInputAttributes,
		"type" | "value" | "min" | "max"
	> {
		/** Native numeric value; bindable for local controls and updated live during dragging. */
		value: number;
		/** Feature-owned lower endpoint for the input and its filled fraction. */
		min: number;
		/** Feature-owned upper endpoint for the input and its filled fraction. */
		max: number;
	}
	let {
		value = $bindable(),
		min,
		max,
		oninput,
		class: className,
		...attributes
	}: Props = $props();
	// A collapsed native range has one position. Clamping mirrors native endpoint admission.
	const progress = $derived(
		max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) * 100 : 0,
	);
</script>

<input
	{...attributes}
	class={["ui-range", className]}
	type="range"
	{min}
	{max}
	{value}
	style:--ui-range-progress={`${progress}%`}
	oninput={(event) => {
		value = event.currentTarget.valueAsNumber;
		oninput?.(event);
	}}
/>
