<script lang="ts">
	import { onDestroy, onMount, type Snippet } from "svelte";
	import { useClientHudGeometry } from "./client-hud-geometry-context";
	import type { HudSurfaceId } from "./client-hud-geometry";
	import { snapClientHudRectangle } from "./client-hud-snapping";
	import { CLIENT_HUD_SNAP_TUNING } from "./client-tuning";
	import LayoutControls, {
		type LayoutMoveInset,
	} from "../app/LayoutControls.svelte";
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
		readonly minHeight: number;
		readonly minWidth: number;
		readonly placement: ClientHudPlacement;
		/** Whether unlocked layout editing exposes the bottom-right resize affordance. */
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
	const resolved = $derived(
		resolveClientHudPlacement(placement, viewport, {
			width: minWidth,
			height: minHeight,
		}),
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
			width: placement.preferredWidth,
			height: placement.preferredHeight,
		};
		cancelPointerGesture?.();
		cancelPointerGesture = trackPointerGesture(
			window,
			event.pointerId,
			(moved) => {
				const rectangle = moveClientHudRectangle(
					start,
					startViewport,
					{ width: minWidth, height: minHeight },
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

	function beginResize(event: PointerEvent): void {
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
					{ width: minWidth, height: minHeight },
					{ x: moved.clientX - startX, y: moved.clientY - startY },
					{ horizontal: "right", vertical: "bottom" },
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
			{resizable}
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
