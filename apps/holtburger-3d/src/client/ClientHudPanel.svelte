<script lang="ts">
	import type { Snippet } from "svelte";
	import {
		anchorClientHudPlacement,
		resolveClientHudPlacement,
		type ClientHudPlacement,
		type ClientHudViewport,
	} from "./client-hud-layout";

	interface Props {
		readonly children: Snippet;
		readonly editable: boolean;
		readonly label: string;
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
		minHeight,
		minWidth,
		placement,
		resizable,
		contentHitTesting,
		viewport,
		onPlacementChange,
	}: Props = $props();
	const resolved = $derived(
		resolveClientHudPlacement(placement, viewport, {
			width: minWidth,
			height: minHeight,
		}),
	);

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

	function beginResize(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startY = event.clientY;
		const start = resolved;
		const startViewport = viewport;
		trackPointer(event.pointerId, (moved) => {
			const width = Math.min(
				startViewport.width - start.left,
				Math.max(
					Math.min(minWidth, startViewport.width - start.left),
					start.width + moved.clientX - startX,
				),
			);
			const height = Math.min(
				startViewport.height - start.top,
				Math.max(
					Math.min(minHeight, startViewport.height - start.top),
					start.height + moved.clientY - startY,
				),
			);
			onPlacementChange(
				anchorClientHudPlacement({ ...start, width, height }, startViewport, {
					width,
					height,
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
	class="hud-panel"
	class:hud-panel-editable={editable}
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
		<button
			type="button"
			class="hud-panel-handle hud-panel-move"
			onpointerdown={beginDrag}
			aria-label={`Move ${label}`}>✥</button
		>
		{#if resizable}
			<button
				type="button"
				class="hud-panel-handle hud-panel-resize"
				onpointerdown={beginResize}
				aria-label={`Resize ${label}`}>↘</button
			>
		{/if}
	{/if}
</section>

<style>
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

	.hud-panel-editable {
		outline: 1px dashed rgb(244 203 97 / 0.65);
		outline-offset: 3px;
	}

	.hud-panel-handle {
		position: absolute;
		z-index: 2;
		width: 22px;
		height: 22px;
		min-height: 0;
		padding: 0;
		border: 1px solid rgb(211 169 68 / 0.9);
		border-radius: 50%;
		background: rgb(20 18 14 / 0.92);
		color: #f2ce70;
		font-size: 13px;
		line-height: 20px;
		pointer-events: auto;
	}

	.hud-panel-move {
		top: -11px;
		left: -11px;
		cursor: grab;
	}

	.hud-panel-resize {
		right: -11px;
		bottom: -11px;
		cursor: nwse-resize;
	}
</style>
