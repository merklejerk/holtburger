import type { RendererFrameProfile, RendererGpuFrameProfile } from "./renderer";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";

/** Elapsed-query support; absolute GPU timestamps are deliberately unnecessary. */
interface WebGL2DisjointTimerQueryExtension {
	readonly GPU_DISJOINT_EXT: GLenum;
	readonly QUERY_COUNTER_BITS_EXT: GLenum;
	readonly TIME_ELAPSED_EXT: GLenum;
}

/** Exactly one query per admitted renderer frame. Epochs isolate resets. */
interface GpuFrame {
	readonly query: WebGLQuery;
	readonly frameNumber: number;
	readonly epoch: number;
}

const NANOSECONDS_PER_MILLISECOND = 1_000_000;

/** Whole-frame query lifetime, closed by the renderer's outer finally block. */
export class WebGL2GpuFrameCapture {
	#finished = false;
	constructor(
		readonly owner: WebGL2GpuFrameProfiler,
		readonly frame: GpuFrame,
	) {}
	finish(): void {
		if (this.#finished)
			throw new Error("GPU frame capture finished more than once.");
		this.#finished = true;
		this.owner.finishFrame(this.frame);
	}
}

/** Opt-in, bounded whole-frame GPU spans. Reads never wait for device completion. */
export class WebGL2GpuFrameProfiler {
	readonly #gl: WebGL2RenderingContext;
	readonly #extension: WebGL2DisjointTimerQueryExtension | null;
	readonly #pending: GpuFrame[] = [];
	#active: GpuFrame | null = null;
	#latest: RendererGpuFrameProfile;
	#epoch = 0;
	#totalMs = 0;
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
			? { kind: "pending", pendingFrameCount: 0 }
			: { kind: "unsupported" };
	}

	beginFrame(frameNumber: number): WebGL2GpuFrameCapture | null {
		this.#assertAlive();
		if (this.#active) throw new Error("A GPU frame query is already active.");
		this.poll();
		if (
			!this.#extension ||
			this.#pending.length >=
				SHARED_FRONTEND_TUNING.diagnostics.maximumPendingGpuFrames
		)
			return null;
		const query = this.#gl.createQuery();
		if (!query) throw new Error("Failed to allocate a GPU frame query.");
		this.#active = { query, frameNumber, epoch: this.#epoch };
		this.#gl.beginQuery(this.#extension.TIME_ELAPSED_EXT, query);
		return new WebGL2GpuFrameCapture(this, this.#active);
	}

	finishFrame(frame: GpuFrame): void {
		this.#assertAlive();
		if (frame.epoch !== this.#epoch) return;
		if (this.#active !== frame || !this.#extension)
			throw new Error("GPU frame query is not active.");
		this.#gl.endQuery(this.#extension.TIME_ELAPSED_EXT);
		this.#active = null;
		this.#pending.push(frame);
	}

	poll(): void {
		this.#assertAlive();
		const extension = this.#extension;
		if (!extension) return;
		if (this.#gl.getParameter(extension.GPU_DISJOINT_EXT) as boolean) {
			this.reset();
			this.#latest = { kind: "disjoint", pendingFrameCount: 0 };
			return;
		}
		while (this.#pending.length > 0) {
			const frame = this.#pending[0];
			if (
				!(this.#gl.getQueryParameter(
					frame.query,
					this.#gl.QUERY_RESULT_AVAILABLE,
				) as boolean)
			)
				return;
			this.#pending.shift();
			const totalMs =
				(this.#gl.getQueryParameter(
					frame.query,
					this.#gl.QUERY_RESULT,
				) as number) / NANOSECONDS_PER_MILLISECOND;
			this.#gl.deleteQuery(frame.query);
			this.#totalMs += totalMs;
			this.#sampleCount++;
			this.#latest = {
				kind: "available",
				frameNumber: frame.frameNumber,
				latestMs: totalMs,
				meanMs: this.#totalMs / this.#sampleCount,
				sampleCount: this.#sampleCount,
				pendingFrameCount: this.#pending.length,
			};
		}
	}

	getProfile(): RendererGpuFrameProfile {
		return this.#latest.kind === "unsupported"
			? this.#latest
			: { ...this.#latest, pendingFrameCount: this.#pending.length };
	}

	/** Discard both outstanding queries and aggregates; prior captures cannot close a new query. */
	reset(): void {
		this.#epoch++;
		if (this.#active && this.#extension) {
			this.#gl.endQuery(this.#extension.TIME_ELAPSED_EXT);
			this.#gl.deleteQuery(this.#active.query);
			this.#active = null;
		}
		for (const frame of this.#pending) this.#gl.deleteQuery(frame.query);
		this.#pending.length = 0;
		this.#totalMs = 0;
		this.#sampleCount = 0;
		this.#latest = this.#extension
			? { kind: "pending", pendingFrameCount: 0 }
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

/** Two CPU clock reads and one optional device query around a complete renderer frame. */
export class WebGL2FrameProfileCapture {
	#finished = false;
	constructor(readonly finishFrame: () => void) {}
	finish(): void {
		if (this.#finished)
			throw new Error("Renderer frame profile finished more than once.");
		this.#finished = true;
		this.finishFrame();
	}
}

/** Whole-renderer timing only; draw helpers have no profiling parameters or hooks. */
export class WebGL2FrameProfiler {
	readonly #gpu: WebGL2GpuFrameProfiler;
	readonly #recentCpuMs: number[] = [];
	#frameNumber = 0;
	#epoch = 0;
	#totalMs = 0;
	#sampleCount = 0;
	#latest: { readonly frameNumber: number; readonly totalMs: number } | null =
		null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gpu = new WebGL2GpuFrameProfiler(gl);
	}

	beginFrame(): WebGL2FrameProfileCapture {
		const startedAt = performance.now();
		const frameNumber = ++this.#frameNumber;
		const epoch = this.#epoch;
		const gpu = this.#gpu.beginFrame(frameNumber);
		return new WebGL2FrameProfileCapture(() => {
			gpu?.finish();
			if (epoch !== this.#epoch) return;
			const totalMs = performance.now() - startedAt;
			this.#totalMs += totalMs;
			this.#sampleCount++;
			this.#latest = { frameNumber, totalMs };
			this.#recentCpuMs.push(totalMs);
			if (
				this.#recentCpuMs.length >
				SHARED_FRONTEND_TUNING.diagnostics.percentileCpuFrameTail
			)
				this.#recentCpuMs.shift();
		});
	}

	getProfile(): RendererFrameProfile | null {
		if (!this.#latest) return null;
		const sorted = [...this.#recentCpuMs].sort((left, right) => left - right);
		return {
			cpu: {
				latestFrameNumber: this.#latest.frameNumber,
				latestMs: this.#latest.totalMs,
				meanMs: this.#totalMs / this.#sampleCount,
				sampleCount: this.#sampleCount,
				p95RecentMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
			},
			gpu: this.#gpu.getProfile(),
		};
	}

	reset(): void {
		this.#epoch++;
		this.#recentCpuMs.length = 0;
		this.#totalMs = 0;
		this.#sampleCount = 0;
		this.#latest = null;
		this.#gpu.reset();
	}
	destroy(): void {
		this.reset();
		this.#gpu.destroy();
	}
}
