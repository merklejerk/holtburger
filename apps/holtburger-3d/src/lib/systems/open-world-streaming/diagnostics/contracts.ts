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
		/** Texture entries with no current owner claims. */
		readonly ownerlessEntries: number;
		/** Reclaimable ownerless pages grouped by retained renderer/build state. */
		readonly ownerlessPages: {
			readonly building: number;
			readonly planned: number;
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
	/** Replacement-native material and texture readiness issues. */
	readonly materialReadiness: OpenWorldStreamingMaterialReadinessDiagnostics;
	readonly texturePageBuildTasks: OpenWorldStreamingTexturePageBuildTaskDiagnostics;
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
	readonly sourceResolution: {
		/** Worker/source requests submitted without broad-result projection. */
		readonly directRequests: number;
		/** Broad source streams submitted for worker-side projected runner results. */
		readonly sourceStreamRequests: number;
		/** Runner requests satisfied from an already submitted source request. */
		readonly reusedRequests: number;
		/** Runner-specific results projected from broader source resolutions. */
		readonly projectedResults: number;
		/** Static recipes delivered through projected runner results. */
		readonly projectedRecipeCount: number;
		/** Dynamic placements delivered through projected runner results. */
		readonly projectedDynamicPlacementCount: number;
		/** Dynamic recipes delivered through projected runner results. */
		readonly projectedDynamicRecipeCount: number;
		/** Sum of worker-side projection time for projected runner results. */
		readonly projectedMs: number;
		/** Maximum worker-side projection time for a projected runner result. */
		readonly maxProjectedMs: number;
		/** Sum of browser delivery/deserialization time for projected runner results when measured. */
		readonly projectedDeliveryMs: number;
		/** Maximum browser delivery/deserialization time for a projected runner result when measured. */
		readonly maxProjectedDeliveryMs: number;
		/** Sum of main-thread source result assimilation and waiter release time. */
		readonly projectedAssimilationMs: number;
		/** Maximum main-thread source result assimilation and waiter release time. */
		readonly maxProjectedAssimilationMs: number;
		/** Waiters released by projected source result delivery. */
		readonly projectedWaiterReleaseCount: number;
		/** Maximum waiter count released by a single projected source result. */
		readonly maxProjectedWaitersReleased: number;
	};
	readonly staticTasks: OpenWorldStreamingStaticTaskDiagnostics;
	readonly frameBudget: {
		readonly yieldedPasses: number;
	};
	readonly compatibilityShims: readonly OpenWorldStreamingShimDiagnostics[];
}

/** Replacement-native material and texture readiness diagnostics. */
export interface OpenWorldStreamingMaterialReadinessDiagnostics {
	readonly recentIssues: readonly OpenWorldStreamingMaterialReadinessIssue[];
	readonly summary: {
		readonly deferredRendererCapabilityIssueCount: number;
		readonly failedTextureDependencyCount: number;
		readonly pendingTextureDependencyCount: number;
		readonly pipelineBugIssueCount: number;
		readonly skippedGeometryIssueCount: number;
		readonly terrainMaterialIssueCount: number;
		readonly unsupportedSourceMaterialIssueCount: number;
	};
}

type OpenWorldStreamingMaterialReadinessIssue =
	| {
			readonly kind: "pending-texture-dependency";
			readonly bucketKey: string;
			readonly elapsedMs: number;
			readonly ownerId: string;
			readonly pageId: string;
			readonly sourceTaskId: string;
	  }
	| {
			readonly kind: "failed-texture-dependency";
			readonly bucketKey: string;
			readonly durationMs: number;
			readonly error: string;
			readonly ownerId: string;
			readonly pageId: string;
			readonly sourceTaskId: string;
	  }
	| {
			readonly kind:
				| "renderer-capability-deferred"
				| "unsupported-source-material";
			readonly domain: string;
			readonly materialFamily: string;
			readonly landblockId: number | null;
			readonly materialCount: number;
			readonly ownerId: string;
			readonly partitionCount: number;
			readonly renderPass: string;
			readonly reasonCodes: readonly string[];
			readonly sourceEvidence: {
				readonly kind: "static-material-coverage";
				readonly reportKey: string;
				readonly reportKind: string;
			};
			readonly taskId: string;
			readonly triangleCount: number;
	  }
	| {
			readonly kind: "skipped-geometry";
			readonly alphaMode: string;
			readonly materialFamily: string;
			readonly landblockId: number;
			readonly materialCount: number;
			readonly ownerId: string;
			readonly renderPass: string;
			readonly reason: string;
			readonly renderCoverage: string;
			readonly sliceId: string;
			readonly taskId: string;
			readonly triangleCount: number;
	  }
	| {
			readonly kind: "terrain-material-issue";
			readonly code: string;
			readonly drawUnitId: string;
			readonly landblockId: number;
			readonly materialFamily: string;
			readonly message: string;
			readonly ownerId: string;
			readonly pcode: number | null;
			readonly taskId: string;
			readonly textureId: number | null;
	  }
	| {
			readonly kind: "pipeline-bug";
			readonly message: string;
			readonly ownerId: string;
			readonly taskId: string;
	  };

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

/** Replacement-owned page-build task diagnostics after scene/texture stream decoupling. */
export interface OpenWorldStreamingTexturePageBuildTaskDiagnostics {
	readonly active: readonly {
		readonly bucketKey: string;
		readonly elapsedMs: number;
		readonly jobId: string;
		readonly ownerId: string;
		readonly pageId: string;
		readonly sourceTaskId: string;
	}[];
	readonly recent: readonly {
		readonly bucketKey: string;
		readonly durationMs: number;
		readonly error: string | null;
		readonly jobId: string;
		readonly ownerId: string;
		readonly pageId: string;
		readonly sourceTaskId: string;
		readonly stageTimings: readonly OpenWorldStreamingStaticTaskStageTiming[];
		readonly status: "accepted" | "committed" | "failed" | "stale-rejected";
	}[];
	readonly summary: {
		readonly accepted: number;
		readonly active: number;
		readonly committed: number;
		readonly failed: number;
		readonly queued: number;
		readonly staleRejected: number;
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
	readonly itemCount?: number;
	readonly stage:
		| "resolve-source"
		| "create-texture-intents"
		| "texture-intent-structured-interior"
		| "texture-intent-static-object"
		| "texture-intent-static-object-partition"
		| "texture-intent-static-object-requirements"
		| "texture-intent-static-object-entry"
		| "texture-intent-chunk"
		| "texture-intent-aggregation"
		| "texture-placement-reservation"
		| "texture-placement-reservation-page"
		| "texture-source-fact-preparation"
		| "texture-source-fact-preparation-chunk"
		| "texture-source-fact-preparation-yield"
		| "texture-source-preparation"
		| "texture-source-preparation-chunk"
		| "texture-source-preparation-yield"
		| "texture-layout"
		| "texture-page-build"
		| "texture-page-materialization"
		| "texture-page-source-preparation"
		| "create-bake-resources"
		| "bake"
		| "bake-worker-wait"
		| "bake-result-transfer"
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
