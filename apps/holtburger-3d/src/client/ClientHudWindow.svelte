<script lang="ts">
	import { onDestroy, onMount, type Snippet } from "svelte";
	import { trackPointerGesture } from "../app/pointer-gesture";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type { EscapeContextHandle } from "../lib/input/keyboard-input-policy";
	import { CLIENT_UI_LAYERS } from "./client-ui-layers";
	import ClientHudIcon, {
		type ClientHudIconName,
	} from "./ClientHudIcon.svelte";
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
		/** Same glyph used by the panel's launcher in the system shortcut dock. */
		readonly icon: ClientHudIconName;
		readonly viewport: ClientHudViewport;
		/** Launcher click revision promotes an already open independent window. */
		readonly focusRevision?: number;
		readonly onClose: () => void;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
	}

	const {
		children,
		minHeight,
		minWidth,
		placement,
		title,
		icon,
		viewport,
		focusRevision = 0,
		onClose,
		onPlacementChange,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const minimum = $derived({ width: minWidth, height: minHeight });
	const resolved = $derived(
		resolveClientHudPlacement(placement, viewport, minimum),
	);
	let cancelPointerGesture: (() => void) | null = null;
	let escapeContext: EscapeContextHandle | null = null;
	/** Cold visual order is published by the same owner that routes Escape. */
	let depth = $state(0);
	onDestroy(() => cancelPointerGesture?.());
	onMount(() => {
		// Read the current prop when Escape fires; keyed window content can replace its close target.
		escapeContext = keyboard.bindEscapeContext(
			() => onClose(),
			(value) => (depth = value),
		);
		return () => {
			escapeContext?.release();
			escapeContext = null;
		};
	});
	$effect(() => {
		if (focusRevision > 0) escapeContext?.promote();
	});
	function focusWindow(): void {
		// Pointer intent promotes the window; automatic editor/modal focus restoration does not.
		escapeContext?.promote();
	}
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
		cancelPointerGesture?.();
		cancelPointerGesture = trackPointerGesture(
			window,
			event.pointerId,
			(moved) => {
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
			},
		);
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
		cancelPointerGesture?.();
		cancelPointerGesture = trackPointerGesture(
			window,
			event.pointerId,
			(moved) => {
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
			},
		);
	}
</script>

<section
	class="hud-window ui-panel"
	style:left={`${resolved.left}px`}
	style:top={`${resolved.top}px`}
	style:width={`${resolved.width}px`}
	style:height={`${resolved.height}px`}
	style:z-index={CLIENT_UI_LAYERS.windowBase + depth}
	aria-label={title}
	onpointerdowncapture={focusWindow}
>
	<header
		class="hud-window-titlebar ui-frame"
		role="group"
		aria-label={`${title} window controls`}
		onpointerdown={beginDrag}
	>
		<span class="hud-window-title"
			><span class="hud-window-icon"><ClientHudIcon name={icon} /></span
			>{title}</span
		>
		<button
			type="button"
			class="ui-button hud-window-close"
			aria-label={`Close ${title}`}
			onpointerdown={(event) => event.stopPropagation()}
			onclick={onClose}>×</button
		>
	</header>
	<div class="hud-window-content">{@render children()}</div>
	{#each resizeHandles as handle}
		<div
			class={`hud-window-resize hud-window-resize-${handle.name}`}
			role="presentation"
			onpointerdown={(event) => beginResize(event, handle.edges)}
		></div>
	{/each}
</section>

<style>
	@layer components {
		.hud-window {
			position: absolute;
			z-index: 100;
			display: grid;
			grid-template-rows: auto minmax(0, 1fr);
			overflow: visible;
			user-select: none;
		}

		.hud-window-titlebar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			cursor: move;
			touch-action: none;
		}

		.hud-window-titlebar:active {
			cursor: grabbing;
		}
		.hud-window-title {
			display: inline-flex;
			align-items: center;
			gap: 6px;
		}
		.hud-window-icon {
			width: 1em;
			height: 1em;
			flex: none;
		}

		.hud-window-close {
			width: 28px;
			height: 26px;
			min-height: 26px;
			margin-right: 2px;
			cursor: pointer;
		}

		.hud-window-content {
			min-width: 0;
			min-height: 0;
			overflow: hidden;
			user-select: text;
		}

		.hud-window-resize {
			position: absolute;
			z-index: 2;
			touch-action: none;
		}

		.hud-window-resize-top,
		.hud-window-resize-bottom {
			left: 8px;
			width: calc(100% - 16px);
			height: 8px;
		}

		.hud-window-resize-left,
		.hud-window-resize-right {
			top: 8px;
			width: 8px;
			height: calc(100% - 16px);
		}

		.hud-window-resize-top {
			top: 0;
			cursor: ns-resize;
		}

		.hud-window-resize-right {
			right: 0;
			cursor: ew-resize;
		}

		.hud-window-resize-bottom {
			bottom: 0;
			cursor: ns-resize;
		}

		.hud-window-resize-left {
			left: 0;
			cursor: ew-resize;
		}

		.hud-window-resize-top-left,
		.hud-window-resize-top-right,
		.hud-window-resize-bottom-right,
		.hud-window-resize-bottom-left {
			width: 12px;
			height: 12px;
		}

		.hud-window-resize-top-left {
			top: 0;
			left: 0;
			cursor: nwse-resize;
		}

		.hud-window-resize-top-right {
			top: 0;
			right: 0;
			cursor: nesw-resize;
		}

		.hud-window-resize-bottom-right {
			right: 0;
			bottom: 0;
			cursor: nwse-resize;
		}

		.hud-window-resize-bottom-left {
			bottom: 0;
			left: 0;
			cursor: nesw-resize;
		}
	}
</style>
