<script lang="ts">
	import ResizeBorders from "../app/ResizeBorders.svelte";
	import type { ResizeEdges } from "../app/resize-edges";
	import { onDestroy, untrack, type Snippet } from "svelte";
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
		/** Content mounts on first opening and stays retained while hidden; hidden windows release input ownership. */
		readonly visible?: boolean;
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
		visible = true,
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
	/** The DOM reference becomes available only after first opening. */
	let element = $state<HTMLElement>();
	/** The shell owns first-open lifetime; callers only supply visibility and domain identity. */
	// Initial visibility is a mount-time snapshot: already-open callers need their DOM during onMount.
	let mounted = $state(untrack(() => visible));
	$effect(() => {
		if (visible) mounted = true;
	});
	/** Cold visual order is published by the same owner that routes Escape. */
	let depth = $state(0);
	onDestroy(() => cancelPointerGesture?.());
	$effect(() => {
		if (!visible) {
			cancelPointerGesture?.();
			cancelPointerGesture = null;
			const focused = document.activeElement;
			if (focused instanceof HTMLElement && element?.contains(focused))
				focused.blur();
			return;
		}
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
		if (visible && focusRevision > 0) escapeContext?.promote();
	});
	function focusWindow(): void {
		// Pointer intent promotes the window; automatic editor/modal focus restoration does not.
		escapeContext?.promote();
	}

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

	function beginResize(event: PointerEvent, edges: ResizeEdges): void {
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

{#if mounted}
	<section
		class="hud-window ui-panel"
		bind:this={element}
		hidden={!visible}
		inert={!visible}
		style:display={visible ? undefined : "none"}
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
		<ResizeBorders onresize={beginResize} axes="both" />
	</section>
{/if}

<style>
	@layer components {
		.hud-window {
			/* Absolute children start inside ui-panel's 1px border. Include it so
			 * targets reach the outermost frame paint while keeping their inner reach. */
			--ui-resize-outset: calc(var(--ui-window-frame-outset) + 1px);
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
			padding-right: var(--ui-hud-window-close-inset);
			cursor: move;
			touch-action: none;
		}

		.hud-window-titlebar:active {
			cursor: grabbing;
		}
		.hud-window-title {
			display: inline-flex;
			min-width: 0;
			overflow-wrap: anywhere;
			align-items: center;
			gap: 6px;
		}
		.hud-window-icon {
			width: 1em;
			height: 1em;
			flex: none;
		}

		.hud-window-close {
			/* Keep the full button clickable when a theme places it inside the resize strips. */
			position: relative;
			z-index: 3;
			width: max(28px, calc(1em + 10px));
			height: max(26px, calc(1.35em + 6px));
			min-height: 26px;
			flex: none;
			cursor: pointer;
		}

		.hud-window-content {
			min-width: 0;
			min-height: 0;
			overflow: hidden;
			user-select: text;
		}
	}
</style>
