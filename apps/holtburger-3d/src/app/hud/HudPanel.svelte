<script lang="ts">
	import { onDestroy, onMount, type Snippet } from "svelte";
	import { pointerUiScale, trackUiPointerGesture } from "../theme/ui-scale";
	import LayoutControls, {
		type LayoutMoveInset,
	} from "../ui/LayoutControls.svelte";
	import type { ResizeEdges } from "../ui/resize-edges";
	import {
		anchorHudPlacement,
		moveHudRectangle,
		resizePanelRectangle,
		resolveHudPlacement,
		type HudPlacement,
		type HudSurfaceId,
		type HudViewport,
	} from "./hud-geometry";
	import { useHudGeometry } from "./hud-geometry-context";
	import { HUD_SNAP_TUNING, snapHudRectangle } from "./hud-snapping";

	interface Props {
		readonly children: Snippet;
		readonly editable: boolean;
		readonly label: string;
		/** Stable opt-in to peer snapping for this mounted surface. */
		readonly snapId?: HudSurfaceId;
		/** Reserved header space before the unlocked move handle. */
		readonly moveInset?: LayoutMoveInset;
		/** Measured content height overrides saved height and permits width-only resizing. */
		readonly contentHeight?: number;
		readonly minHeight: number;
		readonly minWidth: number;
		readonly placement: HudPlacement;
		/** Whether unlocked layout editing allows dragging the borders to resize. */
		readonly resizable: boolean;
		/** Optional width increment in logical UI units, applied after pointer-scale conversion. */
		readonly resizeWidthStep?: number;
		/** Whether the entire HUD rectangle or only explicit descendants participate in hit testing. */
		readonly contentHitTesting: "surface" | "descendants";
		readonly viewport: HudViewport;
		readonly onPlacementChange: (placement: HudPlacement) => void;
	}

	const {
		children,
		editable,
		label,
		snapId,
		moveInset,
		minHeight,
		contentHeight,
		minWidth,
		placement,
		resizable,
		resizeWidthStep,
		contentHitTesting,
		viewport,
		onPlacementChange,
	}: Props = $props();
	const geometry = useHudGeometry();
	onMount(() => {
		if (snapId === undefined) return;
		return geometry.register({ id: snapId, readBounds: () => resolved });
	});
	// Content owns the vertical extent when supplied; retained user height must not create blank hit area.
	const sizedPlacement = $derived(
		contentHeight === undefined
			? placement
			: { ...placement, preferredHeight: contentHeight },
	);
	const minimum = $derived({
		width: minWidth,
		height: contentHeight === undefined ? minHeight : contentHeight,
	});
	const resolved = $derived(
		resolveHudPlacement(sizedPlacement, viewport, minimum),
	);
	let cancelPointerGesture: (() => void) | null = null;
	onDestroy(() => cancelPointerGesture?.());

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
				const rectangle = moveHudRectangle(
					start,
					startViewport,
					minimum,
					preferred,
					{
						x: (moved.clientX - startX) / scale,
						y: (moved.clientY - startY) / scale,
					},
				);
				onPlacementChange(
					anchorHudPlacement(
						snapId === undefined
							? rectangle
							: snapHudRectangle(
									rectangle,
									geometry.readPeers(snapId),
									startViewport,
									HUD_SNAP_TUNING,
								),
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
					resizeWidthStep,
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

<section
	class="hud-panel"
	class:ui-layout-editable={editable}
	style:left={`${resolved.left}px`}
	style:top={`${resolved.top}px`}
	style:width={`${resolved.width}px`}
	style:height={`${resolved.height}px`}
	aria-label={label}
>
	<div
		class="hud-panel-content"
		class:hud-panel-content-passthrough={contentHitTesting === "descendants"}
	>
		{@render children()}
	</div>
	{#if editable}
		<LayoutControls
			{moveInset}
			{label}
			resize={!resizable
				? "none"
				: contentHeight === undefined
					? "both"
					: "horizontal"}
			onmove={beginDrag}
			onresize={beginResize}
		/>
	{/if}
</section>

<style>
	@layer components {
		.hud-panel {
			position: absolute;
			z-index: 3;
			pointer-events: none;
			user-select: none;
		}

		.hud-panel-content {
			width: 100%;
			height: 100%;
			pointer-events: auto;
		}

		.hud-panel-content-passthrough {
			pointer-events: none;
		}
	}
</style>
