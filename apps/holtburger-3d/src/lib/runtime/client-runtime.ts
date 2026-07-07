import type { AssetServiceOverviewSnapshot } from "../assets/contracts";
import type {
	DynamicEntityId,
	DynamicEntityRenderResidence,
} from "../dynamic/contracts";
import type { RuntimeDynamicSpawnRequest } from "../dynamic/dynamic-entity-controller";
import type {
	FrameState,
	PortalFrameWorkPlan,
	RendererResourceSnapshot,
	RendererStaticLayerVisibility,
} from "../renderer/types";
import type { RendererFrameTelemetry } from "../renderer/types";
import type { TextureFilteringMode } from "../textures/sampling-policy";
import type { RuntimeDiagnosticsReport } from "./diagnostics";
import type { EnvCellResourceMembership } from "./env-cell-resource-membership";
import type { RuntimePortalOverlapResidency } from "./portal-base-overlap";
import type {
	StaticSceneCameraResidency,
	StaticSceneEnvCellBounds,
	StaticSceneSelectionKey,
	StaticSceneTerrainLandblockBounds,
	Vec3,
} from "./scene-query/contracts";
import type {
	ScenePickHit,
	ScenePickRequest,
} from "./scene-query/merged-scene-query-contracts";

export const MIN_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH = 0;
export const DEFAULT_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH = 18;
export const MAX_DIRECT_ENV_CELL_PORTAL_MAX_DEPTH = 24;

export type ManualStaticDomain =
	| "terrain"
	| "buildings"
	| "explicit-objects"
	| "generated-scenery"
	| "env-cells";

export type RuntimeSceneInterest =
	| {
			readonly kind: "none";
	  }
	| {
			readonly kind: "outdoor-anchor";
			readonly anchorLandblockId: number;
			readonly domains: readonly ManualStaticDomain[];
			readonly lod?: {
				readonly buildings?: number;
				readonly envCells?: number;
				readonly explicitObjects?: number;
				readonly generatedScenery?: number;
				readonly terrain?: number;
			};
			readonly source: "manual" | "follow" | "settings";
	  }
	| {
			readonly kind: "interior-cell";
			readonly envCellId: number;
			readonly landblockId: number;
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
	/** Cheap renderer and texture resource counts for browser diagnostics. */
	readonly resources: RuntimeResourcesOverviewSnapshot;
	/** Cheap static scene query counts for browser diagnostics. */
	readonly staticSceneQuery: {
		readonly envCellLandblockCount: number;
		readonly envCellRecordCount: number;
		readonly outdoorRecordCount: number;
	};
}

interface RuntimeRenderPolicySnapshot {
	readonly textureFilteringMode: TextureFilteringMode;
}

interface RuntimeDebugOverlaySnapshot {
	readonly envCellAabbCount: number;
	readonly envCellAabbsVisible: boolean;
	readonly flatVisionModeEnabled: boolean;
	readonly portalCount: number;
	readonly portalsVisible: boolean;
}

interface RuntimeResourcesOverviewSnapshot {
	readonly atlas: RuntimeTextureAtlasOverviewSnapshot;
	readonly renderer: RendererResourceSnapshot;
}

interface RuntimeTextureAtlasOverviewSnapshot {
	readonly buckets: readonly RuntimeTextureAtlasBucketOverview[];
	readonly summary: {
		readonly activeBucketCount: number;
		readonly approximateBytes: number;
		readonly bucketCount: number;
		readonly pageLifecycle: {
			readonly absorbed: number;
			readonly created: number;
			readonly reclaimed: number;
			readonly retained: number;
		};
		readonly registryEntryCount: number;
		readonly texturePageCount: number;
	};
}

interface RuntimeTextureAtlasBucketOverview {
	readonly atlasBucketKey: string;
	readonly bucketId: string;
	readonly domain: string;
	readonly pages: readonly RuntimeTextureAtlasPageOverview[];
	readonly texturePageCount: number;
	readonly uniqueSourceCount: number;
}

export interface RuntimeTextureAtlasPageOverview {
	readonly atlasBucketKey: string;
	readonly bucketId: string;
	readonly bucketLabel: string;
	readonly domain: string;
	readonly format: string;
	readonly height: number;
	readonly packingEfficiency: number;
	readonly pageId: string;
	readonly sampleClass: string;
	readonly textureCount: number;
	readonly width: number;
	readonly wrapS: string;
	readonly wrapT: string;
}

export interface ClientRuntime {
	createRuntimeSpawn(request: RuntimeDynamicSpawnRequest): DynamicEntityId;
	removeRuntimeSpawn(entityId: DynamicEntityId): boolean;
	updateRuntimeSpawnRenderResidence(
		entityId: DynamicEntityId,
		renderResidence: DynamicEntityRenderResidence,
	): boolean;
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
	): unknown;
	createDynamicSelectionDiagnosticsReport(
		entityId: DynamicEntityId,
		options?: { readonly pickDistance?: number | null },
	): unknown;
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

type RuntimeFrameTelemetryListener = (
	telemetry: RendererFrameTelemetry,
) => void;
type RuntimeEventListener = (event: RuntimeEvent) => void;
