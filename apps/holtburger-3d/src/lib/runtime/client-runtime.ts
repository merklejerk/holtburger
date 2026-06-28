import { HostBackedAssetService } from "../assets/asset-service";
import type {
	AssetService,
	AssetServiceOverviewSnapshot,
	AssetServiceSnapshot,
} from "../assets/contracts";
import type {
	RuntimeHost,
	RuntimeHostSnapshot,
} from "../host/runtime-contracts";
import type {
	Renderer,
	RendererFrameTelemetry,
	RendererStaticLayerVisibility,
	RendererSnapshot,
	RenderPassPlan,
	PortalProjectionFrameGraphPlan,
	PortalFrameWorkPlan,
	StaticLandblockLayerPayload,
	StaticLandblockLayerKind,
	TerrainLayerPayload,
	OutdoorBuildingsLayerPayload,
	OutdoorDetailsLayerPayload,
	StaticObjectUploadDiagnostics,
	DynamicRendererResourceCommit,
	DynamicRendererVisualResource,
} from "../renderer/types";
import {
	createStaticLandblockLayerGenerationId,
	createStaticLandblockLayerKey,
} from "../renderer/types";
import type { DebugOverlayPrimitive, FrameState } from "../renderer/types";
import {
	createLegacyPortalFrameWorkPlan,
	portalFrameWorkPlanEquals,
} from "../renderer/portal-frame-work-plan";
import {
	combineOutdoorPortalProjectionFramePlans,
	createPortalProjectionFramePlan,
} from "./direct-env-cell-frame-plan";
import { formatHex32, normalizeOutdoorLandblockId } from "../../lib/landblocks";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	multiplyMat4,
} from "../math/ac-placement-transform";
import {
	TextureManager,
	type DynamicTextureUseCommit,
} from "../textures/texture-manager";
import type { TexturePacker } from "../textures/packing/packer";
import type { TextureFilteringMode } from "../textures/sampling-policy";
import {
	createAssetServiceDiagnosticsReport,
	createConsoleRuntimeDiagnostics,
	createDynamicDiagnosticsReport,
	type RendererDiagnosticsSummary,
	type RuntimeDiagnostics,
	type RuntimeDiagnosticsReport,
	type StaticCoordinatorDiagnosticsReport,
	type StaticCoordinatorWorkReportDiagnostics,
	type TerrainTextureDiagnosticsReport,
	type TerrainTextureFallbackDiagnostics,
} from "./diagnostics";
import {
	ImmediateStaticBaker,
	ImmediateStaticResolver,
} from "../static/fake-workers";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type {
	StaticCoordinatorSnapshot,
	StaticCoordinatorCommitDelta,
	StaticDemand,
	StaticBounds,
	StaticDrawUnit,
	StaticObjectGeometryStaticDrawUnit,
	StaticLodRadii,
	StaticMaterialCoverageReport,
	StaticMaterialTableEntry,
	StaticObjectSourceMappingCoverage,
	StaticObjectSourceIdentity,
	StaticMaterialUnrenderedBucket,
	ScheduledStaticWorkStatus,
	StaticRetentionReconciliation,
	StaticPortalInteriorRecord,
	StaticPortalApertureResource,
	StaticPortalProjectionRecord,
	StaticResourceKey,
	StaticCoordinatorTimingDiagnostics,
	StaticCoordinatorOverviewSnapshot,
	StaticObjectBakeDiagnostics,
} from "../static/contracts";
import {
	collectStaticDrawUnitResourceIds,
	type StaticAuthoredDynamicSeedRecord,
	type StaticDomain,
} from "../static/contracts";
import {
	materializeStaticCommit,
	type StaticMaterializationResult,
} from "./static-materializer";
import type {
	EnvCellPortalScenePickDetails,
	EnvCellStaticScenePickDetails,
	OutdoorStaticObjectScenePickDetails,
	OutdoorStaticObjectSourceDiagnostics,
	StaticSceneCameraResidency,
	StaticSceneEnvCellBounds,
	StaticSceneQuerySnapshot,
	StaticSceneQueryOverviewSnapshot,
	StaticSceneSelectionKey,
	StaticSceneTerrainLandblockBounds,
	TerrainQuadScenePickDetails,
	Vec3,
} from "./scene-query/contracts";
import { triangulateEnvCellPortalAperture } from "./scene-query/env-cell-portal-picking";
import { pickMergedSceneRay } from "./scene-query/merged-scene-query";
import type {
	ScenePickHit,
	ScenePickRequest,
} from "./scene-query/merged-scene-query-contracts";
import { describeStaticSceneSelectionKey } from "./scene-query/static-selection-keys";
import { StaticSceneQuery } from "./static-scene-query";
import { createOutdoorLandblockRootTranslation } from "./static-placement";
import {
	createEnvCellResourceMembershipIndex,
	createEnvCellResourceMembershipSnapshot,
	envCellResourceMembershipSnapshotsEqual,
	type EnvCellResourceMembership,
} from "./env-cell-resource-membership";
import {
	EnvCellSystemLayerAssemblyStore,
	type EnvCellSystemLayerAssemblyPublication,
} from "./env-cell-system-layer-assembly";
import {
	EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY,
	deriveRuntimePortalOverlapResidency,
	type RuntimePortalOverlapResidency,
} from "./portal-base-overlap";
import { DynamicEntityController } from "../dynamic/dynamic-entity-controller";
import { DynamicEntityResourceManager } from "../dynamic/dynamic-entity-resource-manager";
import type {
	DynamicEntitySummaryDto,
	DynamicEntityId,
	DynamicRuntimeSnapshot,
} from "../dynamic/contracts";
import { translateBounds } from "./scene-query/geometry";

const STATIC_DIAGNOSTICS_FAILURE_LIMIT = 8;
const TERRAIN_TEXTURE_DIAGNOSTICS_EVENT_LIMIT = 8;
const BLENDED_STATIC_AUDIT_WARNING_BUCKET_LIMIT = 8;
const DEFAULT_ASSET_MAINTENANCE_INTERVAL_MS = 5_000;
const DEFAULT_TRANSITION_PORTAL_MAX_DEPTH = 4;
export const MIN_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH = 0;
export const DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH = 18;
export const MAX_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH = 24;
const DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_CELLS = 512;
const DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_VIEWS = 512;
const DEFAULT_EXTERIOR_SUFFIX_MAX_DEPTH = 1;
const DEFAULT_PORTAL_BASE_OVERLAP_PLANE_EPSILON = 0.25;
const DEFAULT_PORTAL_BASE_OVERLAP_APERTURE_PADDING = 0.25;

export type ManualStaticDomain =
	| "terrain"
	| "buildings"
	| "detail"
	| "env-cells";

export type RuntimeSceneInterest =
	| {
			readonly kind: "none";
	  }
	| {
			readonly kind: "outdoor-anchor";
			readonly anchorLandblockId: number;
			readonly domains: readonly ManualStaticDomain[];
			readonly lod?: Partial<StaticLodRadii>;
			readonly source: "manual" | "follow" | "settings";
	  }
	| {
			readonly kind: "interior-cell";
			readonly landblockId: number;
			readonly envCellId: number;
			readonly source: "manual" | "follow" | "settings";
	  };

export type RuntimeCameraResidency = StaticSceneCameraResidency;

export type RuntimeSceneInterestSource =
	| "manual"
	| "follow"
	| "settings"
	| "none";

export type RuntimeEvent =
	| RuntimeSceneInterestUpdatedEvent
	| RuntimeSceneInterestSettledEvent;

interface RuntimeSceneInterestUpdatedEvent {
	readonly interest: RuntimeSceneInterest;
	readonly kind: "scene-interest-updated";
	readonly revision: number;
	readonly source: RuntimeSceneInterestSource;
}

interface RuntimeSceneInterestSettledEvent {
	readonly interest: RuntimeSceneInterest;
	readonly kind: "scene-interest-settled";
	readonly result: "ready" | "failed" | "cleared";
	readonly revision: number;
	readonly source: RuntimeSceneInterestSource;
}

type PortalFramePlanKey =
	| {
			readonly kind: "env-cell-projection";
			readonly envCellId: number;
			readonly envCellSystemGenerationId: string | null;
			readonly exteriorSuffixMaxDepth: number;
			readonly landblockId: number;
			readonly maxRenderEntries: number;
			readonly maxDepth: number;
			readonly maxMaskEdges: number;
			readonly portalOverlapSignature: string;
			readonly retainedProjectionSourceKey: string | null;
			readonly renderAnchorLandblockId: number | null;
	  }
	| {
			readonly kind: "outdoor-transition";
			readonly landblockId: number;
			readonly maxRenderEntries: number;
			readonly maxDepth: number;
			readonly maxMaskEdges: number;
			readonly portalOverlapSignature: string;
			readonly retainedProjectionSourceKey: string;
			readonly renderAnchorLandblockId: number | null;
	  };

interface CachedPortalFramePlan {
	readonly key: PortalFramePlanKey;
	readonly plan: PortalFrameWorkPlan;
}

interface RetainedOutdoorPortalFramePlan {
	readonly plan: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell"; readonly mode: "portal-projection" }
	>;
	readonly sourceKey: string;
}

export interface RuntimeDiagnosticsSnapshot {
	readonly status: "idle" | "static-active" | "disposed";
	readonly renderPolicy: RuntimeRenderPolicySnapshot;
	readonly sceneInterest: RuntimeSceneInterest;
	readonly currentCameraResidency: RuntimeCameraResidency;
	readonly currentPortalOverlapResidency: RuntimePortalOverlapResidency;
	readonly renderPassPlan: RenderPassPlan;
	readonly portalFrameWorkPlan: PortalFrameWorkPlan;
	readonly debugOverlays: RuntimeDebugOverlaySnapshot;
	readonly assets: AssetServiceSnapshot;
	readonly dynamic: DynamicRuntimeSnapshot;
	readonly host: RuntimeHostSnapshot;
	readonly renderer: RendererSnapshot;
	readonly static: StaticCoordinatorSnapshot;
	readonly staticSceneQuery: StaticSceneQuerySnapshot;
	readonly staticMaterialization: StaticMaterializationSnapshot;
}

export interface RuntimeOverviewSnapshot {
	/** Runtime lifecycle state shown in browser status panels. */
	readonly status: "idle" | "static-active" | "disposed";
	/** Browser-visible render policy controls. */
	readonly renderPolicy: RuntimeRenderPolicySnapshot;
	/** Current static scene interest requested by browser controls or follow mode. */
	readonly sceneInterest: RuntimeSceneInterest;
	/** Current camera residency used by browser status and picking fallback logic. */
	readonly currentCameraResidency: RuntimeCameraResidency;
	/** Current portal overlap state summarized by the browser debug panel. */
	readonly currentPortalOverlapResidency: RuntimePortalOverlapResidency;
	/** Current portal work plan summarized by the browser debug panel. */
	readonly portalFrameWorkPlan: PortalFrameWorkPlan;
	/** Debug overlay visibility and displayed overlay counts. */
	readonly debugOverlays: RuntimeDebugOverlaySnapshot;
	/** Cheap asset counts for browser diagnostics. */
	readonly assets: AssetServiceOverviewSnapshot;
	/** Cheap static coordinator counts and latest payload summaries. */
	readonly static: StaticCoordinatorOverviewSnapshot;
	/** Cheap static scene query counts for browser diagnostics. */
	readonly staticSceneQuery: StaticSceneQueryOverviewSnapshot;
}

interface RuntimeDebugOverlaySnapshot {
	readonly envCellAabbsVisible: boolean;
	readonly envCellAabbCount: number;
	readonly flatVisionModeEnabled: boolean;
	readonly portalCount: number;
	readonly portalsVisible: boolean;
}

interface StaticSelectionDiagnosticsReport {
	readonly kind: "static-selection-diagnostics-report";
	readonly selection: {
		readonly key: StaticSceneSelectionKey;
		readonly label: string;
		readonly pickDistance: number | null;
	};
	readonly debugBounds: StaticBounds | null;
	readonly details: StaticSelectionDiagnosticsDetails | null;
	readonly rendering: StaticSelectionRenderingDiagnostics | null;
	readonly runtime: {
		readonly renderAnchorLandblockId: number | null;
		readonly sceneInterest: string | null;
		readonly staticSceneQuery: StaticSceneQuerySnapshot;
	};
}

interface DynamicSelectionDiagnosticsReport {
	readonly kind: "dynamic-selection-diagnostics-report";
	readonly selection: {
		readonly entityId: DynamicEntityId;
		readonly pickDistance: number | null;
	};
	readonly debugBounds: StaticBounds | null;
	readonly entity: DynamicSelectionEntityDiagnostics | null;
	readonly renderer: DynamicSelectionRendererDiagnostics;
	readonly runtime: {
		readonly renderAnchorLandblockId: number | null;
		readonly sceneInterest: string | null;
	};
}

interface DynamicSelectionEntityDiagnostics {
	readonly animation: DynamicSelectionAnimationDiagnostics;
	readonly bounds: DynamicSelectionBoundsDiagnostics;
	readonly effectiveResidence: DynamicEntitySummaryDto["effectiveResidence"];
	readonly provenance: DynamicEntitySummaryDto["provenance"];
	readonly renderability: DynamicEntitySummaryDto["renderability"];
	readonly rendererIdentity: DynamicSelectionRendererIdentityDiagnostics;
	readonly resources: DynamicSelectionResourceDiagnostics;
	readonly source: DynamicEntitySummaryDto["source"];
	readonly sourceResidence: DynamicEntitySummaryDto["sourceResidence"];
}

interface DynamicSelectionAnimationDiagnostics {
	readonly activeTransformEffects: readonly DynamicSelectionTransformEffectDiagnostics[];
	readonly currentFrameIndex: number | null;
	readonly elapsedSeconds: number | null;
	readonly frameCount: number | null;
	readonly frameNumber: number | null;
	readonly partCount: number | null;
	readonly status: DynamicEntitySummaryDto["animation"]["status"];
}

type DynamicSelectionTransformEffectDiagnostics = {
	readonly hookName: string;
	readonly hookType: number;
	readonly kind: "omega";
	readonly lastAppliedFrameIndex: number;
	readonly lastAppliedLoopIteration: number;
	readonly omega: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
};

interface DynamicSelectionBoundsDiagnostics {
	readonly currentBounds: DynamicEntitySummaryDto["bounds"]["currentBounds"];
	readonly indexed: boolean;
	readonly indexMembership: DynamicEntitySummaryDto["bounds"]["indexMembership"];
	readonly precision: DynamicEntitySummaryDto["bounds"]["precision"];
}

interface DynamicSelectionResourceDiagnostics {
	readonly required: readonly string[];
	readonly setupAnimation: DynamicSelectionSetupAnimationDiagnostics;
	readonly status: DynamicEntitySummaryDto["resources"]["status"];
	readonly visual: DynamicSelectionVisualDiagnostics;
}

type DynamicSelectionSetupAnimationDiagnostics =
	DynamicEntitySummaryDto["resources"]["setupAnimation"];

type DynamicSelectionVisualDiagnostics =
	| {
			readonly status: "blocked" | "pending";
	  }
	| {
			readonly materialSlotCount: number;
			readonly renderPartCount: number;
			readonly sourceAssetCount: number;
			readonly status: "ready";
			readonly textureRequirementCount: number;
	  }
	| {
			readonly failureCount: number;
			readonly missingRefCount: number;
			readonly status: "failed";
			readonly unsupportedReasonCount: number;
	  };

interface DynamicSelectionRendererIdentityDiagnostics {
	readonly eligible: boolean;
	readonly instanceId: string;
	readonly visualResourceId: string;
}

interface DynamicSelectionRendererDiagnostics {
	readonly dynamicInstances: number;
	readonly dynamicVisualResources: number;
	readonly dynamicVisualResourceTextureUses: number;
	readonly skippedDynamicSubmissions: number;
}

type StaticSelectionDiagnosticsDetails =
	| {
			readonly kind: "outdoor-static-object";
			readonly detail: OutdoorStaticObjectSelectionDetails;
	  }
	| {
			readonly kind: "env-cell-static-object";
			readonly detail: EnvCellStaticScenePickDetails;
	  }
	| {
			readonly kind: "env-cell-portal";
			readonly detail: EnvCellPortalSelectionDetails;
	  }
	| {
			readonly kind: "terrain-quad";
			readonly detail: TerrainQuadScenePickDetails;
	  };

type EnvCellPortalSelectionDetails = EnvCellPortalScenePickDetails;

interface OutdoorStaticObjectSelectionDetails {
	readonly bvhItemIndex: number;
	readonly bvhItemKind: "static" | "building";
	readonly domain: OutdoorStaticObjectScenePickDetails["domain"];
	readonly instanceId: string;
	readonly landblockId: number;
	readonly object: StaticSelectionObjectSummary;
}

interface StaticSelectionObjectSummary {
	readonly instanceId: string;
	readonly objectKind: "explicit-object" | "building" | "generated-scenery";
	readonly portalCount: number;
	readonly source: StaticObjectSourceSummary;
	readonly sourceAssetId: string | null;
	readonly sourceIndex: number;
}

interface StaticObjectSourceSummary {
	readonly sourceAssetKind: StaticObjectSourceIdentity["sourceAssetKind"];
	readonly sourceDid: number;
}

type StaticSelectionRenderingDiagnostics =
	| OutdoorStaticSelectionRenderingDiagnostics
	| UnsupportedStaticSelectionRenderingDiagnostics;

interface OutdoorStaticSelectionRenderingDiagnostics {
	readonly kind: "outdoor-static-object-rendering";
	readonly drawUnits: readonly StaticSelectionDrawUnitDiagnostics[];
	readonly partCoverage: readonly StaticSelectionPartCoverageDiagnostics[];
	readonly source: OutdoorStaticObjectSourceDiagnosticsSummary | null;
	readonly unmatchedReason: string | null;
}

interface UnsupportedStaticSelectionRenderingDiagnostics {
	readonly kind: "unsupported-static-selection-rendering";
	readonly reason: string;
}

interface StaticSelectionDrawUnitDiagnostics {
	readonly drawUnitId: string;
	readonly sourceDrawUnitId: string | null;
	readonly domain: StaticObjectGeometryStaticDrawUnit["domain"];
	readonly materialEntryCount: number;
	readonly materialEntries: readonly StaticSelectionDrawUnitMaterialEntryDiagnostics[];
	readonly materialFamily: StaticObjectGeometryStaticDrawUnit["materialFamily"];
	readonly materialIds: readonly number[];
	readonly materialPass: StaticObjectGeometryStaticDrawUnit["materialPass"];
	readonly sourceMapping: StaticSelectionSourceMappingSummaryDiagnostics;
	readonly textureUseCount: number;
	readonly triangleCount: number;
	readonly vertexCount: number;
}

interface StaticSelectionDrawUnitMaterialEntryDiagnostics {
	readonly alphaTest: number;
	readonly blendMode: string;
	readonly indexTextureDid: string | null;
	readonly materialIds: readonly number[];
	readonly paletteDid: string | null;
	readonly primaryTextureDid: string | null;
	readonly slot: number;
	readonly wrapMode: "clamp" | "repeat";
}

interface StaticSelectionSourceMappingSummaryDiagnostics {
	readonly geometrySurfaceIds: readonly number[];
	readonly materialVariantSignatures: readonly (string | null)[];
	readonly partIndices: readonly number[];
	readonly polygonCount: number;
	readonly polygonRange: StaticSelectionNumericRange | null;
	readonly sourceTriangleCount: number;
}

interface StaticSelectionNumericRange {
	readonly max: number;
	readonly min: number;
}

interface StaticSelectionPartCoverageDiagnostics {
	readonly drawUnitIds: readonly string[];
	readonly materialIds: readonly number[];
	readonly partIndex: number;
	readonly polygonCount: number;
	readonly polygonRange: StaticSelectionNumericRange | null;
	readonly sourceTriangleCount: number;
}

interface OutdoorStaticObjectSourceDiagnosticsSummary {
	readonly domain: OutdoorStaticObjectSourceDiagnostics["domain"];
	readonly instanceId: string;
	readonly landblockId: number;
	readonly materialIds: readonly number[];
	readonly materialSlots: readonly StaticSelectionMaterialSlotDiagnostics[];
	readonly object: StaticSelectionObjectSummary;
	readonly sourceAsset: StaticSelectionSourceAssetDiagnostics | null;
	readonly textureRefs: StaticSelectionTextureRefSummary;
}

interface StaticSelectionMaterialSlotDiagnostics {
	readonly diffuse: number | null;
	readonly geometrySurfaceId: number;
	readonly luminosity: number | null;
	readonly materialId: number;
	readonly materialSurfaceId: number;
	readonly materialVariantSignature: string | null;
	readonly partIndex: number;
	readonly slotIndex: number;
	readonly surfaceType: number | null;
	readonly translucency: number | null;
}

interface StaticSelectionSourceAssetDiagnostics {
	readonly identity: StaticObjectSourceSummary;
	readonly invalidPolygonCount: number;
	readonly materialSlotCount: number;
	readonly partCount: number;
	readonly parts: readonly StaticSelectionSourcePartDiagnostics[];
	readonly physicsPolygonCount: number;
	readonly renderTriangleCount: number;
	readonly skippedPolygonCount: number;
}

interface StaticSelectionSourcePartDiagnostics {
	readonly geometrySurfaceIds: readonly number[];
	readonly materialIds: readonly number[];
	readonly materialSlotCount: number;
	readonly partIndex: number;
	readonly physicsPolygonCount: number;
	readonly renderTriangleCount: number;
	readonly skippedPolygonCount: number;
}

interface StaticSelectionTextureRefSummary {
	readonly count: number;
	readonly paletteIds: readonly number[];
	readonly renderSurfaceIds: readonly number[];
	readonly surfaceTextureIds: readonly number[];
}

interface MatchedStaticSelectionDrawUnitDiagnostics {
	readonly diagnostics: StaticSelectionDrawUnitDiagnostics;
	readonly sourceMappingCoverage: readonly StaticObjectSourceMappingCoverage[];
}

type RuntimeEventListener = (event: RuntimeEvent) => void;
type RuntimeFrameTelemetryListener = (
	telemetry: RendererFrameTelemetry,
) => void;

interface RuntimeRenderPolicySnapshot {
	readonly textureFilteringMode: TextureFilteringMode;
}

interface StaticMaterializationSnapshot {
	readonly pendingRevisions: readonly number[];
	readonly committedRevisions: readonly number[];
	readonly envCellResourceMembershipRevision: number;
	readonly materializedDrawUnits: number;
	readonly sourceDrawUnits: number;
}

export interface ClientRuntime {
	updateSceneInterest(interest: RuntimeSceneInterest): void;
	queryCameraResidencyAtPoint(options: {
		readonly outdoorAnchorLandblockId: number;
		readonly point: Vec3;
	}): RuntimeCameraResidency;
	queryCameraResidencyAtLandblockPoint(options: {
		readonly landblockId: number;
		readonly point: Vec3;
	}): RuntimeCameraResidency;
	queryEnvCellBounds(options: {
		readonly envCellId: number;
		readonly landblockId: number;
	}): StaticSceneEnvCellBounds | null;
	queryTerrainLandblockBounds(options: {
		readonly landblockId: number;
	}): StaticSceneTerrainLandblockBounds | null;
	queryEnvCellResourceMembership(options: {
		readonly envCellId: number;
		readonly landblockId: number;
	}): EnvCellResourceMembership | null;
	setCurrentCameraResidency(residency: RuntimeCameraResidency): void;
	pickSceneRay(request: ScenePickRequest): ScenePickHit | null;
	createStaticSelectionDiagnosticsReport(
		selectionKey: StaticSceneSelectionKey,
		options?: { readonly pickDistance?: number | null },
	): StaticSelectionDiagnosticsReport;
	createDynamicSelectionDiagnosticsReport(
		entityId: DynamicEntityId,
		options?: { readonly pickDistance?: number | null },
	): DynamicSelectionDiagnosticsReport;
	setSceneDebugSelection(selection: RuntimeSceneDebugSelection | null): void;
	setEnvCellAabbDebugOverlayVisible(visible: boolean): void;
	setEnvCellPortalDebugOverlayVisible(visible: boolean): void;
	setDirectEnvCellPortalMaxDepth(maxDepth: number): void;
	setFlatVisionModeEnabled(enabled: boolean): void;
	setStaticLayerVisibility(visibility: RendererStaticLayerVisibility): void;
	setTextureFilteringMode(filteringMode: TextureFilteringMode): void;
	updateCameraState(camera: FrameState["camera"]): void;
	tickFrame(timeSeconds: number): void;
	createOverviewSnapshot(): RuntimeOverviewSnapshot;
	createDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot;
	createDiagnosticsReport(): RuntimeDiagnosticsReport;
	subscribeFrameTelemetry(listener: RuntimeFrameTelemetryListener): () => void;
	subscribeEvents(listener: RuntimeEventListener): () => void;
	dispose(): void;
}

/** Browser-selected scene identity whose current bounds should be rendered as a debug overlay. */
export type RuntimeSceneDebugSelection =
	| {
			readonly kind: "static";
			readonly selectionKey: StaticSceneSelectionKey;
	  }
	| {
			readonly entityId: DynamicEntityId;
			readonly kind: "dynamic";
	  };

export interface ClientRuntimeOptions {
	readonly renderer: Renderer;
	readonly host: RuntimeHost;
	readonly assetService?: AssetService;
	readonly assetMaintenanceIntervalMs?: number;
	readonly diagnostics?: RuntimeDiagnostics;
	readonly staticCoordinator?: StaticCoordinator;
	readonly texturePacker?: TexturePacker;
}

export function createClientRuntime(
	options: ClientRuntimeOptions,
): ClientRuntime {
	const staticCoordinator =
		options.staticCoordinator ??
		new StaticCoordinator({
			baker: new ImmediateStaticBaker(),
			resolver: new ImmediateStaticResolver(),
		});
	const assetService =
		options.assetService ?? new HostBackedAssetService({ host: options.host });

	return new ClientRuntimeImpl(
		options.renderer,
		options.host,
		assetService,
		staticCoordinator,
		options.texturePacker,
		options.assetMaintenanceIntervalMs ?? DEFAULT_ASSET_MAINTENANCE_INTERVAL_MS,
		options.diagnostics ?? createConsoleRuntimeDiagnostics(),
	);
}

class ClientRuntimeImpl implements ClientRuntime {
	readonly #renderer: Renderer;
	readonly #host: RuntimeHost;
	readonly #assetService: AssetService;
	readonly #diagnostics: RuntimeDiagnostics;
	readonly #textureManager: TextureManager;
	readonly #staticCoordinator: StaticCoordinator;
	readonly #staticSceneQuery = new StaticSceneQuery();
	readonly #frameTelemetryListeners = new Set<RuntimeFrameTelemetryListener>();
	readonly #eventListeners = new Set<RuntimeEventListener>();
	readonly #unsubscribeRendererTelemetry: () => void;
	readonly #unsubscribeStaticCoordinator: () => void;
	readonly #unsubscribeStaticCommits: () => void;
	readonly #unsubscribeStaticSourcePayloads: () => void;
	readonly #assetMaintenanceIntervalId: ReturnType<
		typeof globalThis.setInterval
	>;
	#lastRendererSnapshot: RendererSnapshot;
	#lastStaticSnapshot: StaticCoordinatorSnapshot;
	#currentRenderPassPlan: RenderPassPlan = { kind: "single-surface-resident" };
	#currentPortalFrameWorkPlan: PortalFrameWorkPlan =
		createLegacyPortalFrameWorkPlan({
			flatVisionModeEnabled: false,
			renderPassPlan: { kind: "single-surface-resident" },
		});
	#cachedPortalFramePlan: CachedPortalFramePlan | null = null;
	#sceneInterest: RuntimeSceneInterest = { kind: "none" };
	#sceneInterestRevision = 0;
	#settledSceneInterestRevision = 0;
	#activeSceneWorkIds = new Set<string>();
	#activeSceneWorkRevisions = new Set<number>();
	#sceneInterestReconciliationActive = false;
	#currentCameraResidency: RuntimeCameraResidency = {
		kind: "unknown",
		landblockId: null,
	};
	#currentPortalOverlapResidency: RuntimePortalOverlapResidency =
		EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY;
	#lastFrameState: FrameState | null = null;
	#renderAnchorLandblockId: number | null = null;
	#staticMaterializationQueue: Promise<void> = Promise.resolve();
	#pendingStaticMaterializations = new Set<number>();
	#committedStaticMaterializations: number[] = [];
	readonly #failedStaticMaterializationRevisions = new Set<number>();
	#materializedDrawUnitIdsBySourceDrawUnitId = new Map<
		string,
		readonly string[]
	>();
	readonly #materializedDrawUnitsById = new Map<string, StaticDrawUnit>();
	#recentTerrainTextureFallbacks: TerrainTextureFallbackDiagnostics[] = [];
	#sceneDebugSelection: RuntimeSceneDebugSelection | null = null;
	#envCellResourceMembership: readonly EnvCellResourceMembership[] = [];
	#envCellResourceMembershipByLandblock = createEnvCellResourceMembershipIndex(
		this.#envCellResourceMembership,
	);
	readonly #envCellSystemLayerAssembly = new EnvCellSystemLayerAssemblyStore();
	readonly #staticLayersByKey = new Map<string, StaticLandblockLayerPayload>();
	readonly #staticLayerKeyByResourceId = new Map<string, string>();
	readonly #staticBatchIdBySourceScope = new Map<string, string>();
	#envCellResourceMembershipRevision = 0;
	readonly #dynamicEntityController: DynamicEntityController;
	readonly #committedDynamicVisualResourceIds = new Set<string>();
	#dynamicRendererResourceQueue: Promise<void> = Promise.resolve();
	#dynamicRendererResourceRevision = 0;
	#envCellAabbDebugOverlayVisible = false;
	#envCellPortalDebugOverlayVisible = false;
	#flatVisionModeEnabled = false;
	#directEnvCellPortalMaxDepth = DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH;
	#disposed = false;

	constructor(
		renderer: Renderer,
		host: RuntimeHost,
		assetService: AssetService,
		staticCoordinator: StaticCoordinator,
		texturePacker: TexturePacker | undefined,
		assetMaintenanceIntervalMs: number,
		diagnostics: RuntimeDiagnostics,
	) {
		assertPositiveFiniteIntervalMs(
			assetMaintenanceIntervalMs,
			"asset maintenance interval",
		);
		this.#renderer = renderer;
		this.#host = host;
		this.#assetService = assetService;
		this.#diagnostics = diagnostics;
		this.#dynamicEntityController = new DynamicEntityController({
			onResourcesChanged: () => {
				if (!this.#disposed) {
					this.#enqueueDynamicRendererResourceSync();
				}
			},
			resourceManager: new DynamicEntityResourceManager({ assetService }),
		});
		this.#textureManager = new TextureManager({ assetService, texturePacker });
		this.#staticCoordinator = staticCoordinator;
		this.#staticCoordinator.setAtlasSnapshotProvider(
			(payloads, staticBatchId) =>
				this.#textureManager.createStaticAtlasBatchSnapshot(
					payloads,
					staticBatchId,
				),
		);
		this.#lastRendererSnapshot = renderer.createDiagnosticsSnapshot();
		this.#currentRenderPassPlan = this.#lastRendererSnapshot.renderPassPlan;
		this.#currentPortalFrameWorkPlan =
			this.#lastRendererSnapshot.portalFrameWorkPlan;
		this.#lastStaticSnapshot = staticCoordinator.createSnapshot();
		this.#unsubscribeRendererTelemetry = renderer.subscribeTelemetry(
			(telemetry) => {
				this.#emitFrameTelemetry(telemetry);
			},
		);
		this.#unsubscribeStaticCoordinator = staticCoordinator.subscribe(
			(snapshot) => {
				this.#lastStaticSnapshot = snapshot;
				this.#maybeEmitSceneInterestSettled();
			},
		);
		this.#unsubscribeStaticCommits = staticCoordinator.subscribeCommits(
			(delta) => {
				this.#enqueueStaticMaterialization(delta);
			},
		);
		this.#unsubscribeStaticSourcePayloads =
			staticCoordinator.subscribeSourcePayloads((delta) => {
				this.#applyEnvCellSystemLayerPublication(
					this.#envCellSystemLayerAssembly.ingestSourcePayload(delta),
				);
				this.#staticSceneQuery.ingestSourcePayload(delta.payload, {
					outdoorAnchorLandblockId: this.#renderAnchorLandblockId,
				});
				this.#refreshSceneDebugOverlay();
			});
		this.#assetMaintenanceIntervalId = globalThis.setInterval(() => {
			this.#pruneExpiredWarmAssets();
		}, assetMaintenanceIntervalMs);
		unrefTimerIfAvailable(this.#assetMaintenanceIntervalId);
	}

	updateSceneInterest(interest: RuntimeSceneInterest): void {
		this.#assertActive();
		this.#sceneInterest = normalizeSceneInterest(interest);
		this.#sceneInterestRevision += 1;
		this.#emitRuntimeEvent({
			interest: this.#sceneInterest,
			kind: "scene-interest-updated",
			revision: this.#sceneInterestRevision,
			source: getSceneInterestSource(this.#sceneInterest),
		});
		const nextAnchor =
			this.#sceneInterest.kind === "outdoor-anchor"
				? normalizeOutdoorLandblockId(this.#sceneInterest.anchorLandblockId)
				: null;
		this.#setRenderAnchorLandblockId(nextAnchor);
		this.#sceneInterestReconciliationActive = true;
		let reconciliation: StaticRetentionReconciliation;
		try {
			reconciliation = this.#reconcileStaticRetention(this.#sceneInterest);
			this.#dynamicEntityController.retainStaticScopes(
				reconciliation.retainedScopes,
			);
			this.#enqueueDynamicRendererResourceSync();
			this.#activeSceneWorkIds = new Set(
				reconciliation.activeWork.map((work) => work.workId),
			);
			this.#activeSceneWorkRevisions = new Set(
				reconciliation.activeWork.map((work) => work.revision),
			);
		} finally {
			this.#sceneInterestReconciliationActive = false;
		}
		this.#refreshSceneDebugOverlay();
		this.#maybeEmitSceneInterestSettled();
	}

	queryCameraResidencyAtPoint(options: {
		readonly outdoorAnchorLandblockId: number;
		readonly point: Vec3;
	}): RuntimeCameraResidency {
		this.#assertActive();
		return this.#staticSceneQuery.queryCameraResidencyAtPoint(options);
	}

	queryCameraResidencyAtLandblockPoint(options: {
		readonly landblockId: number;
		readonly point: Vec3;
	}): RuntimeCameraResidency {
		this.#assertActive();
		return this.#staticSceneQuery.queryCameraResidencyAtLandblockPoint(options);
	}

	queryEnvCellBounds(options: {
		readonly envCellId: number;
		readonly landblockId: number;
	}): StaticSceneEnvCellBounds | null {
		this.#assertActive();
		return this.#staticSceneQuery.queryEnvCellBounds(options);
	}

	queryTerrainLandblockBounds(options: {
		readonly landblockId: number;
	}): StaticSceneTerrainLandblockBounds | null {
		this.#assertActive();
		return this.#staticSceneQuery.queryTerrainLandblockBounds(options);
	}

	queryEnvCellResourceMembership(options: {
		readonly envCellId: number;
		readonly landblockId: number;
	}): EnvCellResourceMembership | null {
		this.#assertActive();
		return (
			this.#envCellResourceMembershipByLandblock
				.get(options.landblockId)
				?.get(options.envCellId) ?? null
		);
	}

	setCurrentCameraResidency(residency: RuntimeCameraResidency): void {
		this.#assertActive();
		const normalized = normalizeCameraResidency(residency);
		if (cameraResidencyEquals(this.#currentCameraResidency, normalized)) {
			return;
		}

		this.#currentCameraResidency = normalized;
		this.#refreshPortalOverlapResidency();
		this.#updateRenderPassPlan();
		this.#refreshSceneDebugOverlay();
	}

	pickSceneRay(request: ScenePickRequest): ScenePickHit | null {
		this.#assertActive();
		return pickMergedSceneRay(
			{
				outdoorAnchorLandblockId: this.#renderAnchorLandblockId,
				pickStaticSceneRay: (staticRequest) =>
					this.#staticSceneQuery.pickRay({
						...staticRequest,
						filters: {
							...staticRequest.filters,
							includeEnvCellPortals: this.#envCellPortalDebugOverlayVisible,
						},
					}),
				queryOutdoorDynamicBounds: (options) =>
					this.#dynamicEntityController.queryOutdoorDynamicBounds(options),
				queryOutdoorDynamicLandblockIds: () =>
					this.#dynamicEntityController.queryOutdoorDynamicLandblockIds(),
				queryEnvCellDynamicBounds: (options) =>
					this.#dynamicEntityController.queryEnvCellDynamicBounds(options),
			},
			request,
		);
	}

	createStaticSelectionDiagnosticsReport(
		selectionKey: StaticSceneSelectionKey,
		options: { readonly pickDistance?: number | null } = {},
	): StaticSelectionDiagnosticsReport {
		this.#assertActive();
		const label = describeStaticSceneSelectionKey(selectionKey);
		const debugBounds =
			this.#queryStaticSelectionDebugBounds(selectionKey)?.bounds ?? null;

		return {
			debugBounds,
			details: this.#queryStaticSelectionDiagnosticsDetails(selectionKey),
			kind: "static-selection-diagnostics-report",
			rendering: this.#queryStaticSelectionRenderingDiagnostics(selectionKey),
			runtime: {
				renderAnchorLandblockId: this.#renderAnchorLandblockId,
				sceneInterest: createSceneInterestSummary(this.#sceneInterest),
				staticSceneQuery: this.#staticSceneQuery.createSnapshot(),
			},
			selection: {
				key: selectionKey,
				label,
				pickDistance: options.pickDistance ?? null,
			},
		};
	}

	createDynamicSelectionDiagnosticsReport(
		entityId: DynamicEntityId,
		options: { readonly pickDistance?: number | null } = {},
	): DynamicSelectionDiagnosticsReport {
		this.#assertActive();
		const entity =
			this.#dynamicEntityController.queryDynamicEntitySummary(entityId);
		const debugBounds =
			this.#querySceneSelectionDebugBounds({
				entityId,
				kind: "dynamic",
			})?.bounds ?? null;
		const rendererSnapshot = this.#refreshRendererDiagnosticsSnapshot();

		return {
			debugBounds,
			entity:
				entity === null
					? null
					: createDynamicSelectionEntityDiagnostics(entity),
			kind: "dynamic-selection-diagnostics-report",
			renderer: createDynamicSelectionRendererDiagnostics(rendererSnapshot),
			runtime: {
				renderAnchorLandblockId: this.#renderAnchorLandblockId,
				sceneInterest: createSceneInterestSummary(this.#sceneInterest),
			},
			selection: {
				entityId,
				pickDistance: options.pickDistance ?? null,
			},
		};
	}

	setSceneDebugSelection(selection: RuntimeSceneDebugSelection | null): void {
		this.#assertActive();
		this.#sceneDebugSelection = selection;
		this.#refreshSceneDebugOverlay();
	}

	setEnvCellAabbDebugOverlayVisible(visible: boolean): void {
		this.#assertActive();
		if (this.#envCellAabbDebugOverlayVisible === visible) {
			return;
		}
		this.#envCellAabbDebugOverlayVisible = visible;
		this.#refreshSceneDebugOverlay();
	}

	setEnvCellPortalDebugOverlayVisible(visible: boolean): void {
		this.#assertActive();
		if (this.#envCellPortalDebugOverlayVisible === visible) {
			return;
		}
		this.#envCellPortalDebugOverlayVisible = visible;
		this.#refreshSceneDebugOverlay();
	}

	setDirectEnvCellPortalMaxDepth(maxDepth: number): void {
		this.#assertActive();
		const normalizedMaxDepth = normalizeDirectEnvCellPortalMaxDepth(maxDepth);
		if (this.#directEnvCellPortalMaxDepth === normalizedMaxDepth) {
			return;
		}
		this.#directEnvCellPortalMaxDepth = normalizedMaxDepth;
		this.#updateRenderPassPlan();
	}

	setFlatVisionModeEnabled(enabled: boolean): void {
		this.#assertActive();
		if (this.#flatVisionModeEnabled === enabled) {
			return;
		}
		this.#flatVisionModeEnabled = enabled;
		this.#renderer.setFlatVisionModeEnabled(enabled);
		this.#updateRenderPassPlan();
	}

	setStaticLayerVisibility(visibility: RendererStaticLayerVisibility): void {
		this.#assertActive();
		this.#renderer.setStaticLayerVisibility(visibility);
	}

	setTextureFilteringMode(filteringMode: TextureFilteringMode): void {
		this.#assertActive();
		const samplerUpdate = this.#textureManager.setFilteringMode(filteringMode);
		if (samplerUpdate) {
			this.#renderer.applySamplerPolicyUpdate(samplerUpdate);
		}
	}

	updateCameraState(camera: FrameState["camera"]): void {
		this.#assertActive();
		const state: FrameState = {
			camera,
			timeSeconds: this.#lastFrameState?.timeSeconds ?? 0,
		};
		this.#lastFrameState = state;
		this.#renderer.updateFrameState(state);
		const portalOverlapChanged = this.#refreshPortalOverlapResidency();
		if (portalOverlapChanged) {
			this.#updateRenderPassPlan();
		}
	}

	tickFrame(timeSeconds: number): void {
		this.#assertActive();
		if (this.#lastFrameState !== null) {
			this.#lastFrameState = {
				...this.#lastFrameState,
				timeSeconds,
			};
			this.#renderer.updateFrameState(this.#lastFrameState);
		}
		const dynamicPlaybackChanged = this.#dynamicEntityController.tick(
			timeSeconds,
			{
				animationCadenceContext:
					this.#lastFrameState === null
						? null
						: {
								cameraPosition: this.#lastFrameState.camera.position,
								renderAnchorLandblockId: this.#renderAnchorLandblockId,
							},
			},
		);
		if (dynamicPlaybackChanged) {
			this.#commitDynamicRendererInstances(timeSeconds);
		}
		if (dynamicPlaybackChanged) {
			this.#refreshSceneDebugOverlay();
		}
		const portalOverlapChanged = this.#refreshPortalOverlapResidency();
		if (portalOverlapChanged) {
			this.#updateRenderPassPlan();
		}
	}

	createDiagnosticsReport(): RuntimeDiagnosticsReport {
		const snapshot = this.createDiagnosticsSnapshot();

		return {
			domains: [
				createAssetServiceDiagnosticsReport(snapshot.assets),
				createDynamicDiagnosticsReport(snapshot.dynamic),
				{
					kind: "renderer",
					summary: createRendererDiagnosticsSummary(snapshot.renderer),
				},
				{
					kind: "static-coordinator",
					...createStaticCoordinatorDiagnosticsReport(this.#lastStaticSnapshot),
				},
				this.#textureManager.createDiagnosticsReport(),
				createTerrainTextureDiagnosticsReport(
					this.#recentTerrainTextureFallbacks,
				),
			],
			kind: "runtime-diagnostics-report",
			runtime: {
				committedStaticMaterializationCount:
					snapshot.staticMaterialization.committedRevisions.length,
				envCellResourceMembershipRevision:
					snapshot.staticMaterialization.envCellResourceMembershipRevision,
				portalFrameWorkPlan: createPortalFrameWorkPlanDiagnostics(
					snapshot.portalFrameWorkPlan,
				),
				renderPassKind: snapshot.renderPassPlan.kind,
				sceneInterest: createSceneInterestSummary(snapshot.sceneInterest),
				materializedStaticDrawUnits:
					snapshot.staticMaterialization.materializedDrawUnits,
				pendingStaticMaterializationCount:
					snapshot.staticMaterialization.pendingRevisions.length,
				sourceStaticDrawUnits: snapshot.staticMaterialization.sourceDrawUnits,
				status: snapshot.status,
				textureFilteringMode: snapshot.renderPolicy.textureFilteringMode,
			},
		};
	}

	subscribeFrameTelemetry(listener: RuntimeFrameTelemetryListener): () => void {
		this.#frameTelemetryListeners.add(listener);

		return () => {
			this.#frameTelemetryListeners.delete(listener);
		};
	}

	subscribeEvents(listener: RuntimeEventListener): () => void {
		this.#eventListeners.add(listener);

		return () => {
			this.#eventListeners.delete(listener);
		};
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		this.#unsubscribeRendererTelemetry();
		this.#unsubscribeStaticCoordinator();
		this.#unsubscribeStaticCommits();
		this.#unsubscribeStaticSourcePayloads();
		globalThis.clearInterval(this.#assetMaintenanceIntervalId);
		this.#renderer.setDebugOverlayPrimitives([]);
		this.#staticCoordinator.dispose();
		this.#dynamicEntityController.dispose();
		this.#textureManager.dispose();
		this.#renderer.dispose();
		this.#frameTelemetryListeners.clear();
		this.#eventListeners.clear();
	}

	#assertActive(): void {
		if (this.#disposed) {
			throw new Error("ClientRuntime has been disposed.");
		}
	}

	#setRenderAnchorLandblockId(nextAnchorLandblockId: number | null): void {
		if (this.#renderAnchorLandblockId === nextAnchorLandblockId) {
			return;
		}

		this.#renderAnchorLandblockId = nextAnchorLandblockId;
		this.#staticSceneQuery.setOutdoorAnchorLandblockId(nextAnchorLandblockId);
		this.#renderer.setStaticRenderAnchorLandblockId(nextAnchorLandblockId);
		this.#updateRenderPassPlan();
		this.#refreshSceneDebugOverlay();
	}

	#reconcileStaticRetention(
		interest: RuntimeSceneInterest,
	): StaticRetentionReconciliation {
		const reconciliation = this.#staticCoordinator.reconcileStaticDemand(
			createStaticDemandFromSceneInterest(interest),
		);
		this.#staticSceneQuery.retainScopes(reconciliation.retainedScopes);
		this.#updateRenderPassPlan();
		return reconciliation;
	}

	#updateRenderPassPlan(): boolean {
		this.#refreshPortalOverlapResidency();
		const plan = this.#flatVisionModeEnabled
			? ({ kind: "single-surface-resident" } satisfies RenderPassPlan)
			: this.#deriveRenderPassPlan();
		let changed = false;
		if (!renderPassPlanEquals(this.#currentRenderPassPlan, plan)) {
			this.#renderer.setRenderPassPlan(plan);
			this.#currentRenderPassPlan = plan;
			changed = true;
		}

		const portalFrameWorkPlan = this.#derivePortalFrameWorkPlan(plan);
		if (portalFrameWorkPlan === this.#currentPortalFrameWorkPlan) {
			return changed;
		}
		if (
			!portalFrameWorkPlanEquals(
				this.#currentPortalFrameWorkPlan,
				portalFrameWorkPlan,
			)
		) {
			this.#renderer.setPortalFrameWorkPlan(portalFrameWorkPlan);
			this.#currentPortalFrameWorkPlan = portalFrameWorkPlan;
			changed = true;
		}

		return changed;
	}

	#derivePortalFrameWorkPlan(
		renderPassPlan: RenderPassPlan,
	): PortalFrameWorkPlan {
		if (
			!this.#flatVisionModeEnabled &&
			this.#currentCameraResidency.kind === "env-cell" &&
			this.#staticSceneQuery.hasCommittedPortalInteriorScene({
				landblockId: this.#currentCameraResidency.landblockId,
			})
		) {
			const landblockId = this.#currentCameraResidency.landblockId;
			const projection = this.#staticSceneQuery.queryEnvCellPortalProjection({
				landblockId,
				startEnvCellId: this.#currentCameraResidency.envCellId,
			});
			if (projection) {
				const baseDirectPlan = createPortalProjectionFramePlan({
					landblockId,
					envCellResourceMembership: this.#envCellResourceMembership,
					maxRenderEntries: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_CELLS,
					maxDepth: this.#directEnvCellPortalMaxDepth,
					maxMaskEdges: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_VIEWS,
					portalOverlap: this.#currentPortalOverlapResidency,
					projection,
				});
				if (baseDirectPlan?.kind === "direct-env-cell") {
					const exteriorSuffix =
						baseDirectPlan.layeredGraph.outdoorCrossings.length > 0
							? this.#deriveRetainedOutdoorPortalFramePlan(landblockId)
							: null;
					const exteriorSuffixMaxDepth =
						exteriorSuffix === null ? 0 : DEFAULT_EXTERIOR_SUFFIX_MAX_DEPTH;
					const portalFramePlanKey: PortalFramePlanKey = {
						envCellId: this.#currentCameraResidency.envCellId,
						envCellSystemGenerationId:
							this.#getEnvCellSystemLayerGenerationId(landblockId),
						exteriorSuffixMaxDepth,
						kind: "env-cell-projection",
						landblockId,
						maxRenderEntries: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_CELLS,
						maxDepth: this.#directEnvCellPortalMaxDepth,
						maxMaskEdges: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_VIEWS,
						portalOverlapSignature:
							this.#currentPortalOverlapResidency.signature,
						retainedProjectionSourceKey: exteriorSuffix?.sourceKey ?? null,
						renderAnchorLandblockId: this.#renderAnchorLandblockId,
					};
					const cachedPlan = this.#getCachedPortalFramePlan(portalFramePlanKey);
					if (cachedPlan) {
						return cachedPlan;
					}
					const directPlan =
						exteriorSuffix === null
							? baseDirectPlan
							: {
									...baseDirectPlan,
									exteriorComposite: {
										graphs: [
											excludePortalProjectionGraphEnvCells(
												exteriorSuffix.plan.layeredGraph,
												collectDirectEnvCellFrameEnvCellIds(
													baseDirectPlan.layeredGraph,
												),
											),
										],
										maxDepth: exteriorSuffixMaxDepth,
									},
								};
					return this.#setCachedPortalFramePlan(portalFramePlanKey, directPlan);
				}
			}
		}
		if (
			!this.#flatVisionModeEnabled &&
			this.#currentCameraResidency.kind === "outdoor-landblock"
		) {
			const landblockId = this.#currentCameraResidency.landblockId;
			const retainedPlan = this.#deriveRetainedOutdoorPortalFramePlan(
				landblockId,
				this.#currentPortalOverlapResidency,
			);
			if (retainedPlan) {
				const portalFramePlanKey: PortalFramePlanKey = {
					kind: "outdoor-transition",
					landblockId,
					maxRenderEntries: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_CELLS,
					maxDepth: this.#directEnvCellPortalMaxDepth,
					maxMaskEdges: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_VIEWS,
					portalOverlapSignature: this.#currentPortalOverlapResidency.signature,
					retainedProjectionSourceKey: retainedPlan.sourceKey,
					renderAnchorLandblockId: this.#renderAnchorLandblockId,
				};
				const cachedPlan = this.#getCachedPortalFramePlan(portalFramePlanKey);
				if (cachedPlan) {
					return cachedPlan;
				}
				return this.#setCachedPortalFramePlan(
					portalFramePlanKey,
					retainedPlan.plan,
				);
			}
		}

		this.#cachedPortalFramePlan = null;
		return createLegacyPortalFrameWorkPlan({
			flatVisionModeEnabled: this.#flatVisionModeEnabled,
			renderPassPlan,
		});
	}

	#refreshPortalOverlapResidency(): boolean {
		const next = this.#derivePortalOverlapResidency();
		if (
			portalOverlapResidencyEquals(this.#currentPortalOverlapResidency, next)
		) {
			return false;
		}
		this.#currentPortalOverlapResidency = next;
		return true;
	}

	#derivePortalOverlapResidency(): RuntimePortalOverlapResidency {
		if (this.#lastFrameState === null) {
			return EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY;
		}
		if (this.#currentCameraResidency.kind === "env-cell") {
			const landblockId = this.#currentCameraResidency.landblockId;
			const projection = this.#staticSceneQuery.queryEnvCellPortalProjection({
				landblockId,
				startEnvCellId: this.#currentCameraResidency.envCellId,
			});
			if (projection === null) {
				return EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY;
			}
			return deriveRuntimePortalOverlapResidency({
				aperturePadding: DEFAULT_PORTAL_BASE_OVERLAP_APERTURE_PADDING,
				envCellResourceMembership: this.#envCellResourceMembership,
				frameState: this.#lastFrameState,
				planeEpsilon: DEFAULT_PORTAL_BASE_OVERLAP_PLANE_EPSILON,
				portalApertureResources:
					this.#staticSceneQuery.queryPortalApertureResources({ landblockId }),
				projection,
				renderAnchorLandblockId: this.#renderAnchorLandblockId,
				residency: this.#currentCameraResidency,
			});
		}
		if (this.#currentCameraResidency.kind === "outdoor-landblock") {
			const landblockId = this.#currentCameraResidency.landblockId;
			const projection = this.#staticSceneQuery.queryOutdoorPortalProjection({
				landblockId,
			});
			if (projection === null) {
				return EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY;
			}
			return deriveRuntimePortalOverlapResidency({
				aperturePadding: DEFAULT_PORTAL_BASE_OVERLAP_APERTURE_PADDING,
				envCellResourceMembership: this.#envCellResourceMembership,
				frameState: this.#lastFrameState,
				planeEpsilon: DEFAULT_PORTAL_BASE_OVERLAP_PLANE_EPSILON,
				portalApertureResources:
					this.#staticSceneQuery.queryPortalApertureResources({ landblockId }),
				projection,
				renderAnchorLandblockId: this.#renderAnchorLandblockId,
				residency: this.#currentCameraResidency,
			});
		}
		return EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY;
	}

	#deriveRetainedOutdoorPortalFramePlan(
		seedLandblockId: number,
		portalOverlap: RuntimePortalOverlapResidency = EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY,
	): RetainedOutdoorPortalFramePlan | null {
		const retainedOutdoorSourceLandblockIds = this.#staticSceneQuery
			.queryRetainedOutdoorSourceLandblocks()
			.filter((source) => source.domains.buildings && source.domains.envCells)
			.map((source) => source.landblockId);
		const projections =
			this.#staticSceneQuery.queryRetainedOutdoorPortalProjections([
				seedLandblockId,
				...retainedOutdoorSourceLandblockIds,
			]);
		if (projections.length === 0) {
			return null;
		}
		const plan = combineOutdoorPortalProjectionFramePlans(
			projections.flatMap((projection) => {
				const projectionPlan = createPortalProjectionFramePlan({
					landblockId: projection.landblockId,
					envCellResourceMembership: this.#envCellResourceMembership,
					maxRenderEntries: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_CELLS,
					maxDepth: this.#directEnvCellPortalMaxDepth,
					maxMaskEdges: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_VIEWS,
					portalOverlap:
						projection.landblockId === seedLandblockId
							? portalOverlap
							: EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY,
					projection,
				});
				return projectionPlan ? [projectionPlan] : [];
			}),
		);
		if (plan?.kind !== "direct-env-cell") {
			return null;
		}
		return {
			plan,
			sourceKey: createRetainedOutdoorProjectionSourceKey(projections),
		};
	}

	#getCachedPortalFramePlan(
		key: PortalFramePlanKey,
	): PortalFrameWorkPlan | null {
		return this.#cachedPortalFramePlan &&
			portalFramePlanKeysEqual(this.#cachedPortalFramePlan.key, key)
			? this.#cachedPortalFramePlan.plan
			: null;
	}

	#setCachedPortalFramePlan(
		key: PortalFramePlanKey,
		plan: PortalFrameWorkPlan,
	): PortalFrameWorkPlan {
		this.#cachedPortalFramePlan = { key, plan };
		return plan;
	}

	#deriveRenderPassPlan(): RenderPassPlan {
		const plan = deriveRenderPassPlan(
			this.#currentCameraResidency,
			this.#renderAnchorLandblockId,
			(landblockId) =>
				this.#staticSceneQuery.hasCommittedPortalInteriorScene({
					landblockId,
				}),
		);
		return plan;
	}

	#refreshRendererDiagnosticsSnapshot(): RendererSnapshot {
		this.#lastRendererSnapshot = this.#renderer.createDiagnosticsSnapshot();
		return this.#lastRendererSnapshot;
	}

	createOverviewSnapshot(): RuntimeOverviewSnapshot {
		const staticOverview = this.#staticCoordinator.createOverviewSnapshot();
		return {
			assets: this.#assetService.createOverviewSnapshot(),
			currentCameraResidency: this.#currentCameraResidency,
			currentPortalOverlapResidency: this.#currentPortalOverlapResidency,
			debugOverlays: this.#createDebugOverlaySnapshot(),
			portalFrameWorkPlan: this.#currentPortalFrameWorkPlan,
			renderPolicy: {
				textureFilteringMode: this.#textureManager.filteringMode,
			},
			sceneInterest: this.#sceneInterest,
			static: staticOverview,
			staticSceneQuery: this.#staticSceneQuery.createOverviewSnapshot(),
			status: this.#createRuntimeStatus(staticOverview.requested),
		};
	}

	createDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
		const rendererSnapshot = this.#refreshRendererDiagnosticsSnapshot();
		return {
			assets: this.#assetService.createSnapshot(),
			currentCameraResidency: this.#currentCameraResidency,
			currentPortalOverlapResidency: this.#currentPortalOverlapResidency,
			debugOverlays: this.#createDebugOverlaySnapshot(),
			dynamic: this.#dynamicEntityController.createSnapshot(),
			host: this.#host.createSnapshot(),
			portalFrameWorkPlan: this.#currentPortalFrameWorkPlan,
			renderPassPlan: this.#currentRenderPassPlan,
			renderPolicy: {
				textureFilteringMode: this.#textureManager.filteringMode,
			},
			renderer: rendererSnapshot,
			sceneInterest: this.#sceneInterest,
			static: this.#lastStaticSnapshot,
			staticSceneQuery: this.#staticSceneQuery.createSnapshot(),
			staticMaterialization: {
				committedRevisions: this.#committedStaticMaterializations,
				envCellResourceMembershipRevision:
					this.#envCellResourceMembershipRevision,
				materializedDrawUnits: countMaterializedDrawUnits(
					this.#materializedDrawUnitIdsBySourceDrawUnitId,
				),
				pendingRevisions: Array.from(this.#pendingStaticMaterializations).sort(
					(a, b) => a - b,
				),
				sourceDrawUnits: this.#materializedDrawUnitIdsBySourceDrawUnitId.size,
			},
			status: this.#createRuntimeStatus(this.#lastStaticSnapshot.requested),
		};
	}

	#createDebugOverlaySnapshot(): RuntimeDebugOverlaySnapshot {
		return {
			envCellAabbCount: this.#envCellAabbDebugOverlayVisible
				? this.#staticSceneQuery.queryEnvCellAabbDebugBounds().length
				: 0,
			envCellAabbsVisible: this.#envCellAabbDebugOverlayVisible,
			flatVisionModeEnabled: this.#flatVisionModeEnabled,
			portalCount: this.#envCellPortalDebugOverlayVisible
				? countEnvCellPortalApertures(
						this.#staticSceneQuery.queryPortalInteriorRecords(),
					) +
					countBuildingTransitionApertures(
						this.#staticSceneQuery.queryEnvCellSystemLayers(),
					)
				: 0,
			portalsVisible: this.#envCellPortalDebugOverlayVisible,
		};
	}

	#createRuntimeStatus(
		requestedStaticWorkCount: number,
	): RuntimeDiagnosticsSnapshot["status"] {
		return this.#disposed
			? "disposed"
			: requestedStaticWorkCount > 0
				? "static-active"
				: "idle";
	}

	#emitFrameTelemetry(telemetry: RendererFrameTelemetry): void {
		for (const listener of this.#frameTelemetryListeners) {
			listener(telemetry);
		}
	}

	#emitRuntimeEvent(event: RuntimeEvent): void {
		for (const listener of this.#eventListeners) {
			listener(event);
		}
	}

	#maybeEmitSceneInterestSettled(): void {
		if (
			this.#sceneInterestRevision === 0 ||
			this.#settledSceneInterestRevision === this.#sceneInterestRevision ||
			this.#sceneInterestReconciliationActive ||
			this.#pendingStaticMaterializations.size > 0
		) {
			return;
		}

		const source = getSceneInterestSource(this.#sceneInterest);
		if (this.#sceneInterest.kind === "none") {
			this.#emitSceneInterestSettled({
				result: "cleared",
				source,
			});
			return;
		}

		const sceneWork = this.#lastStaticSnapshot.activeWork.filter((work) =>
			this.#activeSceneWorkIds.has(work.workId),
		);
		if (sceneWork.length !== this.#activeSceneWorkIds.size) {
			return;
		}

		const unsettledWork = sceneWork.filter(
			(work) => work.status !== "committed" && work.status !== "failed",
		);
		if (unsettledWork.length > 0) {
			return;
		}

		const failedWork = sceneWork.filter((work) => work.status === "failed");
		const failedMaterialization = Array.from(
			this.#failedStaticMaterializationRevisions,
		).some((revision) => this.#activeSceneWorkRevisions.has(revision));
		this.#emitSceneInterestSettled({
			result:
				failedWork.length > 0 || failedMaterialization ? "failed" : "ready",
			source,
		});
	}

	#emitSceneInterestSettled(options: {
		readonly result: RuntimeSceneInterestSettledEvent["result"];
		readonly source: RuntimeSceneInterestSource;
	}): void {
		this.#settledSceneInterestRevision = this.#sceneInterestRevision;
		this.#emitRuntimeEvent({
			interest: this.#sceneInterest,
			kind: "scene-interest-settled",
			result: options.result,
			revision: this.#sceneInterestRevision,
			source: options.source,
		});
	}

	#pruneExpiredWarmAssets(): void {
		if (this.#disposed) {
			return;
		}

		this.#assetService.pruneExpiredWarmAssets();
	}

	#enqueueStaticMaterialization(delta: StaticCoordinatorCommitDelta): void {
		this.#warnAboutDeferredStaticMaterialCoverage(delta);
		this.#pendingStaticMaterializations.add(delta.revision);
		this.#staticMaterializationQueue = this.#staticMaterializationQueue
			.then(() => this.#materializeStaticCommit(delta))
			.catch((error: unknown) => {
				this.#recordStaticMaterializationFailure(delta.revision, error);
			});
	}

	#warnAboutDeferredStaticMaterialCoverage(
		delta: StaticCoordinatorCommitDelta,
	): void {
		for (const coverage of delta.materialCoverage) {
			const buckets = coverage.unrenderedBuckets
				.filter(isBlendedStaticAuditBucket)
				.slice(0, BLENDED_STATIC_AUDIT_WARNING_BUCKET_LIMIT);
			if (buckets.length === 0) {
				continue;
			}

			this.#diagnostics.warn({
				buckets,
				domain: coverage.domain,
				kind: "static-material-coverage-deferred",
				landblockId: coverage.landblockId,
				revision: delta.revision,
			});
		}
	}

	async #materializeStaticCommit(
		delta: StaticCoordinatorCommitDelta,
	): Promise<void> {
		const textureUpdate =
			await this.#textureManager.applyStaticCommitDelta(delta);
		if (this.#disposed) {
			return;
		}

		const materialized = materializeStaticCommit({
			commit: delta,
			materializedDrawUnitIdsBySourceDrawUnitId:
				this.#materializedDrawUnitIdsBySourceDrawUnitId,
			textureUpdate,
		});
		this.#updateMaterializedDrawUnitIdMappings(delta, materialized);
		this.#clearStaticLayersForRemovedResources(materialized.removedResources);
		if (materialized.textureUpdate) {
			this.#renderer.applyTexturePlacementUpdate(materialized.textureUpdate);
		}
		this.#applyMaterializedStaticLayers(delta, materialized);
		this.#applyEnvCellSystemLayerPublications(
			this.#envCellSystemLayerAssembly.ingestMaterializedCommit(
				delta,
				materialized,
			),
		);
		this.#refreshEnvCellResourceMembership();
		this.#warnAboutStaticFallbacks(delta);
		this.#staticSceneQuery.removeStaticResources(materialized.removedResources);
		this.#staticSceneQuery.applyStaticPeerRecords({
			authoredDynamicSeeds: materialized.staticAuthoredDynamicSeeds,
			portalGraphs: materialized.staticPortalGraphs,
			portalInteriorRecords: materialized.staticPortalInteriorRecords,
			sourceMappings: materialized.staticSourceMappings,
			spatialRecords: materialized.staticSpatialRecords,
			visibilityRecords: materialized.staticVisibilityRecords,
		});
		this.#recordDynamicSeedStaticBatchIds(
			delta.staticBatchId,
			materialized.staticAuthoredDynamicSeeds,
		);
		this.#dynamicEntityController.ingestStaticSeeds(
			materialized.staticAuthoredDynamicSeeds,
		);
		this.#enqueueDynamicRendererResourceSync();
		this.#updateRenderPassPlan();
		this.#refreshSceneDebugOverlay();
		this.#pendingStaticMaterializations.delete(delta.revision);
		this.#committedStaticMaterializations = appendBoundedRevision(
			this.#committedStaticMaterializations,
			delta.revision,
		);
		this.#maybeEmitSceneInterestSettled();
	}

	#recordStaticMaterializationFailure(revision: number, error: unknown): void {
		this.#pendingStaticMaterializations.delete(revision);
		const message = error instanceof Error ? error.message : String(error);
		this.#failedStaticMaterializationRevisions.add(revision);
		this.#diagnostics.warn({
			error,
			kind: "static-materialization-failed",
			message,
			revision,
		});
		this.#maybeEmitSceneInterestSettled();
	}

	#enqueueDynamicRendererResourceSync(): void {
		if (this.#disposed) {
			return;
		}
		this.#dynamicRendererResourceQueue = this.#dynamicRendererResourceQueue
			.then(() => this.#syncDynamicRendererResources())
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				this.#diagnostics.warn({
					error,
					kind: "dynamic-renderer-resource-sync-failed",
					message: `dynamic renderer resource sync failed: ${message}`,
					revision: this.#dynamicRendererResourceRevision,
				});
			});
	}

	async #syncDynamicRendererResources(): Promise<void> {
		if (this.#disposed) {
			return;
		}
		const snapshot = this.#dynamicEntityController.createSnapshot();
		const resources = snapshot.records.flatMap((record) =>
			createDynamicRendererVisualResource(record),
		);
		const nextResourceIds = new Set(
			resources.map((resource) => resource.resourceId),
		);
		const removedResourceIds = [
			...this.#committedDynamicVisualResourceIds,
		].filter((resourceId) => !nextResourceIds.has(resourceId));

		const textureUpdate =
			await this.#textureManager.applyDynamicTextureUseDelta({
				removedOwners: removedResourceIds.map((resourceId) => ({
					kind: "dynamic-visual-resource",
					resourceId,
				})),
				textureUses: resources.flatMap((resource) =>
					createDynamicTextureUseCommits(
						resource,
						snapshot.records,
						this.#staticBatchIdBySourceScope,
					),
				),
			});
		if (this.#disposed) {
			return;
		}
		if (textureUpdate) {
			this.#renderer.applyTexturePlacementUpdate(textureUpdate);
		}

		this.#dynamicRendererResourceRevision += 1;
		const commit: DynamicRendererResourceCommit = {
			addedVisualResources: resources,
			removedVisualResourceIds: removedResourceIds,
			revision: this.#dynamicRendererResourceRevision,
		};
		this.#renderer.commitDynamicResources(commit);
		this.#committedDynamicVisualResourceIds.clear();
		for (const resourceId of nextResourceIds) {
			this.#committedDynamicVisualResourceIds.add(resourceId);
		}
		this.#refreshRendererDiagnosticsSnapshot();
	}

	#commitDynamicRendererInstances(frameTimeSeconds: number): void {
		const snapshot = this.#dynamicEntityController.createSnapshot();
		this.#dynamicRendererResourceRevision += 1;
		this.#renderer.commitDynamicInstances({
			frameTimeSeconds,
			instances: snapshot.records.flatMap(createDynamicRendererInstances),
			revision: this.#dynamicRendererResourceRevision,
		});
		this.#refreshRendererDiagnosticsSnapshot();
	}

	#recordDynamicSeedStaticBatchIds(
		staticBatchId: string,
		seeds: readonly StaticAuthoredDynamicSeedRecord[],
	): void {
		for (const seed of seeds) {
			if (seed.owner.kind !== "work") {
				continue;
			}
			this.#staticBatchIdBySourceScope.set(
				createStaticBatchLookupKey(seed.owner.domain, seed.owner.scopeKey),
				staticBatchId,
			);
		}
	}

	#updateMaterializedDrawUnitIdMappings(
		delta: StaticCoordinatorCommitDelta,
		materialized: StaticMaterializationResult,
	): void {
		for (const removedDrawUnitId of collectStaticDrawUnitResourceIds(
			delta.removedResources,
		)) {
			const materializedDrawUnitIds =
				this.#materializedDrawUnitIdsBySourceDrawUnitId.get(
					removedDrawUnitId,
				) ?? [removedDrawUnitId];
			this.#materializedDrawUnitIdsBySourceDrawUnitId.delete(removedDrawUnitId);
			for (const materializedDrawUnitId of materializedDrawUnitIds) {
				this.#materializedDrawUnitsById.delete(materializedDrawUnitId);
			}
		}
		for (const mapping of materialized.drawUnitIdMappings) {
			this.#materializedDrawUnitIdsBySourceDrawUnitId.set(
				mapping.sourceDrawUnitId,
				mapping.materializedDrawUnitIds,
			);
		}
		for (const drawUnit of materialized.materializedDrawUnits) {
			this.#materializedDrawUnitsById.set(drawUnit.drawUnitId, drawUnit);
		}
	}

	#applyMaterializedStaticLayers(
		delta: StaticCoordinatorCommitDelta,
		materialized: StaticMaterializationResult,
	): void {
		for (const payload of createMaterializedLandblockLayerPayloads(
			delta,
			materialized,
		)) {
			this.#installStaticLayer(payload);
		}
	}

	#applyEnvCellSystemLayerPublications(
		publications: readonly EnvCellSystemLayerAssemblyPublication[],
	): void {
		for (const publication of publications) {
			this.#applyEnvCellSystemLayerPublication(publication);
		}
	}

	#applyEnvCellSystemLayerPublication(
		publication: EnvCellSystemLayerAssemblyPublication | null,
	): void {
		if (!publication) {
			return;
		}

		this.#installStaticLayer(publication.payload);
		this.#staticSceneQuery.setEnvCellSystemLayer(publication.payload);
		this.#setEnvCellResourceMembershipFromLayer(publication.payload);
		this.#updateRenderPassPlan();
	}

	#installStaticLayer(payload: StaticLandblockLayerPayload): void {
		const layerKey = createStaticLandblockLayerKey({
			kind: payload.kind,
			landblockId: payload.landblockId,
		});
		this.#unindexStaticLayerResources(layerKey);
		this.#staticLayersByKey.set(layerKey, payload);
		this.#indexStaticLayerResources(layerKey, payload);

		switch (payload.kind) {
			case "terrain":
				this.#renderer.setTerrainLayer(payload.landblockId, payload);
				break;
			case "outdoor-buildings":
				this.#renderer.setOutdoorBuildingsLayer(payload.landblockId, payload);
				break;
			case "outdoor-detail":
				this.#renderer.setOutdoorDetailsLayer(payload.landblockId, payload);
				break;
			case "env-cell-system":
				this.#renderer.setEnvCellSystemLayer(payload.landblockId, payload);
				break;
		}
	}

	#clearStaticLayersForRemovedResources(
		removedResources: readonly StaticResourceKey[],
	): void {
		const layerKeys = new Set(
			removedResources
				.map((resource) =>
					this.#staticLayerKeyByResourceId.get(resourceKeyId(resource)),
				)
				.filter((key): key is string => key !== undefined),
		);
		for (const layerKey of layerKeys) {
			this.#clearStaticLayer(layerKey);
		}
	}

	#clearStaticLayer(layerKey: string): void {
		const payload = this.#staticLayersByKey.get(layerKey);
		if (!payload) {
			return;
		}
		this.#unindexStaticLayerResources(layerKey);
		this.#staticLayersByKey.delete(layerKey);

		switch (payload.kind) {
			case "terrain":
				this.#renderer.setTerrainLayer(payload.landblockId, null);
				break;
			case "outdoor-buildings":
				this.#renderer.setOutdoorBuildingsLayer(payload.landblockId, null);
				break;
			case "outdoor-detail":
				this.#renderer.setOutdoorDetailsLayer(payload.landblockId, null);
				break;
			case "env-cell-system":
				this.#renderer.setEnvCellSystemLayer(payload.landblockId, null);
				this.#staticSceneQuery.clearEnvCellSystemLayer(payload.landblockId);
				break;
		}
	}

	#indexStaticLayerResources(
		layerKey: string,
		payload: StaticLandblockLayerPayload,
	): void {
		for (const resourceId of collectStaticLayerResourceIds(payload)) {
			this.#staticLayerKeyByResourceId.set(resourceId, layerKey);
		}
	}

	#unindexStaticLayerResources(layerKey: string): void {
		for (const [resourceId, ownerLayerKey] of Array.from(
			this.#staticLayerKeyByResourceId,
		)) {
			if (ownerLayerKey === layerKey) {
				this.#staticLayerKeyByResourceId.delete(resourceId);
			}
		}
	}

	#getEnvCellSystemLayerGenerationId(landblockId: number): string | null {
		const payload = this.#staticLayersByKey.get(
			createStaticLandblockLayerKey({
				kind: "env-cell-system",
				landblockId,
			}),
		);
		return payload?.kind === "env-cell-system" ? payload.generationId : null;
	}

	#setEnvCellResourceMembershipFromLayer(
		payload: Extract<StaticLandblockLayerPayload, { kind: "env-cell-system" }>,
	): void {
		const nextMembership = payload.resourceMembership.map((membership) => ({
			envCellId: membership.envCellId,
			envCellStaticObjectDrawUnitIds: membership.envCellStaticObjectDrawUnitIds,
			landblockId: payload.landblockId,
			sharedEnvCellStaticObjectDrawUnits: 0,
			structuredInteriorDrawUnitIds: membership.structuredInteriorDrawUnitIds,
		}));
		if (
			envCellResourceMembershipSnapshotsEqual(
				this.#envCellResourceMembership,
				nextMembership,
			)
		) {
			return;
		}
		this.#envCellResourceMembership = nextMembership;
		this.#envCellResourceMembershipByLandblock =
			createEnvCellResourceMembershipIndex(this.#envCellResourceMembership);
		this.#envCellResourceMembershipRevision += 1;
		this.#cachedPortalFramePlan = null;
	}

	#refreshEnvCellResourceMembership(): void {
		const nextMembership = createEnvCellResourceMembershipSnapshot(
			this.#materializedDrawUnitsById.values(),
		);
		if (
			envCellResourceMembershipSnapshotsEqual(
				this.#envCellResourceMembership,
				nextMembership,
			)
		) {
			return;
		}

		this.#envCellResourceMembership = nextMembership;
		this.#envCellResourceMembershipByLandblock =
			createEnvCellResourceMembershipIndex(nextMembership);
		this.#envCellResourceMembershipRevision += 1;
	}

	#warnAboutStaticFallbacks(delta: StaticCoordinatorCommitDelta): void {
		for (const drawUnit of delta.addedDrawUnits) {
			if (
				drawUnit.kind !== "terrain-geometry" ||
				drawUnit.terrainFallbackReasons.length === 0
			) {
				continue;
			}

			const fallback: TerrainTextureFallbackDiagnostics = {
				drawUnitId: drawUnit.drawUnitId,
				materialBucketKey: drawUnit.materialBucketKey,
				materialFamily: drawUnit.materialFamily,
				reasons: drawUnit.terrainFallbackReasons,
				revision: delta.revision,
			};
			this.#recentTerrainTextureFallbacks = appendBounded(
				this.#recentTerrainTextureFallbacks,
				fallback,
				TERRAIN_TEXTURE_DIAGNOSTICS_EVENT_LIMIT,
			);
			this.#diagnostics.warn({
				drawUnitId: fallback.drawUnitId,
				kind: "terrain-renderable-fallback",
				materialBucketKey: fallback.materialBucketKey,
				materialFamily: fallback.materialFamily,
				reasons: fallback.reasons,
				revision: fallback.revision,
			});
		}
	}

	#refreshSceneDebugOverlay(): void {
		const primitives: DebugOverlayPrimitive[] = [];
		if (this.#envCellAabbDebugOverlayVisible) {
			for (const debugBounds of this.#staticSceneQuery.queryEnvCellAabbDebugBounds()) {
				primitives.push(
					createEnvCellAabbDebugOverlayPrimitive(debugBounds.bounds, {
						envCellId: debugBounds.envCellId,
						landblockId: debugBounds.landblockId,
						memberId: debugBounds.memberId,
					}),
				);
			}
		}
		if (this.#envCellPortalDebugOverlayVisible) {
			for (const layer of this.#staticSceneQuery.queryEnvCellSystemLayers()) {
				for (const resource of layer.portalApertureResources) {
					primitives.push(
						...createBuildingTransitionApertureDebugOverlayPrimitives(
							resource,
							this.#renderAnchorLandblockId,
						),
					);
				}
			}
			for (const record of this.#staticSceneQuery.queryPortalInteriorRecords()) {
				primitives.push(
					...createEnvCellPortalDebugOverlayPrimitives(
						record,
						this.#renderAnchorLandblockId,
					),
				);
			}
		}

		if (!this.#sceneDebugSelection) {
			this.#renderer.setDebugOverlayPrimitives(primitives);
			return;
		}

		const debugBounds = this.#querySceneSelectionDebugBounds(
			this.#sceneDebugSelection,
		);
		if (!debugBounds) {
			if (this.#sceneDebugSelection.kind === "static") {
				const selectionKey = describeStaticSceneSelectionKey(
					this.#sceneDebugSelection.selectionKey,
				);
				this.#diagnostics.warn({
					kind: "static-debug-selection-unresolved",
					reason: "missing-query-bounds",
					selectionKey,
				});
			}
			this.#renderer.setDebugOverlayPrimitives(primitives);
			return;
		}

		primitives.push(
			createSelectionDebugBoundsOverlayPrimitive(debugBounds.bounds, {
				id: debugBounds.id,
			}),
		);
		this.#renderer.setDebugOverlayPrimitives(primitives);
	}

	#querySceneSelectionDebugBounds(selection: RuntimeSceneDebugSelection): {
		readonly bounds: StaticBounds;
		readonly id: string;
	} | null {
		if (selection.kind === "static") {
			const debugBounds = this.#queryStaticSelectionDebugBounds(
				selection.selectionKey,
			);
			return debugBounds === null
				? null
				: {
						bounds: debugBounds.bounds,
						id: describeStaticSceneSelectionKey(debugBounds.selectionKey),
					};
		}

		const currentBounds =
			this.#dynamicEntityController.queryDynamicCurrentBounds(
				selection.entityId,
			);
		if (currentBounds === null) {
			return null;
		}
		const bounds =
			currentBounds.kind === "outdoor-landblock"
				? translateBounds(
						currentBounds.bounds,
						createOutdoorLandblockRootTranslation(
							currentBounds.sourceLandblockId,
							this.#renderAnchorLandblockId,
						),
					)
				: currentBounds.bounds;

		return {
			bounds,
			id: `dynamic:${selection.entityId}`,
		};
	}

	#queryStaticSelectionDebugBounds(selectionKey: StaticSceneSelectionKey): {
		readonly bounds: StaticBounds;
		readonly selectionKey: StaticSceneSelectionKey;
	} | null {
		return this.#staticSceneQuery.querySelectionDebugBounds(selectionKey);
	}

	#queryStaticSelectionDiagnosticsDetails(
		selectionKey: StaticSceneSelectionKey,
	): StaticSelectionDiagnosticsDetails | null {
		if (selectionKey.itemKind === "outdoor-static-object") {
			const detail = this.#staticSceneQuery.queryOutdoorStaticObjectDetails({
				domain: selectionKey.domain,
				instanceId: selectionKey.instanceId,
				landblockId: selectionKey.landblockId,
			});
			return detail === null
				? null
				: {
						detail: summarizeOutdoorStaticObjectDetails(detail),
						kind: "outdoor-static-object",
					};
		}

		if (selectionKey.itemKind === "terrain-quad") {
			const detail = this.#staticSceneQuery.queryTerrainQuadDetails({
				landblockId: selectionKey.landblockId,
				quadIndex: selectionKey.quadIndex,
			});
			return detail === null
				? null
				: {
						detail,
						kind: "terrain-quad",
					};
		}

		if (selectionKey.itemKind === "env-cell-portal") {
			const detail =
				this.#staticSceneQuery.queryEnvCellPortalDetails(selectionKey);
			return detail === null
				? null
				: {
						detail,
						kind: "env-cell-portal",
					};
		}

		const detail = this.#staticSceneQuery.queryEnvCellStaticObjectDetails({
			envCellId: selectionKey.envCellId,
			instanceId: selectionKey.instanceId,
			landblockId: selectionKey.landblockId,
		});
		return detail === null
			? null
			: {
					detail,
					kind: "env-cell-static-object",
				};
	}

	#queryStaticSelectionRenderingDiagnostics(
		selectionKey: StaticSceneSelectionKey,
	): StaticSelectionRenderingDiagnostics | null {
		if (selectionKey.itemKind === "terrain-quad") {
			return null;
		}

		if (selectionKey.itemKind === "env-cell-static-object") {
			return {
				kind: "unsupported-static-selection-rendering",
				reason:
					"Env-cell static selection source material retention is not implemented yet.",
			};
		}

		if (selectionKey.itemKind === "env-cell-portal") {
			return {
				kind: "unsupported-static-selection-rendering",
				reason:
					"Env-cell portal selections are debug overlay evidence and are not materialized static draw units.",
			};
		}

		const source =
			this.#staticSceneQuery.queryOutdoorStaticObjectSourceDiagnostics({
				domain: selectionKey.domain,
				instanceId: selectionKey.instanceId,
				landblockId: selectionKey.landblockId,
			});
		const matchedDrawUnits = this.#queryOutdoorStaticSelectionDrawUnits(
			selectionKey,
			source?.object.identity.objectKind ?? null,
		);
		const drawUnits = matchedDrawUnits.map((drawUnit) => drawUnit.diagnostics);

		return {
			drawUnits,
			kind: "outdoor-static-object-rendering",
			partCoverage: createStaticSelectionPartCoverage(matchedDrawUnits),
			source:
				source === null ? null : summarizeOutdoorStaticObjectSource(source),
			unmatchedReason:
				source === null
					? "selected outdoor static source diagnostics were not retained"
					: drawUnits.length === 0
						? "no committed materialized static object draw units referenced this selection"
						: null,
		};
	}

	#queryOutdoorStaticSelectionDrawUnits(
		selectionKey: StaticSceneSelectionKey & {
			readonly itemKind: "outdoor-static-object";
		},
		objectKind: "building" | "explicit-object" | "generated-scenery" | null,
	): readonly MatchedStaticSelectionDrawUnitDiagnostics[] {
		const drawUnits: MatchedStaticSelectionDrawUnitDiagnostics[] = [];

		for (const drawUnit of this.#materializedDrawUnitsById.values()) {
			if (drawUnit.kind !== "static-object-geometry") {
				continue;
			}
			const sourceMappingCoverage = drawUnit.sourceMappingCoverage.filter(
				(coverage) =>
					matchesStaticObjectSourceMappingCoverage(
						coverage,
						selectionKey,
						objectKind,
					),
			);
			if (sourceMappingCoverage.length === 0) {
				continue;
			}

			drawUnits.push({
				diagnostics: {
					domain: drawUnit.domain,
					drawUnitId: drawUnit.drawUnitId,
					materialEntryCount: drawUnit.materialEntries.length,
					materialEntries: drawUnit.materialEntries.map(
						summarizeDrawUnitMaterialEntry,
					),
					materialFamily: drawUnit.materialFamily,
					materialIds: drawUnit.materialIds,
					materialPass: drawUnit.materialPass,
					sourceDrawUnitId: this.#findSourceDrawUnitId(drawUnit.drawUnitId),
					sourceMapping: createStaticSelectionSourceMappingSummary(
						sourceMappingCoverage,
					),
					textureUseCount: drawUnit.textureUseIds.length,
					triangleCount: drawUnit.triangleCount,
					vertexCount: drawUnit.vertexCount,
				},
				sourceMappingCoverage,
			});
		}

		return drawUnits.sort((left, right) =>
			left.diagnostics.drawUnitId.localeCompare(right.diagnostics.drawUnitId),
		);
	}

	#findSourceDrawUnitId(materializedDrawUnitId: string): string | null {
		for (const [sourceDrawUnitId, materializedDrawUnitIds] of this
			.#materializedDrawUnitIdsBySourceDrawUnitId) {
			if (materializedDrawUnitIds.includes(materializedDrawUnitId)) {
				return sourceDrawUnitId;
			}
		}

		return null;
	}
}

function summarizeOutdoorStaticObjectDetails(
	detail: OutdoorStaticObjectScenePickDetails,
): OutdoorStaticObjectSelectionDetails {
	return {
		bvhItemIndex: detail.bvhItemIndex,
		bvhItemKind: detail.bvhItemKind,
		domain: detail.domain,
		instanceId: detail.instanceId,
		landblockId: detail.landblockId,
		object: summarizeStaticSelectionObject(detail.object),
	};
}

function summarizeOutdoorStaticObjectSource(
	source: OutdoorStaticObjectSourceDiagnostics,
): OutdoorStaticObjectSourceDiagnosticsSummary {
	return {
		domain: source.domain,
		instanceId: source.instanceId,
		landblockId: source.landblockId,
		materialIds: uniqueNumbers(
			source.materialSources.map((material) => material.identity.materialId),
		),
		materialSlots: source.materialSlots.map((entry) => ({
			diffuse: entry.material?.diffuse ?? null,
			geometrySurfaceId: entry.slot.identity.geometrySurfaceId,
			luminosity: entry.material?.luminosity ?? null,
			materialId: entry.slot.material.materialId,
			materialSurfaceId: entry.slot.identity.materialSurfaceId,
			materialVariantSignature: entry.slot.materialVariantSignature,
			partIndex: entry.slot.identity.part.partIndex,
			slotIndex: entry.slot.identity.slotIndex,
			surfaceType: entry.material?.surfaceType ?? null,
			translucency: entry.material?.translucency ?? null,
		})),
		object: summarizeStaticSelectionObject(source.object),
		sourceAsset:
			source.sourceAsset === null
				? null
				: {
						identity: summarizeStaticObjectSource(source.sourceAsset.identity),
						invalidPolygonCount: source.sourceAsset.invalidPolygonCount,
						materialSlotCount: source.sourceAsset.materialSlotCount,
						partCount: source.sourceAsset.partCount,
						parts: source.sourceAsset.parts.map((part) => ({
							geometrySurfaceIds: uniqueNumbers(
								part.materialSlots.map((slot) => slot.geometrySurfaceId),
							),
							materialIds: uniqueNumbers(
								part.materialSlots.map((slot) => slot.material.materialId),
							),
							materialSlotCount: part.materialSlotCount,
							partIndex: part.partIndex,
							physicsPolygonCount: part.physicsPolygonCount,
							renderTriangleCount: part.renderTriangleCount,
							skippedPolygonCount: part.skippedPolygonCount,
						})),
						physicsPolygonCount: source.sourceAsset.physicsPolygonCount,
						renderTriangleCount: source.sourceAsset.renderTriangleCount,
						skippedPolygonCount: source.sourceAsset.skippedPolygonCount,
					},
		textureRefs: summarizeTextureRefs(source.textureRefs),
	};
}

function summarizeStaticSelectionObject(
	object: OutdoorStaticObjectScenePickDetails["object"],
): StaticSelectionObjectSummary {
	return {
		instanceId: object.identity.instanceId,
		objectKind: object.identity.objectKind,
		portalCount: object.portalCount,
		source: summarizeStaticObjectSource(object.source),
		sourceAssetId: object.debug.sourceAssetId,
		sourceIndex: object.sourceIndex,
	};
}

function summarizeStaticObjectSource(
	source: StaticObjectSourceIdentity,
): StaticObjectSourceSummary {
	return {
		sourceAssetKind: source.sourceAssetKind,
		sourceDid: source.sourceDid,
	};
}

function summarizeDrawUnitMaterialEntry(
	entry: StaticMaterialTableEntry,
): StaticSelectionDrawUnitMaterialEntryDiagnostics {
	return {
		alphaTest: entry.alphaTest,
		blendMode: entry.renderState.blend.mode,
		indexTextureDid: extractTextureUseDid(entry.indexTextureUseId),
		materialIds: entry.materialIds,
		paletteDid: extractTextureUseDid(entry.paletteTextureUseId),
		primaryTextureDid: extractTextureUseDid(entry.primaryTextureUseId),
		slot: entry.slot,
		wrapMode: entry.primaryTextureWrapMode,
	};
}

function extractTextureUseDid(textureUseId: string | null): string | null {
	if (textureUseId === null) {
		return null;
	}
	const match = textureUseId.match(/:([0-9a-f]{8})(?::|$)/i);
	return match?.[1] ?? textureUseId;
}

function summarizeTextureRefs(
	textureRefs: OutdoorStaticObjectSourceDiagnostics["textureRefs"],
): StaticSelectionTextureRefSummary {
	const paletteIds: number[] = [];
	const renderSurfaceIds: number[] = [];
	const surfaceTextureIds: number[] = [];

	for (const textureRef of textureRefs) {
		if (textureRef.palette !== null) {
			paletteIds.push(textureRef.palette.paletteId);
		}
		if (textureRef.renderSurface !== null) {
			renderSurfaceIds.push(textureRef.renderSurface.renderSurfaceId);
		}
		if (textureRef.role === "surface-texture") {
			surfaceTextureIds.push(textureRef.texture.surfaceTextureId);
		}
	}

	return {
		count: textureRefs.length,
		paletteIds: uniqueNumbers(paletteIds),
		renderSurfaceIds: uniqueNumbers(renderSurfaceIds),
		surfaceTextureIds: uniqueNumbers(surfaceTextureIds),
	};
}

function uniqueNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function createStaticSelectionPartCoverage(
	drawUnits: readonly MatchedStaticSelectionDrawUnitDiagnostics[],
): readonly StaticSelectionPartCoverageDiagnostics[] {
	const coverageByPart = new Map<
		number,
		{
			readonly drawUnitIds: Set<string>;
			readonly materialIds: Set<number>;
			maxPolygonId: number | null;
			minPolygonId: number | null;
			polygonCount: number;
			sourceTriangleCount: number;
		}
	>();

	for (const drawUnit of drawUnits) {
		for (const sourceCoverage of drawUnit.sourceMappingCoverage) {
			const coverage = coverageByPart.get(sourceCoverage.partIndex) ?? {
				drawUnitIds: new Set<string>(),
				materialIds: new Set<number>(),
				maxPolygonId: null,
				minPolygonId: null,
				polygonCount: 0,
				sourceTriangleCount: 0,
			};
			coverage.drawUnitIds.add(drawUnit.diagnostics.drawUnitId);
			for (const materialId of sourceCoverage.materialIds) {
				coverage.materialIds.add(materialId);
			}
			coverage.polygonCount += sourceCoverage.polygonCount;
			coverage.sourceTriangleCount += sourceCoverage.sourceTriangleCount;
			if (sourceCoverage.polygonRange !== null) {
				coverage.minPolygonId =
					coverage.minPolygonId === null
						? sourceCoverage.polygonRange.min
						: Math.min(coverage.minPolygonId, sourceCoverage.polygonRange.min);
				coverage.maxPolygonId =
					coverage.maxPolygonId === null
						? sourceCoverage.polygonRange.max
						: Math.max(coverage.maxPolygonId, sourceCoverage.polygonRange.max);
			}
			coverageByPart.set(sourceCoverage.partIndex, coverage);
		}
	}

	return [...coverageByPart.entries()]
		.sort(([left], [right]) => left - right)
		.map(([partIndex, coverage]) => ({
			drawUnitIds: [...coverage.drawUnitIds].sort(),
			materialIds: [...coverage.materialIds].sort(
				(left, right) => left - right,
			),
			partIndex,
			polygonCount: coverage.polygonCount,
			polygonRange:
				coverage.minPolygonId === null || coverage.maxPolygonId === null
					? null
					: { max: coverage.maxPolygonId, min: coverage.minPolygonId },
			sourceTriangleCount: coverage.sourceTriangleCount,
		}));
}

function createStaticSelectionSourceMappingSummary(
	coverages: readonly StaticObjectSourceMappingCoverage[],
): StaticSelectionSourceMappingSummaryDiagnostics {
	const geometrySurfaceIds = new Set<number>();
	const materialVariantSignatures = new Set<string | null>();
	const partIndices = new Set<number>();
	let polygonCount = 0;
	let minPolygonId: number | null = null;
	let maxPolygonId: number | null = null;
	let sourceTriangleCount = 0;

	for (const coverage of coverages) {
		for (const geometrySurfaceId of coverage.geometrySurfaceIds) {
			geometrySurfaceIds.add(geometrySurfaceId);
		}
		for (const materialVariantSignature of coverage.materialVariantSignatures) {
			materialVariantSignatures.add(materialVariantSignature);
		}
		partIndices.add(coverage.partIndex);
		polygonCount += coverage.polygonCount;
		sourceTriangleCount += coverage.sourceTriangleCount;
		if (coverage.polygonRange !== null) {
			minPolygonId =
				minPolygonId === null
					? coverage.polygonRange.min
					: Math.min(minPolygonId, coverage.polygonRange.min);
			maxPolygonId =
				maxPolygonId === null
					? coverage.polygonRange.max
					: Math.max(maxPolygonId, coverage.polygonRange.max);
		}
	}

	return {
		geometrySurfaceIds: [...geometrySurfaceIds].sort(
			(left, right) => left - right,
		),
		materialVariantSignatures: [...materialVariantSignatures].sort(
			compareNullableStrings,
		),
		partIndices: [...partIndices].sort((left, right) => left - right),
		polygonCount,
		polygonRange:
			minPolygonId === null || maxPolygonId === null
				? null
				: { max: maxPolygonId, min: minPolygonId },
		sourceTriangleCount,
	};
}

function compareNullableStrings(
	left: string | null,
	right: string | null,
): number {
	if (left === right) {
		return 0;
	}
	if (left === null) {
		return -1;
	}
	if (right === null) {
		return 1;
	}
	return left.localeCompare(right);
}

function matchesStaticObjectSourceMappingCoverage(
	coverage: StaticObjectSourceMappingCoverage,
	selectionKey: StaticSceneSelectionKey & {
		readonly itemKind: "outdoor-static-object";
	},
	objectKind: "building" | "explicit-object" | "generated-scenery" | null,
): boolean {
	return (
		coverage.object.landblockId === selectionKey.landblockId &&
		coverage.object.instanceId === selectionKey.instanceId &&
		(objectKind === null || coverage.object.objectKind === objectKind)
	);
}

function createSelectionDebugBoundsOverlayPrimitive(
	bounds: StaticBounds,
	options: { readonly id: string },
): DebugOverlayPrimitive {
	const visibleBounds = createMinimumDebugOverlayBounds(bounds);
	return {
		color: [1, 0.85, 0.1, 1],
		id: options.id,
		kind: "aabb",
		max: [visibleBounds.max.x, visibleBounds.max.y, visibleBounds.max.z],
		min: [visibleBounds.min.x, visibleBounds.min.y, visibleBounds.min.z],
	};
}

function createEnvCellAabbDebugOverlayPrimitive(
	bounds: StaticBounds,
	options: {
		readonly envCellId: number;
		readonly landblockId: number;
		readonly memberId: string;
	},
): DebugOverlayPrimitive {
	const visibleBounds = createMinimumDebugOverlayBounds(bounds);
	return {
		color: [0.15, 0.85, 1, 0.55],
		id: `env-cell-aabb:${formatHex32(options.landblockId)}:${formatHex32(options.envCellId)}:${options.memberId}`,
		kind: "aabb",
		max: [visibleBounds.max.x, visibleBounds.max.y, visibleBounds.max.z],
		min: [visibleBounds.min.x, visibleBounds.min.y, visibleBounds.min.z],
	};
}

function createBuildingTransitionApertureDebugOverlayPrimitives(
	resource: StaticPortalApertureResource,
	renderAnchorLandblockId: number | null,
): DebugOverlayPrimitive[] {
	if (resource.sourceDomain !== "outdoor-buildings") {
		return [];
	}
	const primitives: DebugOverlayPrimitive[] = [];
	const translation = createOutdoorLandblockRootTranslation(
		resource.landblockId,
		renderAnchorLandblockId,
	);
	for (const range of resource.ranges) {
		if (range.sourceKind !== "building-transition") {
			continue;
		}
		const storedWindingVertices = readPortalApertureRangeVertices(
			resource,
			range.firstIndex,
			range.indexCount,
			translation,
		);
		const baseId = `transition-aperture:${formatHex32(resource.landblockId)}:${describeBuildingTransitionApertureRangeSource(range.source)}:${range.source.portalId}`;
		primitives.push({
			color: [0.95, 0.12, 0.08, 0.35],
			id: `${baseId}:indoor-to-outdoor`,
			kind: "triangles",
			vertices: storedWindingVertices,
		});
		primitives.push({
			color: [0.05, 0.95, 0.25, 0.35],
			id: `${baseId}:outdoor-to-indoor`,
			kind: "triangles",
			vertices: reverseTriangleWinding(storedWindingVertices),
		});
	}

	return primitives;
}

function describeBuildingTransitionApertureRangeSource(source: {
	readonly buildingInstanceId: string;
	readonly buildingPortalId: string;
	readonly portalIndex: number;
	readonly polyId: number;
	readonly sourceDid: number;
}): string {
	return [
		"building",
		source.buildingInstanceId,
		source.buildingPortalId,
		`portal-index-${source.portalIndex}`,
		`poly-${source.polyId}`,
		`gfx-${formatHex32(source.sourceDid)}`,
	].join(":");
}

function readPortalApertureRangeVertices(
	resource: StaticPortalApertureResource,
	firstIndex: number,
	indexCount: number,
	translation: readonly [number, number, number],
): readonly (readonly [number, number, number])[] {
	const vertices: Array<readonly [number, number, number]> = [];
	for (let indexOffset = 0; indexOffset < indexCount; indexOffset += 1) {
		const vertexIndex = resource.indices[firstIndex + indexOffset];
		const vertex =
			vertexIndex === undefined ? undefined : resource.vertices[vertexIndex];
		if (!vertex) {
			throw new Error(
				`Portal aperture resource ${resource.apertureResourceId} has invalid index at ${firstIndex + indexOffset}.`,
			);
		}
		vertices.push([
			vertex.x + translation[0],
			vertex.y + translation[1],
			vertex.z + translation[2],
		]);
	}
	return vertices;
}

function reverseTriangleWinding(
	vertices: readonly (readonly [number, number, number])[],
): readonly (readonly [number, number, number])[] {
	const reversed: Array<readonly [number, number, number]> = [];
	for (let index = 0; index < vertices.length; index += 3) {
		const first = vertices[index];
		const second = vertices[index + 1];
		const third = vertices[index + 2];
		if (!first || !second || !third) {
			throw new Error(
				"Transition aperture debug geometry is not triangulated.",
			);
		}
		reversed.push(first, third, second);
	}
	return reversed;
}

function createEnvCellPortalDebugOverlayPrimitives(
	record: StaticPortalInteriorRecord,
	renderAnchorLandblockId: number | null,
): DebugOverlayPrimitive[] {
	const primitives: DebugOverlayPrimitive[] = [];
	const translation = createOutdoorLandblockRootTranslation(
		record.landblockId,
		renderAnchorLandblockId,
	);
	for (const envCell of record.envCells) {
		const matrix = buildAcPlacementMatrix(
			envCell.localPlacement,
			AC_UNIT_SCALE,
		);
		for (const aperture of envCell.portalApertures) {
			const vertices = triangulateEnvCellPortalAperture(
				aperture.points,
				matrix,
				translation,
			);
			if (vertices.length === 0) {
				continue;
			}
			primitives.push({
				color: [0.05, 0.85, 1, 0.45],
				id: `env-cell-portal:${formatHex32(record.landblockId)}:${formatHex32(envCell.envCellId)}:${aperture.portalId}`,
				kind: "triangles",
				vertices,
			});
		}
	}
	return primitives;
}

function countBuildingTransitionApertures(
	layers: readonly {
		readonly portalApertureResources: readonly StaticPortalApertureResource[];
	}[],
): number {
	return layers.reduce(
		(layerCount, layer) =>
			layerCount +
			layer.portalApertureResources.reduce(
				(resourceCount, resource) =>
					resourceCount +
					resource.ranges.filter(
						(range) => range.sourceKind === "building-transition",
					).length,
				0,
			),
		0,
	);
}

function countEnvCellPortalApertures(
	records: readonly StaticPortalInteriorRecord[],
): number {
	return records.reduce(
		(recordCount, record) =>
			recordCount +
			record.envCells.reduce(
				(cellCount, envCell) => cellCount + envCell.portalApertures.length,
				0,
			),
		0,
	);
}

function createMinimumDebugOverlayBounds(bounds: StaticBounds): StaticBounds {
	const minExtent = 0.1;
	const x = expandDebugBoundsAxis(bounds.min.x, bounds.max.x, minExtent);
	const y = expandDebugBoundsAxis(bounds.min.y, bounds.max.y, minExtent);
	const z = expandDebugBoundsAxis(bounds.min.z, bounds.max.z, minExtent);
	return {
		max: {
			x: x.max,
			y: y.max,
			z: z.max,
		},
		min: {
			x: x.min,
			y: y.min,
			z: z.min,
		},
	};
}

function expandDebugBoundsAxis(
	min: number,
	max: number,
	minExtent: number,
): { readonly min: number; readonly max: number } {
	const extent = max - min;
	if (extent >= minExtent) {
		return { max, min };
	}

	const center = (min + max) * 0.5;
	const halfExtent = minExtent * 0.5;
	return {
		max: center + halfExtent,
		min: center - halfExtent,
	};
}

function isBlendedStaticAuditBucket(
	bucket: StaticMaterialUnrenderedBucket,
): boolean {
	return (
		bucket.triangleCount > 0 &&
		bucket.outcome === "render-deferred" &&
		(bucket.pass === "transparent" || bucket.pass === "additive")
	);
}

function createTerrainTextureDiagnosticsReport(
	recentFallbacks: readonly TerrainTextureFallbackDiagnostics[],
): TerrainTextureDiagnosticsReport {
	const report: TerrainTextureDiagnosticsReport = {
		kind: "terrain-textures",
		summary: {
			recentFallbackCount: recentFallbacks.length,
		},
	};
	if (recentFallbacks.length > 0) {
		return {
			...report,
			recentFallbacks,
		};
	}
	return report;
}

function createMaterializedLandblockLayerPayloads(
	delta: StaticCoordinatorCommitDelta,
	materialized: StaticMaterializationResult,
): readonly (
	| TerrainLayerPayload
	| OutdoorBuildingsLayerPayload
	| OutdoorDetailsLayerPayload
)[] {
	const payloads: (
		| TerrainLayerPayload
		| OutdoorBuildingsLayerPayload
		| OutdoorDetailsLayerPayload
	)[] = [];
	const terrainByLandblock = new Map<
		number,
		TerrainLayerPayload["drawUnits"]
	>();
	const buildingsByLandblock = new Map<
		number,
		OutdoorBuildingsLayerPayload["drawUnits"]
	>();
	const detailByLandblock = new Map<
		number,
		OutdoorDetailsLayerPayload["drawUnits"]
	>();

	for (const drawUnit of materialized.materializedDrawUnits) {
		if (drawUnit.kind === "terrain-geometry") {
			terrainByLandblock.set(drawUnit.landblockId, [
				...(terrainByLandblock.get(drawUnit.landblockId) ?? []),
				drawUnit,
			]);
			continue;
		}
		if (drawUnit.kind !== "static-object-geometry") {
			continue;
		}
		if (drawUnit.domain === "outdoor-buildings") {
			buildingsByLandblock.set(drawUnit.landblockId, [
				...(buildingsByLandblock.get(drawUnit.landblockId) ?? []),
				drawUnit as OutdoorBuildingsLayerPayload["drawUnits"][number],
			]);
			continue;
		}
		if (drawUnit.domain === "outdoor-detail") {
			detailByLandblock.set(drawUnit.landblockId, [
				...(detailByLandblock.get(drawUnit.landblockId) ?? []),
				drawUnit as OutdoorDetailsLayerPayload["drawUnits"][number],
			]);
		}
	}
	for (const instance of materialized.staticObjectRenderInstances) {
		if (instance.domain !== "outdoor-detail") {
			continue;
		}
		if (!detailByLandblock.has(instance.landblockId)) {
			detailByLandblock.set(instance.landblockId, []);
		}
	}

	for (const [landblockId, drawUnits] of terrainByLandblock) {
		const drawUnitIds = new Set(
			drawUnits.map((drawUnit) => drawUnit.drawUnitId),
		);
		payloads.push({
			drawUnits,
			generationId: createStaticLandblockLayerGenerationIdForRuntime(
				"terrain",
				landblockId,
				delta.revision,
			),
			kind: "terrain",
			landblockId,
			materialCoverage: delta.materialCoverage.filter(
				(coverage) =>
					coverage.domain === "outdoor-terrain" &&
					coverage.landblockId === landblockId,
			),
			sourceMappingRecords: materialized.staticSourceMappings.filter(
				(record) =>
					record.owner.kind === "draw-unit" &&
					drawUnitIds.has(record.owner.drawUnitId),
			),
			spatialRecords: materialized.staticSpatialRecords.filter(
				(record) =>
					record.owner.kind === "draw-unit" &&
					drawUnitIds.has(record.owner.drawUnitId),
			),
			textureUses: delta.textureUses.filter(
				(textureUse) => textureUse.domain === "outdoor-terrain",
			),
		});
	}
	for (const [landblockId, drawUnits] of buildingsByLandblock) {
		payloads.push({
			drawUnits,
			generationId: createStaticLandblockLayerGenerationIdForRuntime(
				"outdoor-buildings",
				landblockId,
				delta.revision,
			),
			kind: "outdoor-buildings",
			landblockId,
			materialCoverage: delta.materialCoverage.filter(
				(coverage) =>
					coverage.domain === "outdoor-buildings" &&
					coverage.landblockId === landblockId,
			),
			sourceMappingRecords: materialized.staticSourceMappings.filter(
				(record) =>
					record.owner.kind === "work" &&
					record.owner.domain === "outdoor-buildings" &&
					record.owner.scope.landblockId === landblockId,
			),
			spatialRecords: materialized.staticSpatialRecords.filter(
				(record) =>
					record.owner.kind === "work" &&
					record.owner.domain === "outdoor-buildings" &&
					record.owner.scope.landblockId === landblockId,
			),
			textureUses: delta.textureUses.filter(
				(textureUse) => textureUse.domain === "outdoor-buildings",
			),
		});
	}
	for (const [landblockId, drawUnits] of detailByLandblock) {
		payloads.push({
			drawUnits,
			generationId: createStaticLandblockLayerGenerationIdForRuntime(
				"outdoor-detail",
				landblockId,
				delta.revision,
			),
			instancedObjectInstances: materialized.staticObjectRenderInstances.filter(
				(instance) =>
					instance.domain === "outdoor-detail" &&
					instance.landblockId === landblockId,
			),
			instancedObjectResources: materialized.staticObjectVisualResources.filter(
				(resource) =>
					materialized.staticObjectRenderInstances.some(
						(instance) =>
							instance.landblockId === landblockId &&
							instance.resourceId === resource.resourceId,
					),
			),
			kind: "outdoor-detail",
			landblockId,
			materialCoverage: delta.materialCoverage.filter(
				(coverage) =>
					coverage.domain === "outdoor-detail" &&
					coverage.landblockId === landblockId,
			),
			sourceMappingRecords: materialized.staticSourceMappings.filter(
				(record) =>
					record.owner.kind === "work" &&
					record.owner.domain === "outdoor-detail" &&
					record.owner.scope.landblockId === landblockId,
			),
			spatialRecords: materialized.staticSpatialRecords.filter(
				(record) =>
					record.owner.kind === "work" &&
					record.owner.domain === "outdoor-detail" &&
					record.owner.scope.landblockId === landblockId,
			),
			textureUses: delta.textureUses.filter(
				(textureUse) => textureUse.domain === "outdoor-detail",
			),
		});
	}

	return payloads;
}

function createStaticLandblockLayerGenerationIdForRuntime(
	kind: StaticLandblockLayerKind,
	landblockId: number,
	revision: number,
): string {
	return createStaticLandblockLayerGenerationId({
		kind,
		landblockId,
		sourceKey: `runtime:${revision}`,
	});
}

function collectStaticLayerResourceIds(
	payload: StaticLandblockLayerPayload,
): readonly string[] {
	switch (payload.kind) {
		case "terrain":
		case "outdoor-buildings":
			return payload.drawUnits.map((drawUnit) => drawUnit.drawUnitId);
		case "outdoor-detail":
			return [
				...payload.drawUnits.map((drawUnit) => drawUnit.drawUnitId),
				...payload.instancedObjectResources.map(
					(resource) => resource.resourceId,
				),
			];
		case "env-cell-system":
			return [
				...payload.envCellStaticObjectDrawUnits.map(
					(drawUnit) => drawUnit.drawUnitId,
				),
				...payload.structuredInteriorDrawUnits.map(
					(drawUnit) => drawUnit.drawUnitId,
				),
				...payload.portalApertureResources.map(
					(resource) => resource.apertureResourceId,
				),
			];
	}
}

function resourceKeyId(resource: StaticResourceKey): string {
	switch (resource.kind) {
		case "draw-unit":
			return resource.drawUnitId;
		case "static-object-visual-resource":
			return resource.resourceId;
		case "portal-aperture-resource":
			return resource.apertureResourceId;
	}
}

function appendBoundedRevision(
	revisions: readonly number[],
	revision: number,
): number[] {
	return [...revisions, revision].slice(-8);
}

function countMaterializedDrawUnits(
	drawUnitIdsBySourceDrawUnitId: ReadonlyMap<string, readonly string[]>,
): number {
	return [...drawUnitIdsBySourceDrawUnitId.values()].reduce(
		(count, drawUnitIds) => count + drawUnitIds.length,
		0,
	);
}

function appendBounded<T>(entries: readonly T[], entry: T, limit: number): T[] {
	return [...entries, entry].slice(-limit);
}

function normalizeSceneInterest(
	interest: RuntimeSceneInterest,
): RuntimeSceneInterest {
	if (interest.kind === "none") {
		return interest;
	}

	if (interest.kind === "interior-cell") {
		return {
			envCellId: interest.envCellId >>> 0,
			kind: "interior-cell",
			landblockId: normalizeOutdoorLandblockId(interest.landblockId),
			source: interest.source,
		};
	}

	return {
		anchorLandblockId: normalizeOutdoorLandblockId(interest.anchorLandblockId),
		domains: Array.from(new Set(interest.domains)).sort(),
		...(interest.lod ? { lod: interest.lod } : {}),
		kind: "outdoor-anchor",
		source: interest.source,
	};
}

function normalizeCameraResidency(
	residency: RuntimeCameraResidency,
): RuntimeCameraResidency {
	if (residency.kind === "unknown") {
		return {
			kind: "unknown",
			landblockId:
				residency.landblockId === null
					? null
					: normalizeOutdoorLandblockId(residency.landblockId),
		};
	}

	if (residency.kind === "outdoor-landblock") {
		return {
			kind: "outdoor-landblock",
			landblockId: normalizeOutdoorLandblockId(residency.landblockId),
		};
	}

	return {
		envCellId: residency.envCellId >>> 0,
		kind: "env-cell",
		landblockId: normalizeOutdoorLandblockId(residency.landblockId),
	};
}

function portalOverlapResidencyEquals(
	left: RuntimePortalOverlapResidency,
	right: RuntimePortalOverlapResidency,
): boolean {
	return left.signature === right.signature;
}

function deriveRenderPassPlan(
	residency: RuntimeCameraResidency,
	fallbackExteriorLandblockId: number | null,
	hasPortalInteriorScene: (landblockId: number) => boolean,
): RenderPassPlan {
	if (residency.kind === "env-cell") {
		if (!hasPortalInteriorScene(residency.landblockId)) {
			return { kind: "single-surface-resident" };
		}
		return {
			kind: "portal-scene-domains",
			baseScene: {
				envCellId: residency.envCellId,
				kind: "interior",
				landblockId: residency.landblockId,
			},
			transitionDepthPolicy: { maxDepth: DEFAULT_TRANSITION_PORTAL_MAX_DEPTH },
		};
	}

	const exteriorLandblockId =
		residency.kind === "outdoor-landblock"
			? residency.landblockId
			: (residency.landblockId ?? fallbackExteriorLandblockId);
	if (exteriorLandblockId === null) {
		return { kind: "single-surface-resident" };
	}
	if (!hasPortalInteriorScene(exteriorLandblockId)) {
		return { kind: "single-surface-resident" };
	}

	return {
		kind: "portal-scene-domains",
		baseScene: {
			kind: "exterior",
			landblockId: exteriorLandblockId,
		},
		transitionDepthPolicy: { maxDepth: DEFAULT_TRANSITION_PORTAL_MAX_DEPTH },
	};
}

function renderPassPlanEquals(
	left: RenderPassPlan,
	right: RenderPassPlan,
): boolean {
	if (left.kind !== right.kind) {
		return false;
	}

	if (left.kind === "single-surface-resident") {
		return true;
	}
	if (right.kind === "single-surface-resident") {
		return false;
	}

	if (
		left.transitionDepthPolicy.maxDepth !== right.transitionDepthPolicy.maxDepth
	) {
		return false;
	}

	const leftBase = left.baseScene;
	const rightBase = right.baseScene;
	if (
		leftBase.kind !== rightBase.kind ||
		leftBase.landblockId !== rightBase.landblockId
	) {
		return false;
	}

	if (leftBase.kind !== "interior" || rightBase.kind !== "interior") {
		return true;
	}

	return leftBase.envCellId === rightBase.envCellId;
}

function portalFramePlanKeysEqual(
	left: PortalFramePlanKey,
	right: PortalFramePlanKey,
): boolean {
	if (
		left.kind !== right.kind ||
		left.landblockId !== right.landblockId ||
		left.maxDepth !== right.maxDepth ||
		left.portalOverlapSignature !== right.portalOverlapSignature ||
		left.renderAnchorLandblockId !== right.renderAnchorLandblockId ||
		(left.kind === "env-cell-projection" &&
			right.kind === "env-cell-projection" &&
			left.envCellSystemGenerationId !== right.envCellSystemGenerationId)
	) {
		return false;
	}
	if (left.kind === "env-cell-projection") {
		return (
			right.kind === "env-cell-projection" &&
			left.maxRenderEntries === right.maxRenderEntries &&
			left.maxMaskEdges === right.maxMaskEdges &&
			left.envCellId === right.envCellId &&
			left.exteriorSuffixMaxDepth === right.exteriorSuffixMaxDepth &&
			left.retainedProjectionSourceKey === right.retainedProjectionSourceKey
		);
	}
	return (
		right.kind === "outdoor-transition" &&
		left.maxRenderEntries === right.maxRenderEntries &&
		left.maxMaskEdges === right.maxMaskEdges &&
		left.retainedProjectionSourceKey === right.retainedProjectionSourceKey
	);
}

function createRetainedOutdoorProjectionSourceKey(
	projections: readonly StaticPortalProjectionRecord[],
): string {
	return projections
		.map(
			(projection) =>
				`${formatHex32(projection.landblockId)}:${projection.sourceRevisionKey}`,
		)
		.sort()
		.join("|");
}

function collectDirectEnvCellFrameEnvCellIds(
	graph: PortalProjectionFrameGraphPlan,
): ReadonlySet<number> {
	const envCellIds = new Set<number>();
	if (graph.baseEntry.scene.kind === "env-cell-direct") {
		envCellIds.add(graph.baseEntry.scene.envCellId);
	}
	for (const entry of graph.renderEntries) {
		envCellIds.add(entry.envCellId);
	}
	return envCellIds;
}

function excludePortalProjectionGraphEnvCells(
	graph: PortalProjectionFrameGraphPlan,
	excludedEnvCellIds: ReadonlySet<number>,
): PortalProjectionFrameGraphPlan {
	if (excludedEnvCellIds.size === 0) {
		return graph;
	}

	const retainedRenderEntryIds = new Set(
		graph.renderEntries
			.filter((entry) => !excludedEnvCellIds.has(entry.envCellId))
			.map((entry) => entry.renderEntryId),
	);
	const retainedMaskEdgeIds = new Set(
		graph.maskEdges
			.filter(
				(edge) =>
					retainedRenderEntryIds.has(edge.renderEntryId) &&
					!excludedEnvCellIds.has(edge.targetEnvCellId) &&
					(edge.sourceEnvCellId === null ||
						!excludedEnvCellIds.has(edge.sourceEnvCellId)),
			)
			.map((edge) => edge.edgeId),
	);
	const renderEntries = graph.renderEntries
		.filter((entry) => retainedRenderEntryIds.has(entry.renderEntryId))
		.map((entry) => ({
			...entry,
			incomingMaskEdgeIds: entry.incomingMaskEdgeIds.filter((edgeId) =>
				retainedMaskEdgeIds.has(edgeId),
			),
		}));
	const renderEntryIds = new Set(
		renderEntries.map((entry) => entry.renderEntryId),
	);
	const renderLayers = graph.renderLayers
		.map((layer) => ({
			...layer,
			renderEntryIds: layer.renderEntryIds.filter((renderEntryId) =>
				renderEntryIds.has(renderEntryId),
			),
		}))
		.filter((layer) => layer.renderEntryIds.length > 0);
	const maskEdges = graph.maskEdges.filter((edge) =>
		retainedMaskEdgeIds.has(edge.edgeId),
	);
	const outdoorCrossings = graph.outdoorCrossings.filter(
		(crossing) => !excludedEnvCellIds.has(crossing.targetEnvCellId),
	);
	return {
		...graph,
		maskEdges,
		outdoorCrossings,
		projectionDiagnostics: {
			...graph.projectionDiagnostics,
			outdoorCrossingCount: outdoorCrossings.length,
			renderEntryCount: renderEntries.length,
		},
		renderEntries,
		renderLayers,
	};
}

function cameraResidencyEquals(
	left: RuntimeCameraResidency,
	right: RuntimeCameraResidency,
): boolean {
	if (left.kind !== right.kind || left.landblockId !== right.landblockId) {
		return false;
	}

	if (left.kind !== "env-cell" || right.kind !== "env-cell") {
		return true;
	}

	return left.envCellId === right.envCellId;
}

function createSceneInterestSummary(
	interest: RuntimeSceneInterest,
): string | null {
	if (interest.kind === "none") {
		return null;
	}

	if (interest.kind === "interior-cell") {
		return [
			interest.source,
			"interior-cell",
			`0x${formatHex32(interest.landblockId)}`,
			`0x${formatHex32(interest.envCellId)}`,
		].join("|");
	}

	return [
		interest.source,
		"outdoor-anchor",
		`0x${formatHex32(interest.anchorLandblockId)}`,
		interest.domains.join(","),
	].join("|");
}

function assertPositiveFiniteIntervalMs(value: number, label: string): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${label} must be a positive finite number.`);
	}
}

interface UnrefableTimer {
	unref(): void;
}

function unrefTimerIfAvailable(timer: unknown): void {
	if (!isUnrefableTimer(timer)) {
		return;
	}

	timer.unref();
}

function isUnrefableTimer(timer: unknown): timer is UnrefableTimer {
	return (
		typeof timer === "object" &&
		timer !== null &&
		"unref" in timer &&
		typeof (timer as { readonly unref?: unknown }).unref === "function"
	);
}

function getSceneInterestSource(
	interest: RuntimeSceneInterest,
): RuntimeSceneInterestSource {
	return interest.kind === "none" ? "none" : interest.source;
}

function createStaticCoordinatorDiagnosticsReport(
	snapshot: StaticCoordinatorSnapshot,
): Omit<StaticCoordinatorDiagnosticsReport, "kind"> {
	const inFlightWork = snapshot.activeWork
		.filter(isInFlightStaticWorkStatus)
		.map((work) => createStaticCoordinatorWorkDiagnostics(work));
	const recentFailures = snapshot.activeWork
		.filter(isFailedStaticWorkStatus)
		.slice(-STATIC_DIAGNOSTICS_FAILURE_LIMIT)
		.map((work) => createStaticCoordinatorWorkDiagnostics(work));

	const targetStaticObjectBakeDiagnostics =
		snapshot.staticObjectBakeDiagnostics.filter(
			(diagnostics) =>
				diagnostics.domain === "outdoor-detail" && diagnostics.objectCount > 0,
		);

	const report: Omit<StaticCoordinatorDiagnosticsReport, "kind"> = {
		materialCoverageSummary: createStaticMaterialCoverageSummary(
			snapshot.materialCoverage,
		),
		staticObjectBakeSummary: createStaticObjectBakeSummary(
			targetStaticObjectBakeDiagnostics,
		),
		summary: {
			baking: snapshot.baking,
			committed: snapshot.committed,
			committedDrawUnits: snapshot.committedDrawUnits,
			failed: snapshot.failed,
			requested: snapshot.requested,
			resolving: snapshot.resolving,
			revision: snapshot.revision,
			staleBakeResults: snapshot.staleBakeResults,
			staleResolverResults: snapshot.staleResolverResults,
		},
		timingSummary: createStaticCoordinatorTimingSummary(snapshot.recentTiming),
	};
	return {
		...report,
		...(inFlightWork.length > 0 ? { inFlightWork } : {}),
		...(recentFailures.length > 0 ? { recentFailures } : {}),
	};
}

function createRendererDiagnosticsSummary(
	snapshot: RendererSnapshot,
): RendererDiagnosticsSummary {
	return {
		backend: snapshot.backend,
		canvasHeight: snapshot.canvasHeight,
		canvasWidth: snapshot.canvasWidth,
		debugOverlayPrimitives: snapshot.debugOverlayPrimitives,
		directEnvCellDrawCalls: snapshot.directEnvCellDrawCalls,
		dynamicInstances: snapshot.dynamicInstances,
		dynamicVisualResources: snapshot.dynamicVisualResources,
		dynamicVisualResourceTextureUses: snapshot.dynamicVisualResourceTextureUses,
		error: snapshot.error,
		frameCount: snapshot.frameCount,
		frameHandlerMs: snapshot.frameHandlerMs,
		isRunning: snapshot.isRunning,
		outdoorDetailStaticObjectResources:
			snapshot.outdoorDetailStaticObjectResources,
		outdoorDetailStaticObjectBakedDirectDrawCalls:
			snapshot.outdoorDetailStaticObjectBakedDirectDrawCalls,
		outdoorDetailStaticObjectBakedDirectDrawCallsByPass:
			snapshot.outdoorDetailStaticObjectBakedDirectDrawCallsByPass,
		outdoorDetailStaticObjectRenderInstances:
			snapshot.outdoorDetailStaticObjectRenderInstances,
		outdoorDetailStaticObjectVisualResources:
			snapshot.outdoorDetailStaticObjectVisualResources,
		outdoorDetailStaticObjectUploadedBufferBytes:
			snapshot.outdoorDetailStaticObjectUploadedBufferBytes,
		renderedTriangles: snapshot.renderedTriangles,
		renderPassKind: snapshot.renderPassPlan.kind,
		staticDrawUnits: snapshot.staticDrawUnits,
		skippedDynamicSubmissions: snapshot.skippedDynamicSubmissions,
		staticObjectBakedDirectDrawCalls: snapshot.staticObjectBakedDirectDrawCalls,
		staticObjectDirectRenderInstanceDrawCalls:
			snapshot.staticObjectDirectRenderInstanceDrawCalls,
		staticObjectInstancedRenderInstanceDrawCalls:
			snapshot.staticObjectInstancedRenderInstanceDrawCalls,
		staticObjectInstancedRenderInstances:
			snapshot.staticObjectInstancedRenderInstances,
		staticObjectNearTransparentDirectRenderInstanceDrawCalls:
			snapshot.staticObjectNearTransparentDirectRenderInstanceDrawCalls,
		staticObjectFarTransparentDirectRenderInstanceDrawCalls:
			snapshot.staticObjectFarTransparentDirectRenderInstanceDrawCalls,
		staticObjectFarTransparentInstancedRenderInstanceDrawCalls:
			snapshot.staticObjectFarTransparentInstancedRenderInstanceDrawCalls,
		staticObjectFarTransparentInstancedRenderInstances:
			snapshot.staticObjectFarTransparentInstancedRenderInstances,
		staticObjectRenderInstances: snapshot.staticObjectRenderInstances,
		staticObjectResources: snapshot.staticObjectResources,
		staticObjectUploadSummary: createStaticObjectUploadSummary(
			snapshot.recentStaticObjectUploads,
		),
		staticObjectUploadedBufferBytes: snapshot.staticObjectUploadedBufferBytes,
		staticObjectVisualResources: snapshot.staticObjectVisualResources,
		terrainDrawUnits: snapshot.terrainDrawUnits,
	};
}

function createDynamicSelectionEntityDiagnostics(
	record: DynamicEntitySummaryDto,
): DynamicSelectionEntityDiagnostics {
	return {
		animation: createDynamicSelectionAnimationDiagnostics(record),
		bounds: {
			currentBounds: record.bounds.currentBounds,
			indexed: record.bounds.indexed,
			indexMembership: record.bounds.indexMembership,
			precision: record.bounds.precision,
		},
		effectiveResidence: record.effectiveResidence,
		provenance: record.provenance,
		renderability: record.renderability,
		rendererIdentity: {
			eligible: isDynamicRendererEligible(record),
			instanceId: createDynamicRendererInstanceId(record),
			visualResourceId: createDynamicRendererVisualResourceId(record),
		},
		resources: {
			required: record.resources.required,
			setupAnimation: record.resources.setupAnimation,
			status: record.resources.status,
			visual: createDynamicSelectionVisualDiagnostics(record),
		},
		source: record.source,
		sourceResidence: record.sourceResidence,
	};
}

function createDynamicSelectionAnimationDiagnostics(
	record: DynamicEntitySummaryDto,
): DynamicSelectionAnimationDiagnostics {
	const playback = record.animation.playback;
	if (playback.status !== "playing") {
		return {
			activeTransformEffects: [],
			currentFrameIndex: null,
			elapsedSeconds: null,
			frameCount: null,
			frameNumber: null,
			partCount: null,
			status: record.animation.status,
		};
	}

	return {
		activeTransformEffects: createDynamicSelectionTransformEffects(playback),
		currentFrameIndex: playback.currentFrameIndex,
		elapsedSeconds: playback.elapsedSeconds,
		frameCount: playback.frameCount,
		frameNumber: playback.frameNumber,
		partCount: playback.partCount,
		status: record.animation.status,
	};
}

function createDynamicSelectionTransformEffects(
	playback: Extract<
		DynamicEntitySummaryDto["animation"]["playback"],
		{ readonly status: "playing" }
	>,
): readonly DynamicSelectionTransformEffectDiagnostics[] {
	const activeOmega = playback.transformEffects.activeOmega;
	return activeOmega === null
		? []
		: [
				{
					hookName: activeOmega.hookName,
					hookType: activeOmega.hookType,
					kind: "omega",
					lastAppliedFrameIndex: activeOmega.lastAppliedFrameIndex,
					lastAppliedLoopIteration: activeOmega.lastAppliedLoopIteration,
					omega: activeOmega.omega,
				},
			];
}

function createDynamicSelectionVisualDiagnostics(
	record: DynamicEntitySummaryDto,
): DynamicSelectionVisualDiagnostics {
	const visual = record.resources.visual;
	if (visual.status === "ready") {
		return {
			materialSlotCount: visual.materialSlots.length,
			renderPartCount: visual.renderParts.length,
			sourceAssetCount: visual.sourceAssets.length,
			status: "ready",
			textureRequirementCount: visual.textureRequirements.length,
		};
	}
	if (visual.status === "failed") {
		return {
			failureCount: visual.failures.length,
			missingRefCount: visual.missingRefs.length,
			status: "failed",
			unsupportedReasonCount: visual.unsupportedReasons.length,
		};
	}
	return {
		status: visual.status,
	};
}

function createDynamicSelectionRendererDiagnostics(
	snapshot: RendererSnapshot,
): DynamicSelectionRendererDiagnostics {
	return {
		dynamicInstances: snapshot.dynamicInstances,
		dynamicVisualResources: snapshot.dynamicVisualResources,
		dynamicVisualResourceTextureUses: snapshot.dynamicVisualResourceTextureUses,
		skippedDynamicSubmissions: snapshot.skippedDynamicSubmissions,
	};
}

function createDynamicRendererVisualResource(
	record: DynamicEntitySummaryDto,
): readonly DynamicRendererVisualResource[] {
	const visual = record.resources.visual;
	if (visual.status !== "ready" || !isDynamicRendererEligible(record)) {
		return [];
	}
	return [
		{
			entityId: record.id,
			materialPlan: {
				skipped: [],
				textureUses: visual.textureRequirements.map((requirement) => ({
					role: requirement.role,
					samplingPolicy: requirement.samplingPolicy,
					source: requirement.dataUse,
					textureUseId: requirement.textureUseId,
				})),
			},
			parts: visual.renderParts.map((part) => ({
				bounds: part.bounds,
				indices: part.indices,
				indexType: part.indexType,
				materialEntries: part.materialEntries,
				materialFamily: part.materialFamily,
				materialPass: part.materialPass,
				materialSlotIndices: part.materialSlotIndices,
				partIndex: part.partIndex,
				positions: part.positions,
				renderState: part.renderState,
				sourceAssetId: part.sourceAssetId,
				texCoords: part.texCoords,
				textureUseIds: part.textureUseIds,
				triangleCount: part.triangleCount,
				vertexCount: part.vertexCount,
			})),
			resourceId: createDynamicRendererVisualResourceId(record),
		},
	];
}

function createDynamicTextureUseCommits(
	resource: DynamicRendererVisualResource,
	records: readonly DynamicEntitySummaryDto[],
	staticBatchIdsBySourceScope: ReadonlyMap<string, string>,
): readonly DynamicTextureUseCommit[] {
	const record = records.find(
		(candidate) => candidate.id === resource.entityId,
	);
	if (!record) {
		throw new Error(
			`Cannot create dynamic texture uses for unknown entity ${resource.entityId}.`,
		);
	}
	const atlasDomain = createDynamicRendererAtlasDomain(record);
	const atlasBatchId =
		staticBatchIdsBySourceScope.get(
			createStaticBatchLookupKey(
				record.provenance.owner.domain,
				record.provenance.owner.scopeKey,
			),
		) ?? `dynamic:${record.provenance.sourceScopeKey}`;
	return resource.materialPlan.textureUses.map((textureUse) => ({
		atlasBatchId,
		atlasDomain,
		owner: {
			kind: "dynamic-visual-resource",
			resourceId: resource.resourceId,
		},
		samplingPolicy: textureUse.samplingPolicy,
		source: textureUse.source,
		textureUseId: textureUse.textureUseId,
	}));
}

function createDynamicRendererInstances(
	record: DynamicEntitySummaryDto,
): readonly {
	readonly entityId: string;
	readonly instanceId: string;
	readonly objectToRenderMatrix: readonly number[];
	readonly partToObjectMatrices: readonly {
		readonly matrix: readonly number[];
		readonly partIndex: number;
	}[];
	readonly renderResidence:
		| {
				readonly kind: "outdoor-landblock";
				readonly landblockId: number;
		  }
		| {
				readonly envCellId: number;
				readonly kind: "env-cell";
				readonly landblockId: number;
		  };
	readonly resourceId: string;
}[] {
	if (
		record.resources.visual.status !== "ready" ||
		record.animation.playback.status !== "playing" ||
		!isDynamicRendererEligible(record)
	) {
		return [];
	}
	const playback = record.animation.playback;
	const objectToRenderMatrix = multiplyMat4(
		multiplyMat4(
			buildAcPlacementMatrix(
				record.baseTransform.baseLocalPlacement,
				record.baseTransform.sourceScale,
			),
			buildAcPlacementMatrix(playback.objectRootPose, AC_UNIT_SCALE),
		),
		buildAcPlacementMatrix(
			createDynamicObjectRootOmegaPlacement(
				playback.transformEffects.activeOmega?.objectRootRotation ?? null,
			),
			AC_UNIT_SCALE,
		),
	);
	return [
		{
			entityId: record.id,
			instanceId: createDynamicRendererInstanceId(record),
			objectToRenderMatrix: Array.from(objectToRenderMatrix),
			partToObjectMatrices: playback.partPoses.map((pose) => ({
				matrix: Array.from(
					buildAcPlacementMatrix(pose.localPlacement, AC_UNIT_SCALE),
				),
				partIndex: pose.partIndex,
			})),
			renderResidence: record.effectiveResidence,
			resourceId: createDynamicRendererVisualResourceId(record),
		},
	];
}

function createDynamicObjectRootOmegaPlacement(
	objectRootRotation: {
		readonly w: number;
		readonly x: number;
		readonly y: number;
		readonly z: number;
	} | null,
): {
	readonly orientation: {
		readonly w: number;
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly origin: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
} {
	return {
		orientation: objectRootRotation ?? {
			w: 1,
			x: 0,
			y: 0,
			z: 0,
		},
		origin: { x: 0, y: 0, z: 0 },
	};
}

function isDynamicRendererEligible(record: DynamicEntitySummaryDto): boolean {
	return record.renderability.reasons.length === 0;
}

function createDynamicRendererAtlasDomain(
	record: DynamicEntitySummaryDto,
): StaticDomain {
	if (record.effectiveResidence.kind === "env-cell") {
		return "landblock-env-cells";
	}
	const ownerDomain = record.provenance.owner.domain;
	return ownerDomain === "outdoor-buildings" ? ownerDomain : "outdoor-detail";
}

function createDynamicRendererVisualResourceId(
	record: Pick<DynamicEntitySummaryDto, "id">,
): string {
	return `dynamic-visual-resource:${record.id}`;
}

function createDynamicRendererInstanceId(
	record: Pick<DynamicEntitySummaryDto, "id">,
): string {
	return `dynamic-instance:${record.id}`;
}

function createStaticBatchLookupKey(
	domain: StaticDomain,
	scopeKey: string,
): string {
	return `${domain}:${scopeKey}`;
}

function createPortalFrameWorkPlanDiagnostics(plan: PortalFrameWorkPlan) {
	if (plan.kind === "legacy-render-pass") {
		return {
			kind: plan.kind,
			mode: plan.mode,
			renderPassKind: plan.renderPassPlan.kind,
		};
	}

	return {
		apertureResourceCount: plan.layeredGraph.apertureResources.length,
		baseScene: describePortalFrameBaseScene(plan.layeredGraph.baseEntry.scene),
		envCellPortalEdgeCount: plan.layeredGraph.diagnostics.envCellPortalEdges,
		kind: plan.kind,
		maskEdgeCount: plan.layeredGraph.maskEdges.length,
		mode: plan.mode,
		renderEntryCount: plan.layeredGraph.renderEntries.length,
		renderLayerCount: plan.layeredGraph.renderLayers.length,
		selectedMaskEdgeCount: plan.layeredGraph.diagnostics.selectedMaskEdges,
		transitionRootCount: plan.layeredGraph.diagnostics.transitionRootCount,
	};
}

function describePortalFrameBaseScene(
	scene: Extract<
		PortalFrameWorkPlan,
		{ readonly kind: "direct-env-cell" }
	>["layeredGraph"]["baseEntry"]["scene"],
): string {
	if (scene.kind === "outdoor-target") {
		return `outdoor:${formatHex(scene.landblockId)}`;
	}
	return `env-cell:${formatHex(scene.landblockId)}:${formatHex(scene.envCellId)}`;
}

function createStaticObjectUploadSummary(
	uploads: readonly StaticObjectUploadDiagnostics[],
): RendererDiagnosticsSummary["staticObjectUploadSummary"] {
	const largestUpload = uploads.reduce<StaticObjectUploadDiagnostics | null>(
		(largest, upload) =>
			largest === null ||
			upload.uploadedBufferBytes > largest.uploadedBufferBytes
				? upload
				: largest,
		null,
	);

	return {
		largestUpload:
			largestUpload === null
				? null
				: {
						domain: largestUpload.domain,
						drawUnitCount: largestUpload.drawUnitCount,
						landblockId: formatHex(largestUpload.landblockId),
						uploadedBufferBytes: largestUpload.uploadedBufferBytes,
						uploadMs: roundMilliseconds(largestUpload.uploadMs),
					},
		recentUploadCount: uploads.length,
		totalDrawUnits: sumNumbers(uploads.map((upload) => upload.drawUnitCount)),
		totalUploadedBufferBytes: sumNumbers(
			uploads.map((upload) => upload.uploadedBufferBytes),
		),
		totalUploadMs: roundMilliseconds(
			sumNumbers(uploads.map((upload) => upload.uploadMs)),
		),
	};
}

function createStaticMaterialCoverageSummary(
	coverages: readonly StaticMaterialCoverageReport[],
): StaticCoordinatorDiagnosticsReport["materialCoverageSummary"] {
	const fallbackReasonCounts: Record<string, number> = {};

	for (const coverage of coverages) {
		for (const reason of coverage.fallbackReasonCounts) {
			fallbackReasonCounts[reason.code] =
				(fallbackReasonCounts[reason.code] ?? 0) + reason.count;
		}
	}

	return {
		deferredTriangles: sumNumbers(
			coverages.map((coverage) => coverage.deferredTriangleCount),
		),
		fallbackReasonCounts,
		materialCount: sumNumbers(
			coverages.map((coverage) => coverage.materialCount),
		),
		partitionCount: sumNumbers(
			coverages.map((coverage) => coverage.partitionCount),
		),
		renderedTriangles: sumNumbers(
			coverages.map((coverage) => coverage.renderedTriangleCount),
		),
		reportCount: coverages.length,
		triangleCount: sumNumbers(
			coverages.map((coverage) => coverage.triangleCount),
		),
		unrenderedBucketCount: sumNumbers(
			coverages.map((coverage) => coverage.unrenderedBuckets.length),
		),
		unsupportedTriangles: sumNumbers(
			coverages.map((coverage) => coverage.unsupportedTriangleCount),
		),
	};
}

function createStaticObjectBakeSummary(
	diagnostics: readonly StaticObjectBakeDiagnostics[],
): StaticCoordinatorDiagnosticsReport["staticObjectBakeSummary"] {
	const largestBake = diagnostics.reduce<StaticObjectBakeDiagnostics | null>(
		(largest, entry) =>
			largest === null ||
			entry.estimatedFlattenedTypedArrayBytes >
				largest.estimatedFlattenedTypedArrayBytes
				? entry
				: largest,
		null,
	);

	return {
		drawUnitCount: sumNumbers(diagnostics.map((entry) => entry.drawUnitCount)),
		estimatedFlattenedTypedArrayBytes: sumNumbers(
			diagnostics.map((entry) => entry.estimatedFlattenedTypedArrayBytes),
		),
		estimatedAvoidedFlattenedTriangleCount: sumNumbers(
			diagnostics.map((entry) => entry.estimatedAvoidedFlattenedTriangleCount),
		),
		estimatedAvoidedFlattenedTypedArrayBytes: sumNumbers(
			diagnostics.map(
				(entry) => entry.estimatedAvoidedFlattenedTypedArrayBytes,
			),
		),
		estimatedInstancedSourceTypedArrayBytes: sumNumbers(
			diagnostics.map((entry) => entry.estimatedInstancedSourceTypedArrayBytes),
		),
		explicitObjectCount: sumNumbers(
			diagnostics.map((entry) => entry.explicitObjectCount),
		),
		flattenedTriangleCount: sumNumbers(
			diagnostics.map((entry) => entry.flattenedTriangleCount),
		),
		flattenedVertexCount: sumNumbers(
			diagnostics.map((entry) => entry.flattenedVertexCount),
		),
		generatedInstanceCount: sumNumbers(
			diagnostics.map((entry) => entry.generatedInstanceCount),
		),
		bakedInstancedRenderInstanceCount: sumNumbers(
			diagnostics.map((entry) => entry.instancedRenderInstanceCount),
		),
		instancedSourceTriangleCount: sumNumbers(
			diagnostics.map((entry) => entry.instancedSourceTriangleCount),
		),
		bakedInstancedVisualResourceCount: sumNumbers(
			diagnostics.map((entry) => entry.instancedVisualResourceCount),
		),
		largestBake:
			largestBake === null
				? null
				: {
						domain: largestBake.domain,
						drawUnitCount: largestBake.drawUnitCount,
						estimatedAvoidedFlattenedTypedArrayBytes:
							largestBake.estimatedAvoidedFlattenedTypedArrayBytes,
						estimatedFlattenedTypedArrayBytes:
							largestBake.estimatedFlattenedTypedArrayBytes,
						flattenedTriangleCount: largestBake.flattenedTriangleCount,
						generatedInstanceCount: largestBake.generatedInstanceCount,
						bakedInstancedRenderInstanceCount:
							largestBake.instancedRenderInstanceCount,
						bakedInstancedVisualResourceCount:
							largestBake.instancedVisualResourceCount,
						landblockId: formatHex(largestBake.landblockId),
						objectCount: largestBake.objectCount,
						uniqueSourceCount: largestBake.uniqueSourceCount,
					},
		objectCount: sumNumbers(diagnostics.map((entry) => entry.objectCount)),
		partitionCount: sumNumbers(
			diagnostics.map((entry) => entry.partitionCount),
		),
		reportCount: diagnostics.length,
		retainedTransparentOutdoorDetailPartitionReasons:
			sumRetainedTransparentOutdoorDetailPartitionReasons(diagnostics),
		uniqueSourceCount: sumNumbers(
			diagnostics.map((entry) => entry.uniqueSourceCount),
		),
		uniqueSourcePartGeometryCount: sumNumbers(
			diagnostics.map((entry) => entry.uniqueSourcePartGeometryCount),
		),
		uniqueSourceTriangleCount: sumNumbers(
			diagnostics.map((entry) => entry.uniqueSourceTriangleCount),
		),
	};
}

function sumRetainedTransparentOutdoorDetailPartitionReasons(
	diagnostics: readonly StaticObjectBakeDiagnostics[],
): StaticObjectBakeDiagnostics["retainedTransparentOutdoorDetailPartitionReasons"] {
	return {
		explicitObject: sumNumbers(
			diagnostics.map(
				(entry) =>
					entry.retainedTransparentOutdoorDetailPartitionReasons.explicitObject,
			),
		),
		missingInstanceBounds: sumNumbers(
			diagnostics.map(
				(entry) =>
					entry.retainedTransparentOutdoorDetailPartitionReasons
						.missingInstanceBounds,
			),
		),
		nonRenderableOrDeferredMaterialBucket: sumNumbers(
			diagnostics.map(
				(entry) =>
					entry.retainedTransparentOutdoorDetailPartitionReasons
						.nonRenderableOrDeferredMaterialBucket,
			),
		),
		oneOffGeneratedSource: sumNumbers(
			diagnostics.map(
				(entry) =>
					entry.retainedTransparentOutdoorDetailPartitionReasons
						.oneOffGeneratedSource,
			),
		),
		repeatedGeneratedSourceRetainedByPartitionPolicy: sumNumbers(
			diagnostics.map(
				(entry) =>
					entry.retainedTransparentOutdoorDetailPartitionReasons
						.repeatedGeneratedSourceRetainedByPartitionPolicy,
			),
		),
		unsupportedMaterialBucket: sumNumbers(
			diagnostics.map(
				(entry) =>
					entry.retainedTransparentOutdoorDetailPartitionReasons
						.unsupportedMaterialBucket,
			),
		),
	};
}

function createStaticCoordinatorTimingSummary(
	timings: readonly StaticCoordinatorTimingDiagnostics[],
): StaticCoordinatorDiagnosticsReport["timingSummary"] {
	return {
		attachmentMs: roundMilliseconds(
			sumNumbers(
				timings.map((timing) => nullableMilliseconds(timing.attachmentMs)),
			),
		),
		bakeMs: roundMilliseconds(
			sumNumbers(timings.map((timing) => nullableMilliseconds(timing.bakeMs))),
		),
		commitMs: roundMilliseconds(
			sumNumbers(
				timings.map((timing) => nullableMilliseconds(timing.commitMs)),
			),
		),
		reportCount: timings.length,
		resolverMs: roundMilliseconds(
			sumNumbers(
				timings.map((timing) => nullableMilliseconds(timing.resolverMs)),
			),
		),
		slowestBake: createTimingSample(
			maxByNullableNumber(timings, (timing) => timing.bakeMs),
		),
		slowestResolver: createTimingSample(
			maxByNullableNumber(timings, (timing) => timing.resolverMs),
		),
		totalItemCount: sumNumbers(timings.map((timing) => timing.itemCount)),
	};
}

function createTimingSample(
	timing: StaticCoordinatorTimingDiagnostics | null,
): StaticCoordinatorDiagnosticsReport["timingSummary"]["slowestBake"] {
	if (timing === null) {
		return null;
	}
	return {
		attachmentMs: roundNullableMilliseconds(timing.attachmentMs),
		bakeMs: roundNullableMilliseconds(timing.bakeMs),
		commitMs: roundNullableMilliseconds(timing.commitMs),
		domain: timing.domain,
		itemCount: timing.itemCount,
		resolverMs: roundNullableMilliseconds(timing.resolverMs),
	};
}

function maxByNullableNumber<T>(
	items: readonly T[],
	getValue: (item: T) => number | null,
): T | null {
	let maxItem: T | null = null;
	let maxValue = Number.NEGATIVE_INFINITY;
	for (const item of items) {
		const value = getValue(item);
		if (value !== null && value > maxValue) {
			maxItem = item;
			maxValue = value;
		}
	}
	return maxItem;
}

function nullableMilliseconds(value: number | null): number {
	return value ?? 0;
}

function roundNullableMilliseconds(value: number | null): number | null {
	return value === null ? null : roundMilliseconds(value);
}

function roundMilliseconds(value: number): number {
	return Math.round(value * 100) / 100;
}

function sumNumbers(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0);
}

type StaticCoordinatorReportWorkStatus = Exclude<
	ScheduledStaticWorkStatus["status"],
	"committed" | "source-committed"
>;

type StaticCoordinatorReportWork = ScheduledStaticWorkStatus & {
	readonly status: StaticCoordinatorReportWorkStatus;
};

function isInFlightStaticWorkStatus(
	work: ScheduledStaticWorkStatus,
): work is ScheduledStaticWorkStatus & {
	readonly status: "baking" | "requested" | "resolving";
} {
	return (
		work.status === "requested" ||
		work.status === "resolving" ||
		work.status === "baking"
	);
}

function isFailedStaticWorkStatus(
	work: ScheduledStaticWorkStatus,
): work is ScheduledStaticWorkStatus & { readonly status: "failed" } {
	return work.status === "failed";
}

function createStaticCoordinatorWorkDiagnostics(
	work: StaticCoordinatorReportWork,
): StaticCoordinatorWorkReportDiagnostics {
	return {
		domain: work.domain,
		revision: work.revision,
		scopeKey: work.scopeKey,
		status: work.status,
		workId: work.workId,
	};
}

function formatHex(value: number): string {
	return `0x${value.toString(16).padStart(8, "0")}`;
}

function normalizeDirectEnvCellPortalMaxDepth(maxDepth: number): number {
	if (!Number.isFinite(maxDepth)) {
		return DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH;
	}
	return Math.min(
		MAX_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH,
		Math.max(MIN_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH, Math.trunc(maxDepth)),
	);
}

function createStaticDemandFromSceneInterest(
	interest: RuntimeSceneInterest,
): StaticDemand {
	if (interest.kind === "none") {
		return {
			location: null,
			lod: {
				buildings: -1,
				detail: -1,
				envCells: -1,
				terrain: -1,
			},
		};
	}

	if (interest.kind === "interior-cell") {
		return {
			location: {
				envCellId: interest.envCellId,
				kind: "interior-cell",
				landblockId: interest.landblockId,
			},
			lod: {
				buildings: -1,
				detail: -1,
				envCells: 0,
				terrain: -1,
			},
		};
	}

	const lod: StaticLodRadii = {
		buildings: interest.domains.includes("buildings")
			? (interest.lod?.buildings ?? 0)
			: -1,
		detail: interest.domains.includes("detail")
			? (interest.lod?.detail ?? 0)
			: -1,
		terrain: interest.domains.includes("terrain")
			? (interest.lod?.terrain ?? 0)
			: -1,
		envCells: interest.domains.includes("env-cells")
			? (interest.lod?.envCells ?? 0)
			: -1,
	};

	return {
		location: {
			kind: "outdoor-landblock",
			landblockId: interest.anchorLandblockId,
		},
		lod,
	};
}
