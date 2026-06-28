import type {
	PortalFrameWorkPlan,
	RenderPassPlan,
	RendererSnapshot,
	ObjectMaterialTextureRolePageKind,
	TerrainTextureRolePageKind,
} from "../renderer/types";
import type { AssetServiceSnapshot } from "../assets/contracts";
import type {
	StaticDomain,
	StaticMaterialUnrenderedBucket,
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialFallbackReason,
} from "../static/contracts";
import type { TextureFilteringMode } from "../textures/sampling-policy";
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
	readonly pendingStaticMaterializationCount: number;
	readonly committedStaticMaterializationCount: number;
	readonly envCellResourceMembershipRevision: number;
	readonly sourceStaticDrawUnits: number;
	readonly materializedStaticDrawUnits: number;
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
	| RendererDiagnosticsReport
	| StaticCoordinatorDiagnosticsReport
	| TerrainTextureDiagnosticsReport
	| TextureAtlasDiagnosticsReport;

export interface AssetServiceDiagnosticsReport {
	readonly kind: "asset-service";
	readonly summary: AssetServiceDiagnosticsSummary;
}

interface AssetServiceDiagnosticsSummary {
	readonly pending: number;
	readonly pendingWaiters: number;
	readonly committed: number;
	readonly leased: number;
	readonly warmRetained: number;
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
	readonly outdoorDetailStaticObjectResources: number;
	readonly outdoorDetailStaticObjectBakedDirectDrawCalls: number;
	readonly outdoorDetailStaticObjectBakedDirectDrawCallsByPass: RendererSnapshot["outdoorDetailStaticObjectBakedDirectDrawCallsByPass"];
	readonly outdoorDetailStaticObjectVisualResources: number;
	readonly outdoorDetailStaticObjectRenderInstances: number;
	readonly staticObjectUploadedBufferBytes: number;
	readonly outdoorDetailStaticObjectUploadedBufferBytes: number;
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

export interface StaticCoordinatorDiagnosticsReport {
	readonly kind: "static-coordinator";
	readonly summary: StaticCoordinatorDiagnosticsSummary;
	readonly materialCoverageSummary: StaticMaterialCoverageSummaryDiagnostics;
	readonly staticObjectBakeSummary: StaticObjectBakeSummaryDiagnostics;
	readonly timingSummary: StaticCoordinatorTimingSummaryDiagnostics;
	readonly inFlightWork?: readonly StaticCoordinatorWorkDiagnostics[];
	readonly recentFailures?: readonly StaticCoordinatorWorkDiagnostics[];
}

interface StaticCoordinatorDiagnosticsSummary {
	readonly revision: number;
	readonly requested: number;
	readonly resolving: number;
	readonly baking: number;
	readonly committed: number;
	readonly failed: number;
	readonly staleResolverResults: number;
	readonly staleBakeResults: number;
	readonly committedDrawUnits: number;
}

interface StaticCoordinatorWorkDiagnostics {
	readonly workId: string;
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly status: "requested" | "resolving" | "baking" | "failed";
}

export type StaticCoordinatorWorkReportDiagnostics =
	StaticCoordinatorWorkDiagnostics;

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
	readonly flattenedTriangleCount: number;
	readonly flattenedVertexCount: number;
	readonly drawUnitCount: number;
	readonly partitionCount: number;
	readonly estimatedFlattenedTypedArrayBytes: number;
	readonly bakedInstancedVisualResourceCount: number;
	readonly bakedInstancedRenderInstanceCount: number;
	readonly instancedSourceTriangleCount: number;
	readonly estimatedInstancedSourceTypedArrayBytes: number;
	readonly estimatedAvoidedFlattenedTriangleCount: number;
	readonly estimatedAvoidedFlattenedTypedArrayBytes: number;
	readonly retainedTransparentOutdoorDetailPartitionReasons: StaticObjectRetainedTransparentPartitionReasonSummaryDiagnostics;
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
	readonly flattenedTriangleCount: number;
	readonly estimatedFlattenedTypedArrayBytes: number;
	readonly bakedInstancedRenderInstanceCount: number;
	readonly bakedInstancedVisualResourceCount: number;
	readonly estimatedAvoidedFlattenedTypedArrayBytes: number;
	readonly uniqueSourceCount: number;
}

interface StaticCoordinatorTimingSummaryDiagnostics {
	readonly reportCount: number;
	readonly totalItemCount: number;
	readonly resolverMs: number;
	readonly attachmentMs: number;
	readonly bakeMs: number;
	readonly commitMs: number;
	readonly slowestResolver: StaticCoordinatorTimingSampleDiagnostics | null;
	readonly slowestBake: StaticCoordinatorTimingSampleDiagnostics | null;
}

interface StaticCoordinatorTimingSampleDiagnostics {
	readonly domain: StaticDomain;
	readonly itemCount: number;
	readonly resolverMs: number | null;
	readonly attachmentMs: number | null;
	readonly bakeMs: number | null;
	readonly commitMs: number | null;
}

export interface TextureAtlasDiagnosticsReport {
	readonly kind: "texture-atlas";
	readonly summary: TextureAtlasDiagnosticsSummary;
	readonly warnings?: readonly TextureAtlasWarningDiagnostics[];
}

interface TextureAtlasDiagnosticsSummary {
	readonly batchCount: number;
	readonly activeBatchCount: number;
	readonly emptyBatchCount: number;
	readonly texturePageCount: number;
	readonly multiSourcePageCount: number;
	readonly entryAliasCount: number;
	readonly mipmappedPageCount: number;
	readonly unmippedPageCount: number;
	readonly approximateBytes: number;
}

type TextureAtlasWarningDiagnostics =
	| TerrainRolePageOverflowSummaryDiagnostics
	| ObjectMaterialRolePageOverflowSummaryDiagnostics;

export type TextureAtlasWarningReportDiagnostics =
	TextureAtlasWarningDiagnostics;

interface TerrainRolePageOverflowSummaryDiagnostics {
	readonly kind: "terrain-role-page-overflow";
	readonly count: number;
	readonly latestDrawUnitId: string | null;
	readonly latestRole: TerrainTextureRolePageKind | null;
}

interface ObjectMaterialRolePageOverflowSummaryDiagnostics {
	readonly kind: "object-material-role-page-overflow";
	readonly count: number;
	readonly latestOwnerKey: string | null;
	readonly latestRole: ObjectMaterialTextureRolePageKind | null;
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

export interface TerrainRolePageOverflowDiagnostics {
	readonly drawUnitId: string;
	readonly kind: TerrainTextureRolePageKind;
	readonly maxSlots: number;
	readonly textureRefId: string;
}

export interface ObjectMaterialRolePageOverflowDiagnostics {
	readonly ownerKey: string;
	readonly kind: ObjectMaterialTextureRolePageKind;
	readonly maxSlots: number;
	readonly textureRefId: string;
}

type RuntimeWarningEvent =
	| StaticMaterializationFailedWarning
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

interface StaticMaterializationFailedWarning {
	readonly kind: "static-materialization-failed";
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
	return {
		kind: "asset-service",
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
			staticAuthoredSeeds: snapshot.staticSeedCount,
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
			case "static-materialization-failed":
				console.error(
					`static materialization revision ${event.revision} failed; draw units from this commit were not added to renderer residency.`,
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
