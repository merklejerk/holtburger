import type { RendererSnapshot } from "../renderer/types";

export interface PerformanceMetricsTrackerOptions {
	readonly sampleMs: number;
	readonly emaAlpha: number;
	readonly nowMs?: () => number;
}

export interface PerformanceMetricsSnapshot {
	readonly fps: number;
	readonly frameMs: number;
	readonly handlerMs: number;
}

interface PerformanceMetricsSample {
	readonly frameCount: number;
	readonly timeMs: number;
}

export class PerformanceMetricsTracker {
	readonly #sampleMs: number;
	readonly #emaAlpha: number;
	readonly #nowMs: () => number;
	#lastSample: PerformanceMetricsSample | null = null;
	#snapshot: PerformanceMetricsSnapshot = {
		fps: 0,
		frameMs: 0,
		handlerMs: 0,
	};

	constructor(options: PerformanceMetricsTrackerOptions) {
		this.#sampleMs = options.sampleMs;
		this.#emaAlpha = options.emaAlpha;
		this.#nowMs = options.nowMs ?? (() => performance.now());
	}

	update(renderer: RendererSnapshot): PerformanceMetricsSnapshot {
		const nowMs = this.#nowMs();
		if (!this.#lastSample) {
			this.#lastSample = {
				frameCount: renderer.frameCount,
				timeMs: nowMs,
			};
			this.#snapshot = {
				...this.#snapshot,
				handlerMs: this.#smooth(
					this.#snapshot.handlerMs,
					renderer.frameHandlerMs,
				),
			};
			return this.#snapshot;
		}

		const elapsedMs = nowMs - this.#lastSample.timeMs;
		const frameDelta = renderer.frameCount - this.#lastSample.frameCount;
		if (elapsedMs < this.#sampleMs || frameDelta <= 0) {
			this.#snapshot = {
				...this.#snapshot,
				handlerMs: this.#smooth(
					this.#snapshot.handlerMs,
					renderer.frameHandlerMs,
				),
			};
			return this.#snapshot;
		}

		this.#snapshot = {
			fps: this.#smooth(this.#snapshot.fps, (frameDelta * 1000) / elapsedMs),
			frameMs: this.#smooth(this.#snapshot.frameMs, elapsedMs / frameDelta),
			handlerMs: this.#smooth(
				this.#snapshot.handlerMs,
				renderer.frameHandlerMs,
			),
		};
		this.#lastSample = {
			frameCount: renderer.frameCount,
			timeMs: nowMs,
		};

		return this.#snapshot;
	}

	#smooth(previous: number, next: number): number {
		if (previous <= 0) {
			return next;
		}

		return previous + (next - previous) * this.#emaAlpha;
	}
}
