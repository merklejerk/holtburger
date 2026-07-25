<script lang="ts">
	import { onMount } from "svelte";
	import type { Texture2DReadback } from "../lib/game/renderer/webgl2-device";
	import type {
		TextureAtlasPageDiagnostics,
		TextureAtlasPageEntryDiagnostics,
	} from "../lib/game/textures/texture-manager";

	interface Props {
		/** Active page facts captured when the inspector was opened. */
		readonly page: TextureAtlasPageDiagnostics;
		/** Explicit one-off GPU copy retained only for the modal lifetime. */
		readonly preview: Texture2DReadback;
		readonly onClose: () => void;
	}

	let { page, preview, onClose }: Props = $props();
	let canvasElement: HTMLCanvasElement | null = $state(null);
	let viewportElement: HTMLDivElement | null = $state(null);
	let sourceCanvas: HTMLCanvasElement | null = $state(null);
	let boundsVisible = $state(true);
	let selectedEntryKey = $state<string | null>(null);
	let panX = $state(0);
	let panY = $state(0);
	let zoom = $state(1);
	let dragState: {
		readonly pointerId: number;
		readonly startClientX: number;
		readonly startClientY: number;
		readonly startPanX: number;
		readonly startPanY: number;
		moved: boolean;
	} | null = null;

	const selectedEntry = $derived(
		page.entries.find((entry) => entry.key === selectedEntryKey) ??
			page.entries[0] ??
			null,
	);

	onMount(() => {
		sourceCanvas = createSourceCanvas(preview);
		requestAnimationFrame(fitPage);
	});

	$effect(() => {
		canvasElement;
		viewportElement;
		sourceCanvas;
		boundsVisible;
		selectedEntryKey;
		panX;
		panY;
		zoom;
		drawPage();
	});

	$effect(() => {
		if (!viewportElement) return;
		const observer = new ResizeObserver(drawPage);
		observer.observe(viewportElement);
		return () => observer.disconnect();
	});

	function handleWindowKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") onClose();
	}

	function fitPage(): void {
		const viewport = viewportElement?.getBoundingClientRect();
		if (!viewport) return;
		zoom = Math.min(
			8,
			Math.max(
				0.05,
				Math.min(
					viewport.width / preview.width,
					viewport.height / preview.height,
				),
			),
		);
		panX = (viewport.width - preview.width * zoom) * 0.5;
		panY = (viewport.height - preview.height * zoom) * 0.5;
	}

	function drawPage(): void {
		if (!canvasElement || !viewportElement || !sourceCanvas) return;
		const viewport = viewportElement.getBoundingClientRect();
		const pixelRatio = window.devicePixelRatio || 1;
		const canvasWidth = Math.max(1, Math.floor(viewport.width * pixelRatio));
		const canvasHeight = Math.max(1, Math.floor(viewport.height * pixelRatio));
		if (
			canvasElement.width !== canvasWidth ||
			canvasElement.height !== canvasHeight
		) {
			canvasElement.width = canvasWidth;
			canvasElement.height = canvasHeight;
		}
		const context = canvasElement.getContext("2d");
		if (!context)
			throw new Error("Texture page inspector could not create a 2D context.");
		context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		context.clearRect(0, 0, viewport.width, viewport.height);
		context.imageSmoothingEnabled = false;
		drawCheckerboard(context, viewport);
		context.drawImage(
			sourceCanvas,
			panX,
			panY,
			preview.width * zoom,
			preview.height * zoom,
		);
		drawPageBorder(context);
		if (boundsVisible) drawEntryBounds(context);
	}

	function drawCheckerboard(
		context: CanvasRenderingContext2D,
		viewport: DOMRect,
	): void {
		context.save();
		context.beginPath();
		context.rect(panX, panY, preview.width * zoom, preview.height * zoom);
		context.clip();
		const cellSize = Math.max(4, 16 * zoom);
		for (
			let y = Math.floor(-panY / cellSize) - 1;
			y <= Math.ceil((viewport.height - panY) / cellSize) + 1;
			y += 1
		) {
			for (
				let x = Math.floor(-panX / cellSize) - 1;
				x <= Math.ceil((viewport.width - panX) / cellSize) + 1;
				x += 1
			) {
				context.fillStyle =
					(x + y) % 2 === 0 ? "rgb(48, 58, 54)" : "rgb(28, 36, 33)";
				context.fillRect(
					panX + x * cellSize,
					panY + y * cellSize,
					cellSize,
					cellSize,
				);
			}
		}
		context.restore();
	}

	function drawPageBorder(context: CanvasRenderingContext2D): void {
		context.save();
		context.strokeStyle = "rgb(255 247 207 / 95%)";
		context.lineWidth = 1;
		context.setLineDash([6, 4]);
		context.strokeRect(
			panX + 0.5,
			panY + 0.5,
			preview.width * zoom,
			preview.height * zoom,
		);
		context.restore();
	}

	function drawEntryBounds(context: CanvasRenderingContext2D): void {
		context.save();
		context.lineWidth = Math.max(1, 1 / zoom);
		for (const entry of page.entries) {
			const selected = entry.key === selectedEntry?.key;
			context.strokeStyle = selected
				? "#ffd666"
				: entry.canonical
					? "rgb(117 255 209 / 82%)"
					: "rgb(162 168 171 / 78%)";
			context.fillStyle = selected
				? "rgb(255 214 102 / 16%)"
				: entry.canonical
					? "rgb(117 255 209 / 6%)"
					: "rgb(162 168 171 / 5%)";
			context.fillRect(
				panX + entry.x * zoom,
				panY + entry.y * zoom,
				entry.width * zoom,
				entry.height * zoom,
			);
			context.strokeRect(
				panX + entry.x * zoom,
				panY + entry.y * zoom,
				entry.width * zoom,
				entry.height * zoom,
			);
		}
		context.restore();
	}

	function handlePointerDown(event: PointerEvent): void {
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragState = {
			moved: false,
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startPanX: panX,
			startPanY: panY,
		};
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!dragState || dragState.pointerId !== event.pointerId) return;
		const xDelta = event.clientX - dragState.startClientX;
		const yDelta = event.clientY - dragState.startClientY;
		if (Math.hypot(xDelta, yDelta) > 3) dragState.moved = true;
		panX = dragState.startPanX + xDelta;
		panY = dragState.startPanY + yDelta;
	}

	function handlePointerUp(event: PointerEvent): void {
		if (!dragState || dragState.pointerId !== event.pointerId) return;
		const wasClick = !dragState.moved;
		dragState = null;
		if (wasClick) selectedEntryKey = findEntryAtEvent(event)?.key ?? null;
	}

	function handleWheel(event: WheelEvent): void {
		event.preventDefault();
		const viewport = viewportElement?.getBoundingClientRect();
		if (!viewport) return;
		const pointerX = event.clientX - viewport.left;
		const pointerY = event.clientY - viewport.top;
		const pageX = (pointerX - panX) / zoom;
		const pageY = (pointerY - panY) / zoom;
		const nextZoom = Math.min(
			64,
			Math.max(0.05, zoom * Math.exp(-event.deltaY * 0.0015)),
		);
		zoom = nextZoom;
		panX = pointerX - pageX * nextZoom;
		panY = pointerY - pageY * nextZoom;
	}

	function findEntryAtEvent(
		event: PointerEvent,
	): TextureAtlasPageEntryDiagnostics | null {
		const viewport = viewportElement?.getBoundingClientRect();
		if (!viewport) return null;
		const pageX = (event.clientX - viewport.left - panX) / zoom;
		const pageY = (event.clientY - viewport.top - panY) / zoom;
		return (
			[...page.entries]
				.reverse()
				.find(
					(entry) =>
						pageX >= entry.x &&
						pageX <= entry.x + entry.width &&
						pageY >= entry.y &&
						pageY <= entry.y + entry.height,
				) ?? null
		);
	}

	function createSourceCanvas(readback: Texture2DReadback): HTMLCanvasElement {
		const nextCanvas = document.createElement("canvas");
		nextCanvas.width = readback.width;
		nextCanvas.height = readback.height;
		const context = nextCanvas.getContext("2d");
		if (!context)
			throw new Error(
				"Texture page inspector could not create a source canvas.",
			);
		context.putImageData(
			new ImageData(
				createDisplayPixels(readback),
				readback.width,
				readback.height,
			),
			0,
			0,
		);
		return nextCanvas;
	}

	function createDisplayPixels(
		readback: Texture2DReadback,
	): Uint8ClampedArray<ArrayBuffer> {
		const display = new Uint8ClampedArray(readback.pixels.byteLength);
		if (readback.format === "rgba8") {
			display.set(readback.pixels);
			return display;
		}
		for (let source = 0; source < readback.pixels.length; source += 4) {
			const red = readback.pixels[source] ?? 0;
			const green = readback.pixels[source + 1] ?? 0;
			if (readback.format === "rg8") {
				display[source] = red;
				display[source + 1] = green;
			} else {
				display[source] = red;
				display[source + 1] = red;
				display[source + 2] = red;
			}
			display[source + 3] = 255;
		}
		return display;
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1_024) return `${bytes} B`;
		if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
		return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`;
	}

	function formatPercent(ratio: number): string {
		return `${(ratio * 100).toFixed(1)}%`;
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="texture-page-modal-backdrop" data-browser-display-modal>
	<div
		class="texture-page-modal ac-panel"
		role="dialog"
		aria-modal="true"
		aria-labelledby="texture-page-modal-title"
	>
		<header class="texture-page-modal-header">
			<div>
				<p class="ac-section-label">Texture page</p>
				<h2 id="texture-page-modal-title">{page.pageId}</h2>
			</div>
			<button type="button" class="emoji-button" onclick={onClose}>✕</button>
		</header>

		<div class="texture-page-modal-body">
			<section
				class="texture-page-modal-preview"
				aria-label="Texture page pixel preview"
			>
				<div class="texture-page-modal-toolbar">
					<span
						>{preview.width} × {preview.height} {preview.format} readback</span
					>
					<label
						><input bind:checked={boundsVisible} type="checkbox" /> Bounds</label
					>
					<button type="button" class="explorer-action" onclick={fitPage}
						>Fit</button
					>
				</div>
				<div
					bind:this={viewportElement}
					class="texture-page-modal-viewport"
					role="application"
					aria-label="Pan with drag, zoom with wheel, and click to select a texture placement"
					onpointerdown={handlePointerDown}
					onpointermove={handlePointerMove}
					onpointerup={handlePointerUp}
					onpointercancel={handlePointerUp}
					onwheel={handleWheel}
				>
					<canvas bind:this={canvasElement}></canvas>
				</div>
			</section>

			<aside
				class="texture-page-modal-details"
				aria-label="Texture page details"
			>
				<div class="ac-param-panel">
					<div class="ac-param-row">
						<span class="ac-param-key">Purpose</span><code>{page.purpose}</code>
					</div>
					<div class="ac-param-row">
						<span class="ac-param-key">Byte cost</span><code
							>{formatBytes(page.byteLength)}</code
						>
					</div>
					<div class="ac-param-row">
						<span class="ac-param-key">Canonical occupancy</span><code
							>{formatPercent(page.canonicalOccupiedPixelRatio)}</code
						>
					</div>
					<div class="ac-param-row">
						<span class="ac-param-key">Candidate occupancy</span><code
							>{formatPercent(page.candidateOccupiedPixelRatio)}</code
						>
					</div>
				</div>

				<p class="ac-section-label">Placements</p>
				<div class="explorer-selectable-list texture-page-modal-entry-list">
					{#each page.entries as entry}
						<button
							type="button"
							class:active={entry.key === selectedEntry?.key}
							class="explorer-selectable-row"
							onclick={() => (selectedEntryKey = entry.key)}
						>
							<strong>{entry.canonical ? "Canonical" : "Candidate only"}</strong
							>
							<span>{entry.key}</span>
							<code>{entry.x}, {entry.y} · {entry.width} × {entry.height}</code>
						</button>
					{/each}
				</div>

				{#if selectedEntry}
					<p class="texture-page-modal-selected">
						Selected: {selectedEntry.canonical
							? "canonical binding"
							: "candidate-only placement"}.
					</p>
				{/if}
			</aside>
		</div>
	</div>
</div>

<style>
	.texture-page-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: 24px;
		background: rgb(0 0 0 / 70%);
	}
	.texture-page-modal {
		box-sizing: border-box;
		width: min(1180px, 100%);
		max-height: calc(100vh - 48px);
		padding: 16px;
		overflow: auto;
	}
	.texture-page-modal-header,
	.texture-page-modal-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.texture-page-modal-header h2 {
		margin: 0;
		color: var(--ac-parchment);
		font-size: 1rem;
		font-family: var(--ac-monospace, monospace);
		overflow-wrap: anywhere;
	}
	.texture-page-modal-header .ac-section-label {
		margin-bottom: 4px;
	}
	.texture-page-modal-body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(245px, 330px);
		gap: 16px;
		margin-top: 16px;
	}
	.texture-page-modal-preview {
		min-width: 0;
	}
	.texture-page-modal-toolbar {
		margin-bottom: 8px;
		color: var(--ac-gold-bright);
		font-size: 0.78rem;
	}
	.texture-page-modal-toolbar label {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.texture-page-modal-viewport {
		height: min(68vh, 700px);
		min-height: 360px;
		overflow: hidden;
		touch-action: none;
		background: #020605;
		cursor: grab;
	}
	.texture-page-modal-viewport:active {
		cursor: grabbing;
	}
	.texture-page-modal-viewport canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
	.texture-page-modal-details {
		min-width: 0;
	}
	.texture-page-modal-details .ac-section-label {
		margin: 16px 0 7px;
	}
	.texture-page-modal-entry-list {
		max-height: 360px;
		overflow: auto;
	}
	.texture-page-modal-entry-list button {
		gap: 3px;
		font-size: 0.74rem;
	}
	.texture-page-modal-entry-list strong {
		color: var(--ac-gold-bright);
	}
	.texture-page-modal-entry-list span {
		overflow-wrap: anywhere;
		font-family: var(--ac-monospace, monospace);
	}
	.texture-page-modal-selected {
		margin-bottom: 0;
		font-size: 0.8rem;
	}
	@media (max-width: 760px) {
		.texture-page-modal-backdrop {
			padding: 10px;
		}
		.texture-page-modal-body {
			grid-template-columns: 1fr;
		}
		.texture-page-modal-viewport {
			height: 48vh;
			min-height: 280px;
		}
	}
</style>
