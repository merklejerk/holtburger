<script lang="ts">
	import type {
		TextureAtlasPageInspectionSnapshot,
		TextureAtlasPageInspectionTexture,
	} from "../textures/texture-manager";

	interface Props {
		readonly label: string;
		readonly onClose: () => void;
		readonly snapshot: TextureAtlasPageInspectionSnapshot;
	}

	let { label, onClose, snapshot }: Props = $props();

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let viewportElement: HTMLDivElement | null = $state(null);
	let boundsVisible = $state(true);
	let selectedTexture = $state<TextureAtlasPageInspectionTexture | null>(null);
	let panX = $state(0);
	let panY = $state(0);
	let zoom = $state(1);
	let sourceCanvas = $state<HTMLCanvasElement | null>(null);
	let fittedSnapshot = $state<TextureAtlasPageInspectionSnapshot | null>(null);
	let dragState: {
		readonly pointerId: number;
		readonly startClientX: number;
		readonly startClientY: number;
		readonly startPanX: number;
		readonly startPanY: number;
		moved: boolean;
	} | null = null;

	const CHECKERBOARD_CELL_PIXELS = 16;

	$effect(() => {
		sourceCanvas = createSourceCanvas(snapshot);
		selectedTexture = null;
		fittedSnapshot = null;
	});

	$effect(() => {
		if (!viewportElement || !sourceCanvas || fittedSnapshot === snapshot) {
			return;
		}
		fitViewToPage();
		fittedSnapshot = snapshot;
	});

	$effect(() => {
		canvasElement;
		viewportElement;
		sourceCanvas;
		panX;
		panY;
		zoom;
		boundsVisible;
		selectedTexture;
		drawAtlasPage();
	});

	$effect(() => {
		if (!viewportElement) {
			return;
		}
		const observer = new ResizeObserver(() => drawAtlasPage());
		observer.observe(viewportElement);
		return () => observer.disconnect();
	});

	function resetView(): void {
		fitViewToPage();
	}

	function fitViewToPage(): void {
		const viewport = viewportElement?.getBoundingClientRect();
		if (!viewport) {
			panX = 0;
			panY = 0;
			zoom = 1;
			return;
		}
		zoom = Math.min(
			8,
			Math.max(
				0.05,
				Math.min(
					viewport.width / snapshot.width,
					viewport.height / snapshot.height,
				),
			),
		);
		panX = (viewport.width - snapshot.width * zoom) * 0.5;
		panY = (viewport.height - snapshot.height * zoom) * 0.5;
	}

	function drawAtlasPage(): void {
		if (!canvasElement || !viewportElement || !sourceCanvas) {
			return;
		}
		const viewport = viewportElement.getBoundingClientRect();
		const pixelRatio = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.floor(viewport.width * pixelRatio));
		const height = Math.max(1, Math.floor(viewport.height * pixelRatio));
		if (canvasElement.width !== width || canvasElement.height !== height) {
			canvasElement.width = width;
			canvasElement.height = height;
		}
		const context = canvasElement.getContext("2d");
		if (!context) {
			return;
		}
		context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		context.clearRect(0, 0, viewport.width, viewport.height);
		context.imageSmoothingEnabled = false;
		context.fillStyle = "#020605";
		context.fillRect(0, 0, viewport.width, viewport.height);
		drawPageCheckerboard(context, viewport);
		context.drawImage(
			sourceCanvas,
			panX,
			panY,
			snapshot.width * zoom,
			snapshot.height * zoom,
		);
		drawPageBorder(context);
		if (boundsVisible) {
			drawTextureBounds(context);
		}
	}

	function drawPageCheckerboard(
		context: CanvasRenderingContext2D,
		viewport: DOMRect,
	): void {
		const pageWidth = snapshot.width * zoom;
		const pageHeight = snapshot.height * zoom;
		context.save();
		context.beginPath();
		context.rect(panX, panY, pageWidth, pageHeight);
		context.clip();
		const cellSize = Math.max(4, CHECKERBOARD_CELL_PIXELS * zoom);
		const startColumn = Math.floor(-panX / cellSize) - 1;
		const endColumn = Math.ceil((viewport.width - panX) / cellSize) + 1;
		const startRow = Math.floor(-panY / cellSize) - 1;
		const endRow = Math.ceil((viewport.height - panY) / cellSize) + 1;
		for (let row = startRow; row <= endRow; row += 1) {
			for (let column = startColumn; column <= endColumn; column += 1) {
				context.fillStyle =
					(row + column) % 2 === 0 ? "rgb(48, 58, 54)" : "rgb(28, 36, 33)";
				context.fillRect(
					panX + column * cellSize,
					panY + row * cellSize,
					cellSize,
					cellSize,
				);
			}
		}
		context.restore();
	}

	function drawPageBorder(context: CanvasRenderingContext2D): void {
		context.save();
		context.strokeStyle = "rgba(255, 247, 207, 0.95)";
		context.lineWidth = 1;
		context.setLineDash([6, 4]);
		context.strokeRect(
			panX + 0.5,
			panY + 0.5,
			snapshot.width * zoom,
			snapshot.height * zoom,
		);
		context.restore();
	}

	function drawTextureBounds(context: CanvasRenderingContext2D): void {
		context.save();
		context.lineWidth = Math.max(1, 1 / zoom);
		for (const texture of snapshot.textures) {
			const selected = selectedTexture?.itemId === texture.itemId;
			context.strokeStyle = selected ? "#ffd666" : "rgba(117, 255, 209, 0.82)";
			context.fillStyle = selected
				? "rgba(255, 214, 102, 0.16)"
				: "rgba(117, 255, 209, 0.06)";
			const [x, y, width, height] = texture.rect;
			context.fillRect(
				panX + x * zoom,
				panY + y * zoom,
				width * zoom,
				height * zoom,
			);
			context.strokeRect(
				panX + x * zoom,
				panY + y * zoom,
				width * zoom,
				height * zoom,
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
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}
		const dx = event.clientX - dragState.startClientX;
		const dy = event.clientY - dragState.startClientY;
		if (Math.hypot(dx, dy) > 3) {
			dragState.moved = true;
		}
		panX = dragState.startPanX + dx;
		panY = dragState.startPanY + dy;
	}

	function handlePointerUp(event: PointerEvent): void {
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}
		const wasClick = !dragState.moved;
		dragState = null;
		if (wasClick) {
			selectedTexture = findTextureAtEvent(event);
		}
	}

	function handleWheel(event: WheelEvent): void {
		event.preventDefault();
		const viewport = viewportElement?.getBoundingClientRect();
		if (!viewport) {
			return;
		}
		const pointerX = event.clientX - viewport.left;
		const pointerY = event.clientY - viewport.top;
		const atlasX = (pointerX - panX) / zoom;
		const atlasY = (pointerY - panY) / zoom;
		const nextZoom = Math.min(
			64,
			Math.max(0.05, zoom * Math.exp(-event.deltaY * 0.0015)),
		);
		zoom = nextZoom;
		panX = pointerX - atlasX * nextZoom;
		panY = pointerY - atlasY * nextZoom;
	}

	function findTextureAtEvent(
		event: PointerEvent,
	): TextureAtlasPageInspectionTexture | null {
		const viewport = viewportElement?.getBoundingClientRect();
		if (!viewport) {
			return null;
		}
		const atlasX = (event.clientX - viewport.left - panX) / zoom;
		const atlasY = (event.clientY - viewport.top - panY) / zoom;
		return (
			[...snapshot.textures]
				.reverse()
				.find((texture) => textureContainsPoint(texture, atlasX, atlasY)) ??
			null
		);
	}

	function textureContainsPoint(
		texture: TextureAtlasPageInspectionTexture,
		x: number,
		y: number,
	): boolean {
		const [left, top, width, height] = texture.rect;
		return x >= left && x <= left + width && y >= top && y <= top + height;
	}

	function createSourceCanvas(
		page: TextureAtlasPageInspectionSnapshot,
	): HTMLCanvasElement {
		const nextCanvas = document.createElement("canvas");
		nextCanvas.width = page.width;
		nextCanvas.height = page.height;
		const context = nextCanvas.getContext("2d");
		if (!context) {
			throw new Error("Texture atlas inspector could not create a 2D context.");
		}
		context.putImageData(
			new ImageData(
				new Uint8ClampedArray(createRgbaPixels(page)),
				page.width,
				page.height,
			),
			0,
			0,
		);
		return nextCanvas;
	}

	function createRgbaPixels(
		page: TextureAtlasPageInspectionSnapshot,
	): Uint8ClampedArray {
		if (page.format === "rgba8") {
			return new Uint8ClampedArray(page.pixels);
		}
		const pixels = new Uint8ClampedArray(page.width * page.height * 4);
		if (page.format === "r8") {
			for (
				let source = 0, target = 0;
				source < page.pixels.length;
				source += 1, target += 4
			) {
				const value = page.pixels[source] ?? 0;
				pixels[target] = value;
				pixels[target + 1] = value;
				pixels[target + 2] = value;
				pixels[target + 3] = 255;
			}
			return pixels;
		}
		for (
			let source = 0, target = 0;
			source < page.pixels.length;
			source += 2, target += 4
		) {
			pixels[target] = page.pixels[source] ?? 0;
			pixels[target + 1] = page.pixels[source + 1] ?? 0;
			pixels[target + 2] = 0;
			pixels[target + 3] = 255;
		}
		return pixels;
	}
</script>

<div class="atlas-inspector__backdrop" data-browser-display-modal>
	<div
		class="atlas-inspector"
		role="dialog"
		aria-modal="true"
		aria-labelledby="atlas-inspector-title"
	>
		<div class="atlas-inspector__header">
			<div>
				<p>Texture Atlas Page</p>
				<h2 id="atlas-inspector-title">{label}</h2>
			</div>
			<div class="atlas-inspector__header-actions">
				<label>
					<input bind:checked={boundsVisible} type="checkbox" />
					<span>Bounds</span>
				</label>
				<button type="button" onclick={resetView}>Fit</button>
				<button type="button" onclick={onClose}>Close</button>
			</div>
		</div>
		<div class="atlas-inspector__body">
			<div
				bind:this={viewportElement}
				class="atlas-inspector__viewport"
				role="application"
				aria-label="Texture atlas page viewport"
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerUp}
				onpointercancel={handlePointerUp}
				onwheel={handleWheel}
			>
				<canvas bind:this={canvasElement}></canvas>
			</div>
			<aside class="atlas-inspector__details">
				<dl>
					<div>
						<dt>Page</dt>
						<dd>{snapshot.width}x{snapshot.height} {snapshot.format}</dd>
					</div>
					<div>
						<dt>Textures</dt>
						<dd>{snapshot.textures.length}</dd>
					</div>
					<div>
						<dt>Zoom</dt>
						<dd>{(zoom * 100).toFixed(0)}%</dd>
					</div>
					<div>
						<dt>Selected</dt>
						<dd>{selectedTexture?.itemId ?? "none"}</dd>
					</div>
					{#if selectedTexture}
						<div>
							<dt>Rect</dt>
							<dd>{selectedTexture.rect.join(", ")}</dd>
						</div>
						<div>
							<dt>Source</dt>
							<dd>{selectedTexture.sourceLabel}</dd>
						</div>
					{/if}
				</dl>
			</aside>
		</div>
	</div>
</div>

<style>
	.atlas-inspector__backdrop {
		position: absolute;
		inset: 0;
		z-index: 5;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgba(0, 0, 0, 0.46);
		pointer-events: auto;
	}

	.atlas-inspector {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 10px;
		width: min(1100px, calc(100vw - 32px));
		height: min(760px, calc(100vh - 32px));
		box-sizing: border-box;
		padding: 12px;
		border: 1px solid rgba(91, 255, 187, 0.52);
		border-radius: 6px;
		background: rgba(4, 12, 11, 0.98);
		color: #d9ffe8;
	}

	.atlas-inspector__header,
	.atlas-inspector__header-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-width: 0;
	}

	.atlas-inspector__header p,
	.atlas-inspector__details dt {
		margin: 0;
		color: #75ffd1;
		font-size: 10px;
		text-transform: uppercase;
	}

	.atlas-inspector__header h2 {
		margin: 2px 0 0;
		color: #f1fff6;
		font-size: 15px;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}

	.atlas-inspector__header-actions label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
	}

	.atlas-inspector__body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(220px, 0.28fr);
		gap: 10px;
		min-height: 0;
	}

	.atlas-inspector__viewport {
		min-width: 0;
		min-height: 0;
		border: 1px solid rgba(91, 255, 187, 0.25);
		background: #020605;
		cursor: grab;
		overflow: hidden;
		touch-action: none;
	}

	.atlas-inspector__viewport:active {
		cursor: grabbing;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.atlas-inspector__details {
		min-width: 0;
		overflow: auto;
		border: 1px solid rgba(91, 255, 187, 0.2);
		background: rgba(1, 9, 8, 0.42);
	}

	.atlas-inspector__details dl {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 8px;
	}

	.atlas-inspector__details div {
		display: grid;
		gap: 2px;
	}

	.atlas-inspector__details dd {
		margin: 0;
		color: #f1fff6;
		font-size: 11px;
		overflow-wrap: anywhere;
	}

	button {
		min-height: 30px;
		padding: 0 9px;
		border: 1px solid rgba(91, 255, 187, 0.45);
		border-radius: 4px;
		background: rgba(9, 38, 31, 0.92);
		color: #d9ffe8;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}

	@media (max-width: 760px) {
		.atlas-inspector__body {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(0, 1fr) auto;
		}
	}
</style>
