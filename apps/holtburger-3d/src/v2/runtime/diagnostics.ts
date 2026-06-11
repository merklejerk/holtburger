import type {
	RendererSnapshot,
	TerrainTextureRolePageKind,
	TexturePlacement,
} from "../renderer/types";
import type {
	StaticDomain,
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialFallbackReason,
} from "../static/contracts";
import type {
	TextureFilteringMode,
	TexturePageSampleClass,
} from "../textures/sampling-policy";

export interface RuntimeDiagnostics {
	warn(event: RuntimeWarningEvent): void;
}

export interface RuntimeDiagnosticsReport {
	readonly kind: "runtime-diagnostics-report";
	readonly runtime: RuntimeDiagnosticsRuntimeSummary;
	readonly domains: readonly RuntimeDiagnosticsDomainReport[];
}

export interface RuntimeDiagnosticsRuntimeSummary {
	readonly status: "idle" | "static-active" | "disposed";
	readonly lastStaticRequest: string | null;
	readonly pendingStaticMaterializationRevisions: readonly number[];
	readonly committedStaticMaterializationRevisions: readonly number[];
	readonly failedStaticMaterializations: readonly RuntimeDiagnosticsFailure[];
}

export interface RuntimeDiagnosticsFailure {
	readonly revision: number;
	readonly message: string;
}

export type RuntimeDiagnosticsDomainReport =
	| RendererDiagnosticsReport
	| StaticCoordinatorDiagnosticsReport
	| TextureAtlasDiagnosticsReport;

export interface RendererDiagnosticsReport {
	readonly kind: "renderer";
	readonly summary: RendererSnapshot;
}

export interface StaticCoordinatorDiagnosticsReport {
	readonly kind: "static-coordinator";
	readonly summary: StaticCoordinatorDiagnosticsSummary;
	readonly inFlightWork: readonly StaticCoordinatorWorkDiagnostics[];
	readonly recentFailures: readonly StaticCoordinatorWorkDiagnostics[];
}

export interface StaticCoordinatorDiagnosticsSummary {
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
	readonly latestLandblockTopologyPayload: string | null;
	readonly latestDungeonPayload: string | null;
	readonly latestResolverFailure: string | null;
}

export interface StaticCoordinatorWorkDiagnostics {
	readonly workId: string;
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly status: "requested" | "resolving" | "baking" | "failed";
	readonly failureMessage: string | null;
}

export interface TextureAtlasDiagnosticsReport {
	readonly kind: "texture-atlas";
	readonly summary: TextureAtlasDiagnosticsSummary;
	readonly batches: readonly TextureAtlasBatchDiagnostics[];
	readonly terrainRolePages: TerrainRolePageUsageDiagnostics;
	readonly recentRolePageOverflows: readonly TerrainRolePageOverflowDiagnostics[];
}

export interface TextureAtlasDiagnosticsSummary {
	readonly batchCount: number;
	readonly texturePageCount: number;
	readonly multiSourcePageCount: number;
	readonly entryAliasCount: number;
	readonly approximateBytes: number;
}

export interface TextureAtlasBatchDiagnostics {
	readonly batchId: string;
	readonly domain: StaticDomain;
	readonly revision: number;
	readonly entryAliasCount: number;
	readonly uniqueSourceCount: number;
	readonly texturePageCount: number;
	readonly multiSourcePageCount: number;
	readonly approximateBytes: number;
	readonly pages: readonly TextureAtlasPageDiagnostics[];
}

export interface TextureAtlasPageDiagnostics {
	readonly pageId: string;
	readonly width: number;
	readonly height: number;
	readonly format: TexturePlacement["format"];
	readonly approximateBytes: number;
	readonly entryAliasCount: number;
	readonly uniqueSourceCount: number;
	readonly totalLeaseCount: number;
	readonly sampleClass: TexturePageSampleClass;
	readonly samplerPolicyKey: string;
	readonly filteringMode: TextureFilteringMode;
	readonly mipmapsGenerated: boolean;
	readonly anisotropy: number;
	readonly wrapS: TexturePlacement["wrapS"];
	readonly wrapT: TexturePlacement["wrapT"];
}

export interface TerrainRolePageUsageDiagnostics {
	readonly drawUnitCount: number;
	readonly maxColorPages: number;
	readonly maxMaskPages: number;
	readonly maxDetailPages: number;
	readonly multiColorDrawUnits: number;
	readonly multiMaskDrawUnits: number;
	readonly missingMaskDrawUnits: number;
	readonly outliers: readonly TerrainRolePageOutlierDiagnostics[];
}

export interface TerrainRolePageOutlierDiagnostics {
	readonly drawUnitId: string;
	readonly colorPages: number;
	readonly maskPages: number;
	readonly detailPages: number;
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
