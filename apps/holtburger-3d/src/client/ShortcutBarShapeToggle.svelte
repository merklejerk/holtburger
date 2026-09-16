<script lang="ts">
	import LayoutHandleIcon from "../app/LayoutHandleIcon.svelte";
	import type {
		ClientHudViewport,
		ResolvedClientHudPlacement,
	} from "./client-hud-layout";
	interface Props {
		/** Accessible name for this bar's shape toggle. */
		label: string;
		/** The numbered strip's primary axis. */
		orientation: "horizontal" | "vertical";
		/** Current one-strip or two-strip configuration. */
		shape: "single" | "double";
		/** Rendered bounds determine which handle edge points toward viewport center. */
		bounds: ResolvedClientHudPlacement;
		/** Current usable HUD extent. */
		viewport: ClientHudViewport;
		/** Reserved interactive header above a top-edge handle. */
		topInset: number;
		/** Publish the toggled shape; the bar retains ownership of its placement. */
		onchange: (shape: "single" | "double") => void;
	}
	let {
		label,
		orientation,
		shape,
		bounds,
		viewport,
		topInset,
		onchange,
	}: Props = $props();
	const towardCenter = $derived({
		right: bounds.left + bounds.width / 2 < viewport.width / 2,
		bottom: bounds.top + bounds.height / 2 < viewport.height / 2,
	});
	function toggleShape(event: MouseEvent): void {
		event.stopPropagation();
		onchange(shape === "single" ? "double" : "single");
	}
</script>

<button
	type="button"
	class="shortcut-shape-toggle ui-button ui-icon-button"
	class:toggle-top={orientation === "horizontal" && !towardCenter.bottom}
	class:toggle-left={orientation === "vertical" && !towardCenter.right}
	style:top={orientation === "horizontal" && !towardCenter.bottom
		? `${topInset + 2}px`
		: undefined}
	aria-label={label}
	title="Toggle single/double strip"
	onclick={toggleShape}><LayoutHandleIcon action="shape" /></button
>

<style>
	@layer components {
		.shortcut-shape-toggle {
			position: absolute;
			right: 2px;
			bottom: 2px;
			width: 22px;
			height: 22px;
			cursor: pointer;
		}
		.toggle-top {
			bottom: auto;
		}
		.toggle-left {
			left: 2px;
			right: auto;
		}
	}
</style>
