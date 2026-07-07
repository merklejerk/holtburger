import type {
	StaticBakeJobInput,
	StaticBakeJobResult,
	StaticBaker,
} from "../../../static/contracts";
import type { OpenWorldStreamingStaticTaskStageTiming } from "../diagnostics/contracts";

interface StaticBakeWorkerBoundaryDiagnostics {
	/** Main-thread delay from worker result-ready progress to resolved result delivery. */
	readonly deliveryMs: number | null;
	/** Draw units in the result, used as a compact result-size proxy. */
	readonly drawUnitCount: number;
	/** Transferable bytes returned with the worker result. */
	readonly transferByteLength: number;
	/** Transferable object count returned with the worker result. */
	readonly transferCount: number;
	/** Worker execution wait from started progress to result-ready progress. */
	readonly waitMs: number | null;
}

interface DiagnosticStaticBaker extends StaticBaker {
	/** Optional richer worker-boundary bake path exposed by worker-backed bakers. */
	bakeWithDiagnostics(input: StaticBakeJobInput): Promise<{
		readonly diagnostics: StaticBakeWorkerBoundaryDiagnostics | null;
		readonly result: StaticBakeJobResult;
	}>;
}

export interface OpenWorldStaticBakeBoundaryResult {
	/** Static bake result used by the replacement runner's normal commit path. */
	readonly result: StaticBakeJobResult;
	/** Replacement-native substages proving where the worker boundary spent time. */
	readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
}

export async function bakeStaticJobWithBoundaryDiagnostics(
	baker: StaticBaker,
	input: StaticBakeJobInput,
): Promise<OpenWorldStaticBakeBoundaryResult> {
	if (!hasDiagnosticBakeBoundary(baker)) {
		return {
			result: await baker.bake(input),
			stageTimings: [],
		};
	}

	const baked = await baker.bakeWithDiagnostics(input);
	if (!baked.diagnostics) {
		return {
			result: baked.result,
			stageTimings: [],
		};
	}

	return {
		result: baked.result,
		stageTimings: createBoundaryStageTimings(baked.diagnostics),
	};
}

function hasDiagnosticBakeBoundary(
	baker: StaticBaker,
): baker is DiagnosticStaticBaker {
	return (
		"bakeWithDiagnostics" in baker &&
		typeof baker.bakeWithDiagnostics === "function"
	);
}

function createBoundaryStageTimings(
	diagnostics: StaticBakeWorkerBoundaryDiagnostics,
): readonly OpenWorldStreamingStaticTaskStageTiming[] {
	const timings: OpenWorldStreamingStaticTaskStageTiming[] = [];
	if (diagnostics.waitMs !== null) {
		timings.push({
			durationMs: diagnostics.waitMs,
			itemCount: diagnostics.drawUnitCount,
			stage: "bake-worker-wait",
		});
	}
	if (diagnostics.deliveryMs !== null) {
		timings.push({
			durationMs: diagnostics.deliveryMs,
			itemCount: diagnostics.transferCount,
			stage: "bake-result-transfer",
		});
	}
	return timings;
}
