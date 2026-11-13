import {
	RENDERER_CPU_PHASES,
	RENDERER_GPU_SYSTEMS,
	type RendererCpuPhase,
	type RendererFrameProfile,
	type RendererGpuFrameProfile,
	type RendererGpuSystem,
} from "./renderer";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";

/** Elapsed-query support; absolute GPU timestamps are deliberately unnecessary. */
interface WebGL2DisjointTimerQueryExtension {
	readonly GPU_DISJOINT_EXT: GLenum;
	readonly QUERY_COUNTER_BITS_EXT: GLenum;
	readonly TIME_ELAPSED_EXT: GLenum;
}

/** One non-overlapping command-stream segment. */
interface GpuSegment {
	readonly query: WebGLQuery;
	readonly system: RendererGpuSystem;
}

/** A bounded set of segments, or null after an incomplete frame has been discarded. */
interface GpuFrame {
	segments: GpuSegment[] | null;
	readonly frameNumber: number;
	readonly epoch: number;
}

/** Only complete frames may enter the asynchronous readback queue. */
interface PendingGpuFrame {
	readonly frameNumber: number;
	readonly segments: readonly GpuSegment[];
}

const NANOSECONDS_PER_MILLISECOND = 1_000_000;

/** GPU capture lifetime, closed by the renderer's outer finally block. */
export class WebGL2GpuFrameCapture {
	#finished = false;
	constructor(
		readonly owner: WebGL2GpuFrameProfiler,
		readonly frame: GpuFrame,
	) {}
	discard(): void {
		this.owner.discardFrame(this.frame);
	}
	finish(): void {
		if (this.#finished)
			throw new Error("GPU frame capture finished more than once.");
		this.#finished = true;
		this.owner.finishFrame(this.frame);
	}
}

/** Fresh mutable accumulators; only completed frame snapshots cross the public boundary. */
function emptySystemTimes(): Record<RendererGpuSystem, number> {
	return {
		terrain: 0,
		opaqueGeometry: 0,
		shadowMaps: 0,
		ambientOcclusion: 0,
		portalComposition: 0,
		transparencyAndEffects: 0,
		presentation: 0,
		other: 0,
	};
}

/** Opt-in, bounded sequential GPU spans. Reads never wait for device completion. */
export class WebGL2GpuFrameProfiler {
	readonly #gl: WebGL2RenderingContext;
	readonly #extension: WebGL2DisjointTimerQueryExtension | null;
	readonly #pending: PendingGpuFrame[] = [];
	#active: GpuFrame | null = null;
	#latest: RendererGpuFrameProfile;
	#epoch = 0;
	#totalSystemMs = emptySystemTimes();
	#skippedFrameCount = 0;
	#sampleCount = 0;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		const extension = gl.getExtension(
			"EXT_disjoint_timer_query_webgl2",
		) as WebGL2DisjointTimerQueryExtension | null;
		this.#extension =
			extension &&
			(gl.getQuery(
				extension.TIME_ELAPSED_EXT,
				extension.QUERY_COUNTER_BITS_EXT,
			) as number) > 0
				? extension
				: null;
		this.#latest = this.#extension
			? { kind: "pending", pendingFrameCount: 0, skippedFrameCount: 0 }
			: { kind: "unsupported" };
	}

	beginFrame(frameNumber: number): WebGL2GpuFrameCapture | null {
		this.#assertAlive();
		if (this.#active) throw new Error("A GPU frame query is already active.");
		this.poll();
		const extension = this.#extension;
		if (!extension) return null;
		if (
			this.#pending.length >=
			SHARED_FRONTEND_TUNING.diagnostics.maximumPendingGpuFrames
		) {
			this.#skippedFrameCount++;
			return null;
		}
		const segment = this.#createSegment("other");
		this.#gl.beginQuery(extension.TIME_ELAPSED_EXT, segment.query);
		this.#active = { segments: [segment], frameNumber, epoch: this.#epoch };
		return new WebGL2GpuFrameCapture(this, this.#active);
	}

	/** Switch attribution without nesting elapsed queries; adjacent equal systems share a query. */
	setSystem(system: RendererGpuSystem): void {
		this.#assertAlive();
		const frame = this.#active;
		const extension = this.#extension;
		if (!frame?.segments || !extension) return;
		const segments = frame.segments;
		if (segments[segments.length - 1].system === system) return;
		if (
			segments.length >=
			SHARED_FRONTEND_TUNING.diagnostics.maximumGpuSegmentsPerFrame
		) {
			this.discardFrame(frame);
			return;
		}
		// Allocate before ending the current query so allocation failure can still close it.
		const next = this.#createSegment(system);
		this.#gl.endQuery(extension.TIME_ELAPSED_EXT);
		segments.push(next);
		this.#gl.beginQuery(extension.TIME_ELAPSED_EXT, next.query);
	}

	finishFrame(frame: GpuFrame): void {
		this.#assertAlive();
		if (frame.epoch !== this.#epoch) return;
		if (this.#active !== frame || !this.#extension)
			throw new Error("GPU frame query is not active.");
		if (frame.segments) {
			this.#gl.endQuery(this.#extension.TIME_ELAPSED_EXT);
			this.#pending.push({
				frameNumber: frame.frameNumber,
				segments: frame.segments,
			});
		}
		this.#active = null;
	}

	/** An aborted or over-budget frame contributes neither totals nor individual systems. */
	discardFrame(frame: GpuFrame): void {
		this.#assertAlive();
		if (frame.epoch !== this.#epoch) return;
		if (this.#active !== frame || !this.#extension)
			throw new Error("GPU frame query is not active.");
		if (!frame.segments) return;
		this.#gl.endQuery(this.#extension.TIME_ELAPSED_EXT);
		for (const segment of frame.segments) this.#gl.deleteQuery(segment.query);
		frame.segments = null;
		this.#skippedFrameCount++;
	}

	#createSegment(system: RendererGpuSystem): GpuSegment {
		const query = this.#gl.createQuery();
		if (!query) throw new Error("Failed to allocate a GPU segment query.");
		return { query, system };
	}

	poll(): void {
		this.#assertAlive();
		const extension = this.#extension;
		if (!extension) return;
		if (this.#gl.getParameter(extension.GPU_DISJOINT_EXT) as boolean) {
			this.reset();
			this.#latest = {
				kind: "disjoint",
				pendingFrameCount: 0,
				skippedFrameCount: 0,
			};
			return;
		}
		while (this.#pending.length > 0) {
			const frame = this.#pending[0];
			const segments = frame.segments;
			if (
				segments.some(
					(segment) =>
						!(this.#gl.getQueryParameter(
							segment.query,
							this.#gl.QUERY_RESULT_AVAILABLE,
						) as boolean),
				)
			)
				return;
			this.#pending.shift();
			const latestSystemMs = emptySystemTimes();
			let totalMs = 0;
			for (const segment of segments) {
				const elapsedMs =
					(this.#gl.getQueryParameter(
						segment.query,
						this.#gl.QUERY_RESULT,
					) as number) / NANOSECONDS_PER_MILLISECOND;
				this.#gl.deleteQuery(segment.query);
				latestSystemMs[segment.system] += elapsedMs;
				totalMs += elapsedMs;
			}
			this.#sampleCount++;
			const meanSystemMs = emptySystemTimes();
			let meanMs = 0;
			for (const system of RENDERER_GPU_SYSTEMS) {
				this.#totalSystemMs[system] += latestSystemMs[system];
				meanSystemMs[system] = this.#totalSystemMs[system] / this.#sampleCount;
				meanMs += meanSystemMs[system];
			}
			this.#latest = {
				kind: "available",
				frameNumber: frame.frameNumber,
				latestMs: totalMs,
				meanMs,
				latestSystemMs,
				meanSystemMs,
				sampleCount: this.#sampleCount,
				pendingFrameCount: this.#pending.length,
				skippedFrameCount: this.#skippedFrameCount,
			};
		}
	}

	getProfile(): RendererGpuFrameProfile {
		return this.#latest.kind === "unsupported"
			? this.#latest
			: {
					...this.#latest,
					pendingFrameCount: this.#pending.length,
					skippedFrameCount: this.#skippedFrameCount,
				};
	}

	/** Discard both outstanding queries and aggregates; prior captures cannot close a new query. */
	reset(): void {
		this.#epoch++;
		if (this.#active?.segments && this.#extension) {
			this.#gl.endQuery(this.#extension.TIME_ELAPSED_EXT);
			for (const segment of this.#active.segments)
				this.#gl.deleteQuery(segment.query);
		}
		this.#active = null;
		for (const frame of this.#pending) {
			for (const segment of frame.segments) this.#gl.deleteQuery(segment.query);
		}
		this.#pending.length = 0;
		this.#totalSystemMs = emptySystemTimes();
		this.#skippedFrameCount = 0;
		this.#sampleCount = 0;
		this.#latest = this.#extension
			? { kind: "pending", pendingFrameCount: 0, skippedFrameCount: 0 }
			: { kind: "unsupported" };
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.reset();
		this.#destroyed = true;
	}

	#assertAlive(): void {
		if (this.#destroyed) throw new Error("GPU frame profiler is destroyed.");
	}
}

/** Renderer frame capture lifetime covering sequential CPU phases and optional GPU segments. */
export class WebGL2FrameProfileCapture {
	#finished = false;
	readonly #finishFrame: () => void;
	readonly #discardFrame: () => void;
	constructor(finishFrame: () => void, discardFrame: () => void) {
		this.#finishFrame = finishFrame;
		this.#discardFrame = discardFrame;
	}
	discard(): void {
		this.#discardFrame();
	}
	finish(): void {
		if (this.#finished)
			throw new Error("Renderer frame profile finished more than once.");
		this.#finished = true;
		this.#finishFrame();
	}
}

/** Fresh mutable CPU phase accumulators; only completed frame snapshots cross the public boundary. */
function emptyCpuPhaseTimes(): Record<RendererCpuPhase, number> {
	return {
		portalPlanning: 0,
		sceneSelection: 0,
		opaqueSubmission: 0,
		terrainSubmission: 0,
		portalComposition: 0,
		transparencyAndOverlays: 0,
		postAndPresentation: 0,
		other: 0,
	};
}

/** In-flight synchronous CPU attribution window, or `phaseMs: null` after aborting the frame. */
interface ActiveCpuFrame {
	readonly epoch: number;
	readonly frameNumber: number;
	phaseMs: Record<RendererCpuPhase, number> | null;
	currentPhase: RendererCpuPhase;
	lastMarkAt: number;
}

/** Sequential CPU phase attribution and coarse, sequential GPU system attribution. */
export class WebGL2FrameProfiler {
	readonly #gpu: WebGL2GpuFrameProfiler;
	readonly #recentCpuMs: number[] = [];
	#activeCpu: ActiveCpuFrame | null = null;
	#frameNumber = 0;
	#epoch = 0;
	#totalPhaseMs = emptyCpuPhaseTimes();
	#sampleCount = 0;
	#latest: {
		readonly frameNumber: number;
		readonly phaseMs: Readonly<Record<RendererCpuPhase, number>>;
		readonly totalMs: number;
	} | null = null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gpu = new WebGL2GpuFrameProfiler(gl);
	}

	beginFrame(): WebGL2FrameProfileCapture {
		if (this.#activeCpu)
			throw new Error("A CPU frame profile is already active.");
		const startedAt = performance.now();
		const frameNumber = ++this.#frameNumber;
		const epoch = this.#epoch;
		const gpu = this.#gpu.beginFrame(frameNumber);
		const activeCpu: ActiveCpuFrame = {
			epoch,
			frameNumber,
			phaseMs: emptyCpuPhaseTimes(),
			currentPhase: "other",
			lastMarkAt: startedAt,
		};
		this.#activeCpu = activeCpu;
		return new WebGL2FrameProfileCapture(
			() => {
				gpu?.finish();
				if (epoch !== this.#epoch) return;
				if (this.#activeCpu !== activeCpu)
					throw new Error("CPU frame profile is not active.");
				this.#activeCpu = null;
				const phaseMs = activeCpu.phaseMs;
				if (!phaseMs) return;
				const endedAt = performance.now();
				phaseMs[activeCpu.currentPhase] += endedAt - activeCpu.lastMarkAt;
				let totalMs = 0;
				for (const phase of RENDERER_CPU_PHASES) {
					const elapsedMs = phaseMs[phase];
					this.#totalPhaseMs[phase] += elapsedMs;
					totalMs += elapsedMs;
				}
				this.#sampleCount++;
				this.#latest = {
					frameNumber,
					phaseMs: { ...phaseMs },
					totalMs,
				};
				this.#recentCpuMs.push(totalMs);
				if (
					this.#recentCpuMs.length >
					SHARED_FRONTEND_TUNING.diagnostics.percentileCpuFrameTail
				)
					this.#recentCpuMs.shift();
			},
			() => {
				gpu?.discard();
				if (epoch !== this.#epoch) return;
				if (this.#activeCpu !== activeCpu)
					throw new Error("CPU frame profile is not active.");
				activeCpu.phaseMs = null;
			},
		);
	}

	/** Switch synchronous CPU phase attribution; ignored outside an active, undiscarded frame. */
	setCpuPhase(phase: RendererCpuPhase): void {
		const active = this.#activeCpu;
		const phaseMs = active?.phaseMs;
		if (
			!active ||
			!phaseMs ||
			active.epoch !== this.#epoch ||
			active.currentPhase === phase
		)
			return;
		const now = performance.now();
		phaseMs[active.currentPhase] += now - active.lastMarkAt;
		active.lastMarkAt = now;
		active.currentPhase = phase;
	}

	/** Ignored when the GPU capture was not admitted or elapsed queries are unsupported. */
	setGpuSystem(system: RendererGpuSystem): void {
		this.#gpu.setSystem(system);
	}

	getProfile(): RendererFrameProfile | null {
		if (!this.#latest) return null;
		const sorted = [...this.#recentCpuMs].sort((left, right) => left - right);
		const meanPhaseMs = emptyCpuPhaseTimes();
		let meanMs = 0;
		for (const phase of RENDERER_CPU_PHASES) {
			meanPhaseMs[phase] = this.#totalPhaseMs[phase] / this.#sampleCount;
			meanMs += meanPhaseMs[phase];
		}
		return {
			cpu: {
				latestFrameNumber: this.#latest.frameNumber,
				latestMs: this.#latest.totalMs,
				meanMs,
				latestPhaseMs: { ...this.#latest.phaseMs },
				meanPhaseMs,
				sampleCount: this.#sampleCount,
				p95RecentMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
			},
			gpu: this.#gpu.getProfile(),
		};
	}

	reset(): void {
		this.#epoch++;
		this.#activeCpu = null;
		this.#recentCpuMs.length = 0;
		this.#totalPhaseMs = emptyCpuPhaseTimes();
		this.#sampleCount = 0;
		this.#latest = null;
		this.#gpu.reset();
	}
	destroy(): void {
		this.reset();
		this.#gpu.destroy();
	}
}
