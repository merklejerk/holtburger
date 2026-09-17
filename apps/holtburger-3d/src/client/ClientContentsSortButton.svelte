<script lang="ts">
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
	<svg viewBox="0 0 24 24" aria-hidden="true"
		><path
			d="M5 4v16m-3-3 3 3 3-3M11 5h10M11 10h7M11 15h4"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		/></svg
	>
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
		.contents-sort svg {
			width: 18px;
			height: 18px;
		}
	}
</style>
