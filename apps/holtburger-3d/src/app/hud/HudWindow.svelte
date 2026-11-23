<script lang="ts">
	import { onDestroy, untrack, type Snippet } from "svelte";
	import { useAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import type { EscapeContextHandle } from "../../lib/input/keyboard-input-policy";
	import { pointerUiScale, trackUiPointerGesture } from "../theme/ui-scale";
	import ResizeBorders from "../ui/ResizeBorders.svelte";
	import type { ResizeEdges } from "../ui/resize-edges";
	import {
		anchorHudPlacement,
		resizePanelRectangle,
		resolveHudPlacement,
		type HudPlacement,
		type HudViewport,
	} from "./hud-geometry";
	import { UI_LAYERS } from "./hud-layers";

	interface Props {
		readonly children: Snippet;
		readonly icon: Snippet;
		readonly minHeight: number;
		readonly minWidth: number;
		readonly placement: HudPlacement;
		readonly title: string;
		/** Whether this floating window exposes border resize handles. */
		readonly resizable?: boolean;
		/** Natural content determines height instead of saved height and the vertical minimum. */
		readonly fitContentHeight?: boolean;
		readonly viewport: HudViewport;
		/** Launcher click revision promotes an already open independent window. */
		readonly focusRevision?: number;
		/** Content mounts on first opening and stays retained while hidden; hidden windows release input ownership. */
		readonly visible?: boolean;
		readonly onClose: () => void;
		readonly onPlacementChange: (placement: HudPlacement) => void;
	}

	const {
		children,
		icon,
		minHeight,
		minWidth,
		placement,
		title,
		resizable = true,
		fitContentHeight = false,
		viewport,
		focusRevision = 0,
		visible = true,
		onClose,
		onPlacementChange,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	let measuredHeight = $state(0);
	const sizedPlacement = $derived(
		fitContentHeight
			? { ...placement, preferredHeight: measuredHeight }
			: placement,
	);
	const minimum = $derived({
		width: minWidth,
		height: fitContentHeight ? 0 : minHeight,
	});
	const resolved = $derived(
		resolveHudPlacement(sizedPlacement, viewport, minimum),
	);
	let cancelPointerGesture: (() => void) | null = null;
	let escapeContext: EscapeContextHandle | null = null;
	let element = $state<HTMLElement>();
	let mounted = $state(untrack(() => visible));
	$effect(() => {
		if (visible) mounted = true;
	});
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
		escapeContext = keyboard.bindEscapeContext(() => onClose(), {
			onOrder: (value) => (depth = value),
			untilRelease: true,
		});
		return () => {
			escapeContext?.release();
			escapeContext = null;
		};
	});
	$effect(() => {
		if (visible && focusRevision > 0) escapeContext?.promote();
	});
	function focusWindow(): void {
		escapeContext?.promote();
	}

	function beginDrag(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const scale = pointerUiScale(event);
		const startX = event.clientX;
		const startY = event.clientY;
		const start = resolved;
		const startViewport = viewport;
		const preferred = {
			width: sizedPlacement.preferredWidth,
			height: sizedPlacement.preferredHeight,
		};
		cancelPointerGesture?.();
		cancelPointerGesture = trackUiPointerGesture(
			window,
			event.pointerId,
			(moved) => {
				onPlacementChange(
					anchorHudPlacement(
						{
							...start,
							left: start.left + (moved.clientX - startX) / scale,
							top: start.top + (moved.clientY - startY) / scale,
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
		const scale = pointerUiScale(event);
		const startX = event.clientX;
		const startY = event.clientY;
		const start = resolved;
		const startViewport = viewport;
		cancelPointerGesture?.();
		cancelPointerGesture = trackUiPointerGesture(
			window,
			event.pointerId,
			(moved) => {
				const rectangle = resizePanelRectangle(
					start,
					startViewport,
					minimum,
					{
						x: (moved.clientX - startX) / scale,
						y: (moved.clientY - startY) / scale,
					},
					edges,
				);
				onPlacementChange(
					anchorHudPlacement(rectangle, startViewport, {
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
		bind:offsetHeight={measuredHeight}
		hidden={!visible}
		inert={!visible}
		style:display={visible ? undefined : "none"}
		style:left={`${resolved.left}px`}
		style:top={`${resolved.top}px`}
		style:width={`${resolved.width}px`}
		style:height={fitContentHeight ? undefined : `${resolved.height}px`}
		style:max-height={fitContentHeight ? `${viewport.height}px` : undefined}
		style:z-index={UI_LAYERS.windowBase + depth}
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
				><span class="hud-window-icon">{@render icon()}</span>{title}</span
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
		{#if resizable}<ResizeBorders
				onresize={beginResize}
				axes={fitContentHeight ? "horizontal" : "both"}
			/>{/if}
	</section>
{/if}

<style>
	@layer components {
		.hud-window {
			--ui-panel-opacity: var(--ui-hud-window-opacity);
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
