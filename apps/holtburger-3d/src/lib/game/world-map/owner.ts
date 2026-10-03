import type { WorldMapManifest, WorldMapSource, WorldMapView } from "./types";
import { WorldMapRenderer, WorldMapCanvasLostError } from "./renderer";
import { clampWorldMap, fitWorldMap } from "./view";

/** Cold presentation outcomes; an incomplete image is usable while tiles stream. */
export type WorldMapState =
	| { readonly kind: "idle" | "opening" }
	| {
			readonly kind: "streaming";
			readonly manifest: WorldMapManifest;
			readonly appliedTiles: number;
	  }
	| { readonly kind: "ready"; readonly manifest: WorldMapManifest }
	| {
			readonly kind: "load-failed" | "unavailable";
			readonly diagnostic: string;
	  }
	| { readonly kind: "disposed" };

/** Interdependent image/view resources exist together throughout progressive display. */
interface Presentation {
	readonly manifest: WorldMapManifest;
	readonly renderer: WorldMapRenderer;
	view: WorldMapView;
}

/** Retained image owner; tile reads are independent of panel visibility and current zoom. */
export class WorldMapOwner {
	readonly #source: WorldMapSource;
	readonly #canvas: HTMLCanvasElement;
	readonly #listeners = new Set<(state: WorldMapState) => void>();
	readonly #drawListeners = new Set<() => void>();
	readonly #drawWaiters = new Set<() => void>();
	#state: WorldMapState = { kind: "idle" };
	#presentation: Presentation | null = null;
	#load: Promise<void> | null = null;
	#frame: number | null = null;
	#epoch = 0;
	#visible = false;
	#aspectRatio = 1;

	constructor(source: WorldMapSource, canvas: HTMLCanvasElement) {
		this.#source = source;
		this.#canvas = canvas;
		this.#aspect();
	}
	read(): WorldMapState {
		return this.#state;
	}
	subscribe(listener: (state: WorldMapState) => void): () => void {
		this.#listeners.add(listener);
		listener(this.#state);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	/** Presentation overlays update within the same RAF as the image, using its latest view. */
	subscribeDraw(listener: () => void): () => void {
		this.#drawListeners.add(listener);
		return () => {
			this.#drawListeners.delete(listener);
		};
	}
	load(): Promise<void> {
		if (this.#load) return this.#load;
		if (this.#state.kind !== "idle" && this.#state.kind !== "load-failed")
			return Promise.resolve();
		const retry = this.#state.kind === "load-failed";
		const epoch = ++this.#epoch;
		this.#publish({ kind: "opening" });
		const operation = this.#loadImage(epoch, retry ? "retry" : "open");
		this.#load = operation;
		void operation.finally(() => {
			if (this.#load === operation) this.#load = null;
		});
		return operation;
	}
	setVisible(visible: boolean): void {
		this.#visible = visible;
		if (visible) this.#redraw();
		else this.#cancelDraw();
	}
	async settled(): Promise<void> {
		await this.#load;
		await this.drawSettled();
	}
	/** Wait only for current canvas work, allowing diagnostics to interact during generation. */
	drawSettled(): Promise<void> {
		if (this.#frame === null) return Promise.resolve();
		return new Promise((resolve) => {
			this.#drawWaiters.add(resolve);
		});
	}
	readView(): WorldMapView | null {
		return this.#presentation ? this.#presentation.view : null;
	}
	setView(view: WorldMapView): void {
		const presentation = this.#presentation;
		if (!presentation) return;
		presentation.view = clampWorldMap(
			view,
			presentation.manifest.bounds,
			this.#aspect(),
		);
		this.#redraw();
	}
	fit(): void {
		const presentation = this.#presentation;
		if (presentation)
			this.setView(fitWorldMap(presentation.manifest.bounds, this.#aspect()));
	}

	/** Whether the retained view matches the whole-world reset for its current aspect. */
	isResetView(): boolean {
		const presentation = this.#presentation;
		if (!presentation) return false;
		const fit = fitWorldMap(presentation.manifest.bounds, this.#aspectRatio);
		return (
			presentation.view.centerX === fit.centerX &&
			presentation.view.centerZ === fit.centerZ &&
			presentation.view.spanMeters === fit.spanMeters
		);
	}
	resize(): void {
		if (!this.#visible || !this.#presentation) return;
		// Keep a fitted view fitted as layout changes; preserve a user's zoom otherwise.
		if (this.isResetView()) this.fit();
		else this.setView(this.#presentation.view);
	}
	#aspect(): number {
		// Hidden canvases report zero CSS dimensions; preserve the visible projection aspect.
		if (this.#canvas.clientWidth > 0 && this.#canvas.clientHeight > 0)
			this.#aspectRatio = this.#canvas.clientWidth / this.#canvas.clientHeight;
		return this.#aspectRatio;
	}
	diagnostics(): ReturnType<WorldMapRenderer["diagnostics"]> | null {
		return this.#presentation
			? this.#presentation.renderer.diagnostics()
			: null;
	}
	destroy(): void {
		this.#epoch++;
		this.#load = null;
		this.#cancelDraw();
		this.#releaseImage();
		this.#publish({ kind: "disposed" });
		this.#listeners.clear();
		this.#drawListeners.clear();
	}
	#releaseImage(): void {
		this.#presentation?.renderer.dispose();
		this.#presentation = null;
	}
	#failed(kind: "load-failed" | "unavailable", diagnostic: string): void {
		if (this.#state.kind === "disposed") return;
		this.#epoch++;
		this.#load = null;
		this.#cancelDraw();
		this.#releaseImage();
		this.#publish({ kind, diagnostic });
	}
	async #loadImage(epoch: number, intent: "open" | "retry"): Promise<void> {
		const live = () => this.#epoch === epoch;
		let manifest: WorldMapManifest;
		try {
			manifest = await this.#source.open(intent);
		} catch (error) {
			if (live())
				this.#failed(
					"load-failed",
					error instanceof Error ? error.message : String(error),
				);
			return;
		}
		if (!live()) return;
		let renderer: WorldMapRenderer;
		try {
			renderer = new WorldMapRenderer(this.#canvas, manifest, (diagnostic) =>
				this.#failed("load-failed", diagnostic),
			);
		} catch (error) {
			if (live())
				this.#failed(
					error instanceof WorldMapCanvasLostError
						? "load-failed"
						: "unavailable",
					error instanceof Error ? error.message : String(error),
				);
			return;
		}
		this.#presentation = {
			manifest,
			renderer,
			view: fitWorldMap(manifest.bounds, this.#aspect()),
		};
		this.#publish({ kind: "streaming", manifest, appliedTiles: 0 });
		this.#redraw();
		let cursor = 0;
		try {
			for (;;) {
				const response = await this.#source.readTiles(manifest, cursor);
				if (!live()) return;
				renderer.apply(response);
				cursor += response.tiles.length;
				this.#redraw();
				if (response.state === "complete") {
					this.#publish({ kind: "ready", manifest });
					return;
				}
				this.#publish({ kind: "streaming", manifest, appliedTiles: cursor });
			}
		} catch (error) {
			if (live())
				this.#failed(
					"load-failed",
					error instanceof Error ? error.message : String(error),
				);
		}
	}
	#redraw(): void {
		if (!this.#visible || !this.#presentation || this.#frame !== null) return;
		this.#frame = requestAnimationFrame(() => {
			this.#frame = null;
			try {
				const presentation = this.#presentation;
				if (this.#visible && presentation) {
					presentation.renderer.draw(presentation.view);
					for (const listener of this.#drawListeners) listener();
				}
			} catch (error) {
				this.#failed(
					"load-failed",
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				this.#finishDraw();
			}
		});
	}
	#finishDraw(): void {
		for (const resolve of this.#drawWaiters) resolve();
		this.#drawWaiters.clear();
	}
	#cancelDraw(): void {
		if (this.#frame !== null) cancelAnimationFrame(this.#frame);
		this.#frame = null;
		this.#finishDraw();
	}
	#publish(state: WorldMapState): void {
		this.#state = state;
		for (const listener of this.#listeners) listener(state);
	}
}
