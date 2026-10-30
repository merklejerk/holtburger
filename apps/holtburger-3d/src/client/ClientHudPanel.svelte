<script lang="ts">
	import { onDestroy, onMount, type Snippet } from "svelte";
	import { useClientHudGeometry } from "./client-hud-geometry-context";
	import type { HudSurfaceId } from "./client-hud-geometry";
	import { snapClientHudRectangle } from "./client-hud-snapping";
	import { CLIENT_HUD_SNAP_TUNING } from "./client-tuning";
	import LayoutControls, {
		type LayoutMoveInset,
	} from "../app/LayoutControls.svelte";
	import type { ResizeEdges } from "../app/resize-edges";
	import { trackPointerGesture } from "../app/pointer-gesture";
	import {
		anchorClientHudPlacement,
		moveClientHudRectangle,
		resizeClientPanelRectangle,
		resolveClientHudPlacement,
		type ClientHudPlacement,
		type ClientHudViewport,
	} from "./client-hud-layout";

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
		readonly placement: ClientHudPlacement;
		/** Whether unlocked layout editing allows dragging the borders to resize. */
		readonly resizable: boolean;
		/** Whether the entire HUD rectangle or only explicit descendants participate in hit testing. */
		readonly contentHitTesting: "surface" | "descendants";
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
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
		contentHitTesting,
		viewport,
		onPlacementChange,
	}: Props = $props();
	const geometry = useClientHudGeometry();
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
		resolveClientHudPlacement(sizedPlacement, viewport, minimum),
	);
	let cancelPointerGesture: (() => void) | null = null;
	onDestroy(() => cancelPointerGesture?.());

	function beginDrag(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startY = event.clientY;
		const start = resolved;
		const startViewport = viewport;
		const preferred = {
			width: sizedPlacement.preferredWidth,
			height: sizedPlacement.preferredHeight,
		};
		cancelPointerGesture?.();
		cancelPointerGesture = trackPointerGesture(
			window,
			event.pointerId,
			(moved) => {
				const rectangle = moveClientHudRectangle(
					start,
					startViewport,
					minimum,
					preferred,
					{ x: moved.clientX - startX, y: moved.clientY - startY },
				);
				onPlacementChange(
					anchorClientHudPlacement(
						snapId === undefined
							? rectangle
							: snapClientHudRectangle(
									rectangle,
									geometry.readPeers(snapId),
									startViewport,
									CLIENT_HUD_SNAP_TUNING,
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
