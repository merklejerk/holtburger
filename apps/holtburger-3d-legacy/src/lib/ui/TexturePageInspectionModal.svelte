<script lang="ts">
	import type {
		RuntimeTexturePageInspectionEntry,
		RuntimeTexturePageInspectionPreview,
		RuntimeTexturePageInspectionSnapshot,
	} from "../runtime/client-runtime";

	type RuntimeTexturePageInspectionPlacement =
		RuntimeTexturePageInspectionPreview["placements"][number];

	interface Props {
		readonly label: string;
		readonly onClose: () => void;
		readonly snapshot: RuntimeTexturePageInspectionSnapshot;
	}

	let { label, onClose, snapshot }: Props = $props();

	let dialogElement: HTMLDivElement | null = $state(null);
	let canvasElement: HTMLCanvasElement | null = $state(null);
	let viewportElement: HTMLDivElement | null = $state(null);
	let boundsVisible = $state(true);
	let activeDetailTab = $state<"page" | "entries" | "entry">("page");
	let selectedEntryId = $state<string | null>(null);
	let selectedPlacementBindingId = $state<string | null>(null);
	let panX = $state(0);
	let panY = $state(0);
	let zoom = $state(1);
	let sourceCanvas = $state<HTMLCanvasElement | null>(null);
	let fittedPreview = $state<RuntimeTexturePageInspectionPreview | null>(null);
	let dragState: {
		readonly pointerId: number;
		readonly startClientX: number;
		readonly startClientY: number;
		readonly startPanX: number;
		readonly startPanY: number;
		moved: boolean;
	} | null = null;

	const selectedEntry = $derived(
		snapshot.entries.find((entry) => entry.id === selectedEntryId) ?? null,
	);
	const selectedPlacement = $derived(
		snapshot.preview?.placements.find(
			(placement) => placement.bindingId === selectedPlacementBindingId,
		) ?? null,
	);

	const CHECKERBOARD_CELL_PIXELS = 16;

	$effect(() => {
		const firstPlacement = snapshot.preview?.placements[0] ?? null;
		selectedPlacementBindingId = firstPlacement?.bindingId ?? null;
		selectedEntryId =
			firstPlacement === null
				? (snapshot.entries[0]?.id ?? null)
				: (findEntryForBindingId(firstPlacement.bindingId)?.id ??
					snapshot.entries[0]?.id ??
					null);
		sourceCanvas =
			snapshot.preview === null ? null : createSourceCanvas(snapshot.preview);
		fittedPreview = null;
	});

	$effect(() => {
		if (
			!viewportElement ||
			!sourceCanvas ||
			!snapshot.preview ||
			fittedPreview === snapshot.preview
		) {
			return;
		}
		fitViewToPage();
		fittedPreview = snapshot.preview;
	});

	$effect(() => {
		canvasElement;
		viewportElement;
		sourceCanvas;
		panX;
		panY;
		zoom;
		boundsVisible;
		selectedPlacementBindingId;
		drawTexturePage();
	});

	$effect(() => {
		if (!viewportElement) {
			return;
		}
		const observer = new ResizeObserver(() => drawTexturePage());
		observer.observe(viewportElement);
		return () => observer.disconnect();
	});

	function handleWindowPointerDown(event: PointerEvent): void {
		if (
			dialogElement &&
			event.target instanceof Node &&
			!dialogElement.contains(event.target)
		) {
			onClose();
		}
	}

	function selectEntry(entry: RuntimeTexturePageInspectionEntry): void {
		selectedEntryId = entry.id;
		if (
			selectedPlacementBindingId === null ||
			!entry.bindingIds.includes(selectedPlacementBindingId)
		) {
			selectedPlacementBindingId =
				findFirstPlacementForEntry(entry)?.bindingId ?? null;
		}
		activeDetailTab = "entry";
	}

	function selectPlacement(
		placement: RuntimeTexturePageInspectionPlacement | null,
	): void {
		if (placement === null) {
			selectedPlacementBindingId = null;
			return;
		}
		selectedPlacementBindingId = placement.bindingId;
		selectedEntryId = findEntryForBindingId(placement.bindingId)?.id ?? null;
		activeDetailTab = "entry";
	}

	function findEntryForBindingId(
		bindingId: string,
	): RuntimeTexturePageInspectionEntry | null {
		return (
			snapshot.entries.find((entry) => entry.bindingIds.includes(bindingId)) ??
			null
		);
	}

	function findFirstPlacementForEntry(
		entry: RuntimeTexturePageInspectionEntry,
	): RuntimeTexturePageInspectionPlacement | null {
		return (
			snapshot.preview?.placements.find((placement) =>
				entry.bindingIds.includes(placement.bindingId),
			) ?? null
		);
	}

	function resetView(): void {
		fitViewToPage();
	}

	function fitViewToPage(): void {
		const preview = snapshot.preview;
		const viewport = viewportElement?.getBoundingClientRect();
		if (!preview || !viewport) {
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
					viewport.width / preview.width,
					viewport.height / preview.height,
				),
			),
		);
		panX = (viewport.width - preview.width * zoom) * 0.5;
		panY = (viewport.height - preview.height * zoom) * 0.5;
	}

	function drawTexturePage(): void {
		const preview = snapshot.preview;
		if (!canvasElement || !viewportElement || !sourceCanvas || !preview) {
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
		drawPageCheckerboard(context, viewport, preview);
		context.drawImage(
			sourceCanvas,
			panX,
			panY,
			preview.width * zoom,
			preview.height * zoom,
		);
		drawPageBorder(context, preview);
		if (boundsVisible) {
			drawPlacementBounds(context, preview);
		}
	}

	function drawPageCheckerboard(
		context: CanvasRenderingContext2D,
		viewport: DOMRect,
		preview: RuntimeTexturePageInspectionPreview,
	): void {
		context.save();
		context.beginPath();
		context.rect(panX, panY, preview.width * zoom, preview.height * zoom);
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

	function drawPageBorder(
		context: CanvasRenderingContext2D,
		preview: RuntimeTexturePageInspectionPreview,
	): void {
		context.save();
		context.strokeStyle = "rgba(255, 247, 207, 0.95)";
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

	function drawPlacementBounds(
		context: CanvasRenderingContext2D,
		preview: RuntimeTexturePageInspectionPreview,
	): void {
		context.save();
		context.lineWidth = Math.max(1, 1 / zoom);
		for (const placement of preview.placements) {
			const selected = selectedPlacementBindingId === placement.bindingId;
			context.strokeStyle = selected ? "#ffd666" : "rgba(117, 255, 209, 0.82)";
			context.fillStyle = selected
				? "rgba(255, 214, 102, 0.16)"
				: "rgba(117, 255, 209, 0.06)";
			const [x, y, width, height] = placement.rect;
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
			selectPlacement(findPlacementAtEvent(event));
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

	function findPlacementAtEvent(event: PointerEvent) {
		const preview = snapshot.preview;
		const viewport = viewportElement?.getBoundingClientRect();
		if (!preview || !viewport) {
			return null;
		}
		const pageX = (event.clientX - viewport.left - panX) / zoom;
		const pageY = (event.clientY - viewport.top - panY) / zoom;
		return (
			[...preview.placements]
				.reverse()
				.find((placement) =>
					placementContainsPoint(placement.rect, pageX, pageY),
				) ?? null
		);
	}

	function placementContainsPoint(
		rect: readonly [number, number, number, number],
		x: number,
		y: number,
	): boolean {
		const [left, top, width, height] = rect;
		return x >= left && x <= left + width && y >= top && y <= top + height;
	}

	function createSourceCanvas(
		preview: RuntimeTexturePageInspectionPreview,
	): HTMLCanvasElement {
		const nextCanvas = document.createElement("canvas");
		nextCanvas.width = preview.width;
		nextCanvas.height = preview.height;
		const context = nextCanvas.getContext("2d");
		if (!context) {
			throw new Error("Texture page inspector could not create a 2D context.");
		}
		context.putImageData(
			new ImageData(
				new Uint8ClampedArray(createRgbaPixels(preview)),
				preview.width,
				preview.height,
			),
			0,
			0,
		);
		return nextCanvas;
	}

	function createRgbaPixels(
		preview: RuntimeTexturePageInspectionPreview,
	): Uint8ClampedArray {
		if (preview.format === "rgba8") {
			return new Uint8ClampedArray(preview.pixels);
		}
		const pixels = new Uint8ClampedArray(preview.width * preview.height * 4);
		if (preview.format === "r8") {
			for (
				let source = 0, target = 0;
				source < preview.pixels.length;
				source += 1, target += 4
			) {
				const value = preview.pixels[source] ?? 0;
				pixels[target] = value;
				pixels[target + 1] = value;
				pixels[target + 2] = value;
				pixels[target + 3] = 255;
			}
			return pixels;
		}
		for (
			let source = 0, target = 0;
			source < preview.pixels.length;
			source += 2, target += 4
		) {
			pixels[target] = preview.pixels[source] ?? 0;
			pixels[target + 1] = preview.pixels[source + 1] ?? 0;
			pixels[target + 2] = 0;
			pixels[target + 3] = 255;
		}
		return pixels;
	}

	function formatList(values: readonly string[]): string {
		return values.length === 0 ? "none" : values.join(", ");
	}

	function formatEntryLabel(entry: RuntimeTexturePageInspectionEntry): string {
		const ownerCount = entry.ownerIds.length;
		const bindingCount = entry.bindingIds.length;
		return `${entry.purpose} / ${ownerCount} owner${ownerCount === 1 ? "" : "s"} / ${bindingCount} binding${bindingCount === 1 ? "" : "s"}`;
	}

	function formatPreviewSummary(
		preview: RuntimeTexturePageInspectionPreview | null,
	): string {
		return preview === null
			? "none"
			: `${preview.width}x${preview.height} ${preview.format} / ${preview.sampleClass}`;
	}

	function formatAssignedPixels(
		snapshot: RuntimeTexturePageInspectionSnapshot,
	): string {
		const ratio =
			snapshot.assignedPixelRatio === null
				? "unknown"
				: `${(snapshot.assignedPixelRatio * 100).toFixed(1)}%`;
		const total =
			snapshot.texturePixelCount === null
				? "unknown"
				: String(snapshot.texturePixelCount);
		return `${ratio} / ${snapshot.assignedPixelCount} of ${total}`;
	}
</script>

<svelte:window onpointerdown={handleWindowPointerDown} />

<div class="texture-page-inspector__backdrop" data-browser-display-modal>
	<div
		bind:this={dialogElement}
		class="texture-page-inspector"
		role="dialog"
		aria-modal="true"
		aria-labelledby="texture-page-inspector-title"
	>
		<div class="texture-page-inspector__header">
			<div>
				<p>Texture Page</p>
				<h2 id="texture-page-inspector-title">{label}</h2>
			</div>
			<button type="button" onclick={onClose}>Close</button>
		</div>

		<div class="texture-page-inspector__body">
			<section
				class="texture-page-inspector__preview"
				aria-label="Texture page preview"
			>
				<div class="texture-page-inspector__preview-toolbar">
					<div>
						<h3>Preview</h3>
						<p>{formatPreviewSummary(snapshot.preview)}</p>
					</div>
					<div class="texture-page-inspector__preview-actions">
						<label>
							<input bind:checked={boundsVisible} type="checkbox" />
							<span>Bounds</span>
						</label>
						<button
							disabled={snapshot.preview === null}
							type="button"
							onclick={resetView}
						>
							Fit
						</button>
					</div>
				</div>
				{#if snapshot.preview === null}
					<div class="texture-page-inspector__missing-preview">
						no accepted page upload
					</div>
				{:else}
					<div
						bind:this={viewportElement}
						class="texture-page-inspector__viewport"
						role="application"
						aria-label="Texture page pixel preview"
						onpointerdown={handlePointerDown}
						onpointermove={handlePointerMove}
						onpointerup={handlePointerUp}
						onpointercancel={handlePointerUp}
						onwheel={handleWheel}
					>
						<canvas bind:this={canvasElement}></canvas>
					</div>
				{/if}
			</section>

			<aside
				class="texture-page-inspector__side"
				aria-label="Texture page details"
			>
				<div
					class="texture-page-inspector__tabs"
					role="tablist"
					aria-label="Inspection panels"
				>
					<button
						class:active={activeDetailTab === "page"}
						type="button"
						role="tab"
						aria-selected={activeDetailTab === "page"}
						onclick={() => {
							activeDetailTab = "page";
						}}
					>
						Page
					</button>
					<button
						class:active={activeDetailTab === "entries"}
						type="button"
						role="tab"
						aria-selected={activeDetailTab === "entries"}
						onclick={() => {
							activeDetailTab = "entries";
						}}
					>
						Entries
					</button>
					<button
						class:active={activeDetailTab === "entry"}
						type="button"
						role="tab"
						aria-selected={activeDetailTab === "entry"}
						onclick={() => {
							activeDetailTab = "entry";
						}}
					>
						Selected
					</button>
				</div>

				{#if activeDetailTab === "page"}
					<section
						class="texture-page-inspector__panel"
						aria-label="Page summary"
					>
						<dl>
							<div>
								<dt>State</dt>
								<dd>{snapshot.state}</dd>
							</div>
							<div>
								<dt>Domain</dt>
								<dd>{snapshot.bucket.domain}</dd>
							</div>
							<div>
								<dt>Purpose</dt>
								<dd>{snapshot.bucket.purpose}</dd>
							</div>
							<div>
								<dt>Scope</dt>
								<dd>{snapshot.bucket.scope}</dd>
							</div>
							<div>
								<dt>Placements</dt>
								<dd>{snapshot.preview?.placements.length ?? 0}</dd>
							</div>
							<div>
								<dt>Assigned pixels</dt>
								<dd>{formatAssignedPixels(snapshot)}</dd>
							</div>
							<div>
								<dt>Entries</dt>
								<dd>{snapshot.entries.length}</dd>
							</div>
							<div>
								<dt>Selected rect</dt>
								<dd>{selectedPlacement?.rect.join(", ") ?? "none"}</dd>
							</div>
							<div>
								<dt>Page id</dt>
								<dd>{snapshot.pageId}</dd>
							</div>
							<div>
								<dt>Bucket</dt>
								<dd>{snapshot.bucket.key}</dd>
							</div>
						</dl>
					</section>
				{:else if activeDetailTab === "entries"}
					<section
						class="texture-page-inspector__panel"
						aria-label="Page entries"
					>
						<h3>Entries</h3>
						{#if snapshot.entries.length === 0}
							<p class="texture-page-inspector__empty">none</p>
						{:else}
							<div class="texture-page-inspector__entry-list">
								{#each snapshot.entries as entry (entry.id)}
									<button
										class:active={selectedEntryId === entry.id}
										type="button"
										onclick={() => selectEntry(entry)}
									>
										<strong>{entry.state}</strong>
										<span>{formatEntryLabel(entry)}</span>
									</button>
								{/each}
							</div>
						{/if}
					</section>
				{:else}
					<section
						class="texture-page-inspector__panel"
						aria-label="Entry details"
					>
						<h3>Selected Entry</h3>
						{#if selectedEntry === null}
							<p class="texture-page-inspector__empty">none</p>
						{:else}
							<dl>
								<div>
									<dt>Entry id</dt>
									<dd>{selectedEntry.id}</dd>
								</div>
								<div>
									<dt>State</dt>
									<dd>{selectedEntry.state}</dd>
								</div>
								<div>
									<dt>Page class</dt>
									<dd>{selectedEntry.pageClass}</dd>
								</div>
								<div>
									<dt>Purpose</dt>
									<dd>{selectedEntry.purpose}</dd>
								</div>
								<div>
									<dt>Owners</dt>
									<dd>{formatList(selectedEntry.ownerIds)}</dd>
								</div>
								<div>
									<dt>Bindings</dt>
									<dd>{formatList(selectedEntry.bindingIds)}</dd>
								</div>
								<div>
									<dt>Source</dt>
									<dd>{selectedEntry.sourceKey}</dd>
								</div>
								<div>
									<dt>Texture</dt>
									<dd>{selectedEntry.textureKey}</dd>
								</div>
							</dl>
						{/if}
					</section>
				{/if}
			</aside>
		</div>
	</div>
</div>

<style>
	.texture-page-inspector__backdrop {
		position: absolute;
		inset: 0;
		z-index: 5;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgba(0, 0, 0, 0.46);
		pointer-events: auto;
	}

	.texture-page-inspector {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 14px;
		width: min(1320px, calc(100vw - 32px));
		height: min(860px, calc(100vh - 32px));
		box-sizing: border-box;
		padding: 14px;
		border: 1px solid rgba(91, 255, 187, 0.52);
		border-radius: 6px;
		background: rgba(4, 12, 11, 0.98);
		color: #d9ffe8;
	}

	.texture-page-inspector__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-width: 0;
	}

	.texture-page-inspector__header p,
	.texture-page-inspector dt,
	.texture-page-inspector h3 {
		margin: 0;
		color: #75ffd1;
		font-size: 10px;
		text-transform: uppercase;
	}

	.texture-page-inspector__header h2 {
		margin: 2px 0 0;
		color: #f1fff6;
		font-size: 15px;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}

	.texture-page-inspector button {
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

	.texture-page-inspector button:hover,
	.texture-page-inspector button.active {
		border-color: rgba(255, 214, 102, 0.9);
		color: #fff7cf;
	}

	.texture-page-inspector__body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(360px, 0.32fr);
		gap: 14px;
		min-height: 0;
	}

	.texture-page-inspector__preview {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 10px;
		min-width: 0;
		min-height: 0;
	}

	.texture-page-inspector__preview-toolbar,
	.texture-page-inspector__preview-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-width: 0;
	}

	.texture-page-inspector__preview-toolbar p {
		margin: 2px 0 0;
		color: rgba(241, 255, 246, 0.74);
		font-size: 11px;
		overflow-wrap: anywhere;
	}

	.texture-page-inspector__preview-actions label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
	}

	.texture-page-inspector__viewport,
	.texture-page-inspector__missing-preview {
		min-width: 0;
		min-height: 0;
		border: 1px solid rgba(91, 255, 187, 0.25);
		background: #020605;
	}

	.texture-page-inspector__viewport {
		cursor: grab;
		overflow: hidden;
		touch-action: none;
	}

	.texture-page-inspector__viewport:active {
		cursor: grabbing;
	}

	.texture-page-inspector__missing-preview {
		display: grid;
		place-items: center;
		color: rgba(241, 255, 246, 0.72);
		font-size: 12px;
		text-transform: uppercase;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.texture-page-inspector__side {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 10px;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	.texture-page-inspector__tabs {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
		min-width: 0;
	}

	.texture-page-inspector__tabs button {
		width: 100%;
	}

	.texture-page-inspector__panel {
		min-width: 0;
		overflow: auto;
		border: 1px solid rgba(91, 255, 187, 0.2);
		background: rgba(1, 9, 8, 0.42);
	}

	.texture-page-inspector dl,
	.texture-page-inspector__panel {
		display: grid;
		align-content: start;
		gap: 10px;
		margin: 0;
	}

	.texture-page-inspector__panel {
		padding: 10px;
	}

	.texture-page-inspector dl div {
		display: grid;
		gap: 2px;
	}

	.texture-page-inspector dd {
		margin: 0;
		color: #f1fff6;
		font-size: 11px;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}

	.texture-page-inspector__entry-list {
		display: grid;
		gap: 8px;
	}

	.texture-page-inspector__entry-list button {
		display: grid;
		justify-items: start;
		gap: 4px;
		min-width: 0;
		height: auto;
		padding: 9px;
		text-align: left;
		white-space: normal;
	}

	.texture-page-inspector__entry-list strong {
		color: #fff7cf;
		font-size: 11px;
		text-transform: uppercase;
	}

	.texture-page-inspector__entry-list span,
	.texture-page-inspector__empty {
		color: rgba(241, 255, 246, 0.74);
		font-size: 11px;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}

	@media (max-width: 880px) {
		.texture-page-inspector__body {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(300px, 1fr) minmax(240px, 0.55fr);
		}

		.texture-page-inspector__side {
			grid-template-rows: auto minmax(0, 1fr);
		}
	}
</style>
