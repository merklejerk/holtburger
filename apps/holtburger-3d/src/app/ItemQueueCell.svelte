<script lang="ts">
	import type { Snippet } from "svelte";
	import CantripBorderSpecular from "./CantripBorderSpecular.svelte";
	import { useItemCantrips } from "./item-cantrips";
	import RemovableItemCell from "./RemovableItemCell.svelte";
	import type { HTMLButtonAttributes } from "svelte/elements";

	const itemCantrips = useItemCantrips();

	/** Shared square queue cell and removal affordance; feature owners supply artwork and actions. */
	type Props = HTMLButtonAttributes & {
		readonly children: Snippet;
		/** Backing item GUID used to resolve shared cantrip borders. */
		readonly itemGuid?: number | null;
		/** Accessible removal action, supplied by the queue owner. */
		readonly removeLabel: string;
		/** Removal may be locked independently of selection and inspection. */
		readonly removalDisabled: boolean;
		readonly onremove: () => void;
	};
	const {
		children,
		itemGuid = null,
		removeLabel,
		removalDisabled,
		onremove,
		class: className = "",
		...button
	}: Props = $props();
	const cantripTier = $derived(itemCantrips.tierFor(itemGuid));
</script>

<RemovableItemCell
	removal={{ label: removeLabel, disabled: removalDisabled, onremove }}
>
	<button
		{...button}
		type="button"
		class="item-queue-cell ui-item-cell ui-item-selection ui-hud-control {className}"
		data-cantrip-tier={cantripTier}
	>
		{@render children()}
		<CantripBorderSpecular tier={cantripTier} />
	</button>
</RemovableItemCell>

<style>
	@layer components {
		.item-queue-cell {
			position: relative;
			aspect-ratio: 1;
			width: 100%;
			min-width: 0;
			padding: var(--ui-item-cell-padding);
			overflow: hidden;
			user-select: none;
		}
	}
</style>
