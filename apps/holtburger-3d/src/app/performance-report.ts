import type { NativePerformanceState } from "./native-performance";
import type { FrameRates } from "./frame-rate-sampler";
import type {
	FrameSettings,
	RendererFrameProfile,
} from "../lib/game/renderer/renderer";
import type { PresentationProfile } from "../lib/game/runtime/presentation-profiler";
import type { WebGL2DeviceDiagnosticIdentity } from "../lib/game/renderer/webgl2-diagnostic-identity";
import type { ClosedWorkerPoolDiagnostics } from "../lib/game/workers/closed-worker";

/** Report shared by both frontends and their automated probes. No game/account payloads. */
export interface PerformanceReport {
	readonly schemaVersion: 3;
	readonly mode: "client" | "explorer";
	readonly capture: {
		readonly generation: number;
		readonly state: "recording" | "stopped";
		readonly startedAt: string;
		readonly elapsedMs: number;
		/** Retirement can prevent a final read from an asynchronous boundary. */
		readonly retired: boolean;
	};
	readonly context: {
		readonly userAgent: string;
		readonly device: WebGL2DeviceDiagnosticIdentity;
		readonly graphics: FrameSettings;
		readonly viewport: {
			readonly cssWidth: number;
			readonly cssHeight: number;
			readonly drawingBufferWidth: number;
			readonly drawingBufferHeight: number;
		};
	};
	readonly browser: {
		/** Mode-root smoothed cadence; independent of the capture-wide work mean. */
		readonly frameRates: FrameRates | null;
		readonly meanFrameWorkMs: number | null;
		readonly sampleCount: number;
		/** Render-frame detail nests the renderer; update work has independent sample coverage. */
		readonly presentation: PresentationProfile | null;
	};
	/** Native timing is cached at cold read cadence, independently of browser frames. */
	readonly native: NativePerformanceState;
	readonly renderer: RendererFrameProfile | null;
	/** Broad workload counts, independent of the timed device span. */
	readonly workload: {
		readonly sceneEntries: number;
		readonly staticDraws: number;
		readonly dynamicDraws: number;
	} | null;
	readonly terrainWorker: {
		/** Current depth, not an accumulated amount of work. */
		readonly activeJobs: number;
		readonly queuedJobs: number;
		/** Lifetime-counter deltas. Work can cross the capture boundary. */
		readonly completedJobs: number;
		readonly queueDelayMs: number;
		readonly jobTurnaroundMs: number;
		readonly transferredRequestBytes: number;
		readonly activeJobsAtStart: number;
		readonly queuedJobsAtStart: number;
	};
}

/** Preserve the pool's measured semantics; it times dispatch-to-result, not worker CPU. */
export function terrainCaptureDelta(
	start: ClosedWorkerPoolDiagnostics,
	end: ClosedWorkerPoolDiagnostics,
): PerformanceReport["terrainWorker"] {
	return {
		activeJobs: end.activeJobCount,
		queuedJobs: end.queuedJobCount,
		completedJobs: end.completedJobCount - start.completedJobCount,
		queueDelayMs: end.totalQueueDelayMs - start.totalQueueDelayMs,
		jobTurnaroundMs: end.totalJobTurnaroundMs - start.totalJobTurnaroundMs,
		transferredRequestBytes: end.transferredBytes - start.transferredBytes,
		activeJobsAtStart: start.activeJobCount,
		queuedJobsAtStart: start.queuedJobCount,
	};
}

/** Stable serialization shared by clipboard, downloads and automation. */
export function serializePerformanceReport(report: PerformanceReport): string {
	return `${JSON.stringify(report, null, 2)}\n`;
}
