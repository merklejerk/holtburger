import type { RendererFrameTelemetry } from "../renderer/types";

export interface PerformanceMetricsTrackerOptions {
	readonly sampleMs: number;
	readonly emaAlpha: number;
	readonly nowMs?: () => number;
}

export interface PerformanceMetricsSnapshot {
	readonly fps: number;
	readonly frameMs: number;
	readonly handlerMs: number;
	readonly extrapolatedFps: number;
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
	#smoothedHandlerMs = 0;
	#snapshot: PerformanceMetricsSnapshot = {
		fps: 0,
		frameMs: 0,
		handlerMs: 0,
		extrapolatedFps: 0,
	};

	constructor(options: PerformanceMetricsTrackerOptions) {
		this.#sampleMs = options.sampleMs;
		this.#emaAlpha = options.emaAlpha;
		this.#nowMs = options.nowMs ?? (() => performance.now());
	}

	update(telemetry: RendererFrameTelemetry): PerformanceMetricsSnapshot {
		const nowMs = this.#nowMs();

		this.#smoothedHandlerMs = this.#smooth(
			this.#smoothedHandlerMs,
			telemetry.frameHandlerMs,
		);

		if (!this.#lastSample) {
			this.#lastSample = {
				frameCount: telemetry.frameCount,
				timeMs: nowMs,
			};
			this.#snapshot = {
				fps: 0,
				frameMs: 0,
				handlerMs: this.#smoothedHandlerMs,
				extrapolatedFps: this.#calculateExtrapolatedFps(
					this.#smoothedHandlerMs,
				),
			};
			return this.#snapshot;
		}

		const elapsedMs = nowMs - this.#lastSample.timeMs;
		const frameDelta = telemetry.frameCount - this.#lastSample.frameCount;
		if (elapsedMs < this.#sampleMs || frameDelta <= 0) {
			return this.#snapshot;
		}

		this.#snapshot = {
			fps: this.#smooth(this.#snapshot.fps, (frameDelta * 1000) / elapsedMs),
			frameMs: this.#smooth(this.#snapshot.frameMs, elapsedMs / frameDelta),
			handlerMs: this.#smoothedHandlerMs,
			extrapolatedFps: this.#calculateExtrapolatedFps(this.#smoothedHandlerMs),
		};
		this.#lastSample = {
			frameCount: telemetry.frameCount,
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

	#calculateExtrapolatedFps(handlerMs: number): number {
		return handlerMs > 0 ? Math.min(9999, 1000 / handlerMs) : 9999;
	}
}
