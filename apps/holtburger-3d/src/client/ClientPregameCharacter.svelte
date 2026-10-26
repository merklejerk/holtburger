<script lang="ts">
	import { onMount } from "svelte";
	import "./client-model-surface.css";
	import {
		mountModelRotation,
		modelHeadingDegrees,
	} from "./client-model-rotation";
	import type { ObjectPreviewFraming } from "../lib/game/preview/object-preview-viewport";
	import type {
		PregameCharacterPresentation,
		PregameCharacterSource,
		PregameCharacterStatus,
		PregameCharacterSurface,
	} from "./client-pregame-character";
	import type { PregameCharacterRectangle } from "./client-pregame-camera";
	import { CLIENT_TUNING } from "./client-tuning";
	import { CLIENT_PREGAME_CAMERA_TUNING } from "./client-pregame-tuning";

	interface Props {
		readonly scene: PregameCharacterPresentation;
		readonly source: PregameCharacterSource | null;
		readonly framing: ObjectPreviewFraming;
	}
	const { scene, source, framing }: Props = $props();
	let surface: HTMLDivElement;
	let handle: PregameCharacterSurface | null = null;
	let publishedSource: PregameCharacterSource | null = null;
	let rotation: ReturnType<typeof mountModelRotation> | null = null;
	let rectangle: PregameCharacterRectangle | null = null;
	let status = $state<PregameCharacterStatus>({ kind: "empty" });
	const initialHeading = modelHeadingDegrees(
		CLIENT_PREGAME_CAMERA_TUNING.initialYawRadians,
	);
	const diagnostic = $derived(
		status.kind === "failed" || status.kind === "limited"
			? status.message
			: status.kind === "ready" && status.replacement.kind === "failed"
				? status.replacement.message
				: null,
	);

	function publishSource(next: PregameCharacterSource | null): void {
		if (handle === null || next === publishedSource) return;
		publishedSource = next;
		handle.setSource(next);
	}

	function publishView(): void {
		if (rotation === null) return;
		handle?.setView(
			rectangle === null || document.visibilityState !== "visible"
				? null
				: { rectangle, headingRadians: rotation.heading(), framing },
		);
	}

	onMount(() => {
		const canvas = scene.canvas;
		let current = true;
		const measure = () => {
			if (!current) return;
			const bounds = surface.getBoundingClientRect();
			const origin = canvas.getBoundingClientRect();
			rectangle =
				bounds.width <= 0 || bounds.height <= 0
					? null
					: {
							left: bounds.left - origin.left,
							top: bounds.top - origin.top,
							width: bounds.width,
							height: bounds.height,
						};
			publishView();
		};
		const observer = new ResizeObserver(measure);
		const visibilityChanged = () => {
			if (document.visibilityState !== "visible") rotation?.cancelPointer();
			measure();
		};
		const revoke = () => {
			if (!current) return;
			current = false;
			handle = null;
			rotation?.destroy();
			rotation = null;
			observer.disconnect();
			window.removeEventListener("resize", measure);
			document.removeEventListener("scroll", measure, true);
			document.removeEventListener("visibilitychange", visibilityChanged);
		};
		rotation = mountModelRotation(surface, {
			...CLIENT_TUNING.objectPreview,
			initialYawRadians: CLIENT_PREGAME_CAMERA_TUNING.initialYawRadians,
			keyboardNavigation: false,
			onHeading: publishView,
		});
		const mounted = scene.characters.open((next) => {
			if (current) status = next;
		}, revoke);
		handle = mounted;
		observer.observe(surface);
		observer.observe(canvas);
		window.addEventListener("resize", measure);
		document.addEventListener("scroll", measure, true);
		document.addEventListener("visibilitychange", visibilityChanged);
		publishSource(source);
		measure();
		return () => {
			mounted.destroy();
			revoke();
		};
	});

	$effect(() => {
		const next = source;
		publishSource(next);
	});
	$effect(() => {
		void framing;
		publishView();
	});
</script>

<div
	class="creature-preview"
	bind:this={surface}
	role="slider"
	tabindex={-1}
	aria-label="Rotatable creature model. Drag horizontally to rotate."
	aria-valuemin={-180}
	aria-valuemax={180}
	aria-valuenow={initialHeading}
	aria-valuetext={`${initialHeading} degrees horizontal rotation`}
>
	{#if status.kind === "ready" && diagnostic !== null}
		<p class="creature-preview-error" role="alert">{diagnostic}</p>
	{:else if status.kind === "failed" || status.kind === "limited"}
		<div class="creature-preview-status" role="alert">
			<span aria-hidden="true">◆</span>
			{status.kind === "failed"
				? "Character unavailable"
				: "Character view unavailable"}
			{#if diagnostic !== null}<small>{diagnostic}</small>{/if}
		</div>
	{/if}
</div>
