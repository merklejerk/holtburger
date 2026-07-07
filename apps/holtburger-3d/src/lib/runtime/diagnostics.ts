import type {
	PortalFrameWorkPlan,
	RenderPassPlan,
	RendererSnapshot,
} from "../renderer/types";
import type { AssetServiceSnapshot } from "../assets/contracts";
import type {
	StaticActiveBakeStage,
	StaticBakerDiagnosticsSnapshot,
	StaticDomain,
	StaticMaterialUnrenderedBucket,
	StaticSourceResolutionDiagnostics,
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialFallbackReason,
	VisualTextureDomain,
} from "../static/contracts";
import type {
	TextureFilteringMode,
	TexturePageSampleClass,
	TextureWrapMode,
} from "../textures/sampling-policy";
import type { DynamicRuntimeSnapshot } from "../dynamic/contracts";

export interface RuntimeDiagnostics {
	warn(event: RuntimeWarningEvent): void;
}

export interface RuntimeDiagnosticsReport {
	readonly kind: "runtime-diagnostics-report";
	readonly runtime: RuntimeDiagnosticsRuntimeSummary;
	readonly domains: readonly RuntimeDiagnosticsDomainReport[];
}

interface RuntimeDiagnosticsRuntimeSummary {
	readonly status: "idle" | "static-active" | "disposed";
	readonly textureFilteringMode: TextureFilteringMode;
	readonly sceneInterest: string | null;
	readonly renderPassKind: RenderPassPlan["kind"];
	readonly portalFrameWorkPlan: PortalFrameWorkPlanDiagnostics;
	readonly pendingStaticCommitInstallCount: number;
	readonly committedStaticCommitInstallCount: number;
	readonly envCellResourceMembershipRevision: number;
	readonly sourceStaticDrawUnits: number;
	readonly installedStaticDrawUnits: number;
}

type PortalFrameWorkPlanDiagnostics =
	| {
			readonly kind: "legacy-render-pass";
			readonly mode: Extract<
				PortalFrameWorkPlan,
				{ readonly kind: "legacy-render-pass" }
			>["mode"];
			readonly renderPassKind: RenderPassPlan["kind"];
	  }
	| {
			readonly kind: "direct-env-cell";
			readonly mode: "portal-projection";
			readonly baseScene: string;
			readonly renderEntryCount: number;
			readonly renderLayerCount: number;
			readonly maskEdgeCount: number;
			readonly apertureResourceCount: number;
			readonly transitionRootCount: number;
			readonly envCellPortalEdgeCount: number;
			readonly selectedMaskEdgeCount: number;
	  };

type RuntimeDiagnosticsDomainReport =
	| AssetServiceDiagnosticsReport
	| DynamicDiagnosticsReport
	| OpenWorldStreamingDiagnosticsReport
	| RendererDiagnosticsReport
	| StaticCommitInstallDiagnosticsReport
	| StaticCoordinatorDiagnosticsReport
	| TerrainTextureDiagnosticsReport
	| TextureAtlasDiagnosticsReport;

export interface AssetServiceDiagnosticsReport {
	readonly kind: "asset-service";
	readonly summary: AssetServiceDiagnosticsSummary;
	readonly pending?: readonly AssetServicePendingDiagnostics[];
}

interface AssetServiceDiagnosticsSummary {
	readonly pending: number;
	readonly pendingWaiters: number;
	readonly committed: number;
	readonly leased: number;
	readonly warmRetained: number;
}

interface AssetServicePendingDiagnostics {
	readonly key: string;
	readonly kind: string;
	readonly revision: number;
	readonly waiterCount: number;
}

export interface DynamicDiagnosticsReport {
	readonly kind: "dynamic";
	readonly summary: DynamicDiagnosticsSummary;
}

interface DynamicDiagnosticsSummary {
	readonly active: number;
	readonly indexed: number;
	readonly nonRenderable: number;
	readonly renderable: number;
	readonly resourceFailed: number;
	readonly resourcePending: number;
	readonly staticAuthoredSeeds: number;
}

interface RendererDiagnosticsReport {
	readonly kind: "renderer";
	readonly summary: RendererDiagnosticsSummary;
}

export interface OpenWorldStreamingDiagnosticsReport {
	readonly kind: "open-world-streaming";
	readonly summary: unknown;
}

export interface RendererDiagnosticsSummary {
	readonly backend: RendererSnapshot["backend"];
	readonly canvasWidth: number;
	readonly canvasHeight: number;
	readonly frameCount: number;
	readonly frameHandlerMs: number;
	readonly isRunning: boolean;
	readonly error: string | null;
	readonly renderPassKind: RenderPassPlan["kind"];
	readonly staticDrawUnits: number;
	readonly terrainDrawUnits: number;
	readonly directEnvCellDrawCalls: number;
	readonly dynamicVisualResources: number;
	readonly dynamicVisualResourceTextureUses: number;
	readonly dynamicInstances: number;
	readonly skippedDynamicSubmissions: number;
	readonly renderedTriangles: number;
	readonly debugOverlayPrimitives: number;
	readonly staticObjectResources: number;
	readonly staticObjectBakedDirectDrawCalls: number;
	readonly staticObjectVisualResources: number;
	readonly staticObjectRenderInstances: number;
	readonly staticObjectDirectRenderInstanceDrawCalls: number;
	readonly staticObjectInstancedRenderInstanceDrawCalls: number;
	readonly staticObjectInstancedRenderInstances: number;
	readonly staticObjectNearTransparentDirectRenderInstanceDrawCalls: number;
	readonly staticObjectFarTransparentDirectRenderInstanceDrawCalls: number;
	readonly staticObjectFarTransparentInstancedRenderInstanceDrawCalls: number;
	readonly staticObjectFarTransparentInstancedRenderInstances: number;
	readonly outdoorGeneratedSceneryStaticObjectResources: number;
	readonly outdoorGeneratedSceneryStaticObjectBakedDirectDrawCalls: number;
	readonly outdoorGeneratedSceneryStaticObjectBakedDirectDrawCallsByPass: RendererSnapshot["outdoorGeneratedSceneryStaticObjectBakedDirectDrawCallsByPass"];
	readonly outdoorGeneratedSceneryStaticObjectVisualResources: number;
	readonly outdoorGeneratedSceneryStaticObjectRenderInstances: number;
	readonly staticObjectUploadedBufferBytes: number;
	readonly outdoorGeneratedSceneryStaticObjectUploadedBufferBytes: number;
	readonly staticObjectUploadSummary: StaticObjectUploadSummaryDiagnostics;
}

interface StaticObjectUploadSummaryDiagnostics {
	readonly recentUploadCount: number;
	readonly totalDrawUnits: number;
	readonly totalUploadedBufferBytes: number;
	readonly totalUploadMs: number;
	readonly largestUpload: StaticObjectUploadSampleDiagnostics | null;
}

interface StaticObjectUploadSampleDiagnostics {
	readonly domain: StaticDomain;
	readonly landblockId: string;
	readonly drawUnitCount: number;
	readonly uploadedBufferBytes: number;
	readonly uploadMs: number;
}

export interface StaticCommitInstallDiagnosticsReport {
	readonly kind: "static-commit-install";
	readonly summary: StaticCommitInstallDiagnosticsSummary;
	readonly committedCommits: readonly StaticCommitInstallCommitDiagnostics[];
	readonly failedCommits: readonly StaticCommitInstallCommitDiagnostics[];
	readonly pendingCommits: readonly StaticCommitInstallCommitDiagnostics[];
}

interface StaticCommitInstallDiagnosticsSummary {
	readonly committed: number;
	readonly failed: number;
	readonly pending: number;
	readonly slowestCommit: StaticCommitInstallCommitDiagnostics | null;
}

export interface StaticCommitInstallCommitDiagnostics {
	/** Static coordinator commit id installed by the browser runtime. */
	readonly commitId: string;
	/** Current install lifecycle phase for this commit. */
	readonly phase: "queued" | "materializing" | "materialized" | "failed";
	/** Static scene interest revision that produced this commit. */
	readonly revision: number;
	/** Page-thread install timing breakdown for diagnosing browser stutter. */
	readonly timing: StaticCommitInstallTimingDiagnostics;
}

export interface StaticCommitInstallTimingDiagnostics {
	readonly applyDynamicPlacementsMs: number;
	readonly applyEnvCellPublicationsMs: number;
	readonly applyStaticLayersMs: number;
	readonly applyTexturePlacementUpdateMs: number;
	readonly dynamicRendererSyncMs: number;
	readonly dynamicVisualPrepMs: number;
	readonly installStaticCommitMs: number;
	readonly materializeMs: number;
	readonly pinTextureLeasesMs: number;
	readonly queryRecordsMs: number;
	readonly refreshDebugOverlayMs: number;
	readonly refreshEnvCellMembershipMs: number;
	readonly releaseTextureLeasesMs: number;
	readonly renderPassPlanMs: number;
	readonly textureApplyMs: number;
	readonly queuedMs: number;
}

export interface StaticCoordinatorDiagnosticsReport {
	readonly kind: "static-coordinator";
	readonly summary: StaticCoordinatorDiagnosticsSummary;
	readonly materialCoverageSummary: StaticMaterialCoverageSummaryDiagnostics;
	readonly staticObjectBakeSummary: StaticObjectBakeSummaryDiagnostics;
	readonly timingSummary: StaticCoordinatorTimingSummaryDiagnostics;
	readonly inFlightTasks?: readonly StaticCoordinatorTaskDiagnostics[];
	readonly recentFailures?: readonly StaticCoordinatorTaskDiagnostics[];
	readonly sourceResolutions?: readonly StaticSourceResolutionDiagnostics[];
	readonly staticBaker?: StaticBakerDiagnosticsSnapshot;
}

interface StaticCoordinatorDiagnosticsSummary {
	readonly revision: number;
	readonly requested: number;
	readonly resolving: number;
	readonly baking: number;
	readonly committed: number;
	readonly failed: number;
	readonly committedDrawUnits: number;
}

interface StaticCoordinatorTaskDiagnostics {
	readonly taskId: string;
	readonly ownerId: string;
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly phase: "requested" | "resolving" | "baking" | "failed";
	readonly phaseAgeMs: number;
	readonly phaseStartedAtMs: number;
	readonly activeBakeStage: StaticActiveBakeStage | null;
	readonly activeBakeStageAgeMs: number | null;
	readonly activeBakeStageStartedAtMs: number | null;
}

export type StaticCoordinatorTaskReportDiagnostics =
	StaticCoordinatorTaskDiagnostics;

interface StaticMaterialCoverageSummaryDiagnostics {
	readonly reportCount: number;
	readonly materialCount: number;
	readonly partitionCount: number;
	readonly triangleCount: number;
	readonly renderedTriangles: number;
	readonly deferredTriangles: number;
	readonly unsupportedTriangles: number;
	readonly fallbackReasonCounts: Record<string, number>;
	readonly unrenderedBucketCount: number;
}

interface StaticObjectBakeSummaryDiagnostics {
	readonly reportCount: number;
	readonly objectCount: number;
	readonly generatedInstanceCount: number;
	readonly explicitObjectCount: number;
	readonly uniqueSourceCount: number;
	readonly uniqueSourcePartGeometryCount: number;
	readonly uniqueSourceTriangleCount: number;
	readonly drawUnitCount: number;
	readonly partitionCount: number;
	readonly bakedInstancedVisualResourceCount: number;
	readonly bakedInstancedRenderInstanceCount: number;
	readonly instancedSourceTriangleCount: number;
	readonly estimatedInstancedSourceTypedArrayBytes: number;
	readonly estimatedAvoidedFlattenedTriangleCount: number;
	readonly estimatedAvoidedFlattenedTypedArrayBytes: number;
	readonly retainedTransparentOutdoorGeneratedSceneryPartitionReasons: StaticObjectRetainedTransparentPartitionReasonSummaryDiagnostics;
	readonly largestBake: StaticObjectBakeSampleDiagnostics | null;
}

interface StaticObjectRetainedTransparentPartitionReasonSummaryDiagnostics {
	readonly explicitObject: number;
	readonly oneOffGeneratedSource: number;
	readonly repeatedGeneratedSourceRetainedByPartitionPolicy: number;
	readonly missingInstanceBounds: number;
	readonly unsupportedMaterialBucket: number;
	readonly nonRenderableOrDeferredMaterialBucket: number;
}

interface StaticObjectBakeSampleDiagnostics {
	readonly domain: StaticDomain;
	readonly landblockId: string;
	readonly objectCount: number;
	readonly generatedInstanceCount: number;
	readonly drawUnitCount: number;
	readonly bakedInstancedRenderInstanceCount: number;
	readonly bakedInstancedVisualResourceCount: number;
	readonly estimatedAvoidedFlattenedTypedArrayBytes: number;
	readonly uniqueSourceCount: number;
}

interface StaticCoordinatorTimingSummaryDiagnostics {
	readonly reportCount: number;
	readonly totalJobCount: number;
	readonly resolverMs: number;
	readonly placementIntentMs: number;
	readonly texturePlacementMs: number;
	readonly resourceMs: number;
	readonly bakeMs: number;
	readonly commitMs: number;
	readonly slowestResolver: StaticCoordinatorTimingSampleDiagnostics | null;
	readonly slowestBake: StaticCoordinatorTimingSampleDiagnostics | null;
}

interface StaticCoordinatorTimingSampleDiagnostics {
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly taskId: string;
	readonly resolverMs: number | null;
	readonly placementIntentMs: number | null;
	readonly texturePlacementMs: number | null;
	readonly resourceMs: number | null;
	readonly bakeMs: number | null;
	readonly commitMs: number | null;
}

export interface TextureAtlasDiagnosticsReport {
	readonly kind: "texture-atlas";
	readonly buckets: readonly TextureAtlasBucketDiagnostics[];
	readonly mutations: TextureMutationDiagnostics;
	readonly summary: TextureAtlasDiagnosticsSummary;
}

interface TextureMutationDiagnostics {
	readonly maxPendingQueueDepth: number;
	readonly pending: number;
	readonly recent: readonly TextureMutationSampleDiagnostics[];
	readonly totalsByKind: Record<string, TextureMutationKindSummaryDiagnostics>;
}

interface TextureMutationKindSummaryDiagnostics {
	readonly count: number;
	readonly maxQueueWaitMs: number;
	readonly maxRunMs: number;
	readonly outputPlacementCount: number;
	readonly reclaimedTextureRefCount: number;
	readonly resolvedPlacementCount: number;
	readonly textureUseCount: number;
	readonly totalQueueWaitMs: number;
	readonly totalRunMs: number;
}

export interface TextureMutationSampleDiagnostics {
	/** Monotonic sequence number for one texture-manager mutation. */
	readonly sequence: number;
	/** Caller-visible mutation class used to identify queue spam. */
	readonly kind: string;
	/** Number of texture uses or placement intents represented by the mutation. */
	readonly textureUseCount: number;
	/** Removed texture owners represented by the mutation. */
	readonly removedOwnerCount: number;
	/** Number of mutations already queued or running when this mutation was enqueued. */
	readonly pendingAtEnqueue: number;
	/** Time spent waiting behind previous texture mutations. */
	readonly queueWaitMs: number;
	/** Total wall time spent executing this mutation after it reached the queue head. */
	readonly runMs: number;
	readonly outputPlacementCount: number;
	readonly reclaimedTextureRefCount: number;
	readonly resolvedPlacementCount: number;
	readonly pendingPlacementCount: number;
	readonly pendingGroupCount: number;
	readonly packedGroupCount: number;
	readonly absorbedPlacementCount: number;
	readonly pageLocalRepackCount: number;
	readonly phases: TextureMutationPhaseDiagnostics;
}

export interface TextureMutationPhaseDiagnostics {
	readonly absorbExistingPagesMs: number;
	readonly commitPackedPagesMs: number;
	readonly leaseAndRegistryMs: number;
	readonly markUploadedMs: number;
	readonly packPendingMs: number;
	readonly pageLocalRepackMaterializeMs: number;
	readonly planPackingGroupsMs: number;
	readonly prepareSourcesMs: number;
	readonly reclaimPagesMs: number;
	readonly removeOwnerRefsMs: number;
	readonly resolvedPlacementFanoutMs: number;
	readonly stageTextureUsesMs: number;
	readonly workerPackWaitMs: number;
}

interface TextureAtlasBucketDiagnostics {
	readonly bucketId: string;
	readonly domain: VisualTextureDomain;
	readonly registryEntryCount: number;
	readonly placementBucketKey: string;
	readonly uniqueSourceCount: number;
	readonly texturePageCount: number;
	readonly multiSourcePageCount: number;
	readonly approximateBytes: number;
	readonly pages: readonly TextureAtlasPageDiagnostics[];
	readonly wrapModes: Record<TextureWrapMode, number>;
}

interface TextureAtlasPageDiagnostics {
	readonly pageId: string;
	readonly approximateBytes: number;
	readonly format: "rgba8" | "r8" | "rg8";
	readonly height: number;
	readonly occupiedPixels: number;
	readonly packingEfficiency: number;
	readonly uniqueSourceCount: number;
	readonly width: number;
	readonly sampleClass: TexturePageSampleClass;
	readonly mipmapsGenerated: boolean;
	readonly samplerPolicyKey: string;
	readonly wrapS: TextureWrapMode;
	readonly wrapT: TextureWrapMode;
}

interface TextureAtlasDiagnosticsSummary {
	readonly bucketCount: number;
	readonly activeBucketCount: number;
	readonly emptyBucketCount: number;
	readonly texturePageCount: number;
	readonly pageLifecycle: TextureAtlasPageLifecycleDiagnostics;
	readonly multiSourcePageCount: number;
	readonly registryEntryCount: number;
	readonly mipmappedPageCount: number;
	readonly unmippedPageCount: number;
	readonly approximateBytes: number;
}

interface TextureAtlasPageLifecycleDiagnostics {
	readonly absorbed: number;
	readonly created: number;
	readonly reclaimed: number;
	readonly retained: number;
}

export interface TerrainTextureDiagnosticsReport {
	readonly kind: "terrain-textures";
	readonly summary: TerrainTextureDiagnosticsSummary;
	readonly recentFallbacks?: readonly TerrainTextureFallbackDiagnostics[];
}

interface TerrainTextureDiagnosticsSummary {
	readonly recentFallbackCount: number;
}

export interface TerrainTextureFallbackDiagnostics {
	readonly revision: number;
	readonly drawUnitId: string;
	readonly materialFamily: TerrainGeometryStaticDrawUnit["materialFamily"];
	readonly materialBucketKey: string;
	readonly reasons: readonly TerrainMaterialFallbackReason[];
}

type RuntimeWarningEvent =
	| StaticCommitInstallFailedWarning
	| DynamicRendererResourceSyncFailedWarning
	| StaticMaterialCoverageDeferredWarning
	| TerrainRenderableFallbackWarning
	| StaticDebugSelectionUnresolvedWarning;

interface DynamicRendererResourceSyncFailedWarning {
	readonly error: unknown;
	readonly kind: "dynamic-renderer-resource-sync-failed";
	readonly message: string;
	readonly revision: number;
}

interface StaticCommitInstallFailedWarning {
	readonly commitId: string;
	readonly kind: "static-commit-install-failed";
	readonly revision: number;
	readonly message: string;
	readonly error: unknown;
}

interface StaticMaterialCoverageDeferredWarning {
	readonly kind: "static-material-coverage-deferred";
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly landblockId: number | null;
	readonly buckets: readonly StaticMaterialUnrenderedBucket[];
}

interface StaticDebugSelectionUnresolvedWarning {
	readonly kind: "static-debug-selection-unresolved";
	readonly selectionKey: string;
	readonly reason: "missing-query-bounds";
}

interface TerrainRenderableFallbackWarning {
	readonly kind: "terrain-renderable-fallback";
	readonly revision: number;
	readonly drawUnitId: string;
	readonly materialFamily: TerrainGeometryStaticDrawUnit["materialFamily"];
	readonly materialBucketKey: string;
	readonly reasons: readonly TerrainMaterialFallbackReason[];
}

export function createConsoleRuntimeDiagnostics(): RuntimeDiagnostics {
	return new ConsoleRuntimeDiagnostics();
}

export function createAssetServiceDiagnosticsReport(
	snapshot: AssetServiceSnapshot,
): AssetServiceDiagnosticsReport {
	const pending = snapshot.pending.map((entry) => ({
		key: `${entry.key.kind}:${entry.key.id}`,
		kind: entry.key.kind,
		revision: entry.revision,
		waiterCount: entry.waiterCount,
	}));
	return {
		kind: "asset-service",
		...(pending.length > 0 ? { pending } : {}),
		summary: {
			committed: snapshot.committed.length,
			leased: snapshot.committed.filter((entry) => entry.leaseCount > 0).length,
			pending: snapshot.pending.length,
			pendingWaiters: snapshot.pending.reduce(
				(total, entry) => total + entry.waiterCount,
				0,
			),
			warmRetained: snapshot.committed.filter(
				(entry) => entry.warmRetainedUntilMs !== null,
			).length,
		},
	};
}

export function createDynamicDiagnosticsReport(
	snapshot: DynamicRuntimeSnapshot,
): DynamicDiagnosticsReport {
	return {
		kind: "dynamic",
		summary: {
			active: snapshot.activeEntityCount,
			indexed: snapshot.records.filter((record) => record.bounds.indexed)
				.length,
			nonRenderable: snapshot.nonRenderableEntityCount,
			renderable:
				snapshot.activeEntityCount - snapshot.nonRenderableEntityCount,
			resourceFailed: snapshot.records.filter(
				(record) => record.resources.status === "failed",
			).length,
			resourcePending: snapshot.records.filter(
				(record) =>
					record.resources.status === "pending" ||
					record.resources.status === "setup-animation-ready",
			).length,
			staticAuthoredSeeds: snapshot.staticAuthoredCount,
		},
	};
}

export function createStaticCommitInstallDiagnosticsReport(input: {
	readonly committedCommits: readonly StaticCommitInstallCommitDiagnostics[];
	readonly failedCommits: readonly StaticCommitInstallCommitDiagnostics[];
	readonly pendingCommits: readonly StaticCommitInstallCommitDiagnostics[];
}): StaticCommitInstallDiagnosticsReport {
	const commits = [
		...input.committedCommits,
		...input.failedCommits,
		...input.pendingCommits,
	];
	const slowestCommit =
		commits.length === 0
			? null
			: commits.reduce((slowest, commit) =>
					commit.timing.materializeMs > slowest.timing.materializeMs
						? commit
						: slowest,
				);
	return {
		committedCommits: input.committedCommits,
		failedCommits: input.failedCommits,
		kind: "static-commit-install",
		pendingCommits: input.pendingCommits,
		summary: {
			committed: input.committedCommits.length,
			failed: input.failedCommits.length,
			pending: input.pendingCommits.length,
			slowestCommit,
		},
	};
}

class ConsoleRuntimeDiagnostics implements RuntimeDiagnostics {
	readonly #reportedFallbacks = new Set<string>();
	readonly #reportedStaticMaterialCoverage = new Set<string>();
	readonly #reportedStaticDebugSelectionFailures = new Set<string>();

	warn(event: RuntimeWarningEvent): void {
		switch (event.kind) {
			case "dynamic-renderer-resource-sync-failed":
				console.error(
					`dynamic renderer resource sync revision ${event.revision} failed; dynamic visual resources from this sync were not committed.`,
					event.error,
				);
				return;
			case "static-commit-install-failed":
				console.error(
					`static commit install ${event.commitId} failed at revision ${event.revision}; static resources were not added to renderer residency.`,
					event.error,
				);
				return;
			case "static-material-coverage-deferred":
				this.#warnStaticMaterialCoverageDeferred(event);
				return;
			case "terrain-renderable-fallback":
				this.#warnTerrainRenderableFallback(event);
				return;
			case "static-debug-selection-unresolved":
				this.#warnStaticDebugSelectionUnresolved(event);
				return;
		}
	}

	#warnStaticDebugSelectionUnresolved(
		event: StaticDebugSelectionUnresolvedWarning,
	): void {
		const warningKey = [event.selectionKey, event.reason].join("|");
		if (this.#reportedStaticDebugSelectionFailures.has(warningKey)) {
			return;
		}
		this.#reportedStaticDebugSelectionFailures.add(warningKey);
		console.warn(
			`static debug selection ${event.selectionKey} could not be resolved to query bounds.`,
			{ reason: event.reason },
		);
	}

	#warnStaticMaterialCoverageDeferred(
		event: StaticMaterialCoverageDeferredWarning,
	): void {
		const warningKey = [
			event.revision,
			event.domain,
			event.landblockId ?? "none",
			...event.buckets.map(createStaticMaterialBucketSignature),
		].join("|");
		if (this.#reportedStaticMaterialCoverage.has(warningKey)) {
			return;
		}

		this.#reportedStaticMaterialCoverage.add(warningKey);
		console.warn(
			"static material coverage encountered deferred blended/order-dependent materials; renderer support is intentionally deferred until audited evidence justifies it.",
			{
				buckets: event.buckets,
				domain: event.domain,
				landblockId:
					event.landblockId === null
						? null
						: `0x${event.landblockId.toString(16).padStart(8, "0")}`,
				revision: event.revision,
			},
		);
	}

	#warnTerrainRenderableFallback(
		event: TerrainRenderableFallbackWarning,
	): void {
		const warningKey = [
			event.revision,
			event.drawUnitId,
			event.materialBucketKey,
			createReasonSignature(event.reasons),
		].join("|");
		if (this.#reportedFallbacks.has(warningKey)) {
			return;
		}

		this.#reportedFallbacks.add(warningKey);
		console.warn(
			`terrain draw unit ${event.drawUnitId} rendered with ${event.materialFamily} because its material could not be fully satisfied.`,
			{
				materialBucketKey: event.materialBucketKey,
				reasons: event.reasons,
				revision: event.revision,
			},
		);
	}
}

function createStaticMaterialBucketSignature(
	bucket: StaticMaterialUnrenderedBucket,
): string {
	return [
		bucket.family,
		bucket.pass,
		bucket.outcome,
		bucket.triangleCount,
		bucket.materialCount,
		bucket.partitionCount,
		bucket.reasonCodes.join(","),
	].join(":");
}

function createReasonSignature(
	reasons: readonly TerrainMaterialFallbackReason[],
): string {
	return reasons
		.map((reason) =>
			[
				reason.code,
				reason.pcode?.toString(16) ?? "none",
				reason.texture?.surfaceTextureId.toString(16) ?? "none",
			].join(":"),
		)
		.join("|");
}
