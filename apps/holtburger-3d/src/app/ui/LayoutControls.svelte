<script lang="ts" module>
	/** Space reserved for an interactive header before the layout move handle. */
	export interface LayoutMoveInset {
		/** Reserved horizontal extent in CSS pixels. */
		readonly left: number;
		/** Reserved vertical extent in CSS pixels. */
		readonly top: number;
	}
</script>

<script lang="ts">
	import ResizeBorders from "./ResizeBorders.svelte";
	import type { ResizeEdges } from "./resize-edges";
	import LayoutHandleIcon from "./LayoutHandleIcon.svelte";

	/** Shared layout controls; each surface retains ownership of its layout gestures. */
	interface Props {
		/** Accessible name of the surface being edited. */
		label: string;
		/** Optional content inset keeps the move handle clear of an interactive header. */
		moveInset?: LayoutMoveInset;
		/** Dimensions this surface allows the user to resize. */
		resize: "none" | "horizontal" | "both";
		/** Starts the owning surface's move gesture. */
		onmove: (event: PointerEvent) => void;
		/** Starts the owning surface's resize gesture. */
		onresize: (event: PointerEvent, edges: ResizeEdges) => void;
	}
	let { label, resize, onmove, onresize, moveInset }: Props = $props();
</script>

<button
	type="button"
	class="ui-button ui-icon-button layout-handle layout-move"
	style:left={moveInset === undefined ? undefined : `${moveInset.left + 2}px`}
	style:top={moveInset === undefined ? undefined : `${moveInset.top + 2}px`}
	onpointerdown={onmove}
	aria-label={`Move ${label}`}><LayoutHandleIcon action="move" /></button
>
{#if resize !== "none"}
	<ResizeBorders {onresize} axes={resize} />
{/if}

<style>
	@layer components {
		.layout-handle {
			position: absolute;
			/* Keep the move button above overlapping border targets. */
			z-index: 3;
			width: 22px;
			height: 22px;
			pointer-events: auto;
		}
		.layout-move {
			top: 2px;
			left: 2px;
			cursor: grab;
		}
		.layout-move:active {
			cursor: grabbing;
		}
	}
</style>
