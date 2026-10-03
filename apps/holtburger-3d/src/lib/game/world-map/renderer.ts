import type {
	WorldMapManifest,
	WorldMapTileBatch,
	WorldMapView,
} from "./types";

/** Existing Canvas2D contents can be replayed once the browser restores the context. */
export class WorldMapCanvasLostError extends Error {}

/** One backing image and one visible canvas; the browser owns all image scaling. */
export class WorldMapRenderer {
	readonly #canvas: HTMLCanvasElement;
	readonly #context: CanvasRenderingContext2D;
	readonly #backing: HTMLCanvasElement;
	readonly #backingContext: CanvasRenderingContext2D;
	readonly #manifest: WorldMapManifest;
	readonly #lost: () => void;
	#disposed = false;
	#appliedTiles = 0;
	#draws = 0;

	constructor(
		canvas: HTMLCanvasElement,
		manifest: WorldMapManifest,
		lost: (diagnostic: string) => void,
	) {
		const context = canvas.getContext("2d");
		if (!context) throw new Error("World map requires Canvas2D.");
		if (context.isContextLost())
			throw new WorldMapCanvasLostError(
				"World-map canvas is still lost. Retry after restoration.",
			);
		const backing = document.createElement("canvas");
		backing.width = manifest.width;
		backing.height = manifest.height;
		const backingContext = backing.getContext("2d");
		if (!backingContext) {
			backing.width = 0;
			backing.height = 0;
			throw new Error("World-map backing image requires Canvas2D.");
		}
		this.#canvas = canvas;
		this.#context = context;
		this.#backing = backing;
		this.#backingContext = backingContext;
		this.#manifest = manifest;
		this.#lost = () =>
			lost("World-map canvas contents were lost. Retry to reload the image.");
		canvas.addEventListener("contextlost", this.#lost);
		backing.addEventListener("contextlost", this.#lost);
	}

	apply(batch: WorldMapTileBatch): void {
		this.#checkContents();
		for (const [offset, bytes] of batch.tiles.entries()) {
			const tile = this.#manifest.tiles[batch.firstTile + offset];
			if (!tile) throw new Error("World-map image tile placement is missing.");
			this.#backingContext.putImageData(
				new ImageData(bytes, tile.width, tile.height),
				tile.x,
				tile.y,
			);
			this.#appliedTiles++;
		}
	}

	draw(view: WorldMapView): void {
		if (this.#disposed) return;
		this.#checkContents();
		const width = Math.max(1, Math.round(this.#canvas.clientWidth));
		const height = Math.max(1, Math.round(this.#canvas.clientHeight));
		if (this.#canvas.width !== width) this.#canvas.width = width;
		if (this.#canvas.height !== height) this.#canvas.height = height;
		this.#context.clearRect(0, 0, width, height);
		this.#context.imageSmoothingEnabled = true;
		this.#context.imageSmoothingQuality = "high";
		const bounds = this.#manifest.bounds;
		const scale = width / view.spanMeters;
		this.#context.drawImage(
			this.#backing,
			width / 2 + (bounds.minX - view.centerX) * scale,
			height / 2 + (bounds.minZ - view.centerZ) * scale,
			(bounds.maxX - bounds.minX) * scale,
			(bounds.maxZ - bounds.minZ) * scale,
		);
		this.#draws++;
	}

	#checkContents(): void {
		if (this.#context.isContextLost() || this.#backingContext.isContextLost())
			throw new WorldMapCanvasLostError(
				"World-map canvas contents were lost. Retry to reload the image.",
			);
	}

	/** Demand-read diagnostics with concrete resource and redraw consumers in the browser harness. */
	diagnostics(): {
		readonly appliedTiles: number;
		readonly draws: number;
		readonly backingPixelBytes: number;
	} {
		return {
			appliedTiles: this.#appliedTiles,
			draws: this.#draws,
			backingPixelBytes: this.#manifest.width * this.#manifest.height * 4,
		};
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#canvas.removeEventListener("contextlost", this.#lost);
		this.#backing.removeEventListener("contextlost", this.#lost);
		this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
		this.#backing.width = 0;
		this.#backing.height = 0;
	}
}
