<script lang="ts">
	import type {
		ClientPresentationCameraController,
		ClientPresentationStatus,
	} from "./client-presentation-session";

	interface Props {
		readonly cameraController: ClientPresentationCameraController | null;
		readonly presentationStatus: ClientPresentationStatus;
		readonly presentationStatusText: (
			status: ClientPresentationStatus,
		) => string;
		readonly presentationError: string | null;
		readonly onCanvas: (canvas: HTMLCanvasElement | null) => void;
		readonly onDisconnect: () => void | Promise<void>;
	}

	let {
		cameraController,
		presentationStatus,
		presentationStatusText,
		presentationError,
		onCanvas,
		onDisconnect,
	}: Props = $props();
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let pointerId: number | null = null;
	let pointerX = 0;
	let pointerY = 0;

	$effect(() => {
		onCanvas(canvasElement);
	});

	function handlePointerDown(event: PointerEvent): void {
		if (cameraController === null || event.button !== 0 || pointerId !== null)
			return;
		pointerId = event.pointerId;
		pointerX = event.clientX;
		pointerY = event.clientY;
		canvasElement?.setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (pointerId !== event.pointerId || cameraController === null) return;
		const deltaX = event.clientX - pointerX;
		const deltaY = event.clientY - pointerY;
		pointerX = event.clientX;
		pointerY = event.clientY;
		if (deltaX === 0 && deltaY === 0) return;
		cameraController.orbit(deltaX, -deltaY, performance.now());
	}

	function releasePointer(event: PointerEvent): void {
		if (pointerId !== event.pointerId) return;
		pointerId = null;
		if (canvasElement?.hasPointerCapture(event.pointerId))
			canvasElement.releasePointerCapture(event.pointerId);
	}

	function handleWheel(event: WheelEvent): void {
		if (cameraController === null) return;
		event.preventDefault();
		cameraController.zoom(event.deltaY * 0.01);
	}
</script>

<main class="client-world" aria-label="Holtburger client world">
	<canvas
		bind:this={canvasElement}
		class="client-canvas"
		aria-label="Game world"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={releasePointer}
		onpointercancel={releasePointer}
		onwheel={handleWheel}
	></canvas>
	<section class="client-world-status" aria-live="polite">
		<strong>Holtburger 3D Client</strong>
		<span>{presentationStatusText(presentationStatus)}</span>
		{#if presentationError !== null}
			<span class="client-status-error" role="alert">{presentationError}</span>
		{/if}
		<button class="client-action" onclick={() => void onDisconnect()}
			>Disconnect</button
		>
	</section>
</main>

<style>
	.client-world {
		position: relative;
		min-height: 100vh;
		background: #080706;
	}

	.client-canvas {
		display: block;
		width: 100%;
		height: 100vh;
		min-height: 320px;
		cursor: grab;
		touch-action: none;
	}

	.client-canvas:active {
		cursor: grabbing;
	}

	.client-world-status {
		position: fixed;
		top: 16px;
		left: 16px;
		display: grid;
		gap: 6px;
		max-width: min(360px, calc(100vw - 32px));
		padding: 10px 12px;
		border: 1px solid rgb(162 117 33 / 55%);
		background: rgb(16 12 7 / 86%);
		color: var(--ac-ink);
		font-family: var(--ac-font-ui);
		font-size: 0.82rem;
		text-shadow: 1px 1px 0 #000;
	}

	.client-world-status span {
		color: var(--ac-ink-muted);
	}

	.client-status-error {
		padding: 10px;
		border: 1px solid rgb(179 41 27 / 0.9);
		background: rgb(65 14 11 / 0.72);
		color: var(--ac-ink);
	}

	.client-action {
		min-width: 120px;
		padding: 6px 12px;
		cursor: pointer;
	}
</style>
