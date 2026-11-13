import type { FrameRates } from "./frame-rate-sampler";
import {
	terrainCaptureDelta,
	type PerformanceReport,
} from "./performance-report";
import type {
	NativePerformanceSource,
	NativePerformanceState,
} from "./native-performance";
import type { GamePresentationRuntime } from "../lib/game/runtime/game-presentation-runtime";
import type {
	FrameSelectionMetrics,
	FrameSettings,
	RendererFrameProfile,
} from "../lib/game/renderer/renderer";
import type { WebGL2DeviceDiagnosticIdentity } from "../lib/game/renderer/webgl2-diagnostic-identity";
import type { ClosedWorkerPoolDiagnostics } from "../lib/game/workers/closed-worker";

/** Subset of renderer frame diagnostics consumed by session reports. */
export interface PerformanceRendererDiagnostics {
	readonly profile: RendererFrameProfile | null;
	readonly selectionMetrics: Pick<
		FrameSelectionMetrics,
		| "visibleSceneEntries"
		| "submittedStaticObjectDrawCount"
		| "submittedDynamicDrawCount"
		| "portalSelectedScopeCount"
		| "portalSelectedCrossingCount"
		| "portalPropagationDrawCount"
		| "portalAtlasTilePixelCount"
		| "portalTargetBytes"
	>;
}

/** Dependencies borrowed for exactly one presentation runtime lifetime. */
export interface PerformanceSessionSource {
	readonly mode: PerformanceReport["mode"];
	readonly runtime: Pick<
		GamePresentationRuntime,
		| "setFrameProfilingEnabled"
		| "resetFrameProfile"
		| "getPresentationProfile"
		| "getTerrainWorkerDiagnostics"
	> & {
		readonly getRendererFrameDiagnostics: () => PerformanceRendererDiagnostics | null;
	};
	readonly canvas: Pick<
		HTMLCanvasElement,
		"clientWidth" | "clientHeight" | "width" | "height"
	>;
	readonly readGraphics: () => FrameSettings;
	readonly readDevice: () => WebGL2DeviceDiagnosticIdentity;
	readonly readFrameRates: () => FrameRates | null;
	/** A mode either supplies native observations or explains its absent capability. */
	readonly native:
		| { readonly kind: "available"; readonly source: NativePerformanceSource }
		| { readonly kind: "unavailable"; readonly reason: string };
}

// Presentation roots can be replaced while the same native authority survives. A module-wide
// sequence prevents a replacement root from reusing an earlier capture generation.
let nextGeneration = 0;

/** In-flight browser window, with immutable device identity probed once at capture start. */
interface RecordingCapture {
	readonly kind: "recording";
	readonly startedAt: string;
	readonly startedAtMs: number;
	readonly terrain: ClosedWorkerPoolDiagnostics;
	readonly device: WebGL2DeviceDiagnosticIdentity;
	workMs: number;
	sampleCount: number;
}

/** Active measurements and frozen evidence cannot coexist as independent optional fields. */
type CaptureState =
	| { readonly kind: "idle" }
	| RecordingCapture
	| { readonly kind: "stopped"; readonly report: PerformanceReport };

/** Owns explicit captures independently of either panel's mount/visibility lifecycle. */
export class PerformanceSession {
	readonly #source: PerformanceSessionSource;
	#generation = 0;
	#capture: CaptureState = { kind: "idle" };
	#retired = false;
	#busy = false;
	#refreshingGeneration: number | null = null;
	#native: NativePerformanceState;

	constructor(source: PerformanceSessionSource) {
		this.#source = source;
		this.#native =
			source.native.kind === "unavailable"
				? source.native
				: { kind: "pending" };
	}

	get recording(): boolean {
		return this.#capture.kind === "recording";
	}
	get retired(): boolean {
		return this.#retired;
	}

	async start(): Promise<void> {
		if (this.recording)
			throw new Error("A performance capture is already recording.");
		await this.#begin(false);
	}

	async reset(): Promise<void> {
		if (!this.recording)
			throw new Error("Start profiling before resetting the capture.");
		await this.#begin(true);
	}

	async #begin(reset: boolean): Promise<void> {
		if (this.#retired) throw new Error("Presentation runtime has retired.");
		if (this.#busy)
			throw new Error("Performance control is already in progress.");
		this.#busy = true;
		const generation = ++nextGeneration;
		try {
			const native = this.#source.native;
			if (native.kind === "available") {
				const snapshot = await native.source.control("start", generation);
				if (this.#retired) {
					throw new Error(
						"Presentation runtime retired during profiling start.",
					);
				}
				this.#native = { kind: "available", snapshot };
			}
			if (reset) this.#source.runtime.resetFrameProfile();
			else this.#source.runtime.setFrameProfilingEnabled(true);
			this.#generation = generation;
			this.#capture = {
				kind: "recording",
				device: this.#source.readDevice(),
				startedAt: new Date().toISOString(),
				startedAtMs: performance.now(),
				terrain: this.#source.runtime.getTerrainWorkerDiagnostics(),
				workMs: 0,
				sampleCount: 0,
			};
		} catch (error) {
			// A partially enabled capture is unusable. Roll back both owners, even when reset failed.
			if (!this.#retired) this.#source.runtime.setFrameProfilingEnabled(false);
			if (this.#capture.kind === "recording") this.#capture = { kind: "idle" };
			if (this.#source.native.kind === "available") {
				try {
					await this.#source.native.source.control("stop", generation);
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						"Performance capture failed and native cleanup failed.",
						{ cause: cleanupError },
					);
				}
			}
			throw error;
		} finally {
			this.#busy = false;
		}
	}

	/** Borrow the frame loop's existing measurement; inactive captures perform no clocks. */
	recordFrame(workMs: number): void {
		if (this.#capture.kind !== "recording" || this.#busy) return;
		this.#capture.workMs += workMs;
		this.#capture.sampleCount++;
	}

	/** Native reads occur only at the diagnostic consumer's cadence, never every frame. */
	async refresh(): Promise<void> {
		if (
			!this.recording ||
			this.#busy ||
			this.#refreshingGeneration === this.#generation ||
			this.#source.native.kind !== "available"
		)
			return;
		const generation = this.#generation;
		this.#refreshingGeneration = generation;
		try {
			const snapshot = await this.#source.native.source.control(
				"snapshot",
				generation,
			);
			if (this.recording && !this.#busy && this.#generation === generation)
				this.#native = { kind: "available", snapshot };
		} catch (error) {
			if (this.recording && !this.#busy && this.#generation === generation) {
				this.#native = this.#nativeFailure(error);
			}
		} finally {
			if (this.#refreshingGeneration === generation)
				this.#refreshingGeneration = null;
		}
	}

	snapshot(): PerformanceReport | null {
		const capture = this.#capture;
		if (capture.kind === "idle") return null;
		if (capture.kind === "stopped") return capture.report;
		return this.#readCapture(capture);
	}

	#readCapture(capture: RecordingCapture): PerformanceReport {
		const { runtime, canvas } = this.#source;
		const presentation = runtime.getPresentationProfile();
		const renderer = runtime.getRendererFrameDiagnostics();
		return {
			schemaVersion: 5,
			mode: this.#source.mode,
			capture: {
				generation: this.#generation,
				state: "recording",
				startedAt: capture.startedAt,
				elapsedMs: performance.now() - capture.startedAtMs,
				retired: false,
			},
			context: {
				userAgent: navigator.userAgent,
				device: capture.device,
				graphics: this.#source.readGraphics(),
				viewport: {
					cssWidth: canvas.clientWidth,
					cssHeight: canvas.clientHeight,
					drawingBufferWidth: canvas.width,
					drawingBufferHeight: canvas.height,
				},
			},
			browser: {
				frameRates: this.#source.readFrameRates(),
				meanFrameWorkMs:
					capture.sampleCount === 0
						? null
						: capture.workMs / capture.sampleCount,
				sampleCount: capture.sampleCount,
				presentation,
			},
			renderer: renderer?.profile ?? null,
			workload: renderer
				? {
						sceneEntries: renderer.selectionMetrics.visibleSceneEntries,
						staticDraws:
							renderer.selectionMetrics.submittedStaticObjectDrawCount,
						dynamicDraws: renderer.selectionMetrics.submittedDynamicDrawCount,
						portal: {
							scopes: renderer.selectionMetrics.portalSelectedScopeCount,
							crossings: renderer.selectionMetrics.portalSelectedCrossingCount,
							propagationDraws:
								renderer.selectionMetrics.portalPropagationDrawCount,
							tilePixels: renderer.selectionMetrics.portalAtlasTilePixelCount,
							targetBytes: renderer.selectionMetrics.portalTargetBytes,
						},
					}
				: null,
			native: this.#native,
			terrainWorker: terrainCaptureDelta(
				capture.terrain,
				runtime.getTerrainWorkerDiagnostics(),
			),
		};
	}

	async stop(): Promise<void> {
		if (this.#busy)
			throw new Error("Performance control is already in progress.");
		if (!this.recording) return;
		this.#freeze(false);
		await this.#finishNative();
	}

	#freeze(retired: boolean): void {
		if (this.#capture.kind !== "recording") return;
		const report = this.#readCapture(this.#capture);
		this.#capture = {
			kind: "stopped",
			report: structuredClone({
				...report,
				capture: { ...report.capture, state: "stopped", retired },
			}),
		};
		this.#source.runtime.setFrameProfilingEnabled(false);
	}

	async #finishNative(): Promise<void> {
		if (this.#source.native.kind !== "available") return;
		this.#busy = true;
		try {
			const snapshot = await this.#source.native.source.control(
				"stop",
				this.#generation,
			);
			if (this.#capture.kind === "stopped")
				this.#capture = {
					kind: "stopped",
					report: {
						...this.#capture.report,
						native: { kind: "available", snapshot },
					},
				};
		} catch (error) {
			if (this.#capture.kind === "stopped")
				this.#capture = {
					kind: "stopped",
					report: {
						...this.#capture.report,
						native: this.#nativeFailure(error),
					},
				};
			throw error;
		} finally {
			this.#busy = false;
		}
	}

	#nativeFailure(error: unknown): NativePerformanceState {
		return {
			kind: "failed",
			reason: error instanceof Error ? error.message : String(error),
			lastSnapshot:
				this.#native.kind === "available"
					? this.#native.snapshot
					: this.#native.kind === "failed"
						? this.#native.lastSnapshot
						: null,
		};
	}

	/** Synchronous browser retirement precedes device teardown; pending start rolls itself back. */
	retire(): void {
		this.#retired = true;
		if (!this.recording) return;
		this.#freeze(true);
		if (!this.#busy)
			void this.#finishNative().catch((error: unknown) =>
				console.error("Native profiler retirement failed", error),
			);
	}
}
