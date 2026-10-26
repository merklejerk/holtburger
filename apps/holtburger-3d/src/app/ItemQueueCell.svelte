<script lang="ts">
	import type { Snippet } from "svelte";
	import RemovableItemCell from "./RemovableItemCell.svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";

	/** Shared square queue cell and removal affordance; feature owners supply artwork and actions. */
	type Props = HTMLButtonAttributes & {
		readonly children: Snippet;
		/** Accessible removal action, supplied by the queue owner. */
		readonly removeLabel: string;
		/** Removal may be locked independently of selection and inspection. */
		readonly removalDisabled: boolean;
		readonly onremove: () => void;
	};
	const {
		children,
		removeLabel,
		removalDisabled,
		onremove,
		class: className = "",
		...button
	}: Props = $props();
</script>

<RemovableItemCell
	removal={{ label: removeLabel, disabled: removalDisabled, onremove }}
>
	<button
		{...button}
		type="button"
		class="item-queue-cell ui-item-cell ui-item-selection ui-hud-control {className}"
	>
		{@render children()}
	</button>
</RemovableItemCell>

<style>
	@layer components {
		.item-queue-cell {
			position: relative;
			aspect-ratio: 1;
			width: 100%;
			min-width: 0;
			padding: calc(var(--ui-item-cell-padding) * var(--ui-icon-scale));
			overflow: hidden;
			user-select: none;
		}
	}
</style>
