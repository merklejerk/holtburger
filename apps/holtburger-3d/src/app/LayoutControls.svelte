<script lang="ts">
	import LayoutHandleIcon from "./LayoutHandleIcon.svelte";

	/** Shared corner controls; each surface retains ownership of its layout gestures. */
	interface Props {
		/** Accessible name of the surface being edited. */
		label: string;
		/** Whether this surface allows resizing. */
		resizable: boolean;
		/** Starts the owning surface's move gesture. */
		onmove: (event: PointerEvent) => void;
		/** Starts the owning surface's resize gesture. */
		onresize: (event: PointerEvent) => void;
	}
	let { label, resizable, onmove, onresize }: Props = $props();
</script>

<button
	type="button"
	class="ui-button ui-icon-button layout-handle layout-move"
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
</style>
