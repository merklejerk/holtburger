<script lang="ts">
	import type { Snippet } from "svelte";
	import {
		anchorClientHudPlacement,
		resizeClientPanelRectangle,
		resolveClientHudPlacement,
		type ClientHudPlacement,
		type ClientHudViewport,
		type ClientPanelResizeEdges,
	} from "./client-hud-layout";

	interface Props {
		readonly children: Snippet;
		readonly minHeight: number;
		readonly minWidth: number;
		readonly placement: ClientHudPlacement;
		readonly title: string;
		readonly viewport: ClientHudViewport;
		readonly onClose: () => void;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
	}

	const {
		children,
		minHeight,
		minWidth,
		placement,
		title,
		viewport,
		onClose,
		onPlacementChange,
	}: Props = $props();
	const minimum = $derived({ width: minWidth, height: minHeight });
	const resolved = $derived(
		resolveClientHudPlacement(placement, viewport, minimum),
	);
	const resizeHandles: readonly {
		readonly name: string;
		readonly edges: ClientPanelResizeEdges;
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

	function beginDrag(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startY = event.clientY;
		const start = resolved;
		const startViewport = viewport;
		const preferred = {
			width: placement.preferredWidth,
			height: placement.preferredHeight,
		};
		trackPointer(event.pointerId, (moved) => {
			onPlacementChange(
				anchorClientHudPlacement(
					{
						...start,
						left: start.left + moved.clientX - startX,
						top: start.top + moved.clientY - startY,
					},
					startViewport,
					preferred,
				),
			);
		});
	}

	function beginResize(
		event: PointerEvent,
		edges: ClientPanelResizeEdges,
	): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startY = event.clientY;
		const start = resolved;
		const startViewport = viewport;
		trackPointer(event.pointerId, (moved) => {
			const rectangle = resizeClientPanelRectangle(
				start,
				startViewport,
				minimum,
				{ x: moved.clientX - startX, y: moved.clientY - startY },
				edges,
			);
			onPlacementChange(
				anchorClientHudPlacement(rectangle, startViewport, {
					width: rectangle.width,
					height: rectangle.height,
				}),
			);
		});
	}

	function trackPointer(
		pointerId: number,
		update: (event: PointerEvent) => void,
	): void {
		const move = (event: PointerEvent): void => {
			if (event.pointerId === pointerId) update(event);
		};
		const end = (event: PointerEvent): void => {
			if (event.pointerId !== pointerId) return;
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", end);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", end);
	}
</script>

<section
	class="floating-panel ac-panel"
	style:left={`${resolved.left}px`}
	style:top={`${resolved.top}px`}
	style:width={`${resolved.width}px`}
	style:height={`${resolved.height}px`}
	aria-label={title}
>
	<header
		class="floating-panel-titlebar ac-titlebar"
		role="group"
		aria-label={`${title} window controls`}
		onpointerdown={beginDrag}
	>
		<span>{title}</span>
		<button
			type="button"
			class="emoji-button floating-panel-close"
			aria-label={`Close ${title}`}
			onpointerdown={(event) => event.stopPropagation()}
			onclick={onClose}>×</button
		>
	</header>
	<div class="floating-panel-content">{@render children()}</div>
	{#each resizeHandles as handle}
		<div
			class={`floating-panel-resize floating-panel-resize-${handle.name}`}
			role="presentation"
			onpointerdown={(event) => beginResize(event, handle.edges)}
		></div>
	{/each}
</section>

<style>
	.floating-panel {
		position: absolute;
		z-index: 4;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		overflow: visible;
		user-select: none;
	}

	.floating-panel-titlebar {
		justify-content: space-between;
		cursor: move;
		touch-action: none;
	}

	.floating-panel-titlebar:active {
		cursor: grabbing;
	}

	.floating-panel-close {
		width: 28px;
		height: 26px;
		min-height: 26px;
		margin-right: 2px;
		cursor: pointer;
	}

	.floating-panel-content {
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		user-select: text;
	}

	.floating-panel-resize {
		position: absolute;
		z-index: 2;
		touch-action: none;
	}

	.floating-panel-resize-top,
	.floating-panel-resize-bottom {
		left: 8px;
		width: calc(100% - 16px);
		height: 8px;
	}

	.floating-panel-resize-left,
	.floating-panel-resize-right {
		top: 8px;
		width: 8px;
		height: calc(100% - 16px);
	}

	.floating-panel-resize-top {
		top: -4px;
		cursor: ns-resize;
	}

	.floating-panel-resize-right {
		right: -4px;
		cursor: ew-resize;
	}

	.floating-panel-resize-bottom {
		bottom: -4px;
		cursor: ns-resize;
	}

	.floating-panel-resize-left {
		left: -4px;
		cursor: ew-resize;
	}

	.floating-panel-resize-top-left,
	.floating-panel-resize-top-right,
	.floating-panel-resize-bottom-right,
	.floating-panel-resize-bottom-left {
		width: 12px;
		height: 12px;
	}

	.floating-panel-resize-top-left {
		top: -4px;
		left: -4px;
		cursor: nwse-resize;
	}

	.floating-panel-resize-top-right {
		top: -4px;
		right: -4px;
		cursor: nesw-resize;
	}

	.floating-panel-resize-bottom-right {
		right: -4px;
		bottom: -4px;
		cursor: nwse-resize;
	}

	.floating-panel-resize-bottom-left {
		bottom: -4px;
		left: -4px;
		cursor: nesw-resize;
	}
</style>
