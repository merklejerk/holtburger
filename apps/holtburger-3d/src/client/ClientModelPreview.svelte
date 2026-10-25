<script lang="ts">
	import { onMount } from "svelte";
	import type { ObjectPreviewSource } from "../lib/game/runtime/object-preview-source";
	import type { ObjectPreviewViewport } from "../lib/game/preview/object-preview-viewport";
	import type { ObjectPreviewHandle } from "../lib/game/preview/object-preview-controller";
	import type { ClientObjectPreviewService } from "./client-object-preview-service";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		readonly source: ObjectPreviewSource | null;
		/** Consumer wording while no subject is admitted, including missing cached captures. */
		readonly emptyMessage: string;
		readonly service: ClientObjectPreviewService;
		/** Inspector orbits the camera; creator turns the subject independently of its backdrop. */
		readonly rotation: "orbit" | "subject";
		/** Inspectors support Tab focus; pregame previews keep dragging separate from keyboard ownership. */
		readonly keyboardNavigation: boolean;
		/** Frontend-owned focus policy, independent of model part numbering. */
		readonly framing: ObjectPreviewViewport["framing"];
	}

	const {
		source,
		service,
		rotation,
		framing,
		emptyMessage,
		keyboardNavigation,
	}: Props = $props();
	const tuning = CLIENT_TUNING.objectPreview;
	let surface: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let status = $state<"empty" | "loading" | "ready" | "failed">("loading");
	let diagnostic = $state<string | null>(null);
	// Pointer-rate heading stays with the imperative viewport owner, outside Svelte's UI graph.
	let yaw: number = tuning.initialYawRadians;
	const initialYawDegrees = yawDegrees(tuning.initialYawRadians);
	let pointer: { readonly id: number; x: number } | null = null;
	let preview: ObjectPreviewHandle | null = null;
	let installedSource: ObjectPreviewSource | null = null;
	let sourceRevision = 0;

	function publishViewport(): void {
		if (surface) {
			const degrees = yawDegrees(yaw);
			surface.setAttribute("aria-valuenow", String(degrees));
			surface.setAttribute(
				"aria-valuetext",
				`${degrees} degrees horizontal rotation`,
			);
		}
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
			rotation:
				rotation === "orbit"
					? { kind: "orbit", yawRadians: yaw }
					: // Retail creator camera is at negative AC Y (render +Z), with the body
						// initially facing 180 degrees (acclient.c:177525,180040). Keep the
						// inspector's orbit policy independent from this fixed backdrop viewpoint.
						{
							kind: "subject",
							headingRadians: Math.PI + yaw,
							cameraYawRadians: Math.PI,
						},
			framing,
		});
	}

	function yawDegrees(radians: number): number {
		const degrees = (radians * 180) / Math.PI;
		return Math.round(((((degrees + 180) % 360) + 360) % 360) - 180);
	}

	function handlePointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (keyboardNavigation) surface.focus();
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
		installedSource = source;
		status = source === null ? "empty" : "loading";
		const handle = service.open({
			canvas,
			source,
		});
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
				if (current && sourceRevision === 0)
					status = source === null ? "empty" : "ready";
			},
			(error: unknown) => {
				if (!current || sourceRevision !== 0) return;
				status = "failed";
				diagnostic = error instanceof Error ? error.message : String(error);
			},
		);
		return () => {
			current = false;
			sourceRevision++;
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

	// Cold source publication replaces only the visual bundle. Mount owns the device lifetime.
	$effect(() => {
		const next = source;
		const handle = preview;
		if (handle === null || next === installedSource) return;
		installedSource = next;
		const revision = ++sourceRevision;
		diagnostic = null;
		if (next === null) {
			status = "empty";
			void handle.withdrawSource().catch((error: unknown) => {
				if (preview !== handle || revision !== sourceRevision) return;
				status = "failed";
				diagnostic = error instanceof Error ? error.message : String(error);
			});
			return;
		}
		if (status !== "ready") status = "loading";
		void handle.replaceSource(next).then(
			(result) => {
				if (preview !== handle || revision !== sourceRevision) return;
				if (result.kind === "installed") status = "ready";
			},
			(error: unknown) => {
				if (preview !== handle || revision !== sourceRevision) return;
				if (status !== "ready") status = "failed";
				diagnostic = error instanceof Error ? error.message : String(error);
			},
		);
	});

	$effect(() => {
		// These are explicit cold controls; gestures publish directly to the retained handle.
		void rotation;
		void framing;
		publishViewport();
	});
</script>

<div
	class="creature-preview"
	bind:this={surface}
	role="slider"
	tabindex={keyboardNavigation ? 0 : -1}
	aria-label={keyboardNavigation
		? "Rotatable creature model. Drag horizontally or use the left and right arrow keys."
		: "Rotatable creature model. Drag horizontally to rotate."}
	aria-valuemin={-180}
	aria-valuemax={180}
	aria-valuenow={initialYawDegrees}
	aria-valuetext={`${initialYawDegrees} degrees horizontal rotation`}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={finishPointer}
	onpointercancel={finishPointer}
	onlostpointercapture={() => (pointer = null)}
	onblur={cancelPointer}
	onkeydown={handleKeydown}
>
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
	{#if status === "ready" && diagnostic !== null}
		<p class="creature-preview-error" role="alert">{diagnostic}</p>
	{/if}
	{#if status !== "ready"}
		<div
			class="creature-preview-status"
			role={status === "failed" ? "alert" : "status"}
		>
			<span aria-hidden="true">◆</span>
			{status === "empty"
				? emptyMessage
				: status === "failed"
					? "Preview unavailable"
					: "Loading model…"}
			{#if diagnostic !== null}<small>{diagnostic}</small>{/if}
		</div>
	{/if}
</div>

<style>
	@layer components {
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
		.creature-preview-error {
			position: absolute;
			inset-inline: 0;
			bottom: 0;
			margin: 0;
			padding: 6px;
			color: var(--ui-color-danger);
			background: var(--ui-color-well);
		}
		.creature-preview-status > span {
			font-size: 1.6rem;
			color: var(--ui-color-danger);
		}
		.creature-preview-status small {
			max-width: 30em;
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
		}
	}
</style>
