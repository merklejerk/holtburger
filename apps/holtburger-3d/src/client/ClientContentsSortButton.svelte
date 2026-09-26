<script lang="ts">
	import SortIcon from "../assets/icons/sort.svg?component";
	import {
		nextContentsSortMode,
		type ContentsSortMode,
	} from "./client-container-contents";

	interface Props {
		/** Current display ordering, owned by the consuming panel. */
		readonly mode: ContentsSortMode;
		/** Accessible name identifying the contents being sorted. */
		readonly label: string;
		/** Advance the owner's sort preference and refresh its display. */
		readonly onclick: () => void;
	}
	const { mode, label, onclick }: Props = $props();
	const sortLabels = {
		native: "Native (slot index)",
		alphabetical: "Alphabetical",
		"item-type": "Item type",
	};
</script>

<button
	type="button"
	class="ui-hud-button contents-sort"
	aria-label={`Sort ${label}: ${sortLabels[mode]}`}
	title={`Sort: ${sortLabels[mode]}. Click for ${sortLabels[nextContentsSortMode(mode)]}.`}
	{onclick}
>
	<SortIcon />
	<span aria-hidden="true"
		>{mode === "native" ? "#" : mode === "alphabetical" ? "A" : "T"}</span
	>
</button>

<style>
	@layer components {
		.contents-sort {
			display: flex;
			align-items: center;
			gap: 3px;
		}
	}
</style>
