/** Replacement-native diagnostics for owner-indexed open-world streaming. */
export interface OpenWorldStreamingDiagnosticsSnapshot {
	readonly kind: "open-world-streaming-diagnostics";
	readonly pipeline: {
		readonly staticPublicationMode:
			| "normal"
			| "suppress-dense-renderer"
			| "defer-dense-renderer-until-ready";
		readonly status: "idle" | "active" | "disposed";
		readonly selectedRuntimePipeline: "open-world-streaming";
	};
	readonly owners: {
		readonly current: number;
		readonly evicted: number;
	};
	readonly artifacts: {
		readonly inFlight: number;
		readonly ready: number;
		readonly staleRejected: number;
	};
	readonly textureResidency: {
		readonly bucketCount: number;
		readonly claimCount: number;
		readonly pageBuildsInFlight: number;
	};
	readonly sceneCommits: {
		readonly pending: number;
		readonly applied: number;
	};
	readonly staticTasks: OpenWorldStreamingStaticTaskDiagnostics;
	readonly frameBudget: {
		readonly yieldedPasses: number;
	};
	readonly compatibilityShims: readonly OpenWorldStreamingShimDiagnostics[];
}

/** Replacement-owned task timing for the static materialization scheduler. */
export interface OpenWorldStreamingStaticTaskDiagnostics {
	readonly active: readonly OpenWorldStreamingActiveStaticTaskDiagnostics[];
	readonly recent: readonly OpenWorldStreamingStaticTaskTimingDiagnostics[];
	readonly summary: {
		readonly requested: number;
		readonly active: number;
		readonly completed: number;
		readonly failed: number;
		readonly totalDurationMs: number;
		readonly maxDurationMs: number;
		readonly totalApplyMs: number;
		readonly maxApplyMs: number;
	};
}

interface OpenWorldStreamingActiveStaticTaskDiagnostics {
	readonly domain: string;
	readonly ownerId: string;
	readonly taskId: string;
	readonly elapsedMs: number;
	readonly phase: "materializing" | "applying";
}

interface OpenWorldStreamingStaticTaskTimingDiagnostics {
	readonly domain: string;
	readonly ownerId: string;
	readonly taskId: string;
	readonly status: "committed" | "failed" | "stale-rejected";
	readonly durationMs: number;
	readonly applyMs: number;
	readonly drawUnits: number;
	readonly error: string | null;
	readonly stages: readonly OpenWorldStreamingStaticTaskStageTiming[];
}

/** Deletion-targeted compatibility projection outside replacement internals. */
interface OpenWorldStreamingShimDiagnostics {
	readonly deletionTarget: string;
	readonly kind: "compatibility-shim";
	readonly owner: "browser-runtime-adapter" | "browser-harness" | "ui";
	readonly reason: string;
}

/** Materialization substage timing owned by replacement diagnostics. */
export interface OpenWorldStreamingStaticTaskStageTiming {
	readonly durationMs: number;
	readonly stage:
		| "resolve-source"
		| "create-texture-intents"
		| "texture-placement"
		| "texture-source-preparation"
		| "texture-packing"
		| "texture-page-settlement"
		| "create-bake-resources"
		| "bake"
		| "assemble-commit";
}

/** Replacement-native atlas/page inspection contract. */
export interface OpenWorldStreamingAtlasInspectionSnapshot {
	readonly kind: "open-world-streaming-atlas-page";
	readonly bucketKey: string;
	readonly pageId: string;
	readonly state:
		| "resident"
		| "planned"
		| "building"
		| "reclaimable"
		| "missing";
	readonly claims: readonly {
		readonly ownerId: string;
		readonly textureBindingId: string;
	}[];
}
