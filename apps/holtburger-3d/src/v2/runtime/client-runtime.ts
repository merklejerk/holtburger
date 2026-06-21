import { HostBackedAssetService } from "../assets/asset-service";
import type { AssetService, AssetServiceSnapshot } from "../assets/contracts";
import type { RuntimeHost, RuntimeHostSnapshot } from "../host/contracts";
import type {
	Renderer,
	RendererFrameTelemetry,
	RendererSnapshot,
	RenderPassPlan,
	PortalFrameWorkPlan,
} from "../renderer/types";
import type { DebugOverlayPrimitive, FrameState } from "../renderer/types";
import {
	createLegacyPortalFrameWorkPlan,
	portalFrameWorkPlanEquals,
} from "../renderer/portal-frame-work-plan";
import {
	createDirectEnvCellFramePlan,
	createOutdoorProjectionPortalFramePlan,
} from "./direct-env-cell-frame-plan";
import { formatHex32, normalizeOutdoorLandblockId } from "../../lib/landblocks";
import { TextureManager } from "../textures/texture-manager";
import type { TexturePacker } from "../textures/packing/packer";
import type { TextureFilteringMode } from "../textures/sampling-policy";
import {
	createAssetServiceDiagnosticsReport,
	createConsoleRuntimeDiagnostics,
	type RuntimeDiagnostics,
	type RuntimeDiagnosticsReport,
	type StaticCoordinatorDiagnosticsReport,
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
	TransitionApertureBatch,
} from "../static/contracts";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
} from "../static/bake/ac-placement-transform";
import { collectStaticDrawUnitResourceIds } from "../static/contracts";
import {
	materializeStaticCommit,
	type StaticMaterializationResult,
} from "./static-materializer";
import {
	StaticSceneQuery,
	createEnvCellPortalSelectionKey,
	describeStaticSceneSelectionKey,
	type EnvCellStaticScenePickDetails,
	type OutdoorStaticObjectSourceDiagnostics,
	type OutdoorStaticObjectScenePickDetails,
	type StaticScenePickRequest,
	type StaticScenePickHit,
	type StaticSceneCameraResidency,
	type StaticSceneEnvCellBounds,
	type StaticSceneQuerySnapshot,
	type StaticSceneSelectionKey,
	type StaticSceneTerrainLandblockBounds,
	type Vec3,
	type TerrainQuadScenePickDetails,
} from "./static-scene-query";
import { createOutdoorLandblockRootTranslation } from "./static-placement";
import {
	createEnvCellResourceMembershipIndex,
	createEnvCellResourceMembershipSnapshot,
	envCellResourceMembershipSnapshotsEqual,
	type EnvCellResourceMembership,
} from "./env-cell-resource-membership";

const STATIC_DIAGNOSTICS_FAILURE_LIMIT = 8;
const TERRAIN_TEXTURE_DIAGNOSTICS_EVENT_LIMIT = 8;
const BLENDED_STATIC_AUDIT_WARNING_BUCKET_LIMIT = 8;
const DEFAULT_ASSET_MAINTENANCE_INTERVAL_MS = 5_000;
const DEFAULT_TRANSITION_PORTAL_MAX_DEPTH = 4;
const DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH = 2;
const MAX_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH = 16;
const DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_CELLS = 512;
const DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_VIEWS = 512;

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

export interface RuntimeSceneInterestUpdatedEvent {
	readonly interest: RuntimeSceneInterest;
	readonly kind: "scene-interest-updated";
	readonly revision: number;
	readonly source: RuntimeSceneInterestSource;
}

export interface RuntimeSceneInterestSettledEvent {
	readonly interest: RuntimeSceneInterest;
	readonly kind: "scene-interest-settled";
	readonly result: "ready" | "failed" | "cleared";
	readonly revision: number;
	readonly source: RuntimeSceneInterestSource;
}

type PortalFramePlanKey =
	| {
			readonly kind: "direct-env-cell";
			readonly envCellId: number;
			readonly envCellResourceMembershipRevision: number;
			readonly landblockId: number;
			readonly maxCells: number;
			readonly maxDepth: number;
			readonly maxPortalViews: number;
			readonly portalTraversalGraphRevision: number;
			readonly renderAnchorLandblockId: number | null;
	  }
	| {
			readonly kind: "outdoor-transition";
			readonly envCellResourceMembershipRevision: number;
			readonly landblockId: number;
			readonly maxCells: number;
			readonly maxDepth: number;
			readonly maxPortalViews: number;
			readonly projectionSourceRevisionKey: string;
			readonly renderAnchorLandblockId: number | null;
	  };

interface CachedPortalFramePlan {
	readonly key: PortalFramePlanKey;
	readonly plan: PortalFrameWorkPlan;
}

export interface RuntimeSnapshot {
	readonly status: "idle" | "static-active" | "disposed";
	readonly renderPolicy: RuntimeRenderPolicySnapshot;
	readonly sceneInterest: RuntimeSceneInterest;
	readonly currentCameraResidency: RuntimeCameraResidency;
	readonly renderPassPlan: RenderPassPlan;
	readonly portalFrameWorkPlan: PortalFrameWorkPlan;
	readonly debugOverlays: RuntimeDebugOverlaySnapshot;
	readonly assets: AssetServiceSnapshot;
	readonly host: RuntimeHostSnapshot;
	readonly renderer: RendererSnapshot;
	readonly static: StaticCoordinatorSnapshot;
	readonly staticSceneQuery: StaticSceneQuerySnapshot;
	readonly staticMaterialization: StaticMaterializationSnapshot;
}

export type TransitionApertureDebugOverlayMode =
	| "both"
	| "outdoor-to-indoor"
	| "indoor-to-outdoor";

interface RuntimeDebugOverlaySnapshot {
	readonly envCellAabbsVisible: boolean;
	readonly envCellAabbCount: number;
	readonly envCellPortalCount: number;
	readonly envCellPortalsVisible: boolean;
	readonly flatVisionModeEnabled: boolean;
	readonly transitionApertureCount: number;
	readonly transitionApertureMode: TransitionApertureDebugOverlayMode;
	readonly transitionAperturesVisible: boolean;
}

export interface StaticSelectionDiagnosticsReport {
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

export type StaticSelectionDiagnosticsDetails =
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

export interface EnvCellPortalSelectionDetails {
	readonly envCellId: number;
	readonly landblockId: number;
	readonly portal:
		| StaticPortalInteriorRecord["envCells"][number]["portals"][number]
		| null;
	readonly portalAperture: StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number];
}

export interface OutdoorStaticObjectSelectionDetails {
	readonly bvhItemIndex: number;
	readonly bvhItemKind: "static" | "building";
	readonly domain: OutdoorStaticObjectScenePickDetails["domain"];
	readonly instanceId: string;
	readonly landblockId: number;
	readonly object: StaticSelectionObjectSummary;
}

export interface StaticSelectionObjectSummary {
	readonly instanceId: string;
	readonly objectKind: "explicit-object" | "building" | "generated-scenery";
	readonly portalCount: number;
	readonly source: StaticObjectSourceSummary;
	readonly sourceAssetId: string | null;
	readonly sourceIndex: number;
}

export interface StaticObjectSourceSummary {
	readonly sourceAssetKind: StaticObjectSourceIdentity["sourceAssetKind"];
	readonly sourceDid: number;
}

export type StaticSelectionRenderingDiagnostics =
	| OutdoorStaticSelectionRenderingDiagnostics
	| UnsupportedStaticSelectionRenderingDiagnostics;

export interface OutdoorStaticSelectionRenderingDiagnostics {
	readonly kind: "outdoor-static-object-rendering";
	readonly drawUnits: readonly StaticSelectionDrawUnitDiagnostics[];
	readonly partCoverage: readonly StaticSelectionPartCoverageDiagnostics[];
	readonly source: OutdoorStaticObjectSourceDiagnosticsSummary | null;
	readonly unmatchedReason: string | null;
}

export interface UnsupportedStaticSelectionRenderingDiagnostics {
	readonly kind: "unsupported-static-selection-rendering";
	readonly reason: string;
}

export interface StaticSelectionDrawUnitDiagnostics {
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

export interface StaticSelectionDrawUnitMaterialEntryDiagnostics {
	readonly alphaTest: number;
	readonly blendMode: string;
	readonly indexTextureDid: string | null;
	readonly materialIds: readonly number[];
	readonly paletteDid: string | null;
	readonly primaryTextureDid: string | null;
	readonly slot: number;
	readonly wrapMode: "clamp" | "repeat";
}

export interface StaticSelectionSourceMappingSummaryDiagnostics {
	readonly geometrySurfaceIds: readonly number[];
	readonly materialVariantSignatures: readonly (string | null)[];
	readonly partIndices: readonly number[];
	readonly polygonCount: number;
	readonly polygonRange: StaticSelectionNumericRange | null;
	readonly sourceTriangleCount: number;
}

export interface StaticSelectionNumericRange {
	readonly max: number;
	readonly min: number;
}

export interface StaticSelectionPartCoverageDiagnostics {
	readonly drawUnitIds: readonly string[];
	readonly materialIds: readonly number[];
	readonly partIndex: number;
	readonly polygonCount: number;
	readonly polygonRange: StaticSelectionNumericRange | null;
	readonly sourceTriangleCount: number;
}

export interface OutdoorStaticObjectSourceDiagnosticsSummary {
	readonly domain: OutdoorStaticObjectSourceDiagnostics["domain"];
	readonly instanceId: string;
	readonly landblockId: number;
	readonly materialIds: readonly number[];
	readonly materialSlots: readonly StaticSelectionMaterialSlotDiagnostics[];
	readonly object: StaticSelectionObjectSummary;
	readonly sourceAsset: StaticSelectionSourceAssetDiagnostics | null;
	readonly textureRefs: StaticSelectionTextureRefSummary;
}

export interface StaticSelectionMaterialSlotDiagnostics {
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

export interface StaticSelectionSourceAssetDiagnostics {
	readonly identity: StaticObjectSourceSummary;
	readonly invalidPolygonCount: number;
	readonly materialSlotCount: number;
	readonly partCount: number;
	readonly parts: readonly StaticSelectionSourcePartDiagnostics[];
	readonly physicsPolygonCount: number;
	readonly renderTriangleCount: number;
	readonly skippedPolygonCount: number;
}

export interface StaticSelectionSourcePartDiagnostics {
	readonly geometrySurfaceIds: readonly number[];
	readonly materialIds: readonly number[];
	readonly materialSlotCount: number;
	readonly partIndex: number;
	readonly physicsPolygonCount: number;
	readonly renderTriangleCount: number;
	readonly skippedPolygonCount: number;
}

export interface StaticSelectionTextureRefSummary {
	readonly count: number;
	readonly paletteIds: readonly number[];
	readonly renderSurfaceIds: readonly number[];
	readonly surfaceTextureIds: readonly number[];
}

interface MatchedStaticSelectionDrawUnitDiagnostics {
	readonly diagnostics: StaticSelectionDrawUnitDiagnostics;
	readonly sourceMappingCoverage: readonly StaticObjectSourceMappingCoverage[];
}

interface EnvCellPortalPickTarget {
	readonly bounds: StaticBounds;
	readonly portal:
		| StaticPortalInteriorRecord["envCells"][number]["portals"][number]
		| null;
	readonly portalAperture: StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number];
	readonly selectionKey: StaticSceneSelectionKey & {
		readonly itemKind: "env-cell-portal";
	};
	readonly vertices: readonly (readonly [number, number, number])[];
}

type RuntimeSnapshotListener = (snapshot: RuntimeSnapshot) => void;
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
	pickStaticRay(request: StaticScenePickRequest): StaticScenePickHit | null;
	createStaticSelectionDiagnosticsReport(
		selectionKey: StaticSceneSelectionKey,
		options?: { readonly pickDistance?: number | null },
	): StaticSelectionDiagnosticsReport;
	setStaticDebugSelection(selectionKey: StaticSceneSelectionKey | null): void;
	setEnvCellAabbDebugOverlayVisible(visible: boolean): void;
	setEnvCellPortalDebugOverlayVisible(visible: boolean): void;
	setDirectEnvCellPortalMaxDepth(maxDepth: number): void;
	setFlatVisionModeEnabled(enabled: boolean): void;
	setTransitionApertureDebugOverlayMode(
		mode: TransitionApertureDebugOverlayMode,
	): void;
	setTransitionApertureDebugOverlayVisible(visible: boolean): void;
	setTextureFilteringMode(filteringMode: TextureFilteringMode): void;
	updateFrameState(state: FrameState): void;
	createDiagnosticsReport(): RuntimeDiagnosticsReport;
	subscribe(listener: RuntimeSnapshotListener): () => void;
	subscribeFrameTelemetry(listener: RuntimeFrameTelemetryListener): () => void;
	subscribeEvents(listener: RuntimeEventListener): () => void;
	dispose(): void;
}

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
	readonly #listeners = new Set<RuntimeSnapshotListener>();
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
	#staticDebugSelectionKey: StaticSceneSelectionKey | null = null;
	#envCellResourceMembership: readonly EnvCellResourceMembership[] = [];
	#envCellResourceMembershipByLandblock = createEnvCellResourceMembershipIndex(
		this.#envCellResourceMembership,
	);
	#envCellResourceMembershipRevision = 0;
	#envCellAabbDebugOverlayVisible = false;
	#envCellPortalDebugOverlayVisible = false;
	#flatVisionModeEnabled = false;
	#directEnvCellPortalMaxDepth = DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH;
	#transitionApertureDebugOverlayVisible = false;
	#transitionApertureDebugOverlayMode: TransitionApertureDebugOverlayMode =
		"both";
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
				this.#emit();
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
				this.#staticSceneQuery.ingestSourcePayload(delta.payload, {
					outdoorAnchorLandblockId: this.#renderAnchorLandblockId,
				});
				this.#refreshStaticDebugOverlay();
				this.#emit();
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
			this.#activeSceneWorkIds = new Set(
				reconciliation.activeWork.map((work) => work.workId),
			);
			this.#activeSceneWorkRevisions = new Set(
				reconciliation.activeWork.map((work) => work.revision),
			);
		} finally {
			this.#sceneInterestReconciliationActive = false;
		}
		this.#refreshStaticDebugOverlay();
		this.#emit();
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
		this.#updateRenderPassPlan();
		this.#refreshStaticDebugOverlay();
		this.#emit();
	}

	pickStaticRay(request: StaticScenePickRequest): StaticScenePickHit | null {
		this.#assertActive();
		const sceneHit = this.#staticSceneQuery.pickRay(request);
		if (!this.#envCellPortalDebugOverlayVisible) {
			return sceneHit;
		}

		const portalHit = this.#pickEnvCellPortalRay(request, sceneHit);
		return chooseNearestStaticSceneHit(sceneHit, portalHit);
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

	setStaticDebugSelection(selectionKey: StaticSceneSelectionKey | null): void {
		this.#assertActive();
		this.#staticDebugSelectionKey = selectionKey;
		this.#refreshStaticDebugOverlay();
		this.#emit();
	}

	setEnvCellAabbDebugOverlayVisible(visible: boolean): void {
		this.#assertActive();
		if (this.#envCellAabbDebugOverlayVisible === visible) {
			return;
		}
		this.#envCellAabbDebugOverlayVisible = visible;
		this.#refreshStaticDebugOverlay();
		this.#emit();
	}

	setEnvCellPortalDebugOverlayVisible(visible: boolean): void {
		this.#assertActive();
		if (this.#envCellPortalDebugOverlayVisible === visible) {
			return;
		}
		this.#envCellPortalDebugOverlayVisible = visible;
		this.#refreshStaticDebugOverlay();
		this.#emit();
	}

	setDirectEnvCellPortalMaxDepth(maxDepth: number): void {
		this.#assertActive();
		const normalizedMaxDepth = normalizeDirectEnvCellPortalMaxDepth(maxDepth);
		if (this.#directEnvCellPortalMaxDepth === normalizedMaxDepth) {
			return;
		}
		this.#directEnvCellPortalMaxDepth = normalizedMaxDepth;
		this.#updateRenderPassPlan();
		this.#emit();
	}

	setFlatVisionModeEnabled(enabled: boolean): void {
		this.#assertActive();
		if (this.#flatVisionModeEnabled === enabled) {
			return;
		}
		this.#flatVisionModeEnabled = enabled;
		this.#renderer.setFlatVisionModeEnabled(enabled);
		this.#updateRenderPassPlan();
		this.#emit();
	}

	setTransitionApertureDebugOverlayVisible(visible: boolean): void {
		this.#assertActive();
		if (this.#transitionApertureDebugOverlayVisible === visible) {
			return;
		}
		this.#transitionApertureDebugOverlayVisible = visible;
		this.#refreshStaticDebugOverlay();
		this.#emit();
	}

	setTransitionApertureDebugOverlayMode(
		mode: TransitionApertureDebugOverlayMode,
	): void {
		this.#assertActive();
		if (this.#transitionApertureDebugOverlayMode === mode) {
			return;
		}
		this.#transitionApertureDebugOverlayMode = mode;
		this.#refreshStaticDebugOverlay();
		this.#emit();
	}

	setTextureFilteringMode(filteringMode: TextureFilteringMode): void {
		this.#assertActive();
		const samplerUpdate = this.#textureManager.setFilteringMode(filteringMode);
		if (samplerUpdate) {
			this.#renderer.applySamplerPolicyUpdate(samplerUpdate);
		}
		this.#emit();
	}

	updateFrameState(state: FrameState): void {
		this.#assertActive();
		this.#renderer.updateFrameState(state);
	}

	createDiagnosticsReport(): RuntimeDiagnosticsReport {
		const snapshot = this.#createSnapshot();

		return {
			domains: [
				createAssetServiceDiagnosticsReport(snapshot.assets),
				{
					kind: "renderer",
					summary: snapshot.renderer,
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
				committedStaticMaterializationRevisions:
					snapshot.staticMaterialization.committedRevisions,
				currentCameraResidency: snapshot.currentCameraResidency,
				envCellResourceMembershipRevision:
					snapshot.staticMaterialization.envCellResourceMembershipRevision,
				portalFrameWorkPlan: snapshot.portalFrameWorkPlan,
				renderPassPlan: snapshot.renderPassPlan,
				sceneInterest: createSceneInterestSummary(snapshot.sceneInterest),
				materializedStaticDrawUnits:
					snapshot.staticMaterialization.materializedDrawUnits,
				pendingStaticMaterializationRevisions:
					snapshot.staticMaterialization.pendingRevisions,
				sourceStaticDrawUnits: snapshot.staticMaterialization.sourceDrawUnits,
				status: snapshot.status,
				textureFilteringMode: snapshot.renderPolicy.textureFilteringMode,
			},
		};
	}

	subscribe(listener: RuntimeSnapshotListener): () => void {
		this.#listeners.add(listener);
		listener(this.#createSnapshot());

		return () => {
			this.#listeners.delete(listener);
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
		this.#textureManager.dispose();
		this.#renderer.dispose();
		this.#emit();
		this.#listeners.clear();
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
		this.#refreshStaticDebugOverlay();
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
			const portalFramePlanKey: PortalFramePlanKey = {
				envCellId: this.#currentCameraResidency.envCellId,
				envCellResourceMembershipRevision:
					this.#envCellResourceMembershipRevision,
				kind: "direct-env-cell",
				landblockId,
				maxCells: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_CELLS,
				maxDepth: this.#directEnvCellPortalMaxDepth,
				maxPortalViews: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_VIEWS,
				portalTraversalGraphRevision:
					this.#staticSceneQuery.queryPortalTraversalGraphRevision({
						landblockId,
					}),
				renderAnchorLandblockId: this.#renderAnchorLandblockId,
			};
			const cachedPlan = this.#getCachedPortalFramePlan(portalFramePlanKey);
			if (cachedPlan) {
				return cachedPlan;
			}
			const directPlan = createDirectEnvCellFramePlan({
				currentCameraResidency: this.#currentCameraResidency,
				portalInteriorRecords:
					this.#staticSceneQuery.queryPortalInteriorRecords({
						landblockId,
					}),
				renderAnchorLandblockId: this.#renderAnchorLandblockId,
				envCellResourceMembership: this.#envCellResourceMembership,
				traversalPlan: this.#staticSceneQuery.queryPortalTraversal({
					landblockId,
					maxCells: portalFramePlanKey.maxCells,
					maxDepth: portalFramePlanKey.maxDepth,
					maxPortalViews: portalFramePlanKey.maxPortalViews,
					startEnvCellId: this.#currentCameraResidency.envCellId,
				}),
			});
			if (directPlan) {
				return this.#setCachedPortalFramePlan(portalFramePlanKey, directPlan);
			}
		}
		if (
			!this.#flatVisionModeEnabled &&
			this.#currentCameraResidency.kind === "outdoor-landblock"
		) {
			const landblockId = this.#currentCameraResidency.landblockId;
			const projection = this.#staticSceneQuery.queryOutdoorPortalProjection({
				landblockId,
			});
			if (projection) {
				const portalFramePlanKey: PortalFramePlanKey = {
					envCellResourceMembershipRevision:
						this.#envCellResourceMembershipRevision,
					kind: "outdoor-transition",
					landblockId,
					maxCells: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_CELLS,
					maxDepth: this.#directEnvCellPortalMaxDepth,
					maxPortalViews: DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_VIEWS,
					projectionSourceRevisionKey: projection.sourceRevisionKey,
					renderAnchorLandblockId: this.#renderAnchorLandblockId,
				};
				const cachedPlan = this.#getCachedPortalFramePlan(portalFramePlanKey);
				if (cachedPlan) {
					return cachedPlan;
				}
				const directPlan = createOutdoorProjectionPortalFramePlan({
					landblockId,
					envCellResourceMembership: this.#envCellResourceMembership,
					maxCells: portalFramePlanKey.maxCells,
					maxDepth: portalFramePlanKey.maxDepth,
					maxPortalViews: portalFramePlanKey.maxPortalViews,
					projection,
				});
				if (directPlan) {
					return this.#setCachedPortalFramePlan(portalFramePlanKey, directPlan);
				}
			}
		}

		this.#cachedPortalFramePlan = null;
		return createLegacyPortalFrameWorkPlan({
			flatVisionModeEnabled: this.#flatVisionModeEnabled,
			renderPassPlan,
		});
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

	#createSnapshot(): RuntimeSnapshot {
		const rendererSnapshot = this.#refreshRendererDiagnosticsSnapshot();
		return {
			assets: this.#assetService.createSnapshot(),
			currentCameraResidency: this.#currentCameraResidency,
			debugOverlays: {
				envCellAabbCount: this.#envCellAabbDebugOverlayVisible
					? this.#staticSceneQuery.queryEnvCellAabbDebugBounds().length
					: 0,
				envCellAabbsVisible: this.#envCellAabbDebugOverlayVisible,
				envCellPortalCount: this.#envCellPortalDebugOverlayVisible
					? countEnvCellPortalApertures(
							this.#staticSceneQuery.queryPortalInteriorRecords(),
						)
					: 0,
				envCellPortalsVisible: this.#envCellPortalDebugOverlayVisible,
				flatVisionModeEnabled: this.#flatVisionModeEnabled,
				transitionApertureCount: this.#transitionApertureDebugOverlayVisible
					? countTransitionApertures(
							this.#staticSceneQuery.queryTransitionApertureBatches(),
						)
					: 0,
				transitionApertureMode: this.#transitionApertureDebugOverlayMode,
				transitionAperturesVisible: this.#transitionApertureDebugOverlayVisible,
			},
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
			status: this.#disposed
				? "disposed"
				: this.#lastStaticSnapshot.requested > 0
					? "static-active"
					: "idle",
		};
	}

	#emit(): void {
		const snapshot = this.#createSnapshot();

		for (const listener of this.#listeners) {
			listener(snapshot);
		}
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

		const pruned = this.#assetService.pruneExpiredWarmAssets();
		if (typeof pruned === "number" && pruned > 0) {
			this.#emit();
		}
	}

	#enqueueStaticMaterialization(delta: StaticCoordinatorCommitDelta): void {
		this.#warnAboutDeferredStaticMaterialCoverage(delta);
		this.#pendingStaticMaterializations.add(delta.revision);
		this.#emit();
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
		this.#refreshEnvCellResourceMembership();
		this.#warnAboutStaticFallbacks(delta);
		applyMaterializedStaticCommit(this.#renderer, materialized);
		this.#staticSceneQuery.removeStaticResources(materialized.removedResources);
		this.#staticSceneQuery.applyStaticPeerRecords({
			authoredDynamicSeeds: materialized.staticAuthoredDynamicSeeds,
			portalGraphs: materialized.staticPortalGraphs,
			portalInteriorRecords: materialized.staticPortalInteriorRecords,
			sourceMappings: materialized.staticSourceMappings,
			spatialRecords: materialized.staticSpatialRecords,
			visibilityRecords: materialized.staticVisibilityRecords,
		});
		this.#staticSceneQuery.applyTransitionApertureBatches(
			materialized.staticDelta.addedTransitionApertureBatches,
		);
		this.#updateRenderPassPlan();
		this.#refreshStaticDebugOverlay();
		this.#pendingStaticMaterializations.delete(delta.revision);
		this.#committedStaticMaterializations = appendBoundedRevision(
			this.#committedStaticMaterializations,
			delta.revision,
		);
		this.#emit();
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
		this.#emit();
		this.#maybeEmitSceneInterestSettled();
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
		for (const drawUnit of materialized.staticDelta.addedDrawUnits) {
			this.#materializedDrawUnitsById.set(drawUnit.drawUnitId, drawUnit);
		}
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

	#refreshStaticDebugOverlay(): void {
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
		if (this.#transitionApertureDebugOverlayVisible) {
			for (const batch of this.#staticSceneQuery.queryTransitionApertureBatches()) {
				primitives.push(
					...createTransitionApertureDebugOverlayPrimitives(
						batch,
						this.#renderAnchorLandblockId,
						this.#transitionApertureDebugOverlayMode,
					),
				);
			}
		}
		if (this.#envCellPortalDebugOverlayVisible) {
			for (const record of this.#staticSceneQuery.queryPortalInteriorRecords()) {
				primitives.push(
					...createEnvCellPortalDebugOverlayPrimitives(
						record,
						this.#renderAnchorLandblockId,
					),
				);
			}
		}

		if (!this.#staticDebugSelectionKey) {
			this.#renderer.setDebugOverlayPrimitives(primitives);
			return;
		}

		const debugBounds = this.#queryStaticSelectionDebugBounds(
			this.#staticDebugSelectionKey,
		);
		if (!debugBounds) {
			const selectionKey = describeStaticSceneSelectionKey(
				this.#staticDebugSelectionKey,
			);
			this.#diagnostics.warn({
				kind: "static-debug-selection-unresolved",
				reason: "missing-query-bounds",
				selectionKey,
			});
			this.#renderer.setDebugOverlayPrimitives(primitives);
			return;
		}

		primitives.push(
			createStaticDebugBoundsOverlayPrimitive(debugBounds.bounds, {
				id: describeStaticSceneSelectionKey(debugBounds.selectionKey),
			}),
		);
		this.#renderer.setDebugOverlayPrimitives(primitives);
	}

	#queryStaticSelectionDebugBounds(selectionKey: StaticSceneSelectionKey): {
		readonly bounds: StaticBounds;
		readonly selectionKey: StaticSceneSelectionKey;
	} | null {
		if (selectionKey.itemKind !== "env-cell-portal") {
			return this.#staticSceneQuery.querySelectionDebugBounds(selectionKey);
		}

		const target = this.#queryEnvCellPortalPickTarget(selectionKey);
		return target === null
			? null
			: {
					bounds: target.bounds,
					selectionKey,
				};
	}

	#pickEnvCellPortalRay(
		request: StaticScenePickRequest,
		currentNearestHit: StaticScenePickHit | null,
	): StaticScenePickHit | null {
		let nearestHit: StaticScenePickHit | null = null;
		for (const target of this.#queryEnvCellPortalPickTargets(request)) {
			if (!matchesPortalPickFilters(target, request)) {
				continue;
			}
			for (let index = 0; index < target.vertices.length; index += 3) {
				const first = target.vertices[index];
				const second = target.vertices[index + 1];
				const third = target.vertices[index + 2];
				if (!first || !second || !third) {
					throw new Error(
						`Env-cell portal ${target.selectionKey.portalId} did not triangulate to complete triangles.`,
					);
				}
				const distance = intersectRayTriangle(
					request.ray,
					first,
					second,
					third,
				);
				if (distance === null) {
					continue;
				}
				if (
					currentNearestHit !== null &&
					distance > currentNearestHit.distance
				) {
					continue;
				}
				const hit: StaticScenePickHit = {
					bounds: target.bounds,
					distance,
					hitPoint: pointOnRay(request.ray, distance),
					kind: "static-scene-pick-hit",
					selectionKey: target.selectionKey,
				};
				nearestHit = chooseNearestStaticSceneHit(nearestHit, hit);
			}
		}

		return nearestHit;
	}

	#queryEnvCellPortalPickTarget(
		selectionKey: StaticSceneSelectionKey & {
			readonly itemKind: "env-cell-portal";
		},
	): EnvCellPortalPickTarget | null {
		for (const target of this.#queryEnvCellPortalPickTargets()) {
			if (
				target.selectionKey.landblockId === selectionKey.landblockId &&
				target.selectionKey.envCellId === selectionKey.envCellId &&
				target.selectionKey.portalId === selectionKey.portalId
			) {
				return target;
			}
		}

		return null;
	}

	#queryEnvCellPortalPickTargets(
		request?: StaticScenePickRequest,
	): readonly EnvCellPortalPickTarget[] {
		const targets: EnvCellPortalPickTarget[] = [];
		for (const record of this.#staticSceneQuery.queryPortalInteriorRecords()) {
			if (request?.context.kind === "env-cell") {
				if (record.landblockId !== request.context.landblockId) {
					continue;
				}
			}
			const translation = createOutdoorLandblockRootTranslation(
				record.landblockId,
				this.#renderAnchorLandblockId,
			);
			for (const envCell of record.envCells) {
				if (!envCellMatchesPortalPickRequest(envCell.envCellId, request)) {
					continue;
				}
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
					targets.push({
						bounds: createBoundsForVertices(vertices),
						portal:
							envCell.portals.find(
								(portal) => portal.portalId === aperture.portalId,
							) ?? null,
						portalAperture: aperture,
						selectionKey: createEnvCellPortalSelectionKey({
							envCellId: envCell.envCellId,
							landblockId: record.landblockId,
							portalId: aperture.portalId,
						}),
						vertices,
					});
				}
			}
		}

		return targets;
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
			const target = this.#queryEnvCellPortalPickTarget(selectionKey);
			return target === null
				? null
				: {
						detail: {
							envCellId: selectionKey.envCellId,
							landblockId: selectionKey.landblockId,
							portal: target.portal,
							portalAperture: target.portalAperture,
						},
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

function chooseNearestStaticSceneHit(
	left: StaticScenePickHit | null,
	right: StaticScenePickHit | null,
): StaticScenePickHit | null {
	if (left === null) {
		return right;
	}
	if (right === null) {
		return left;
	}
	if (left.distance !== right.distance) {
		return left.distance < right.distance ? left : right;
	}

	return describeStaticSceneSelectionKey(left.selectionKey).localeCompare(
		describeStaticSceneSelectionKey(right.selectionKey),
	) <= 0
		? left
		: right;
}

function envCellMatchesPortalPickRequest(
	envCellId: number,
	request: StaticScenePickRequest | undefined,
): boolean {
	if (request?.context.kind !== "env-cell") {
		return true;
	}
	const acceptedEnvCellIds = request.context.acceptedEnvCellIds ?? [
		request.context.envCellId,
	];
	return (
		acceptedEnvCellIds.length === 0 || acceptedEnvCellIds.includes(envCellId)
	);
}

function matchesPortalPickFilters(
	target: EnvCellPortalPickTarget,
	request: StaticScenePickRequest,
): boolean {
	const filters = request.filters;
	return (
		(!filters?.itemKinds ||
			filters.itemKinds.includes(target.selectionKey.itemKind)) &&
		(!filters?.domains ||
			filters.domains.includes(target.selectionKey.domain)) &&
		(!filters?.ignoreContainingOrigin ||
			!containsPoint(target.bounds, request.ray.origin))
	);
}

function createBoundsForVertices(
	vertices: readonly (readonly [number, number, number])[],
): StaticBounds {
	if (vertices.length === 0) {
		throw new Error("Cannot create debug bounds for empty vertex list.");
	}

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (const [x, y, z] of vertices) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		minZ = Math.min(minZ, z);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
		maxZ = Math.max(maxZ, z);
	}

	return {
		max: { x: maxX, y: maxY, z: maxZ },
		min: { x: minX, y: minY, z: minZ },
	};
}

function containsPoint(bounds: StaticBounds, point: Vec3): boolean {
	return (
		point.x >= bounds.min.x &&
		point.x <= bounds.max.x &&
		point.y >= bounds.min.y &&
		point.y <= bounds.max.y &&
		point.z >= bounds.min.z &&
		point.z <= bounds.max.z
	);
}

function pointOnRay(
	ray: StaticScenePickRequest["ray"],
	distance: number,
): Vec3 {
	return {
		x: ray.origin.x + ray.direction.x * distance,
		y: ray.origin.y + ray.direction.y * distance,
		z: ray.origin.z + ray.direction.z * distance,
	};
}

function intersectRayTriangle(
	ray: StaticScenePickRequest["ray"],
	first: readonly [number, number, number],
	second: readonly [number, number, number],
	third: readonly [number, number, number],
): number | null {
	const epsilon = 1e-6;
	const edge1 = subtractTuple(second, first);
	const edge2 = subtractTuple(third, first);
	const pvec = cross(ray.direction, edge2);
	const determinant = dot(edge1, pvec);
	if (Math.abs(determinant) < epsilon) {
		return null;
	}

	const inverseDeterminant = 1 / determinant;
	const tvec = subtractVec3Tuple(ray.origin, first);
	const u = dot(tvec, pvec) * inverseDeterminant;
	if (u < -epsilon || u > 1 + epsilon) {
		return null;
	}

	const qvec = cross(tvec, edge1);
	const v = dot(ray.direction, qvec) * inverseDeterminant;
	if (v < -epsilon || u + v > 1 + epsilon) {
		return null;
	}

	const distance = dot(edge2, qvec) * inverseDeterminant;
	return distance >= epsilon ? distance : null;
}

function subtractTuple(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): Vec3 {
	return {
		x: left[0] - right[0],
		y: left[1] - right[1],
		z: left[2] - right[2],
	};
}

function subtractVec3Tuple(
	left: Vec3,
	right: readonly [number, number, number],
): Vec3 {
	return {
		x: left.x - right[0],
		y: left.y - right[1],
		z: left.z - right[2],
	};
}

function cross(left: Vec3, right: Vec3): Vec3 {
	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x,
	};
}

function dot(left: Vec3, right: Vec3): number {
	return left.x * right.x + left.y * right.y + left.z * right.z;
}

function createStaticDebugBoundsOverlayPrimitive(
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

function createTransitionApertureDebugOverlayPrimitives(
	batch: TransitionApertureBatch,
	renderAnchorLandblockId: number | null,
	mode: TransitionApertureDebugOverlayMode,
): DebugOverlayPrimitive[] {
	const primitives: DebugOverlayPrimitive[] = [];
	const translation = createOutdoorLandblockRootTranslation(
		batch.landblockId,
		renderAnchorLandblockId,
	);
	for (const range of batch.ranges) {
		const storedWindingVertices = readTransitionApertureRangeVertices(
			batch,
			range.firstIndex,
			range.indexCount,
			translation,
		);
		const baseId = `transition-aperture:${formatHex32(batch.landblockId)}:${describeTransitionApertureRangeSource(range.source)}:${range.portalId}`;
		if (mode === "both" || mode === "indoor-to-outdoor") {
			primitives.push({
				color: [0.95, 0.12, 0.08, 0.35],
				id: `${baseId}:indoor-to-outdoor`,
				kind: "triangles",
				vertices: storedWindingVertices,
			});
		}
		if (mode === "both" || mode === "outdoor-to-indoor") {
			primitives.push({
				color: [0.05, 0.95, 0.25, 0.35],
				id: `${baseId}:outdoor-to-indoor`,
				kind: "triangles",
				vertices: reverseTriangleWinding(storedWindingVertices),
			});
		}
	}

	return primitives;
}

function describeTransitionApertureRangeSource(
	source: TransitionApertureBatch["ranges"][number]["source"],
): string {
	return [
		"building",
		source.buildingInstanceId,
		source.buildingPortalId,
		`portal-index-${source.portalIndex}`,
		`poly-${source.polyId}`,
		`gfx-${formatHex32(source.sourceDid)}`,
	].join(":");
}

function readTransitionApertureRangeVertices(
	batch: TransitionApertureBatch,
	firstIndex: number,
	indexCount: number,
	translation: readonly [number, number, number],
): readonly (readonly [number, number, number])[] {
	const vertices: Array<readonly [number, number, number]> = [];
	for (let indexOffset = 0; indexOffset < indexCount; indexOffset += 1) {
		const vertexIndex = batch.indices[firstIndex + indexOffset];
		const vertex =
			vertexIndex === undefined ? undefined : batch.vertices[vertexIndex];
		if (!vertex) {
			throw new Error(
				`Transition aperture batch ${batch.apertureBatchId} has invalid index at ${firstIndex + indexOffset}.`,
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

function triangulateEnvCellPortalAperture(
	points: StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number]["points"],
	matrix: Float32Array,
	translation: readonly [number, number, number],
): readonly (readonly [number, number, number])[] {
	if (points.length < 3) {
		return [];
	}
	const vertices: Array<readonly [number, number, number]> = [];
	for (let index = 1; index < points.length - 1; index += 1) {
		vertices.push(
			transformEnvCellPortalPoint(points[0], matrix, translation),
			transformEnvCellPortalPoint(points[index], matrix, translation),
			transformEnvCellPortalPoint(points[index + 1], matrix, translation),
		);
	}
	return vertices;
}

function transformEnvCellPortalPoint(
	point: StaticPortalInteriorRecord["envCells"][number]["portalApertures"][number]["points"][number],
	matrix: Float32Array,
	translation: readonly [number, number, number],
): readonly [number, number, number] {
	return [
		matrix[0] * point.x +
			matrix[4] * point.y +
			matrix[8] * point.z +
			matrix[12] +
			translation[0],
		matrix[1] * point.x +
			matrix[5] * point.y +
			matrix[9] * point.z +
			matrix[13] +
			translation[1],
		matrix[2] * point.x +
			matrix[6] * point.y +
			matrix[10] * point.z +
			matrix[14] +
			translation[2],
	];
}

function countTransitionApertures(
	batches: readonly TransitionApertureBatch[],
): number {
	return batches.reduce((count, batch) => count + batch.ranges.length, 0);
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
	return {
		kind: "terrain-textures",
		recentFallbacks,
		summary: {
			recentFallbackCount: recentFallbacks.length,
		},
	};
}

function applyMaterializedStaticCommit(
	renderer: Renderer,
	materialized: StaticMaterializationResult,
): void {
	if (materialized.textureUpdate) {
		renderer.applyTexturePlacementUpdate(materialized.textureUpdate);
	}
	renderer.applyStaticDelta(materialized.staticDelta);
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
		left.maxCells !== right.maxCells ||
		left.maxDepth !== right.maxDepth ||
		left.maxPortalViews !== right.maxPortalViews ||
		left.renderAnchorLandblockId !== right.renderAnchorLandblockId ||
		left.envCellResourceMembershipRevision !==
			right.envCellResourceMembershipRevision
	) {
		return false;
	}
	if (left.kind === "direct-env-cell") {
		return (
			right.kind === "direct-env-cell" &&
			left.envCellId === right.envCellId &&
			left.portalTraversalGraphRevision === right.portalTraversalGraphRevision
		);
	}
	return (
		right.kind === "outdoor-transition" &&
		left.projectionSourceRevisionKey === right.projectionSourceRevisionKey
	);
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

	return {
		inFlightWork,
		materialCoverage: snapshot.materialCoverage.map(
			createStaticMaterialCoverageDiagnostics,
		),
		recentFailures,
		summary: {
			baking: snapshot.baking,
			committed: snapshot.committed,
			committedDrawUnits: snapshot.committedDrawUnits,
			failed: snapshot.failed,
			latestLandblockEnvCellsPayload: snapshot.latestLandblockEnvCellsPayload
				? `lb ${formatHex(snapshot.latestLandblockEnvCellsPayload.landblockId)} cells ${snapshot.latestLandblockEnvCellsPayload.envCellCount} accepted ${snapshot.latestLandblockEnvCellsPayload.acceptedEnvCellCount} visible ${snapshot.latestLandblockEnvCellsPayload.visibleCellCount} portals ${snapshot.latestLandblockEnvCellsPayload.portalCount} links ${snapshot.latestLandblockEnvCellsPayload.portalLinkCount} seeds ${snapshot.latestLandblockEnvCellsPayload.staticObjectSeedCount} missing ${snapshot.latestLandblockEnvCellsPayload.missingRefCount}`
				: null,
			latestOutdoorStaticObjectsPayload:
				snapshot.latestOutdoorStaticObjectsPayload
					? `lb ${formatHex(snapshot.latestOutdoorStaticObjectsPayload.landblockId)} ${snapshot.latestOutdoorStaticObjectsPayload.domain} objects ${snapshot.latestOutdoorStaticObjectsPayload.objectCount} kinds b:${snapshot.latestOutdoorStaticObjectsPayload.objectKindCounts.building}/g:${snapshot.latestOutdoorStaticObjectsPayload.objectKindCounts["generated-scenery"]}/e:${snapshot.latestOutdoorStaticObjectsPayload.objectKindCounts["explicit-object"]} sources ${snapshot.latestOutdoorStaticObjectsPayload.sourceAssetCount} slots ${snapshot.latestOutdoorStaticObjectsPayload.materialSlotCount} materials ${snapshot.latestOutdoorStaticObjectsPayload.materialSourceCount} tex ${snapshot.latestOutdoorStaticObjectsPayload.textureRefCount} missing ${snapshot.latestOutdoorStaticObjectsPayload.missingRefCount}`
					: null,
			latestTerrainPayload: snapshot.latestTerrainPayload
				? `lb ${formatHex(snapshot.latestTerrainPayload.landblockId)} region ${snapshot.latestTerrainPayload.regionNumber} mesh ${snapshot.latestTerrainPayload.vertexCount}v/${snapshot.latestTerrainPayload.triangleCount}t quads ${snapshot.latestTerrainPayload.quadCount} tex ${snapshot.latestTerrainPayload.textureUseCount} missing ${snapshot.latestTerrainPayload.missingRefCount}`
				: null,
			requested: snapshot.requested,
			resolving: snapshot.resolving,
			revision: snapshot.revision,
			staleBakeResults: snapshot.staleBakeResults,
			staleResolverResults: snapshot.staleResolverResults,
		},
	};
}

function createStaticMaterialCoverageDiagnostics(
	coverage: StaticMaterialCoverageReport,
): StaticCoordinatorDiagnosticsReport["materialCoverage"][number] {
	return {
		buckets: coverage.buckets.map((bucket) => ({
			family: bucket.family,
			filteringMode: bucket.filteringMode,
			materials: bucket.materialCount,
			outcome: bucket.outcome,
			partitions: bucket.partitionCount,
			pass: bucket.pass,
			textureRoles: bucket.textureRoleCount,
			triangles: bucket.triangleCount,
		})),
		coverageKey: coverage.coverageKey,
		coverageKind: coverage.coverageKind,
		deferredTriangles: coverage.deferredTriangleCount,
		detailRoleCount: coverage.detailRoleCount,
		domain: coverage.domain,
		fallbackReasonCount: coverage.fallbackReasonCount,
		fallbackReasons: Object.fromEntries(
			coverage.fallbackReasonCounts.map((reason) => [
				reason.code,
				reason.count,
			]),
		),
		landblockId:
			coverage.landblockId === null ? null : formatHex(coverage.landblockId),
		materialCount: coverage.materialCount,
		partitionCount: coverage.partitionCount,
		renderedTriangles: coverage.renderedTriangleCount,
		triangleCount: coverage.triangleCount,
		unrenderedBuckets: coverage.unrenderedBuckets.map((bucket) => ({
			family: bucket.family,
			materials: bucket.materialCount,
			outcome: bucket.outcome,
			partitions: bucket.partitionCount,
			pass: bucket.pass,
			reasonCodes: bucket.reasonCodes,
			triangles: bucket.triangleCount,
		})),
		unsupportedTriangles: coverage.unsupportedTriangleCount,
	};
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
): StaticCoordinatorDiagnosticsReport["inFlightWork"][number] {
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
		Math.max(0, Math.trunc(maxDepth)),
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
