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
		/** Shared logical texture entries tracked by the replacement claim registry. */
		readonly entryCount: number;
		/** Virtual atlas pages grouped by replacement lifecycle state. */
		readonly pages: {
			readonly building: number;
			readonly planned: number;
			readonly reclaimable: number;
			readonly resident: number;
			readonly total: number;
		};
		readonly pageBuildsInFlight: number;
		/** Replacement-owned byte accounting is not exact until renderer page sizing is canonical. */
		readonly byteEstimate: {
			readonly approximateBytes: number | null;
			readonly reason: "page-size-not-yet-canonical";
		};
	};
	readonly runtimeEntities: {
		readonly active: number;
		readonly nonRenderable: number;
		readonly runtimeAuthored: number;
		readonly staticAuthored: number;
		readonly animation: {
			readonly catchUpTruncationCount: number;
			readonly droppedHookFrameCount: number;
			readonly recentCatchUpTruncations: readonly OpenWorldRuntimeEntityAnimationCatchUpDiagnostics[];
		};
		readonly commits: {
			readonly dynamicInstanceCommitCount: number;
			readonly dynamicResourceCommitCount: number;
			readonly maxInstancesPerCommit: number;
			readonly maxResourcesPerCommit: number;
		};
		readonly prep: {
			readonly bakeFailureCount: number;
			readonly bakeSuccessCount: number;
			readonly failed: number;
			readonly recipeResolvedCount: number;
			readonly skippedVisualCount: number;
			readonly started: number;
			readonly recentFailures: readonly OpenWorldRuntimeEntityPrepFailureDiagnostics[];
		};
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

/** Aggregated replacement diagnostics for capped dynamic animation hook replay. */
interface OpenWorldRuntimeEntityAnimationCatchUpDiagnostics {
	readonly animationAssetId: string;
	readonly dispatchedFrameCount: number;
	readonly droppedFrameCount: number;
	readonly entityId: string;
	readonly frameCount: number;
}

/** Recent replacement-owned dynamic prep failures. */
interface OpenWorldRuntimeEntityPrepFailureDiagnostics {
	readonly entityId: string;
	readonly message: string;
	readonly ownerId: string;
	readonly phase: "bake" | "prep";
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
