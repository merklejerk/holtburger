<script lang="ts">
	import { onMount } from "svelte";
	import type { ObjectPreviewSource } from "./client-object-preview-contract";
	import type { ObjectPreviewHandle } from "../lib/game/preview/object-preview-controller";
	import type { ClientObjectPreviewService } from "./client-object-preview-service";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		readonly source: ObjectPreviewSource;
		readonly service: ClientObjectPreviewService;
	}

	const { source, service }: Props = $props();
	const tuning = CLIENT_TUNING.objectPreview;
	let surface: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let status = $state<"loading" | "ready" | "failed">("loading");
	let diagnostic = $state<string | null>(null);
	let yaw = $state<number>(tuning.initialYawRadians);
	let pointer: { readonly id: number; x: number } | null = null;
	let preview: ObjectPreviewHandle | null = null;

	function publishViewport(): void {
		if (!surface || document.visibilityState !== "visible") {
			preview?.setViewport(null);
			return;
		}
		const bounds = surface.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0) {
			preview?.setViewport(null);
			return;
		}
		const resolutionScale = Math.max(
			tuning.minimumResolutionScale,
			window.devicePixelRatio,
		);
		const desiredWidth = bounds.width * resolutionScale;
		const desiredHeight = bounds.height * resolutionScale;
		const scale = Math.min(
			1,
			tuning.maximumBufferWidth / desiredWidth,
			tuning.maximumBufferHeight / desiredHeight,
		);
		preview?.setViewport({
			extent: {
				width: Math.max(1, Math.round(desiredWidth * scale)),
				height: Math.max(1, Math.round(desiredHeight * scale)),
			},
			minimumFrameIntervalSeconds: 1 / tuning.maximumFramesPerSecond,
			yawRadians: yaw,
		});
	}

	function yawDegrees(): number {
		const degrees = (yaw * 180) / Math.PI;
		return Math.round(((((degrees + 180) % 360) + 360) % 360) - 180);
	}

	function handlePointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		surface.focus();
		surface.setPointerCapture(event.pointerId);
		pointer = { id: event.pointerId, x: event.clientX };
	}

	function handlePointerMove(event: PointerEvent): void {
		if (pointer?.id !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		yaw += (event.clientX - pointer.x) * tuning.yawRadiansPerPixel;
		pointer = { id: pointer.id, x: event.clientX };
		publishViewport();
	}

	function finishPointer(event: PointerEvent): void {
		if (pointer?.id !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		pointer = null;
		if (surface.hasPointerCapture(event.pointerId))
			surface.releasePointerCapture(event.pointerId);
	}

	function cancelPointer(): void {
		const pointerId = pointer?.id;
		pointer = null;
		if (pointerId !== undefined && surface.hasPointerCapture(pointerId))
			surface.releasePointerCapture(pointerId);
	}

	function handleKeydown(event: KeyboardEvent): void {
		const step = tuning.keyboardYawStepRadians;
		if (event.key === "ArrowLeft") yaw -= step;
		else if (event.key === "ArrowRight") yaw += step;
		else return;
		event.preventDefault();
		event.stopPropagation();
		publishViewport();
	}

	onMount(() => {
		let current = true;
		const handle = service.open({ canvas, source });
		preview = handle;
		const observer = new ResizeObserver(publishViewport);
		observer.observe(surface);
		const visibilityChanged = (): void => {
			if (document.visibilityState !== "visible") cancelPointer();
			publishViewport();
		};
		document.addEventListener("visibilitychange", visibilityChanged);
		publishViewport();
		void handle.ready.then(
			() => {
				if (current) status = "ready";
			},
			(error: unknown) => {
				if (!current) return;
				status = "failed";
				diagnostic = error instanceof Error ? error.message : String(error);
			},
		);
		return () => {
			current = false;
			preview = null;
			cancelPointer();
			observer.disconnect();
			document.removeEventListener("visibilitychange", visibilityChanged);
			handle.setViewport(null);
			void handle
				.dispose()
				.catch((error: unknown) =>
					console.error("Object preview teardown failed.", error),
				);
		};
	});
</script>

<div
	class="creature-preview"
	bind:this={surface}
	role="slider"
	tabindex="0"
	aria-label="Rotatable creature model. Drag horizontally or use the left and right arrow keys."
	aria-valuemin={-180}
	aria-valuemax={180}
	aria-valuenow={yawDegrees()}
	aria-valuetext={`${yawDegrees()} degrees horizontal rotation`}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={finishPointer}
	onpointercancel={finishPointer}
	onlostpointercapture={() => (pointer = null)}
	onblur={cancelPointer}
	onkeydown={handleKeydown}
>
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
	{#if status !== "ready"}
		<div
			class="creature-preview-status"
			role={status === "failed" ? "alert" : "status"}
		>
			<span aria-hidden="true">◆</span>
			{status === "failed" ? "Preview unavailable" : "Loading model…"}
			{#if diagnostic !== null}<small>{diagnostic}</small>{/if}
		</div>
	{/if}
</div>

<style>
	.creature-preview {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		background: transparent;
		cursor: grab;
		outline: none;
		touch-action: none;
		user-select: none;
	}
	.creature-preview:active {
		cursor: grabbing;
	}
	.creature-preview:focus-visible {
		box-shadow: inset 0 0 0 1px var(--ui-color-highlight);
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: auto;
	}
	.creature-preview-status {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 6px;
		padding: 12px;
		text-align: center;
		color: var(--ui-color-muted);
		background: color-mix(in srgb, var(--ui-color-well) 88%, transparent);
	}
	.creature-preview-status > span {
		font-size: 1.6rem;
		color: var(--ui-color-danger);
	}
	.creature-preview-status small {
		max-width: 30em;
		font-size: 0.72rem;
	}
</style>
