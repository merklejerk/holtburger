import type {
	PortalPassPlan,
	RendererSnapshot,
	StaticObjectTextureRolePageKind,
	TerrainTextureRolePageKind,
} from "../renderer/types";
import type { AssetServiceSnapshot } from "../assets/contracts";
import type {
	StaticDomain,
	StaticMaterialCoverageFilteringMode,
	StaticMaterialCoverageFamily,
	StaticMaterialCoverageKind,
	StaticMaterialCoveragePass,
	StaticMaterialUnrenderedBucket,
	StaticMaterialRenderOutcome,
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialFallbackReason,
} from "../static/contracts";
import type {
	TextureFilteringMode,
	TexturePageSampleClass,
	TextureWrapMode,
} from "../textures/sampling-policy";
import type { StaticSceneCameraResidency } from "./static-scene-query";

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
	readonly currentCameraResidency: StaticSceneCameraResidency;
	readonly portalPassPlan: PortalPassPlan | null;
	readonly pendingStaticMaterializationRevisions: readonly number[];
	readonly committedStaticMaterializationRevisions: readonly number[];
	readonly failedStaticMaterializations: readonly RuntimeDiagnosticsFailure[];
	readonly sourceStaticDrawUnits: number;
	readonly materializedStaticDrawUnits: number;
}

interface RuntimeDiagnosticsFailure {
	readonly revision: number;
	readonly message: string;
}

type RuntimeDiagnosticsDomainReport =
	| AssetServiceDiagnosticsReport
	| RendererDiagnosticsReport
	| StaticCoordinatorDiagnosticsReport
	| TerrainTextureDiagnosticsReport
	| TextureAtlasDiagnosticsReport;

export interface AssetServiceDiagnosticsReport {
	readonly kind: "asset-service";
	readonly summary: AssetServiceDiagnosticsSummary;
	readonly snapshot: AssetServiceSnapshot;
}

interface AssetServiceDiagnosticsSummary {
	readonly pending: number;
	readonly pendingWaiters: number;
	readonly committed: number;
	readonly leased: number;
	readonly warmRetained: number;
	readonly failures: number;
}

interface RendererDiagnosticsReport {
	readonly kind: "renderer";
	readonly summary: RendererSnapshot;
}

export interface StaticCoordinatorDiagnosticsReport {
	readonly kind: "static-coordinator";
	readonly summary: StaticCoordinatorDiagnosticsSummary;
	readonly materialCoverage: readonly StaticMaterialCoverageDiagnostics[];
	readonly inFlightWork: readonly StaticCoordinatorWorkDiagnostics[];
	readonly recentFailures: readonly StaticCoordinatorWorkDiagnostics[];
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
	readonly latestTerrainPayload: string | null;
	readonly latestOutdoorStaticObjectsPayload: string | null;
	readonly latestLandblockEnvCellsPayload: string | null;
	readonly latestResolverFailure: string | null;
}

interface StaticCoordinatorWorkDiagnostics {
	readonly workId: string;
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly status: "requested" | "resolving" | "baking" | "failed";
	readonly failureMessage: string | null;
}

interface StaticMaterialCoverageDiagnostics {
	readonly coverageKey: string;
	readonly coverageKind: StaticMaterialCoverageKind;
	readonly domain: StaticDomain;
	readonly landblockId: string | null;
	readonly materialCount: number;
	readonly partitionCount: number;
	readonly triangleCount: number;
	readonly renderedTriangles: number;
	readonly deferredTriangles: number;
	readonly unsupportedTriangles: number;
	readonly detailRoleCount: number;
	readonly fallbackReasonCount: number;
	readonly buckets: readonly StaticMaterialCoverageBucketDiagnostics[];
	readonly fallbackReasons: Record<string, number>;
	readonly unrenderedBuckets: readonly StaticMaterialUnrenderedBucketDiagnostics[];
}

interface StaticMaterialCoverageBucketDiagnostics {
	readonly family: StaticMaterialCoverageFamily;
	readonly pass: StaticMaterialCoveragePass;
	readonly outcome: StaticMaterialRenderOutcome;
	readonly filteringMode: StaticMaterialCoverageFilteringMode;
	readonly materials: number;
	readonly partitions: number;
	readonly triangles: number;
	readonly textureRoles: number;
}

interface StaticMaterialUnrenderedBucketDiagnostics {
	readonly family: StaticMaterialCoverageFamily;
	readonly pass: StaticMaterialCoveragePass;
	readonly outcome: Exclude<StaticMaterialRenderOutcome, "rendered">;
	readonly materials: number;
	readonly partitions: number;
	readonly triangles: number;
	readonly reasonCodes: readonly string[];
}

export interface TextureAtlasDiagnosticsReport {
	readonly kind: "texture-atlas";
	readonly summary: TextureAtlasDiagnosticsSummary;
	readonly byDomain: readonly TextureAtlasDomainDiagnostics[];
	readonly warnings: readonly TextureAtlasWarningDiagnostics[];
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

interface TextureAtlasDomainDiagnostics {
	readonly domain: StaticDomain;
	readonly batchCount: number;
	readonly activeBatchCount: number;
	readonly emptyBatchCount: number;
	readonly entryAliasCount: number;
	readonly uniqueSourceCount: number;
	readonly texturePageCount: number;
	readonly multiSourcePageCount: number;
	readonly mipmappedPageCount: number;
	readonly unmippedPageCount: number;
	readonly approximateBytes: number;
	readonly sampleClasses: Record<TexturePageSampleClass, number>;
	readonly formats: Record<TextureAtlasPageFormat, number>;
	readonly samplerPolicies: Record<string, number>;
	readonly wrapModes: Record<TextureWrapMode, number>;
}

type TextureAtlasPageFormat = "rgba8" | "r8" | "rg8";

type TextureAtlasWarningDiagnostics =
	| TerrainRolePageOverflowSummaryDiagnostics
	| StaticObjectRolePageOverflowSummaryDiagnostics;

interface TerrainRolePageOverflowSummaryDiagnostics {
	readonly kind: "terrain-role-page-overflow";
	readonly count: number;
	readonly latestDrawUnitId: string | null;
	readonly latestRole: TerrainTextureRolePageKind | null;
}

interface StaticObjectRolePageOverflowSummaryDiagnostics {
	readonly kind: "static-object-role-page-overflow";
	readonly count: number;
	readonly latestDrawUnitId: string | null;
	readonly latestRole: StaticObjectTextureRolePageKind | null;
}

export interface TerrainTextureDiagnosticsReport {
	readonly kind: "terrain-textures";
	readonly summary: TerrainTextureDiagnosticsSummary;
	readonly recentFallbacks: readonly TerrainTextureFallbackDiagnostics[];
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

export interface StaticObjectRolePageOverflowDiagnostics {
	readonly drawUnitId: string;
	readonly kind: StaticObjectTextureRolePageKind;
	readonly maxSlots: number;
	readonly textureRefId: string;
}

type RuntimeWarningEvent =
	| StaticResolverFailedWarning
	| StaticMaterializationFailedWarning
	| StaticMaterialCoverageDeferredWarning
	| TerrainRenderableFallbackWarning
	| StaticDebugSelectionUnresolvedWarning;

interface StaticResolverFailedWarning {
	readonly kind: "static-resolver-failed";
	readonly revision: number;
	readonly workId: string;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly message: string;
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
		snapshot,
		summary: {
			committed: snapshot.committed.length,
			failures: snapshot.failures.length,
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

class ConsoleRuntimeDiagnostics implements RuntimeDiagnostics {
	readonly #reportedFallbacks = new Set<string>();
	readonly #reportedStaticMaterialCoverage = new Set<string>();
	readonly #reportedStaticDebugSelectionFailures = new Set<string>();

	warn(event: RuntimeWarningEvent): void {
		switch (event.kind) {
			case "static-resolver-failed":
				console.error(
					`V2 static resolver work ${event.workId} failed; static content for ${event.scopeKey}/${event.domain} was not resolved.`,
					{
						message: event.message,
						revision: event.revision,
					},
				);
				return;
			case "static-materialization-failed":
				console.warn(
					`V2 static materialization revision ${event.revision} failed; draw units from this commit were not added to renderer residency.`,
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
			`V2 static debug selection ${event.selectionKey} could not be resolved to query bounds.`,
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
			"V2 static material coverage encountered deferred blended/order-dependent materials; renderer support is intentionally deferred until audited evidence justifies it.",
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
			`V2 terrain draw unit ${event.drawUnitId} rendered with ${event.materialFamily} because its material could not be fully satisfied.`,
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
