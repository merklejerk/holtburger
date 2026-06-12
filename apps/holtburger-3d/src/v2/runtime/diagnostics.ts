import type {
	RendererSnapshot,
	TerrainTextureRolePageKind,
} from "../renderer/types";
import type {
	StaticDomain,
	StaticMaterialCoverageFilteringMode,
	StaticMaterialCoverageFamily,
	StaticMaterialCoveragePass,
	StaticMaterialRenderOutcome,
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialFallbackReason,
} from "../static/contracts";
import type {
	TextureFilteringMode,
	TexturePageSampleClass,
	TextureWrapMode,
} from "../textures/sampling-policy";

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
	readonly lastStaticRequest: string | null;
	readonly pendingStaticMaterializationRevisions: readonly number[];
	readonly committedStaticMaterializationRevisions: readonly number[];
	readonly failedStaticMaterializations: readonly RuntimeDiagnosticsFailure[];
}

interface RuntimeDiagnosticsFailure {
	readonly revision: number;
	readonly message: string;
}

type RuntimeDiagnosticsDomainReport =
	| RendererDiagnosticsReport
	| StaticCoordinatorDiagnosticsReport
	| TerrainTextureDiagnosticsReport
	| TextureAtlasDiagnosticsReport;

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
	readonly latestLandblockTopologyPayload: string | null;
	readonly latestDungeonPayload: string | null;
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

type TextureAtlasWarningDiagnostics = TerrainRolePageOverflowSummaryDiagnostics;

interface TerrainRolePageOverflowSummaryDiagnostics {
	readonly kind: "terrain-role-page-overflow";
	readonly count: number;
	readonly latestDrawUnitId: string | null;
	readonly latestRole: TerrainTextureRolePageKind | null;
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

type RuntimeWarningEvent =
	| StaticMaterializationFailedWarning
	| TerrainRenderableFallbackWarning;

interface StaticMaterializationFailedWarning {
	readonly kind: "static-materialization-failed";
	readonly revision: number;
	readonly message: string;
	readonly error: unknown;
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

class ConsoleRuntimeDiagnostics implements RuntimeDiagnostics {
	readonly #reportedFallbacks = new Set<string>();

	warn(event: RuntimeWarningEvent): void {
		switch (event.kind) {
			case "static-materialization-failed":
				console.warn(
					`V2 static materialization revision ${event.revision} failed; draw units from this commit were not added to renderer residency.`,
					event.error,
				);
				return;
			case "terrain-renderable-fallback":
				this.#warnTerrainRenderableFallback(event);
				return;
		}
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
