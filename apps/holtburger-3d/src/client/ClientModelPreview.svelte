<script lang="ts">
	import { onMount } from "svelte";
	import "./client-model-surface.css";
	import {
		mountModelRotation,
		modelHeadingDegrees,
	} from "./client-model-rotation";
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
		/** Orbit the camera, or turn the subject independently of its composition backdrop. */
		readonly rotation: "orbit" | "subject";
		/** Enable Tab focus and arrow rotation for keyboard-owned inspection. */
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
	let rotationInput: ReturnType<typeof mountModelRotation> | null = null;
	const initialYawDegrees = modelHeadingDegrees(tuning.initialYawRadians);
	let preview: ObjectPreviewHandle | null = null;
	let installedSource: ObjectPreviewSource | null = null;
	let sourceRevision = 0;

	function publishViewport(): void {
		const input = rotationInput;
		if (input === null) return;
		const yaw = input.heading();
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

	onMount(() => {
		rotationInput = mountModelRotation(surface, {
			...tuning,
			keyboardNavigation,
			onHeading: publishViewport,
		});
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
			if (document.visibilityState !== "visible")
				rotationInput?.cancelPointer();
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
			rotationInput?.destroy();
			rotationInput = null;
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
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: auto;
	}
</style>
