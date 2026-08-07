import type {
	RendererCpuFrameProfile,
	RendererCpuFrameProfileWindow,
	RendererCpuFrameTimings,
	RendererContributionFrameMetrics,
	RendererFrameProfile,
	RendererGpuFrameProfile,
} from "./renderer";
import { FRONTEND_TUNING } from "../../frontend-tuning";

/** GPU phases whose timestamp intervals are aggregated across every view in one frame. */
export type WebGL2GpuFramePhase = "terrain" | "opaque" | "blended" | "particle";

/** Non-overlapping CPU spans recorded only while an explicit profiling session is active. */
export type WebGL2CpuFramePhase =
	| "setup"
	| "viewPreparation"
	| "sceneQuery"
	| "sceneContributionResolution"
	| "objectPreparation"
	| "contributionMerge"
	| "blendedOrdering"
	| "generatedInstanceCulling"
	| "instanceRunPreparation"
	| "instanceUpload"
	| "portalGraphPlanning"
	| "terrainSubmission"
	| "opaqueSubmission"
	| "blendedSubmission"
	| "particleSubmission"
	| "finalization";

/**
 * WebGL2 timer-query extension shape absent from TypeScript's standard DOM declarations.
 *
 * `TIMESTAMP_EXT` and `queryCounterEXT` are deliberately not declared. Chrome exposes this extension
 * but reports **zero** `QUERY_COUNTER_BITS_EXT` for `TIMESTAMP_EXT` — absolute GPU timestamps are a
 * high-precision timing-attack vector and are disabled — while `TIME_ELAPSED_EXT` reports 64 bits and
 * works. A profiler built on timestamps therefore never runs in Chrome at all, headless or not.
 */
interface WebGL2DisjointTimerQueryExtension {
	readonly GPU_DISJOINT_EXT: GLenum;
	readonly QUERY_COUNTER_BITS_EXT: GLenum;
	readonly TIME_ELAPSED_EXT: GLenum;
}

interface ElapsedRange {
	readonly phase: WebGL2GpuFramePhase;
	readonly query: WebGLQuery;
}

interface PendingFrame {
	readonly frameNumber: number;
	readonly ranges: readonly ElapsedRange[];
}

const NANOSECONDS_PER_MILLISECOND = 1_000_000;
const CPU_TIMING_KEYS = [
	"blendedOrderingMs",
	"blendedSubmissionMs",
	"contributionMergeMs",
	"finalizationMs",
	"generatedInstanceCullingMs",
	"instanceRunPreparationMs",
	"instanceUploadMs",
	"objectPreparationMs",
	"opaqueSubmissionMs",
	"otherMs",
	"particleSubmissionMs",
	"portalGraphPlanningMs",
	"sceneQueryMs",
	"sceneContributionResolutionMs",
	"setupMs",
	"terrainSubmissionMs",
	"totalMs",
	"viewPreparationMs",
] as const satisfies readonly (keyof RendererCpuFrameTimings)[];

const CONTRIBUTION_METRIC_KEYS = [
	"multiNodeMergeCount",
	"dynamicObjectPreparationCount",
	"staticObjectPreparationCount",
	"portalContributionSetCount",
	"portalContributionSetUseCount",
	"portalNodePreparationCount",
	"repeatedPortalNodeUseCount",
	"repeatedPortalContributionSetUseCount",
	"portalNodeUseCount",
] as const satisfies readonly (keyof RendererContributionFrameMetrics)[];

type MutableContributionFrameMetrics = {
	-readonly [Key in keyof RendererContributionFrameMetrics]: number;
};

function createEmptyContributionMetrics(): MutableContributionFrameMetrics {
	return {
		multiNodeMergeCount: 0,
		dynamicObjectPreparationCount: 0,
		staticObjectPreparationCount: 0,
		portalContributionSetCount: 0,
		portalContributionSetUseCount: 0,
		portalNodePreparationCount: 0,
		repeatedPortalNodeUseCount: 0,
		repeatedPortalContributionSetUseCount: 0,
		portalNodeUseCount: 0,
	};
}

/** One active frame capture; timestamps never nest and results are consumed by its owner later. */
export class WebGL2GpuFrameCapture {
	readonly #owner: WebGL2GpuFrameProfiler;
	readonly #frameNumber: number;
	readonly #ranges: ElapsedRange[] = [];
	#finished = false;

	constructor(owner: WebGL2GpuFrameProfiler, frameNumber: number) {
		this.#owner = owner;
		this.#frameNumber = frameNumber;
	}

	/** Open an elapsed-time query around one profiled draw phase. */
	beginPhase(phase: WebGL2GpuFramePhase): WebGL2GpuFramePhaseCapture {
		if (this.#finished) {
			throw new Error(
				"Cannot begin a GPU phase after its frame capture finished.",
			);
		}
		return new WebGL2GpuFramePhaseCapture(
			this,
			phase,
			this.#owner.beginQuery(),
		);
	}

	/** Transfer this frame's phase queries to asynchronous polling. */
	finish(): void {
		if (this.#finished) {
			throw new Error("GPU frame capture finished more than once.");
		}
		this.#finished = true;
		this.#owner.finishFrame({
			frameNumber: this.#frameNumber,
			ranges: this.#ranges,
		});
	}

	finishPhase(phase: WebGL2GpuFramePhase, query: WebGLQuery): void {
		if (this.#finished) {
			throw new Error(
				"Cannot finish a GPU phase after its frame capture finished.",
			);
		}
		this.#owner.endQuery();
		this.#ranges.push({ phase, query });
	}
}

/** One elapsed-time span whose exact close point is owned by the draw-site caller. */
export class WebGL2GpuFramePhaseCapture {
	readonly #frame: WebGL2GpuFrameCapture;
	readonly #phase: WebGL2GpuFramePhase;
	readonly #start: WebGLQuery;
	#finished = false;

	constructor(
		frame: WebGL2GpuFrameCapture,
		phase: WebGL2GpuFramePhase,
		start: WebGLQuery,
	) {
		this.#frame = frame;
		this.#phase = phase;
		this.#start = start;
	}

	/** Close the elapsed-time query immediately after the profiled draw phase. */
	finish(): void {
		if (this.#finished) {
			throw new Error("GPU phase capture finished more than once.");
		}
		this.#finished = true;
		this.#frame.finishPhase(this.#phase, this.#start);
	}
}

/** Context-owned, opt-in timestamp collector that never waits for unfinished GPU results. */
export class WebGL2GpuFrameProfiler {
	readonly #gl: WebGL2RenderingContext;
	readonly #extension: WebGL2DisjointTimerQueryExtension | null;
	readonly #pending: PendingFrame[] = [];
	#latest: RendererGpuFrameProfile;
	#destroyed = false;
	/** WebGL permits one active elapsed-time query per context, so this guards nesting. */
	#activeQuery: WebGLQuery | null = null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		const extension = gl.getExtension(
			"EXT_disjoint_timer_query_webgl2",
		) as WebGL2DisjointTimerQueryExtension | null;
		const elapsedBits = extension
			? (gl.getQuery(
					extension.TIME_ELAPSED_EXT,
					extension.QUERY_COUNTER_BITS_EXT,
				) as number)
			: 0;
		this.#extension = elapsedBits > 0 ? extension : null;
		this.#latest = this.#extension
			? { kind: "pending", pendingFrameCount: 0 }
			: { kind: "unsupported" };
	}

	/** Poll completed work and begin one bounded frame capture when timestamp queries are supported. */
	beginFrame(frameNumber: number): WebGL2GpuFrameCapture | null {
		this.#assertAlive();
		this.poll();
		if (
			!this.#extension ||
			this.#pending.length >=
				FRONTEND_TUNING.diagnostics.maximumPendingGpuFrames
		) {
			return null;
		}
		return new WebGL2GpuFrameCapture(this, frameNumber);
	}

	/** Consume only already-available results; this method never synchronizes with the GPU. */
	poll(): void {
		this.#assertAlive();
		const extension = this.#extension;
		if (!extension) return;
		if (this.#gl.getParameter(extension.GPU_DISJOINT_EXT) as boolean) {
			this.#deletePending();
			this.#latest = { kind: "disjoint", pendingFrameCount: 0 };
			return;
		}
		for (;;) {
			const pending = this.#pending[0];
			if (!pending) return;
			const last = pending.ranges.at(-1);
			// A frame with no profiled phase has nothing to resolve; drop it rather than stall.
			if (!last) {
				this.#pending.shift();
				continue;
			}
			const available = this.#gl.getQueryParameter(
				last.query,
				this.#gl.QUERY_RESULT_AVAILABLE,
			) as boolean;
			if (!available) return;
			this.#pending.shift();
			this.#latest = this.#resolveFrame(pending);
			this.#deleteFrame(pending);
		}
	}

	/** Return a copied outcome plus the current backlog depth. */
	getProfile(): RendererGpuFrameProfile {
		if (this.#latest.kind === "unsupported") return this.#latest;
		return { ...this.#latest, pendingFrameCount: this.#pending.length };
	}

	/** Delete every outstanding query without waiting for results. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#deletePending();
	}

	/**
	 * Open the one elapsed-time query WebGL permits to be active at a time.
	 *
	 * The single-active constraint is why phases cannot nest and why there is no frame-wide span: a
	 * query wrapping the frame would have to close before any phase query could open inside it.
	 */
	beginQuery(): WebGLQuery {
		const extension = this.#extension;
		if (!extension) {
			throw new Error("Cannot time a GPU phase without timer-query support.");
		}
		if (this.#activeQuery) {
			throw new Error("A GPU phase query is already active; they cannot nest.");
		}
		const query = this.#gl.createQuery();
		if (!query) throw new Error("Failed to allocate a GPU elapsed-time query.");
		this.#gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
		this.#activeQuery = query;
		return query;
	}

	endQuery(): void {
		const extension = this.#extension;
		if (!extension || !this.#activeQuery) {
			throw new Error("No GPU phase query is active to close.");
		}
		this.#gl.endQuery(extension.TIME_ELAPSED_EXT);
		this.#activeQuery = null;
	}

	finishFrame(frame: PendingFrame): void {
		this.#pending.push(frame);
	}

	#resolveFrame(frame: PendingFrame): RendererGpuFrameProfile {
		const milliseconds = (query: WebGLQuery): number =>
			(this.#gl.getQueryParameter(query, this.#gl.QUERY_RESULT) as number) /
			NANOSECONDS_PER_MILLISECOND;
		let terrainMs = 0;
		let opaqueMs = 0;
		let blendedMs = 0;
		let particleMs = 0;
		for (const range of frame.ranges) {
			const durationMs = milliseconds(range.query);
			switch (range.phase) {
				case "terrain":
					terrainMs += durationMs;
					break;
				case "opaque":
					opaqueMs += durationMs;
					break;
				case "blended":
					blendedMs += durationMs;
					break;
				case "particle":
					particleMs += durationMs;
			}
		}
		return {
			blendedMs,
			frameNumber: frame.frameNumber,
			kind: "available",
			opaqueMs,
			particleMs,
			pendingFrameCount: this.#pending.length,
			terrainMs,
			// The sum of what was measured, not wall-clock from first to last command. Elapsed
			// queries cannot nest, so unattributed GPU work between phases is unmeasurable and is
			// deliberately absent rather than reported as a zero.
			totalMs: terrainMs + opaqueMs + blendedMs + particleMs,
		};
	}

	#deletePending(): void {
		for (const frame of this.#pending) this.#deleteFrame(frame);
		this.#pending.length = 0;
	}

	#deleteFrame(frame: PendingFrame): void {
		for (const range of frame.ranges) {
			this.#gl.deleteQuery(range.query);
		}
	}

	#assertAlive(): void {
		if (this.#destroyed) throw new Error("GPU frame profiler is destroyed.");
	}
}

/** One explicitly profiled renderer frame with CPU wall spans and asynchronous GPU timestamps. */
export class WebGL2FrameProfileCapture {
	readonly #owner: WebGL2FrameProfiler;
	readonly #frameNumber: number;
	readonly #gpu: WebGL2GpuFrameCapture | null;
	readonly #startedAt: number;
	readonly #cpu = {
		blendedOrderingMs: 0,
		blendedSubmissionMs: 0,
		particleSubmissionMs: 0,
		contributionMergeMs: 0,
		finalizationMs: 0,
		generatedInstanceCullingMs: 0,
		instanceRunPreparationMs: 0,
		instanceUploadMs: 0,
		objectPreparationMs: 0,
		opaqueSubmissionMs: 0,
		portalGraphPlanningMs: 0,
		sceneQueryMs: 0,
		sceneContributionResolutionMs: 0,
		setupMs: 0,
		terrainSubmissionMs: 0,
		viewPreparationMs: 0,
	};
	readonly #contribution = createEmptyContributionMetrics();
	readonly #portalContributionSetUses = new Map<string, number>();
	readonly #portalNodeUses = new Map<string, number>();
	#finished = false;

	constructor(
		owner: WebGL2FrameProfiler,
		frameNumber: number,
		gpu: WebGL2GpuFrameCapture | null,
		startedAt: number,
	) {
		this.#owner = owner;
		this.#frameNumber = frameNumber;
		this.#gpu = gpu;
		this.#startedAt = startedAt;
	}

	/** Start one CPU phase using the same monotonic clock as the Explorer frame HUD. */
	beginCpuPhase(): number {
		if (this.#finished) {
			throw new Error(
				"Cannot begin a CPU phase after its frame profile finished.",
			);
		}
		return performance.now();
	}

	/** Accumulate a completed CPU phase across every view rendered in this frame. */
	finishCpuPhase(phase: WebGL2CpuFramePhase, startedAt: number): void {
		if (this.#finished) {
			throw new Error(
				"Cannot finish a CPU phase after its frame profile finished.",
			);
		}
		this.#cpu[`${phase}Ms`] += performance.now() - startedAt;
	}

	/** Record one independently prepared scene contribution. */
	recordObjectPreparation(staticCount: number, dynamicCount: number): void {
		this.#contribution.staticObjectPreparationCount += staticCount;
		this.#contribution.dynamicObjectPreparationCount += dynamicCount;
	}

	/** Record one portal node prepared exactly once before graph execution. */
	recordPortalNodePreparation(): void {
		this.#contribution.portalNodePreparationCount += 1;
	}

	/** Record the exact prepared-node set consumed by one executor callback. */
	recordPortalContributionUse(renderNodeIds: readonly string[]): void {
		const setIdentity = renderNodeIds.toSorted().join("\u0000");
		const priorSetUses = this.#portalContributionSetUses.get(setIdentity) ?? 0;
		this.#portalContributionSetUses.set(setIdentity, priorSetUses + 1);
		this.#contribution.portalContributionSetUseCount += 1;
		if (priorSetUses > 0) {
			this.#contribution.repeatedPortalContributionSetUseCount += 1;
		}
		for (const renderNodeId of renderNodeIds) {
			const priorNodeUses = this.#portalNodeUses.get(renderNodeId) ?? 0;
			this.#portalNodeUses.set(renderNodeId, priorNodeUses + 1);
			this.#contribution.portalNodeUseCount += 1;
			if (priorNodeUses > 0) {
				this.#contribution.repeatedPortalNodeUseCount += 1;
			}
		}
	}

	/** Record one multi-node contribution concatenation. */
	recordContributionMerge(): void {
		this.#contribution.multiNodeMergeCount += 1;
	}

	/** Begin one GPU phase interval when timestamp queries are supported and admitted. */
	beginGpuPhase(phase: WebGL2GpuFramePhase): WebGL2GpuFramePhaseCapture | null {
		return this.#gpu?.beginPhase(phase) ?? null;
	}

	/** Close this profile after all renderer finalization work has completed. */
	finish(): void {
		if (this.#finished)
			throw new Error("Frame profile finished more than once.");
		this.#finished = true;
		this.#gpu?.finish();
		const totalMs = performance.now() - this.#startedAt;
		const namedMs =
			this.#cpu.setupMs +
			this.#cpu.viewPreparationMs +
			this.#cpu.sceneQueryMs +
			this.#cpu.sceneContributionResolutionMs +
			this.#cpu.objectPreparationMs +
			this.#cpu.contributionMergeMs +
			this.#cpu.blendedOrderingMs +
			this.#cpu.instanceRunPreparationMs +
			this.#cpu.instanceUploadMs +
			this.#cpu.portalGraphPlanningMs +
			this.#cpu.terrainSubmissionMs +
			this.#cpu.opaqueSubmissionMs +
			this.#cpu.blendedSubmissionMs +
			this.#cpu.finalizationMs +
			this.#cpu.generatedInstanceCullingMs;
		this.#owner.finishFrame({
			...this.#cpu,
			contribution: {
				...this.#contribution,
				portalContributionSetCount: this.#portalContributionSetUses.size,
			},
			frameNumber: this.#frameNumber,
			otherMs: Math.max(0, totalMs - namedMs),
			totalMs,
		});
	}
}

/** Opt-in renderer profiler; construction is the only point that probes timer-query support. */
export class WebGL2FrameProfiler {
	readonly #gpu: WebGL2GpuFrameProfiler;
	#frameNumber = 0;
	readonly #cpuFrames: RendererCpuFrameProfile[] = [];

	constructor(gl: WebGL2RenderingContext) {
		this.#gpu = new WebGL2GpuFrameProfiler(gl);
	}

	/** Begin the next monotonically identified CPU/GPU frame capture. */
	beginFrame(): WebGL2FrameProfileCapture {
		const startedAt = performance.now();
		this.#frameNumber += 1;
		return new WebGL2FrameProfileCapture(
			this,
			this.#frameNumber,
			this.#gpu.beginFrame(this.#frameNumber),
			startedAt,
		);
	}

	/** Return the latest completed CPU profile paired with the latest delayed GPU outcome. */
	getProfile(): RendererFrameProfile | null {
		if (this.#cpuFrames.length === 0) return null;
		return {
			cpu: summarizeCpuFrames(this.#cpuFrames),
			gpu: this.#gpu.getProfile(),
		};
	}

	/** Tear down every pending GPU query immediately. */
	destroy(): void {
		this.#gpu.destroy();
		this.#cpuFrames.length = 0;
	}

	finishFrame(cpu: RendererCpuFrameProfile): void {
		this.#cpuFrames.push(cpu);
		if (
			this.#cpuFrames.length >
			FRONTEND_TUNING.diagnostics.maximumRetainedCpuFrames
		) {
			this.#cpuFrames.shift();
		}
	}
}

/** Build a cold rolling summary without adding aggregation work to the frame path. */
function summarizeCpuFrames(
	frames: readonly RendererCpuFrameProfile[],
): RendererCpuFrameProfileWindow {
	const latest = frames.at(-1);
	if (!latest) throw new Error("Cannot summarize an empty CPU profile window.");
	const totals: Record<keyof RendererCpuFrameTimings, number> = {
		blendedOrderingMs: 0,
		blendedSubmissionMs: 0,
		particleSubmissionMs: 0,
		contributionMergeMs: 0,
		finalizationMs: 0,
		generatedInstanceCullingMs: 0,
		instanceRunPreparationMs: 0,
		instanceUploadMs: 0,
		objectPreparationMs: 0,
		opaqueSubmissionMs: 0,
		otherMs: 0,
		portalGraphPlanningMs: 0,
		sceneQueryMs: 0,
		sceneContributionResolutionMs: 0,
		setupMs: 0,
		terrainSubmissionMs: 0,
		totalMs: 0,
		viewPreparationMs: 0,
	};
	const contributionTotals = createEmptyContributionMetrics();
	for (const frame of frames) {
		for (const key of CPU_TIMING_KEYS) totals[key] += frame[key];
		for (const key of CONTRIBUTION_METRIC_KEYS) {
			contributionTotals[key] += frame.contribution[key];
		}
	}
	const sampleCount = frames.length;
	const mean: RendererCpuFrameTimings = {
		blendedOrderingMs: totals.blendedOrderingMs / sampleCount,
		blendedSubmissionMs: totals.blendedSubmissionMs / sampleCount,
		contributionMergeMs: totals.contributionMergeMs / sampleCount,
		finalizationMs: totals.finalizationMs / sampleCount,
		generatedInstanceCullingMs: totals.generatedInstanceCullingMs / sampleCount,
		instanceRunPreparationMs: totals.instanceRunPreparationMs / sampleCount,
		instanceUploadMs: totals.instanceUploadMs / sampleCount,
		objectPreparationMs: totals.objectPreparationMs / sampleCount,
		opaqueSubmissionMs: totals.opaqueSubmissionMs / sampleCount,
		otherMs: totals.otherMs / sampleCount,
		particleSubmissionMs: totals.particleSubmissionMs / sampleCount,
		portalGraphPlanningMs: totals.portalGraphPlanningMs / sampleCount,
		sceneQueryMs: totals.sceneQueryMs / sampleCount,
		sceneContributionResolutionMs:
			totals.sceneContributionResolutionMs / sampleCount,
		setupMs: totals.setupMs / sampleCount,
		terrainSubmissionMs: totals.terrainSubmissionMs / sampleCount,
		totalMs: totals.totalMs / sampleCount,
		viewPreparationMs: totals.viewPreparationMs / sampleCount,
	};
	const orderedTotals = frames
		.map((frame) => frame.totalMs)
		.toSorted((left, right) => left - right);
	const p95TotalMs = orderedTotals.at(Math.ceil(sampleCount * 0.95) - 1);
	if (p95TotalMs === undefined) {
		throw new Error("CPU profile percentile selection lost its sample.");
	}
	return {
		contribution: {
			latest: latest.contribution,
			mean: averageContributionMetrics(contributionTotals, sampleCount),
		},
		latestFrameNumber: latest.frameNumber,
		latestTotalMs: latest.totalMs,
		mean,
		p95TotalMs,
		sampleCount,
	};
}

function averageContributionMetrics(
	totals: RendererContributionFrameMetrics,
	sampleCount: number,
): RendererContributionFrameMetrics {
	return {
		multiNodeMergeCount: totals.multiNodeMergeCount / sampleCount,
		dynamicObjectPreparationCount:
			totals.dynamicObjectPreparationCount / sampleCount,
		staticObjectPreparationCount:
			totals.staticObjectPreparationCount / sampleCount,
		portalContributionSetCount: totals.portalContributionSetCount / sampleCount,
		portalContributionSetUseCount:
			totals.portalContributionSetUseCount / sampleCount,
		portalNodePreparationCount: totals.portalNodePreparationCount / sampleCount,
		repeatedPortalNodeUseCount: totals.repeatedPortalNodeUseCount / sampleCount,
		repeatedPortalContributionSetUseCount:
			totals.repeatedPortalContributionSetUseCount / sampleCount,
		portalNodeUseCount: totals.portalNodeUseCount / sampleCount,
	};
}
