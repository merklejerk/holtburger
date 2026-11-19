import type { PerformanceSession } from "../app/performance-session";
import type { SceneEnvironmentSelection } from "../lib/game/environment/scene-environment";
import type { ExplorerCameraMode } from "../lib/game/motion/host-physical-fly-path";
import type { AmbientOcclusionSettings } from "../lib/game/renderer/ambient-occlusion-policy";
import type { ColorGradeSettings } from "../lib/game/renderer/color-grade-policy";
import type { EntityShadowSettings } from "../lib/game/renderer/entity-shadow-policy";
import type {
	NameplateCategory,
	NameplateSettings,
} from "../lib/game/renderer/nameplate-policy";
import type {
	EnvCellRenderMode,
	RenderLayerVisibility,
	RendererFrameDiagnosticsSnapshot,
} from "../lib/game/renderer/renderer";
import type { TextureFilteringPolicy } from "../lib/game/renderer/texture-filtering-policy";
import type { Texture2DReadback } from "../lib/game/renderer/webgl2-device";
import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
import type {
	GamePresentationRuntime,
	StaticObjectRuntimeDiagnostics,
} from "../lib/game/runtime/game-presentation-runtime";
import type { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
import type { SceneInterestTarget } from "../lib/game/runtime/scene-target";
import type { SceneInterestRadii } from "../lib/game/runtime/types";
import type { TexturePageId } from "../lib/game/textures/texture-manager";
import type { HostKinematicBoomStatus } from "../lib/game/camera/host-kinematic-boom-session";
import type { WeenieCatalogCapability } from "../lib/host/weenie-catalog-capability";
import type { ExplorerCameraFocusStatus } from "./explorer-camera-coordinator";
import type {
	ExplorerWeenieSearchRequest,
	ExplorerWeenieSearchResult,
} from "./explorer-entity-commands";
import type { ExplorerEntitySelection } from "./explorer-entity-panel-state";
import type {
	ExplorerPossession,
	ExplorerPossessionControls,
	PossessionMotionProbe,
} from "./explorer-entity-possession";
import type { ExplorerFrameDiagnosticReport } from "./explorer-frame-diagnostic-report";
import type { PhysicalFlyStatus } from "./physical-fly-session";

/** Explorer runtime readiness, scene-interest focus, camera mode, and follow switches. */
export interface ExplorerToolsCameraSurface {
	readonly runtimeReady: boolean;
	readonly requestSceneInterest: (
		target: SceneInterestTarget,
		radii: SceneInterestRadii,
	) => void;
	readonly cameraFocusStatus: ExplorerCameraFocusStatus;
	/** Formatted camera residency, or null before the first presented frame. */
	readonly cameraResidencyLabel: string | null;
	readonly cameraMode: ExplorerCameraMode;
	readonly cameraModePending: boolean;
	/** Pull physical-camera diagnostics only while the World panel is mounted. */
	readonly readPhysicalCameraStatus: () => PhysicalFlyStatus | null;
	readonly physicalCameraError: string | null;
	readonly updateCameraMode: (mode: ExplorerCameraMode) => void;
	/** Follow mode: scene interest follows accepted outdoor residency crossings. */
	readonly interestFollowsCamera: boolean;
	readonly updateInterestFollowsCamera: (enabled: boolean) => void;
	readonly audioFollowsCamera: boolean;
	readonly updateAudioFollowsCamera: (enabled: boolean) => void;
}

/** Regional time-of-day, sky day groups, weather, clock following, and audio mix. */
export interface ExplorerToolsEnvironmentSurface {
	readonly environmentSelection: SceneEnvironmentSelection;
	readonly dayGroupNames: readonly string[];
	readonly updateEnvironment: (selection: SceneEnvironmentSelection) => void;
	readonly weatherEnabled: boolean;
	readonly updateWeather: (enabled: boolean) => void;
	readonly clockFollowing: boolean;
	readonly updateClockFollowing: (enabled: boolean) => void;
	readonly effectVolume: number;
	readonly ambientVolume: number;
	readonly updateEffectVolume: (volume: number) => void;
	readonly updateAmbientVolume: (volume: number) => void;
}

/** Renderer switches, layer visibility, nameplates, shadows, AO, color grade, and quality. */
export interface ExplorerToolsRenderingSurface {
	/** Explorer-local switch controlling distance-fog presentation. */
	readonly distanceFogEnabled: boolean;
	readonly updateDistanceFog: (enabled: boolean) => void;
	readonly viewerLightEnabled: boolean;
	readonly updateViewerLight: (enabled: boolean) => void;
	/** Whether meshes suppressed by retail's degradation sentinel remain visible. */
	readonly showRetailHiddenGeometry: boolean;
	readonly updateShowRetailHiddenGeometry: (visible: boolean) => void;
	readonly nameplates: NameplateSettings;
	readonly updateNameplateCategory: (
		category: NameplateCategory,
		visible: boolean,
	) => void;
	readonly ambientOcclusion: AmbientOcclusionSettings;
	readonly updateAmbientOcclusionSettings: (
		settings: AmbientOcclusionSettings,
	) => void;
	readonly entityShadows: EntityShadowSettings;
	readonly updateEntityShadowSettings: (settings: EntityShadowSettings) => void;
	/** Presentation grade authored in the grading panel. */
	readonly colorGrade: ColorGradeSettings;
	readonly updateColorGradeSettings: (settings: ColorGradeSettings) => void;
	readonly envCellRenderMode: EnvCellRenderMode;
	readonly updateEnvCellRenderMode: (mode: EnvCellRenderMode) => void;
	readonly layerVisibility: RenderLayerVisibility;
	readonly updateLayerVisibility: (
		layer: LandblockLayerKind,
		visible: boolean,
	) => void;
	/** Effective filterable texture quality selected for the next frame. */
	readonly textureFiltering: TextureFilteringPolicy;
	/** Device-supported texture filtering choices in display order. */
	readonly textureFilteringOptions: readonly TextureFilteringPolicy[];
	/** Raw device maximum shown beside the client-capped choices. */
	readonly maximumTextureAnisotropy: number | null;
	readonly updateTextureFiltering: (policy: TextureFilteringPolicy) => void;
	readonly renderScale: number;
	readonly renderScaleOptions: readonly number[];
	readonly updateRenderScale: (renderScale: number) => void;
}

/** Pull-only performance session, frame/runtime diagnostics, diagnostic report, and texture atlas readbacks. */
export interface ExplorerToolsDiagnosticsSurface {
	/** Cold access to the mode-owned capture lifecycle. */
	readonly readPerformanceSession: () => PerformanceSession | null;
	/** Pull renderer diagnostics only while the Frame panel is mounted. */
	readonly readRendererFrameDiagnostics: () => RendererFrameDiagnosticsSnapshot | null;
	/** Compose current renderer and Explorer context into one exportable report. */
	readonly captureFrameDiagnosticReport: () => ExplorerFrameDiagnosticReport | null;
	readonly readAuthoredDynamicRuntimeDiagnostics: () => ReturnType<
		GamePresentationRuntime["getAuthoredDynamicRuntimeDiagnostics"]
	> | null;
	/** Read an outdoor-static and texture atlas snapshot for the Explorer inspector. */
	readonly readStaticObjectRuntimeDiagnostics: () => StaticObjectRuntimeDiagnostics | null;
	/** Explicit diagnostic readback of one active packed atlas page. */
	readonly readTextureAtlasPage: (pageId: TexturePageId) => Texture2DReadback;
}

/** Dynamic entity catalog, spawned list, selection, spawning, despawning, and possession. */
export interface ExplorerToolsEntitiesSurface {
	/** Shared cold identity selected from either the entity list or minimap. */
	readonly entitySelection: ExplorerEntitySelection | null;
	readonly selectEntity: (selection: ExplorerEntitySelection | null) => void;
	readonly entityCatalog: WeenieCatalogCapability | null;
	readonly spawnedEntities: readonly DynamicEntityView[];
	readonly spawnedEntityPresentationError: string | null;
	readonly spawnExplorerEntity: (
		wcid: number,
		distance: number,
	) => Promise<void>;
	readonly searchExplorerWeenies: (
		request: ExplorerWeenieSearchRequest,
	) => Promise<readonly ExplorerWeenieSearchResult[]>;
	readonly despawnExplorerEntity: (entity: DynamicEntityView) => Promise<void>;
	/** Possess one spawned entity so commands reach it, or release with `null`. */
	readonly possessExplorerEntity: (
		guid: number | null,
	) => Promise<ExplorerPossession>;
	readonly setExplorerEntityStance: (style: number) => Promise<void>;
	readonly setExplorerEntityRunRate: (value: number) => Promise<void>;
	readonly explorerPossession: ExplorerPossession | null;
	readonly explorerPossessionControls: ExplorerPossessionControls | null;
	readonly readPossessionMotionProbe: () => Promise<PossessionMotionProbe | null>;
	/** Pull one exact current entity only for disclosure-scoped volatile diagnostics. */
	readonly readExplorerEntity: (
		selection: ExplorerEntitySelection,
	) => DynamicEntityView | null;
	/** Pull current boom diagnostics without subscribing the tool tree to render frames. */
	readonly readBoomCameraStatus: () => HostKinematicBoomStatus | null;
}
