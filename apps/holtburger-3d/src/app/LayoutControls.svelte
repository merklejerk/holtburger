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
	import LayoutHandleIcon from "./LayoutHandleIcon.svelte";

	/** Shared corner controls; each surface retains ownership of its layout gestures. */
	interface Props {
		/** Accessible name of the surface being edited. */
		label: string;
		/** Optional content inset keeps the move handle clear of an interactive header. */
		moveInset?: LayoutMoveInset;
		/** Whether this surface allows resizing. */
		resizable: boolean;
		/** Starts the owning surface's move gesture. */
		onmove: (event: PointerEvent) => void;
		/** Starts the owning surface's resize gesture. */
		onresize: (event: PointerEvent) => void;
	}
	let { label, resizable, onmove, onresize, moveInset }: Props = $props();
</script>

<button
	type="button"
	class="ui-button ui-icon-button layout-handle layout-move"
	style:left={moveInset === undefined ? undefined : `${moveInset.left + 2}px`}
	style:top={moveInset === undefined ? undefined : `${moveInset.top + 2}px`}
	onpointerdown={onmove}
	aria-label={`Move ${label}`}><LayoutHandleIcon action="move" /></button
>
{#if resizable}
	<button
		type="button"
		class="ui-button ui-icon-button layout-handle layout-resize"
		onpointerdown={onresize}
		aria-label={`Resize ${label}`}><LayoutHandleIcon action="resize" /></button
	>
{/if}

<style>
	@layer components {
		.layout-handle {
			position: absolute;
			z-index: 2;
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
		.layout-resize {
			right: 2px;
			bottom: 2px;
			cursor: nwse-resize;
		}
	}
</style>
