<script lang="ts">
	import type { ResizeEdges } from "./resize-edges";
	let {
		onresize,
		axes,
	}: {
		/** Allowed dimensions; width-only surfaces expose their full left/right borders. */
		axes: "both" | "horizontal";
		/** Start resizing the owning surface from the selected borders. */
		onresize: (event: PointerEvent, edges: ResizeEdges) => void;
	} = $props();
	const resizeHandles: readonly {
		/** Position class selecting the hit area and cursor. */
		readonly name: string;
		/** Borders delivered to the surface geometry owner. */
		readonly edges: ResizeEdges;
	}[] = [
		{ name: "top", edges: { vertical: "top" } },
		{ name: "right", edges: { horizontal: "right" } },
		{ name: "bottom", edges: { vertical: "bottom" } },
		{ name: "left", edges: { horizontal: "left" } },
		{ name: "top-left", edges: { horizontal: "left", vertical: "top" } },
		{ name: "top-right", edges: { horizontal: "right", vertical: "top" } },
		{
			name: "bottom-right",
			edges: { horizontal: "right", vertical: "bottom" },
		},
		{
			name: "bottom-left",
			edges: { horizontal: "left", vertical: "bottom" },
		},
	];
</script>

{#each resizeHandles.filter((handle) => axes === "both" || handle.edges.vertical === undefined) as handle}
	<div
		class={`resize-border resize-border-${handle.name}`}
		class:resize-border-horizontal-only={axes === "horizontal"}
		role="presentation"
		onpointerdown={(event) => onresize(event, handle.edges)}
	></div>
{/each}

<style>
	@layer components {
		/* The default outset covers the unlocked outline; framed windows supply their paint outset. */
		.resize-border {
			position: absolute;
			z-index: 2;
			pointer-events: auto;
			touch-action: none;
		}

		.resize-border-top,
		.resize-border-bottom {
			left: 8px;
			width: calc(100% - 16px);
			height: calc(8px + var(--ui-resize-outset, 4px));
		}

		.resize-border-left,
		.resize-border-right {
			top: 8px;
			width: calc(8px + var(--ui-resize-outset, 4px));
			height: calc(100% - 16px);
		}

		.resize-border-horizontal-only {
			top: calc(-1 * var(--ui-resize-outset, 4px));
			height: calc(100% + 2 * var(--ui-resize-outset, 4px));
		}

		.resize-border-top {
			top: calc(-1 * var(--ui-resize-outset, 4px));
			cursor: ns-resize;
		}

		.resize-border-right {
			right: calc(-1 * var(--ui-resize-outset, 4px));
			cursor: ew-resize;
		}

		.resize-border-bottom {
			bottom: calc(-1 * var(--ui-resize-outset, 4px));
			cursor: ns-resize;
		}

		.resize-border-left {
			left: calc(-1 * var(--ui-resize-outset, 4px));
			cursor: ew-resize;
		}

		.resize-border-top-left,
		.resize-border-top-right,
		.resize-border-bottom-right,
		.resize-border-bottom-left {
			width: calc(12px + var(--ui-resize-outset, 4px));
			height: calc(12px + var(--ui-resize-outset, 4px));
		}

		.resize-border-top-left {
			top: calc(-1 * var(--ui-resize-outset, 4px));
			left: calc(-1 * var(--ui-resize-outset, 4px));
			cursor: nwse-resize;
		}

		.resize-border-top-right {
			top: calc(-1 * var(--ui-resize-outset, 4px));
			right: calc(-1 * var(--ui-resize-outset, 4px));
			cursor: nesw-resize;
		}

		.resize-border-bottom-right {
			right: calc(-1 * var(--ui-resize-outset, 4px));
			bottom: calc(-1 * var(--ui-resize-outset, 4px));
			cursor: nwse-resize;
		}

		.resize-border-bottom-left {
			bottom: calc(-1 * var(--ui-resize-outset, 4px));
			left: calc(-1 * var(--ui-resize-outset, 4px));
			cursor: nesw-resize;
		}
	}
</style>
