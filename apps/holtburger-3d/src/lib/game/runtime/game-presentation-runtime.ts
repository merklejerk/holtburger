import { createLandblockWorldOrigin } from "../landblocks";
import {
	acRotationFromRenderTransform,
	renderVector3,
	sceneVec3,
	sceneVector3,
	type AcRotation,
	type SceneVector3,
} from "../../assets/ac-frame";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import type { SetupVisualSource } from "../../assets/setup-visual-source";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type { SkySourcePresentations } from "../../assets/decode-sky-record";
import { animationHookCommand } from "../../assets/decode-animation-record";
import type { CommitPipeline, LandblockLayerCommit } from "../commit/types";
import type {
	EnvCellMaterializationDiagnostics,
	EnvCellMaterializationPlan,
} from "../commit/env-cell-materialization";
import type {
	StaticObjectGeometryDiagnostics,
	StaticObjectLayerDiagnostics,
} from "../commit/artifacts";
import type { EnvCellId, LandblockOwnerId } from "../game-types";
import { GeometryManager } from "../geometry/geometry-manager";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type { BakedDrawMergeCensus } from "../renderer/baked-draw-merge-census";
import {
	DEFAULT_FRAME_SETTINGS,
	type FrameSettings,
	type PortalTransitionFrame,
	type Renderer,
	type RendererFrameDiagnosticsSnapshot,
} from "../renderer/renderer";
import { RenderWorld } from "../renderer/render-world";
import {
	type RenderExtent,
	resolveRenderExtent,
	validateRenderExtent,
} from "../renderer/render-extent";
import type { RendererResourceManager } from "../renderer/resource-manager";
import type {
	ClosedWorkerPoolDiagnostics,
	ClosedWorkerPort,
} from "../workers/closed-worker";
import {
	SceneGraph,
	type ScenePlacement,
	type SceneSpatialPlacement,
	type SceneNodeId,
	type SceneResidency,
} from "../scene";
import type { TerrainGenerator } from "../terrain/terrain-generator";
import { WorkerTerrainGenerator } from "../terrain/terrain-worker-client";
import { MapGeometryStore } from "../map/map-geometry-store";
import type { InstalledTerrain } from "../terrain/terrain-system";
import { TerrainSystem } from "../terrain/terrain-system";
import { StaticObjectSystem } from "../systems/static-object-system";
import { DynamicEntitySystem } from "../systems/dynamic-entity-system";
import { DynamicEntityPlacementSystem } from "../systems/dynamic-entity-placement-system";
import {
	InlineObjectVisualTemplatePreparer,
	ObjectVisualTemplateRepository,
	type ObjectVisualTemplateRepositoryDiagnostics,
} from "../systems/object-visual-template-repository";
import { EnvCellSystem } from "../systems/env-cell-system";
import { AnimationSystem } from "../systems/animation-system";
import type { PhysicsScriptSource } from "../../assets/physics-script-source";
import {
	PhysicsScriptRepository,
	type PreparedPhysicsScriptClosure,
} from "../behavior/physics-script-repository";
import type { DatAssetId } from "../game-types";
import { ParticleEmitterRepository } from "../behavior/particle-emitter-repository";
import { SoundTableRepository } from "../behavior/sound-table-repository";
import type { PreparedAssetHandle } from "../behavior/prepared-asset-repository";
import { ParticleMeshCache } from "../behavior/particle-mesh-cache";
import type { ParticleMeshSource } from "../../assets/particle-mesh-source";
import type { SoundTableSource } from "../../assets/sound-table-source";
import type { DecodedSoundTable } from "../../assets/decode-sound-table-record";
import type { PortalTransitionAssets } from "../../client/portal-transition-assets";
import { selectSoundCandidate } from "../../assets/decode-sound-table-record";
import {
	SKY_PARTICLE_RENDER_OWNER,
	type ParticleRenderOwner,
	ParticleSystem,
} from "../systems/particle-system";
import { AmbientSystem } from "../systems/ambient-system";
import {
	ambientSoundTableIds,
	createAmbientRegionResolution,
	type AmbientRegionFacts,
	type AmbientRegionResolution,
} from "../systems/ambient-region";
import {
	AmbientBakeRegistry,
	EMPTY_AMBIENT_SCAN_RESULT,
	accumulateAmbientWeights,
	scanAmbientSources,
	type InstalledAmbientTerrain,
} from "../systems/ambient-scan";
import type { UniformRoll } from "../systems/particle-system";
import type { ParticleEmitterSource } from "../../assets/particle-emitter-source";
import { PhysicsScriptSystem } from "../systems/physics-script-system";
import {
	AudioSystem,
	type AudioDevice,
	type AudioSettings,
} from "../systems/audio-system";
import {
	BehaviorEventRouter,
	behaviorTargetId,
} from "../behavior/behavior-event-router";
import type {
	BehaviorTarget,
	BehaviorTargetId,
} from "../behavior/behavior-event-router";
import { sceneNodeIdOf } from "../scene/utils";
import { SkyScriptSystem } from "../systems/sky-script-system";
import { SKY_OWNER_ID, type SkyOwnerId } from "./owner-ids";
import { AudioControlCadence } from "./audio-control-cadence";
import { SKY_OBJECT_ONLY_PART_INDEX } from "../environment/sky-behavior-targets";
import type { SkyBehaviorTarget } from "../environment/sky-behavior-targets";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import { EffectSystem } from "../systems/effect-system";
import { AnimationAssetRepository } from "../animation/animation-asset-repository";
import {
	TextureManager,
	type TextureAtlasPageDiagnostics,
	type TexturePageId,
} from "../textures/texture-manager";
import {
	ResidentTextureAtlas,
	type AtlasRequirementHandle,
} from "../textures/atlas/resident-texture-atlas";
import { AtlasLayoutWorkerPool } from "../textures/atlas/layout-worker";
import { AtlasPageBuildWorkerPool } from "../textures/atlas/page-build-worker";
import type { Texture2DResourceKey } from "../renderer/resource-manager";
import { TexturePurpose, type AssetTextureKey } from "../textures/types";
import { mergeAssetTextureFacts } from "../textures/texture-facts";
import {
	WorkerTexturePreparer,
	type TexturePreparer,
} from "../textures/texture-preparer";
import { StaticObjectGeometryWorker } from "../commit/static-object-geometry-worker-client";
import { prepareStaticObjectGeometry } from "../commit/static-object-geometry-worker";
import { assembleStaticObjectArtifact } from "../commit/static-object-artifact";
import { collectStaticObjectTextureDependencies } from "../commit/static-object-texture-inputs";
import type { StaticObjectLayerArtifact } from "../commit/artifacts";
import {
	StaticLayerRealizer,
	type StaticLayerCompanionPublication,
	type StaticLayerGeometryPreparer,
} from "./static-layer-realizer";
import {
	activeRegionResourceToOwnerId,
	type ActiveRegionResourceOwnerId,
	dynamicGenerationToResourceOwnerId,
	type DynamicPresentationResourceOwnerId,
	PORTAL_TRANSITION_RESOURCE_OWNER_ID,
	landblockLayerToOwnerId,
	parseLandblockLayerOwnerId,
	type ResourceOwnerId,
	staticRevisionToInstallNamespace,
	staticRevisionToResourceOwnerId,
	envCellRevisionToResourceOwnerId,
	terrainSourceToOwnerId,
	type TerrainResourceOwnerId,
	type OwnerId,
	type DynamicOwnerId,
	type DynamicEntityOwnerId,
	dynamicEntityOwnerId,
} from "./owner-ids";
import type { ActiveRegionStaticDetailBinding } from "../resolution/active-region-static-detail";
import {
	STATIC_DETAIL_ROLES,
	type StaticDetailRole,
} from "../resolution/static-detail-role";
import {
	type AuthoredDynamicSource,
	type ResolvedOutdoorStaticLayerSource,
	type ResolvedStaticObjectLayerSource,
} from "../resolution/landblock-layer";
import { adaptAuthoredDynamicPresentation } from "../resolution/authored-dynamic-presentation";
import {
	adaptDynamicEntityPresentation,
	datAssetId,
	dynamicEntityPlacement,
	dynamicEntityPlacementKey,
	type DynamicEntityRealizationDisposition,
	type DynamicEntityRealizationResults,
} from "./dynamic-entity-presentation";
import type {
	DynamicEntityTickBatch,
	DynamicEntityPlayingClip,
	DynamicEntityView,
} from "./dynamic-entity-feed";
import {
	advancePlayingFrame,
	clipEntryFrame,
	playingClip,
	type PlayingClip,
} from "../animation/animation-playback";
import { prepareAnimation } from "../animation/animation-asset-repository";
import type {
	DynamicPresentationSource,
	PlacedDynamicPresentationSource,
} from "../systems/dynamic-presentation-source";
import {
	objectVisualTemplateKey,
	type ObjectVisualTemplate,
} from "../systems/object-visual-template-repository";
import {
	computeOutdoorSceneInterest,
	computeDungeonSceneInterest,
	isOutdoorStaticLayer,
	LandblockLayerKind,
	type OutdoorStaticLayerKind,
	type StaticLayerKind,
	type SceneInterestMap,
	type SceneInterestRequest,
	validateSceneInterestRadiiOrThrow,
} from "./scene-interest";
import type { ResolvedSceneInterestTarget } from "./scene-target";
import {
	EnvCellGeometryPreparer,
	type EnvCellRealizationArtifact,
} from "./env-cell-realization";
import type {
	AudioListenerPlacement,
	Camera,
	PrimaryCameraView,
} from "./types";
import type {
	RuntimeTickProfile,
	RuntimeTickProfiler,
} from "./runtime-tick-profiler";
import type {
	SceneActivationRequest,
	SceneActivationReceipt,
	SceneActivationStatus,
	SceneAvailabilityEvent,
	SceneAvailabilityListener,
	SceneInterestReceipt,
	SceneInterestRevision,
} from "./scene-availability";
import { SceneInterestCommitCoordinator } from "./scene-interest-commit-coordinator";
import { AnimationPresentationScheduler } from "./animation-presentation-scheduler";
import type { TerrainSurfaceSample } from "../terrain/terrain-surface";
import {
	type ResolvedSceneEnvironment,
	UNAUTHORED_SCENE_LIGHTING,
} from "../environment/scene-environment";
import { resolveViewerLightOrigin } from "../environment/viewer-light";
import { OutdoorLightIndex } from "../environment/outdoor-light-index";
import type { OutdoorLightLookup } from "../renderer/renderer";
import {
	resolveTerrainCoverageFog,
	type TerrainFogCoverage,
} from "../environment/terrain-fog";

const DEFAULT_CAMERA: Camera = {
	near: 0.5,
	far: 800,
	fov: 90,
	placement: {
		envCellId: null,
		landblockId: "0xffffffff",
		position: sceneVec3(Vec3.zero()),
		rotation: Quat.identity(),
	},
};
const DEFAULT_ENVIRONMENT: ResolvedSceneEnvironment = {
	backgroundColor: { red: 0.15, green: 0.05, blue: 0.05, alpha: 1 },
	distanceFog: null,
	sky: null,
	lighting: UNAUTHORED_SCENE_LIGHTING,
};

/** Conservative fixed terrain root bound including retail transition lowering. */
const TERRAIN_ROOT_BOUNDS: AABB3 = new AABB3(
	new Vec3(0, -510, -OUTDOOR_LANDBLOCK_WORLD_SIZE),
	new Vec3(OUTDOOR_LANDBLOCK_WORLD_SIZE, 510, 0),
);

const EMPTY_STATIC_OBJECT_GEOMETRY_DIAGNOSTICS: StaticObjectGeometryDiagnostics =
	{
		bakedRangeCount: 0,
		bakedGeometryBytes: 0,
		geometryWorkerDurationMs: 0,
		instancedGeometryBytes: 0,
		sourceMaterialSlotCount: 0,
		sourcePartCount: 0,
		sourceRangeCount: 0,
		sourceResidentCount: 0,
		transparentTemplateBytes: 0,
		transparentTemplateCohortCount: 0,
		transparentTemplateInstanceCount: 0,
	};

/** Runtime-owned collaborators that tests may replace with focused fakes. */
export interface GamePresentationRuntimeDependencies {
	readonly animationSource: AnimationAssetSource;
	readonly physicsScriptSource: PhysicsScriptSource;
	readonly audioDevice: AudioDevice;
	readonly particleEmitterSource: ParticleEmitterSource;
	readonly soundTableSource: SoundTableSource;
	readonly particleMeshSource: ParticleMeshSource;
	/** Optional live-entity visual capability; null for runtimes that never consume a focused feed. */
	readonly setupVisualSource: SetupVisualSource | null;
	readonly terrainGenerator: TerrainGenerator;
	readonly texturePreparer: TexturePreparer;
	readonly staticGeometryPreparer: StaticLayerGeometryPreparer<
		ResolvedStaticObjectLayerSource,
		StaticObjectLayerArtifact | null,
		OwnerId
	>;
	/**
	 * Optional per-phase tick timing.
	 *
	 * Diagnostic infrastructure, so a production runtime is not obliged to construct one or carry
	 * its state, and the tick reads as phases rather than as measurement. The Explorer and the
	 * browser harness supply one; the thin client route does not.
	 */
	readonly tickProfiler?: RuntimeTickProfiler;
	/**
	 * Uniform [0, 1) source for authored randomness, defaulting to `Math.random`.
	 *
	 * Injectable so a diagnostic harness can make particle emission reproducible. Without a seed,
	 * two runs of the same build differ enough that screenshots cannot resolve a rendering change.
	 */
	readonly roll?: UniformRoll;
}

/** Browser worker constructors replaceable by Node integration tests without inline algorithms. */
export interface GamePresentationRuntimeWorkerFactories {
	readonly createTerrainWorker: () => ClosedWorkerPort;
}

/** Device boundary used by runtime to construct its private renderer facade. */
export interface GamePresentationRuntimeRenderDevice {
	readonly resources: RendererResourceManager;
	buildRenderer(world: RenderWorld): Promise<Renderer>;
}

/** One completed static artifact retained with the currently relevant interest revision. */
interface PendingCommitArtifact {
	readonly artifact: LandblockLayerCommit;
	readonly revision: SceneInterestRevision;
}

interface DynamicEntityPresentationRecord {
	readonly generation: number;
	/**
	 * Dynamics owner generation this node's behavior targets carry.
	 *
	 * Distinct from `generation`, which is the host's semantic entity generation: a later clip
	 * projection has to name the target the animation record was staged under, not the entity's.
	 */
	readonly behaviorGeneration: number;
	readonly nodeId: SceneNodeId;
	readonly ownerId: DynamicEntityOwnerId;
	readonly visualKey: string;
	/** Exact desired placement already applied to this scene root. */
	placementIdentity: string;
	/** Mutable visibility/lighting level already applied to the dynamic system. */
	presentationStateIdentity: string;
	/**
	 * Clip level this presentation last applied, so a restated level is not re-entered.
	 *
	 * Mutable because it tracks what this record is doing, not what it is. Every other field
	 * identifies the record and is fixed for its lifetime.
	 */
	playingClip: DynamicEntityPlayingClip | null;
}

/** One unavailable prerequisite that can make a desired entity realizable later. */
type DynamicEntityDeferral =
	| { readonly kind: "parent"; readonly parentGuid: number }
	| { readonly kind: "residency"; readonly residencyKey: string };

/** Runtime-owned desired level and every derived fact consumed by realization decisions. */
interface DesiredDynamicEntityRecord {
	/** Latest mirror-accepted entity level. */
	entity: DynamicEntityView;
	/** Exact immutable visual lookup identity. */
	readonly visualKey: string;
	/** Placement comparison identity computed once when this desired level is accepted. */
	placementIdentity: string;
	/** Current missing prerequisite, or null while eligible/installed. */
	deferral: DynamicEntityDeferral | null;
	/** Exact asynchronous realization owned by this desired record. */
	realization: Promise<void> | null;
}

/** Whether two clip levels name the same playback, so restating one changes nothing. */
function samePlayingClip(
	current: DynamicEntityPlayingClip | null,
	next: DynamicEntityPlayingClip,
): boolean {
	return (
		current !== null &&
		current.animationId === next.animationId &&
		current.framerate === next.framerate &&
		current.lowFrame === next.lowFrame &&
		current.highFrame === next.highFrame &&
		current.completion === next.completion
	);
}

interface CachedDynamicVisual {
	readonly completion: Promise<DecodedStaticPresentation>;
	readonly users: Set<number>;
}

/** One activated authored-dynamic resident or valid static visual fallback. */
export interface AuthoredDynamicResidentDiagnostic {
	readonly layer: LandblockLayerKind;
	readonly landblockId: LandblockOwnerId;
	readonly residentId: string;
	readonly setupSourceId: string;
	readonly defaultAnimationId: string | null;
	readonly presentationMode: "animated" | "static-visual-fallback";
	readonly blockingHooks: readonly {
		readonly animationId: string;
		readonly frameIndex: number;
		readonly authoredOrder: number;
		readonly command: string;
	}[];
}

/** One installed outdoor-static layer's source-to-runtime diagnostic snapshot. */
export interface StaticObjectLayerRuntimeDiagnostics extends StaticObjectLayerDiagnostics {
	/** Concrete SceneGraph culling group selected for this independently installed layer. */
	readonly cullingGroup: OutdoorStaticLayerKind;
	readonly layer: OutdoorStaticLayerKind;
	readonly landblockId: LandblockOwnerId;
	/** Scene nodes published by this exact layer revision. */
	readonly sceneNodeCount: number;
	/** Promoted residents owned by the authored dynamic runtime. */
	readonly runtimeDynamicResidentCount: number;
	/** Whether this source emitted a static artifact rather than only promoted residents. */
	readonly staticArtifactInstalled: boolean;
}

/** Aggregate outdoor-static resource and arbitration facts for app-local diagnostics. */
export interface StaticObjectRuntimeDiagnostics {
	readonly layers: readonly StaticObjectLayerRuntimeDiagnostics[];
	readonly envCellLayers: readonly EnvCellLayerRuntimeDiagnostics[];
	readonly geometryResourceCount: number;
	/** Uploaded vertex and index payload bytes across every resident geometry. */
	readonly geometryResourceBytes: number;
	readonly staticObjectOwnerCount: number;
	/**
	 * Outdoor static layer publications since startup.
	 *
	 * Each publication is one synchronous main-thread install, so streaming frame timing is only
	 * comparable between runs that published a similar number of layers in the window.
	 */
	readonly staticLayerPublicationCount: number;
	readonly staticObjectNodeCount: number;
	/** Landblock layers owning outdoor lights; growth across relocations means evicted lamps leaked. */
	readonly outdoorLightScopeCount: number;
	/** Synchronous texture-fact collection before building realization dispatch. */
	readonly textureFactCollectionDurationMs: number;
	readonly textureFactCollectionCount: number;
	readonly texture: ReturnType<
		TextureManager<ResourceOwnerId>["getDiagnostics"]
	>;
	/** Active packed atlas pages, exposed as resource-free Explorer diagnostics. */
	readonly textureAtlasPages: readonly TextureAtlasPageDiagnostics[];
}

/** Runtime-owned authored portal closure and transition-resource diagnostics. */
export interface PortalTransitionRuntimeDiagnostics {
	/** Whether the required setup/animation/sound closure is installed. */
	readonly installed: boolean;
	/** Exact source envelopes, with null reserved for injected sources that cannot report bytes. */
	readonly sourceBytes: PortalTransitionAssets["sourceBytes"] | null;
	/** Direct playback cursor facts, or null before the closure is installed. */
	readonly animation: {
		readonly frameCount: number;
		readonly framePosition: number;
		readonly framesPerSecond: number;
		readonly id: DatAssetId;
		readonly partCount: number;
	} | null;
	/** Current transition edge and generation, or null while no transition is active. */
	readonly transition: {
		readonly generation: number;
		readonly phase: PortalTransitionFrame["phase"];
		readonly progress: number;
	} | null;
	/** Shared persistent resource totals; transition resources remain in renderer metrics. */
	readonly persistent: {
		readonly geometryResourceBytes: number;
		readonly geometryResourceCount: number;
		readonly textureAtlasPageBytes: number;
		readonly textureAtlasPageCount: number;
		readonly textureSourceBytes: number;
	};
	/** Template preparation state and owner count for the shared visual repository. */
	readonly templates: ObjectVisualTemplateRepositoryDiagnostics;
	/** Number of retained portal closure resources (one template owner and three wave buffers). */
	readonly outstandingHandles: {
		readonly portalTemplateOwner: number;
		readonly portalWaveBuffers: number;
	};
}

/** One realized EnvCell source plan plus worker consumption facts. */
export interface EnvCellLayerRuntimeDiagnostics
	extends EnvCellMaterializationDiagnostics, StaticObjectGeometryDiagnostics {
	/** Directed seams proven safe for ordinary depth continuity. */
	readonly indoorDepthContinuousCrossingCount: number;
	/** Directed indoor seams that retain a topology-mask boundary. */
	readonly indoorTopologyBoundaryCrossingCount: number;
	/** Directed indoor/outdoor transitions that always retain a scene-domain boundary. */
	readonly exteriorTransitionCrossingCount: number;
	readonly landblockId: LandblockOwnerId;
	/** Total authored potentially-visible EnvCell references across resident scopes. */
	readonly potentiallyVisibleReferenceCount: number;
	readonly sceneShellNodeCount: number;
	readonly sceneResidentNodeCount: number;
	/** Connected components joined only through proven depth-continuous seams. */
	readonly visibilityIslandCount: number;
}

/** Exact immutable visual lookup identity; motion and mutable physics never enter this key. */
function dynamicVisualKey(entity: DynamicEntityView): string {
	return JSON.stringify({
		appearance: entity.presentation.appearance,
		setupDid: entity.presentation.content.setupDid,
	});
}

/** Exact scene-spatial placement used to avoid kinematic-level upserts clearing an active path. */
function dynamicPlacementIdentity(entity: DynamicEntityView): string {
	return dynamicPathIdentity(entity);
}

/** Placement facts whose change requires a scene path rather than a level-only tick update. */
function dynamicPathIdentity(entity: DynamicEntityView): string {
	return entity.placement.kind === "world"
		? JSON.stringify({
				pose: entity.placement.pose,
				spatialMembership: entity.placement.spatialMembership,
			})
		: JSON.stringify(entity.placement);
}

/** Mutable presentation level applied independently from placement and visual identity. */
function dynamicPresentationStateIdentity(entity: DynamicEntityView): string {
	return JSON.stringify({
		cloaked: entity.physics.cloaked,
		hidden: entity.physics.hidden,
		lighting: entity.physics.lighting,
		noDraw: entity.physics.noDraw,
	});
}

/** Resident scope that can wake one deferred world-root entity. */
function dynamicResidencyKey(entity: DynamicEntityView): string {
	if (entity.placement.kind !== "world") {
		throw new Error(
			`Attached dynamic entity ${formatDynamicGuid(entity.identity.guid)} has no residency key.`,
		);
	}
	const cellId = entity.placement.pose.landblockId >>> 0;
	const landblockId = datAssetId((cellId & 0xffff_0000) | 0xffff);
	return (cellId & 0xffff) >= 0x0100
		? `${landblockId}:env-cell:${datAssetId(cellId)}`
		: `${landblockId}:outdoor`;
}

function formatDynamicGuid(guid: number): string {
	return `0x${(guid >>> 0).toString(16).padStart(8, "0")}`;
}

function dynamicEntityPresentationFailure(
	entity: DynamicEntityView,
	cause: unknown,
): Error {
	const reason = cause instanceof Error ? cause.message : String(cause);
	return new Error(
		`Dynamic entity ${formatDynamicGuid(entity.identity.guid)} generation ${entity.generation} presentation refused: ${reason}`,
		{ cause },
	);
}

/** Bridges source commits, scene topology, runtime residency, and frontend frame state. */
export class GamePresentationRuntime {
	/** Canonical scene topology, residency, transforms, and spatial-query membership. */
	readonly #scene = new SceneGraph();
	/** Sole frontend writer of dynamic entity root placement and residency. */
	readonly #dynamicPlacements = new DynamicEntityPlacementSystem(this.#scene);
	/** Logical geometry bindings and shared owner retention. */
	readonly #geometry: GeometryManager<ResourceOwnerId>;
	/** Logical texture preparation, device bindings, and shared owner retention. */
	readonly #textures: TextureManager<ResourceOwnerId>;
	/** Packed object-atlas authority injected into the generic texture facade. */
	readonly #residentAtlas: ResidentTextureAtlas<ResourceOwnerId>;
	/** Immutable-object nodes, components, and resource publication. */
	readonly #staticObjects: StaticObjectSystem<OwnerId, ResourceOwnerId>;
	/** Landblock-scoped authored outdoor lights, rebuilt only when layer residency changes. */
	readonly #outdoorLights: OutdoorLightLookup & OutdoorLightIndex =
		new OutdoorLightIndex();
	/** Source-to-static publication sequencing for independent outdoor static layers. */
	readonly #staticLayerRealizer: StaticLayerRealizer<
		ResolvedOutdoorStaticLayerSource,
		StaticObjectLayerArtifact | null,
		OwnerId
	>;
	readonly #envCellRealizer: StaticLayerRealizer<
		EnvCellMaterializationPlan,
		EnvCellRealizationArtifact,
		OwnerId
	>;
	/** Shared visual-template residency for authored dynamics and the portal transition object. */
	readonly #objectVisualTemplates: ObjectVisualTemplateRepository<
		DynamicPresentationResourceOwnerId,
		AtlasRequirementHandle<ResourceOwnerId>
	>;
	/** Dynamic roots, articulated part nodes, and presentation preparation. */
	readonly #dynamics: DynamicEntitySystem<DynamicOwnerId, ResourceOwnerId>;
	readonly #setupVisualSource: SetupVisualSource | null;
	/** Latest desired current views are liveness tokens and late-readiness endpoints, not authority. */
	readonly #spawnedDesiredEntities = new Map<
		number,
		DesiredDynamicEntityRecord
	>();
	/** Desired attachment adjacency used by parent replacement/removal and late readiness. */
	readonly #spawnedDesiredChildren = new Map<number, Set<number>>();
	/** Deferred world roots keyed by the static residency fact that can wake them. */
	readonly #spawnedDeferredResidencies = new Map<string, Set<number>>();
	/** Deferred attachments keyed by the exact desired parent that can wake them. */
	readonly #spawnedDeferredParents = new Map<number, Set<number>>();
	/** Installed frontend resources keyed by producer identity. */
	readonly #spawnedPresentations = new Map<
		number,
		DynamicEntityPresentationRecord
	>();
	readonly #spawnedVisualKeys = new Map<number, string>();
	readonly #spawnedVisuals = new Map<string, CachedDynamicVisual>();
	/** Env-cell scopes, crossings, shell nodes, and portal contributions. */
	readonly #envCells: EnvCellSystem<OwnerId, ResourceOwnerId>;
	/** Rigid-part pose updates sequenced before visibility and drawing. */
	readonly #animation: AnimationSystem<ResourceOwnerId>;
	/** Binary previous-frame-visible versus timed-offscreen presentation policy. */
	readonly #animationPresentation = new AnimationPresentationScheduler();
	/** Persistent visual-effect state advanced only by the authored behavior clock. */
	readonly #effects: EffectSystem;
	readonly #behaviorRouter: BehaviorEventRouter;
	readonly #physicsScripts: PhysicsScriptRepository;
	readonly #particleEmitters: ParticleEmitterRepository;
	readonly #particles: ParticleSystem;
	readonly #soundTables: SoundTableRepository;
	readonly #particleMeshes: ParticleMeshCache;
	/** Sound table installed by each behaviour target's setup, for `SoundTable` key resolution. */
	readonly #targetSoundTables = new Map<BehaviorTargetId, DecodedSoundTable>();
	/** Exact behavior targets installed by each shared dynamic owner. */
	readonly #dynamicBehaviorTargets = new Map<
		DynamicOwnerId,
		ReadonlySet<BehaviorTargetId>
	>();
	/**
	 * Sky-module-owned behavior targets, which have no scene residency at all.
	 *
	 * Registered at activation and removed at teardown, so membership is also the liveness signal
	 * the residency resolvers read.
	 */
	readonly #skyTargets = new Map<BehaviorTargetId, SkyBehaviorTarget>();
	/** Runs the scripts authored on sky objects; owns their staging and lifetime. */
	readonly #skyScripts: SkyScriptSystem;
	readonly #physicsScriptSystem: PhysicsScriptSystem<
		DynamicOwnerId | SkyOwnerId
	>;
	readonly #audio: AudioSystem;
	readonly #ambient: AmbientSystem;
	/** Bounded owner for live ambient-weight and voice-placement control work. */
	readonly #audioControlCadence = new AudioControlCadence(
		FRONTEND_TUNING.audio.controlUpdateIntervalSeconds,
	);
	/** Where ambience is centred; the listener's own position, kept for the scan and for playback. */
	#audioListenerPosition: SceneVector3 = sceneVector3([0, 0, 0]);
	/** Environment cell the listener occupies, or null for outdoor terrain. */
	#audioListenerEnvCellId: EnvCellId | null = null;
	/** Whether the current mode owns listener/audio presentation for this frame. */
	#audioListenerEnabled = false;
	/** Region ambient facts, installed once per active region; `null` before one is installed. */
	#ambientRegion: AmbientRegionResolution | null = null;
	/** Baked sound-authoring ground per installed landblock, reconciled by terrain revision. */
	readonly #ambientBakes = new AmbientBakeRegistry();
	/** Hoisted so the every-frame reconcile check allocates nothing. */
	readonly #listAmbientTerrain = () => this.#ambientTerrainBlocks();
	/** Staged ambient sound tables, keyed as the descriptors name them. */
	readonly #ambientSoundTables = new Map<DatAssetId, DecodedSoundTable>();
	/** Handles retaining staged ambient sound tables; released on new region or runtime destruction. */
	readonly #ambientSoundTableHandles = new Map<
		DatAssetId,
		PreparedAssetHandle<DecodedSoundTable>
	>();
	/**
	 * Scan cell the last ambient schedule refresh ran from, floored on the authored terrain cell
	 * size. Cell-sized rather than landblock-sized: the ambient radius is 120 m against a 192 m
	 * block, so a landblock trigger would let the listener cross most of the audible field between
	 * refreshes. Compared as numbers so the per-frame check allocates nothing.
	 */
	#ambientScanCellX: number | null = null;
	#ambientScanCellZ: number | null = null;
	/** EnvCell the last ambient refresh ran under, part of the same numeric trigger. */
	#ambientScanEnvCellId: EnvCellId | null = null;
	/**
	 * Make every mesh this generation's emitters can name resident.
	 *
	 * Deliberately fire-and-forget: a resident activates immediately and its first particles may
	 * miss a frame or two while meshes land, which the draw pass counts as unresolved ranges.
	 * Blocking activation on mesh residency would hold back correct script, audio, and animation
	 * behavior for a purely visual dependency.
	 */
	async #stageParticleMeshes(
		prepared: readonly {
			readonly scriptClosure: PreparedPhysicsScriptClosure | null;
		}[],
	): Promise<void> {
		const emitterInfoIds = new Set<DatAssetId>();
		for (const entity of prepared) {
			if (entity.scriptClosure === null) continue;
			for (const script of entity.scriptClosure.scripts.values()) {
				for (const id of script.dependencies.emitterInfoIds)
					emitterInfoIds.add(id);
			}
		}
		if (emitterInfoIds.size === 0) return;
		const meshIds = [...emitterInfoIds].flatMap((id) => {
			const emitter = this.#particleEmitters.getReady(id);
			return emitter?.kind === "drawable" ? [emitter.mesh.id] : [];
		});
		if (meshIds.length === 0) return;
		const batch = await this.#particleMeshes.prepare(meshIds);
		// Only a newly loaded batch reaches residency; already-known meshes never re-upload.
		if (batch !== null)
			await this.#renderer?.particles?.install(batch, this.#texturePreparer);
	}

	/** Current world origin of one behavior target, or `null` once it leaves the scene. */
	/**
	 * Origin of a node in the fixed scene frame.
	 *
	 * Landblock-local origins are meaningless outside their own landblock, and anchor-relative ones
	 * decay the moment the camera crosses a boundary. This frame is the only one safe to retain.
	 */
	#sceneOriginOf(nodeId: SceneNodeId): SceneVector3 | null {
		const resolved = this.#scene.getResolvedOrigin(nodeId);
		if (!resolved) return null;
		const origin = resolved.landblockOrigin;
		const landblockOrigin = createLandblockWorldOrigin(resolved.landblockId);
		return sceneVector3([
			origin.x + landblockOrigin.x,
			origin.y + landblockOrigin.y,
			origin.z + landblockOrigin.z,
		]);
	}

	/**
	 * Current rotation of a target's frame, in AC's authored axes.
	 *
	 * Read from the same resolved placement as {@link GamePresentationRuntime.#sceneOriginOf}, so it reflects
	 * whatever a script has rotated the owner to rather than its authored pose.
	 */
	#sceneRotationOf(nodeId: SceneNodeId): AcRotation | null {
		const placement = this.#scene.getResolvedPlacement(nodeId);
		if (!placement) return null;
		return acRotationFromRenderTransform(placement.localToLandblock);
	}

	/**
	 * Resolve one behavior target's frame, whichever module owns it.
	 *
	 * This is the single place that knows every residency, which is what lets `BehaviorTarget` stay
	 * one id and one generation with no kind tag: consumers take origins and rotations as injected
	 * functions and never learn that sky targets exist. A target in neither residency resolves
	 * `null` rather than throwing, because that is exactly what a torn-down target should report —
	 * teardown removes its registration, and a command queued against it must be rejected as stale.
	 */
	#originOf(target: BehaviorTarget): SceneVector3 | null {
		const sky = this.#skyTargets.get(target.targetId);
		if (sky) return sky.originOf();
		const nodeId = sceneNodeIdOf(target.targetId);
		return nodeId === null ? null : this.#sceneOriginOf(nodeId);
	}

	/**
	 * Whether a behavior target still exists, in either residency, without resolving its frame.
	 *
	 * The liveness half of {@link GamePresentationRuntime.#originOf}, split out because per-frame consumers ask
	 * only this: both residencies always publish an origin for a target they hold, so existence and
	 * "has an origin" are the same fact, and only one of them costs a scene-hierarchy walk.
	 */
	#targetLives(target: BehaviorTarget): boolean {
		if (this.#skyTargets.has(target.targetId)) return true;
		const nodeId = sceneNodeIdOf(target.targetId);
		return nodeId !== null && this.#scene.hasNode(nodeId);
	}

	#rotationOf(target: BehaviorTarget): AcRotation | null {
		const sky = this.#skyTargets.get(target.targetId);
		if (sky) return sky.rotationOf();
		const nodeId = sceneNodeIdOf(target.targetId);
		return nodeId === null ? null : this.#sceneRotationOf(nodeId);
	}

	/**
	 * Resolve the frame a part-attached emitter rides.
	 *
	 * Sky objects are single-part Setups — the whole censused set is one part, `0x010001EC`,
	 * carrying only a default script — so their only part is the object itself and part 0 resolves
	 * to the same frame. Any other index names a part they do not have, which is `unprepared`
	 * rather than a silent fallback to the root.
	 */
	#partFrameOf(
		target: BehaviorTarget,
		partIndex: number,
	): BehaviorTarget | null {
		if (this.#skyTargets.has(target.targetId)) {
			return partIndex === SKY_OBJECT_ONLY_PART_INDEX ? target : null;
		}
		const nodeId = sceneNodeIdOf(target.targetId);
		if (nodeId === null) return null;
		const partNodeId = this.#dynamics.resolvePartNode(nodeId, partIndex);
		// The generation is carried through unchanged: the part belongs to the same activation, so
		// a command that has outlived its owner must still be rejected.
		return partNodeId === null
			? null
			: {
					generation: target.generation,
					targetId: behaviorTargetId(partNodeId),
				};
	}

	/**
	 * Resolve the render owner for a target whose particles survive this frame's culling.
	 *
	 * Scene residents cull against the renderer's previous dynamic selection. Sky targets are
	 * viewer-centered and drawn unconditionally — retail never culls the sky — so they are always
	 * selected and route through the exterior domain. Without that explicit owner they would cull
	 * to nothing every frame: a sky target is absent from a selection built out of scene node ids.
	 */
	#particleRenderOwner(target: BehaviorTarget): ParticleRenderOwner | null {
		if (this.#skyTargets.has(target.targetId)) {
			return SKY_PARTICLE_RENDER_OWNER;
		}
		const nodeId = sceneNodeIdOf(target.targetId);
		return nodeId !== null && this.#selectedDynamicNodeIds.has(nodeId)
			? nodeId
			: null;
	}

	/** Latest advanced frame time, so a mid-frame installation anchors to the current clock. */
	#lastFrameTimeSeconds = 0;
	/** Previous frame's renderer selection, which particle culling reads. */
	#selectedDynamicNodeIds = new Set<SceneNodeId>();
	readonly #tickProfiler: RuntimeTickProfiler | undefined;
	/** Active authored-dynamic residents grouped by their source owner. */
	readonly #authoredDynamicResidents = new Map<
		OwnerId,
		AuthoredDynamicResidentDiagnostic[]
	>();
	/** Source-to-runtime outdoor-static snapshots removed with their layer owner. */
	readonly #staticObjectLayerDiagnostics = new Map<
		OwnerId,
		StaticObjectLayerRuntimeDiagnostics
	>();
	readonly #envCellLayerDiagnostics = new Map<
		OwnerId,
		EnvCellLayerRuntimeDiagnostics
	>();
	#textureFactCollectionDurationMs = 0;
	#textureFactCollectionCount = 0;
	/** Outdoor static layer publications; each one is a synchronous main-thread install. */
	#staticLayerPublicationCount = 0;
	/** Active-region owner of the complete device-backed static-detail role set. */
	#activeRegionStaticDetailOwner: ActiveRegionResourceOwnerId | null = null;
	/** Read-only regional detail selections consumed by renderer-owned object programs. */
	readonly #activeRegionStaticDetails = new Map<
		StaticDetailRole,
		{ readonly key: AssetTextureKey; readonly tiling: number }
	>();
	/** Dynamic terrain sources, generation state, and realized terrain resources. */
	readonly #terrain: TerrainSystem<ResourceOwnerId, TerrainResourceOwnerId>;
	/**
	 * Derived overhead-map geometry, installed and evicted with the layers it comes from.
	 *
	 * Held beside the scene rather than in it: the map is a second consumer of the same records,
	 * and its geometry must never acquire scene-node lifetime.
	 */
	readonly #mapGeometry = new MapGeometryStore();
	/** Read-only renderer gateway over this runtime's scene and resource systems. */
	readonly #renderWorld: RenderWorld;
	/** Renderer constructed with this runtime's private read-only world facade. */
	#renderer: Renderer | null = null;
	/** Runtime-owned terrain-generation worker terminated during runtime shutdown. */
	readonly #terrainGenerator: TerrainGenerator;
	/** Shared source preparer consumed by both generic textures and resident atlas. */
	readonly #texturePreparer: TexturePreparer;
	/** Asynchronous scene-interest receipt coordination, separate from runtime mutation authority. */
	readonly #sceneInterestCoordinator: SceneInterestCommitCoordinator;
	/** Completed asynchronous commits awaiting the next synchronous runtime tick. */
	readonly #commitArtifacts: PendingCommitArtifact[] = [];
	/** Resource continuations awaited before runtime-owned sources and renderer state are destroyed. */
	readonly #realizationContinuations = new Set<Promise<void>>();
	/** Asynchronous dependency-wake failures surfaced synchronously by the next runtime tick. */
	readonly #dynamicRealizationFailures: unknown[] = [];
	/** Frontend listeners informed when placement facts become available or fail. */
	readonly #sceneAvailabilityListeners = new Set<SceneAvailabilityListener>();
	/** Current primary-view input used for visibility and rendering. */
	#camera: Camera = DEFAULT_CAMERA;
	/** Exact drawing extent committed atomically with `#camera`, absent before first view sync. */
	#primaryViewExtent: RenderExtent | null = null;
	/** Frontend-owned static regional presentation state for every render frame. */
	#environment: ResolvedSceneEnvironment = DEFAULT_ENVIRONMENT;
	/** Frontend-selected dynamic display choices forwarded unchanged to each frame. */
	#frameSettings: FrameSettings = DEFAULT_FRAME_SETTINGS;
	/** Presentation-only transition input consumed by the renderer's final-frame compositor. */
	#portalTransition: PortalTransitionFrame | undefined;
	/** Prepared authored portal closure retained until runtime teardown. */
	#portalTransitionAssets: PortalTransitionAssets | null = null;
	/** Authored 40fps traversal sampled at render cadence for the portal's setup and sound hooks. */
	#portalTransitionClip: PlayingClip | null = null;
	#portalTransitionFramePosition = 0;
	#portalTransitionAnimationGeneration: number | null = null;
	#portalTransitionLastTimeSeconds: number | null = null;
	/**
	 * Spawned entity carrying the viewer light, or null while the camera carries it itself.
	 *
	 * Held as an identity rather than a pose: the carrier is walking, and the scene is what
	 * presentation rate updates, so the light is resolved from the live placement every frame
	 * instead of from whatever the frontend last sampled.
	 */
	#viewerLightCarrier: number | null = null;
	/** Terrain interest constraining the frontend's effective distance-fog range. */
	#terrainFogCoverage: TerrainFogCoverage | null = null;
	/** Complete static demand selected by the latest accepted scene target. */
	#sceneInterest: SceneInterestMap = new Map();
	/** Last resolved target accepted by this runtime, for diagnostics and consumer policy. */
	#resolvedSceneInterestTarget: ResolvedSceneInterestTarget | null = null;
	/** One source-neutral replacement barrier layered over the ordinary interest coordinator. */
	#sceneActivation: SceneActivationReceipt | null = null;
	/** Exact layer failures retained until the owning interest revision is withdrawn. */
	readonly #sceneLayerFailures = new Map<
		string,
		{ readonly revision: SceneInterestRevision; readonly diagnostic: string }
	>();
	/** Prevents new work and late async publication after runtime shutdown begins. */
	#destroyed = false;

	protected constructor(
		renderResources: RendererResourceManager,
		commitPipeline: CommitPipeline,
		dependencies: GamePresentationRuntimeDependencies,
	) {
		this.#tickProfiler = dependencies.tickProfiler;
		this.#setupVisualSource = dependencies.setupVisualSource;
		this.#terrainGenerator = dependencies.terrainGenerator;
		this.#texturePreparer = dependencies.texturePreparer;
		this.#geometry = new GeometryManager<ResourceOwnerId>(renderResources);
		this.#residentAtlas = new ResidentTextureAtlas<ResourceOwnerId>(
			dependencies.texturePreparer,
			typeof Worker === "undefined"
				? null
				: {
						layoutPlanner: new AtlasLayoutWorkerPool({
							createWorker: () =>
								new Worker(
									new URL(
										"../textures/atlas/layout-worker.entry.ts",
										import.meta.url,
									),
									{ type: "module" },
								) as unknown as import("../workers/closed-worker").ClosedWorkerPort,
							workerCount: 1,
						}),
						pageBuilder: new AtlasPageBuildWorkerPool({
							createWorker: () =>
								new Worker(
									new URL(
										"../textures/atlas/page-build-worker.entry.ts",
										import.meta.url,
									),
									{ type: "module" },
								) as unknown as import("../workers/closed-worker").ClosedWorkerPort,
							workerCount: 2,
						}),
						renderResources,
						// Compaction can move a retained placement, so anything holding a resolved
						// atlas rect re-resolves it. The renderer may not exist yet during early
						// content load; it holds nothing to invalidate until it does.
						onLayoutPublished: () =>
							this.#renderer?.invalidateResolvedResources?.(
								"atlas-publication",
							),
					},
		);
		this.#textures = new TextureManager<ResourceOwnerId>(
			renderResources,
			dependencies.texturePreparer,
			this.#residentAtlas,
		);
		this.#staticObjects = new StaticObjectSystem<OwnerId, ResourceOwnerId>(
			this.#scene,
			this.#geometry,
			staticRevisionToResourceOwnerId,
		);
		const staticLayerCurrentness = {
			isCurrent: (
				owner: OwnerId,
				layer: StaticLayerKind,
				revision: SceneInterestRevision,
			): boolean => {
				const parsed = parseLandblockLayerOwnerId(owner);
				if (parsed.layer !== layer) {
					throw new Error(
						`Static realization owner ${owner} does not match layer ${layer}.`,
					);
				}
				return this.#sceneInterestCoordinator.ownsDispatch(
					{ id: parsed.landblockId, layer },
					revision,
				);
			},
		};
		this.#staticLayerRealizer = new StaticLayerRealizer<
			ResolvedOutdoorStaticLayerSource,
			StaticObjectLayerArtifact | null,
			OwnerId
		>({
			atlas: this.#residentAtlas,
			currentness: staticLayerCurrentness,
			failureReporter: {
				reportAtlasFailure: ({ cause, layer, owner, revision }) =>
					console.error({
						cause,
						kind: "static-layer-atlas-failed",
						layer,
						owner,
						revision,
					}),
			},
			geometry: dependencies.staticGeometryPreparer,
			publisher: {
				evict: async (owner, revision) => {
					this.#staticObjects.evict(owner, revision);
					const parsed = parseOutdoorLayerOwner(owner);
					this.#outdoorLights.evict(parsed.landblockId, parsed.layer, revision);
				},
				removeExact: async (owner, revision) => {
					this.#staticObjects.removeExact(owner, revision);
					const parsed = parseOutdoorLayerOwner(owner);
					this.#outdoorLights.removeExact(
						parsed.landblockId,
						parsed.layer,
						revision,
					);
				},
				replace: async ({ geometry, layer, owner, revision }) => {
					if (!isOutdoorStaticLayer(layer)) {
						throw new Error(`Outdoor static publisher received ${layer}.`);
					}
					this.#staticLayerPublicationCount += 1;
					this.#staticObjects.replaceObjects(owner, revision, geometry, layer);
					// Only the Objects layer emits, but every outdoor layer publishes here: an
					// empty set is how a withdrawn layer clears its own entry.
					this.#outdoorLights.install(
						parseOutdoorLayerOwner(owner).landblockId,
						layer,
						revision,
						geometry?.staticLights ?? [],
					);
				},
			},
		});
		this.#envCells = new EnvCellSystem(
			this.#scene,
			this.#geometry,
			envCellRevisionToResourceOwnerId,
		);
		this.#envCellRealizer = new StaticLayerRealizer<
			EnvCellMaterializationPlan,
			EnvCellRealizationArtifact,
			OwnerId
		>({
			atlas: this.#residentAtlas,
			currentness: staticLayerCurrentness,
			failureReporter: {
				reportAtlasFailure: ({ cause, layer, owner, revision }) =>
					console.error({
						cause,
						kind: "env-cell-atlas-failed",
						layer,
						owner,
						revision,
					}),
			},
			geometry: new EnvCellGeometryPreparer(
				dependencies.staticGeometryPreparer,
			),
			publisher: {
				evict: async (owner, revision) => {
					this.#envCells.evict(owner, revision);
					this.#staticObjects.evict(owner, revision);
				},
				removeExact: async (owner, revision) => {
					this.#envCells.removeExact(owner, revision);
					this.#staticObjects.removeExact(owner, revision);
				},
				replace: async ({ geometry, owner, revision }) => {
					const rollbackEnvironment = this.#envCells.replace(
						owner,
						revision,
						geometry.environment,
					);
					try {
						this.#staticObjects.replaceObjects(
							owner,
							revision,
							geometry.residents,
							"env-cell-static-residents",
						);
					} catch (cause) {
						rollbackEnvironment();
						throw cause;
					}
				},
			},
		});
		this.#effects = new EffectSystem();
		this.#soundTables = new SoundTableRepository(dependencies.soundTableSource);
		this.#particleMeshes = new ParticleMeshCache(
			dependencies.particleMeshSource,
		);
		this.#physicsScripts = new PhysicsScriptRepository(
			dependencies.physicsScriptSource,
		);
		this.#particleEmitters = new ParticleEmitterRepository(
			dependencies.particleEmitterSource,
		);
		this.#particles = new ParticleSystem({
			clock: () => this.#lastFrameTimeSeconds,
			// Reads an already-staged definition; an unstaged id returns null rather than starting
			// a load inside the frame.
			resolveEmitter: (emitterInfoId) =>
				this.#particleEmitters.getReady(emitterInfoId),
			sceneOriginOf: (target) => this.#originOf(target),
			targetLives: (target) => this.#targetLives(target),
			sceneRotationOf: (target) => this.#rotationOf(target),
			// A part-attached emitter is positioned by its part's node, which the dynamics system owns.
			// The generation is carried through unchanged: the part belongs to the same activation, so
			// a command that has outlived its owner must still be rejected.
			partFrameOf: (target, partIndex) => this.#partFrameOf(target, partIndex),
			roll: dependencies.roll ?? Math.random,
		});
		this.#objectVisualTemplates = new ObjectVisualTemplateRepository<
			DynamicPresentationResourceOwnerId,
			AtlasRequirementHandle<ResourceOwnerId>
		>(
			this.#geometry,
			this.#residentAtlas,
			new InlineObjectVisualTemplatePreparer(),
		);
		this.#dynamics = new DynamicEntitySystem(
			this.#scene,
			this.#dynamicPlacements,
			this.#objectVisualTemplates,
			new AnimationAssetRepository(dependencies.animationSource),
			this.#physicsScripts,
			this.#particleEmitters,
			this.#effects,
			this.#soundTables,
			dynamicGenerationToResourceOwnerId,
			// Emitters ride their owner's visibility: its bounds grow to contain what it emits, so
			// the renderer's existing footprint test covers particles without a parallel path.
			(nodeId) => this.#particles.envelopeRadiusFor(behaviorTargetId(nodeId)),
		);
		this.#audio = new AudioSystem(
			dependencies.audioDevice,
			Math.random,
			FRONTEND_TUNING.audio.maximumSimultaneousVoices,
			() => this.#lastFrameTimeSeconds,
			FRONTEND_TUNING.audio.maximumWarmupReplaySeconds,
		);
		this.#ambient = new AmbientSystem({
			// Pure wiring: the ambient system owns the buffer, what share means, and the indoor
			// gate; the runtime only knows where the baked terrain lives.
			accumulateWeights: (outWeights) =>
				accumulateAmbientWeights(
					this.#audioListenerPosition,
					this.#ambientBakes.blocks(),
					outWeights,
				),
			listenerHearsOutdoors: () => this.#ambientListenerSeenOutside(),
			listenerPosition: () => this.#audioListenerPosition,
			play: (trigger) =>
				this.#audioListenerEnabled ? this.#audio.trigger(trigger) : "inaudible",
			resolveSound: (soundTableId, soundType) =>
				this.#resolveAmbientSound(soundTableId, soundType),
			roll: dependencies.roll ?? Math.random,
		});
		// The script system both produces and consumes `CallPES`, so the two are mutually dependent
		// by design. A holder breaks the construction cycle without making the router mutable.
		const scriptWiring: {
			system?: PhysicsScriptSystem<DynamicOwnerId | SkyOwnerId>;
		} = {};
		this.#behaviorRouter = new BehaviorEventRouter(
			{
				audio: {
					playSound: (target, sound) => {
						if (!this.#audioListenerEnabled) return "suppressed";
						// The emitting node's world position is sampled once at trigger time, as
						// retail samples it; the voice then tracks the listener from that fixed
						// point rather than following the emitter.
						const origin = this.#originOf(target);
						if (origin === null) return "unprepared";
						const outcome = this.#audio.trigger({
							// Authored hook sounds are effect sounds: `PlaySoundA` gates on
							// `effect_sounds_enabled` and passes `is_ambient = 0`.
							category: "effect",
							probability: sound.probability,
							soundId: sound.soundId,
							source: { mode: "world", position: origin, volume: sound.volume },
						});
						return outcome === "played" ? "played" : "suppressed";
					},
					playSoundTableKey: (target, soundType) => {
						if (!this.#audioListenerEnabled) return "suppressed";
						const table = this.#targetSoundTables.get(target.targetId);
						const candidates = table?.entries.get(soundType);
						// Retail's miss is a silent no-op; reporting it keeps a missing table and a
						// missing key distinguishable from a sound that chose not to play.
						if (!candidates) return "unprepared";
						const candidate = selectSoundCandidate(candidates, Math.random());
						if (!candidate) return "unprepared";
						const origin = this.#originOf(target);
						if (origin === null) return "unprepared";
						const outcome = this.#audio.trigger({
							category: "effect",
							probability: candidate.probability,
							soundId: candidate.soundId,
							source: {
								mode: "world",
								position: origin,
								volume: candidate.volume,
							},
						});
						return outcome === "played" ? "played" : "suppressed";
					},
				},
				effects: this.#effects,
				// Authored particles arrive only from physics scripts, and no resident runs one
				// until Phase 7 activates them. Reporting unprepared keeps the outcome honest
				// instead of pretending an emitter was created.
				particles: {
					createEmitter: (target, command) =>
						this.#particles.createEmitter(target, command),
				},
				// Chained script activation lands with the script clock in Phase 7; until an authored
				// script runs, no `CallPES` can reach this port.
				scheduler: {
					scheduleActivation: (target, activation) => {
						const system = scriptWiring.system;
						if (!system)
							throw new Error(
								"Script activation reached an unwired scheduler.",
							);
						system.scheduleActivation(target, activation);
					},
				},
				// A target is live if either producer still holds it at this generation; scripts and
				// animation install independently, so neither alone is authoritative.
				targets: {
					isLive: (target) =>
						this.#animation.holds(target) ||
						(scriptWiring.system?.holds(target) ?? false),
				},
			},
			FRONTEND_TUNING.diagnostics.maximumRecentEffectObservations,
		);
		this.#animation = new AnimationSystem(this.#effects, this.#behaviorRouter);
		this.#physicsScriptSystem = new PhysicsScriptSystem<OwnerId | SkyOwnerId>(
			this.#behaviorRouter,
			Math.random,
		);
		scriptWiring.system = this.#physicsScriptSystem;
		this.#skyScripts = new SkyScriptSystem({
			acquireClosure: (scriptId) =>
				this.#physicsScripts.acquireClosure(scriptId),
			acquireEmitter: (emitterInfoId) =>
				this.#particleEmitters.acquire(emitterInfoId),
			installMeshes: (closure) =>
				this.#stageParticleMeshes([{ scriptClosure: closure }]),
			installScript: (target, closure, timeSeconds) =>
				this.#physicsScriptSystem.install(
					SKY_OWNER_ID,
					target,
					closure,
					timeSeconds,
				),
			removeScript: (targetId) =>
				this.#physicsScriptSystem.remove(SKY_OWNER_ID, targetId),
			registerTarget: (targetId, target) =>
				this.#skyTargets.set(targetId, target),
			unregisterTarget: (targetId) => this.#skyTargets.delete(targetId),
			// Read per call rather than captured, so every sky target follows the live camera.
			viewerOrigin: () => {
				const position = this.#camera.placement.position;
				return sceneVector3([position.x, position.y, position.z]);
			},
			clock: () => this.#lastFrameTimeSeconds,
		});
		this.#terrain = new TerrainSystem<ResourceOwnerId, TerrainResourceOwnerId>(
			this.#scene,
			dependencies.terrainGenerator,
			this.#geometry,
			this.#textures,
			terrainSourceToOwnerId,
		);
		this.#renderWorld = new RenderWorld({
			dynamics: this.#dynamics,
			envCells: this.#envCells,
			geometry: this.#geometry,
			staticDetails: {
				getBinding: (role) => this.#activeRegionStaticDetails.get(role) ?? null,
			},
			scene: this.#scene,
			staticObjects: this.#staticObjects,
			terrain: this.#terrain,
			textures: this.#textures,
		});
		this.#sceneInterestCoordinator = new SceneInterestCommitCoordinator(
			commitPipeline,
			{
				evict: ({ layer, revision }) =>
					this.#evictStaticLayer(layer.id, layer.layer, revision),
				failed: ({ error, layer, revision }) =>
					this.#publishSceneAvailability({
						kind: "scene-content-failed",
						layer: layer.layer,
						message: error instanceof Error ? error.message : String(error),
						residency: { envCellId: null, landblockId: layer.id },
						revision,
					}),
				prepared: ({ artifact, revision }) =>
					this.#commitArtifacts.push({ artifact, revision }),
				unavailable: ({ layer, revision }) =>
					this.#publishSceneAvailability({
						kind: "scene-content-unavailable",
						layer: layer.layer,
						residency: { envCellId: null, landblockId: layer.id },
						revision,
					}),
			},
		);
	}

	/** Construct production runtime workers and inject them into runtime-owned systems. */
	static async build(
		device: GamePresentationRuntimeRenderDevice,
		commitPipeline: CommitPipeline,
		texturePixelSource: TexturePixelSource,
		animationSource: AnimationAssetSource,
		physicsScriptSource: PhysicsScriptSource,
		audioDevice: AudioDevice,
		particleEmitterSource: ParticleEmitterSource,
		soundTableSource: SoundTableSource,
		particleMeshSource: ParticleMeshSource,
		setupVisualSource: SetupVisualSource | null,
		roll?: UniformRoll,
		tickProfiler?: RuntimeTickProfiler,
		workerFactories?: GamePresentationRuntimeWorkerFactories,
	): Promise<GamePresentationRuntime> {
		const [terrainGenerator, texturePreparer] = await Promise.all([
			workerFactories === undefined
				? WorkerTerrainGenerator.build()
				: new WorkerTerrainGenerator({
						createWorker: workerFactories.createTerrainWorker,
					}),
			WorkerTexturePreparer.build(texturePixelSource),
		]);
		const runtime = new GamePresentationRuntime(
			device.resources,
			commitPipeline,
			{
				animationSource,
				audioDevice,
				particleEmitterSource,
				physicsScriptSource,
				particleMeshSource,
				setupVisualSource,
				roll,
				soundTableSource,
				tickProfiler,
				staticGeometryPreparer:
					typeof Worker === "undefined"
						? new InlineStaticObjectGeometryPreparer()
						: new RuntimeStaticObjectGeometryPreparer(
								StaticObjectGeometryWorker.build(),
							),
				terrainGenerator,
				texturePreparer,
			},
		);
		runtime.#renderer = await device.buildRenderer(runtime.#renderWorld);
		return runtime;
	}

	/** Construct runtime from explicit ports for focused integration tests. */
	static buildForTesting(
		renderResources: RendererResourceManager,
		commitPipeline: CommitPipeline,
		dependencies: GamePresentationRuntimeDependencies,
	): GamePresentationRuntime {
		return new GamePresentationRuntime(
			renderResources,
			commitPipeline,
			dependencies,
		);
	}

	/** Replace the complete accepted producer snapshot and converge its eligible presentations. */
	async replaceDynamicEntitySnapshot(
		entities: readonly DynamicEntityView[],
	): Promise<DynamicEntityRealizationResults> {
		if (this.#destroyed)
			throw new Error(
				"Cannot replace the dynamic entity snapshot after runtime shutdown.",
			);
		if (this.#setupVisualSource === null && entities.length > 0) {
			throw new Error("This runtime has no setup visual source capability.");
		}
		const requested = new Map<number, DynamicEntityView>();
		for (const entity of entities) {
			const guid = entity.identity.guid;
			if (requested.has(guid))
				throw new Error(
					`Dynamic entity snapshot repeats GUID ${formatDynamicGuid(guid)}.`,
				);
			requested.set(guid, entity);
		}
		const stale = new Set(
			[...this.#spawnedDesiredEntities.keys()].filter(
				(guid) => !requested.has(guid),
			),
		);
		for (const guid of stale) {
			const desired = this.#spawnedDesiredEntities.get(guid);
			if (desired !== undefined)
				this.removeDynamicEntity(guid, desired.entity.generation);
		}
		for (const entity of requested.values())
			this.#acceptDesiredDynamicEntity(entity);
		return this.reevaluateDynamicEntityEligibility();
	}

	/** Apply one mirror-accepted entity level without revisiting unrelated desired entities. */
	async upsertDynamicEntity(
		entity: DynamicEntityView,
	): Promise<DynamicEntityRealizationDisposition> {
		if (this.#destroyed)
			throw new Error("Cannot upsert a dynamic entity after runtime shutdown.");
		if (this.#setupVisualSource === null)
			throw new Error("This runtime has no setup visual source capability.");
		const record = this.#acceptDesiredDynamicEntity(entity);
		await this.#realizeAcceptedDynamicEntity(record);
		const guid = entity.identity.guid;
		return this.#spawnedPresentations.get(guid)?.generation ===
			entity.generation
			? "installed"
			: "deferred";
	}

	/** Retire one exact accepted generation while preserving newer desired authority. */
	removeDynamicEntity(guid: number, generation: number): void {
		if (this.#destroyed)
			throw new Error("Cannot remove a dynamic entity after runtime shutdown.");
		const desired = this.#spawnedDesiredEntities.get(guid);
		if (desired?.entity.generation !== generation) return;
		this.#retireDynamicPresentationTree(guid);
		this.#forgetDesiredDynamicEntity(guid, "release-visual");
		for (const childGuid of this.#spawnedDesiredChildren.get(guid) ?? []) {
			const child = this.#spawnedDesiredEntities.get(childGuid);
			if (child !== undefined)
				this.#deferDynamicEntity(child, {
					kind: "parent",
					parentGuid: guid,
				});
		}
	}

	/** Revisit desired authority only at an explicit scene-readiness boundary. */
	async reevaluateDynamicEntityEligibility(): Promise<DynamicEntityRealizationResults> {
		if (this.#destroyed)
			throw new Error(
				"Cannot reevaluate dynamic entity eligibility after runtime shutdown.",
			);
		const records = [...this.#spawnedDesiredEntities.values()];
		const worldRoots = records.filter(
			(record) => record.entity.placement.kind === "world",
		);
		const outcomes = await Promise.allSettled(
			worldRoots.map((record) => this.#realizeAcceptedDynamicEntity(record)),
		);
		for (const record of records) {
			if (
				record.entity.placement.kind === "attached" &&
				this.#spawnedPresentations.get(record.entity.identity.guid)
					?.generation !== record.entity.generation
			) {
				await this.#realizeAcceptedDynamicEntity(record);
			}
		}
		const failures = outcomes.flatMap((outcome) =>
			outcome.status === "rejected" ? [outcome.reason] : [],
		);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(
				failures,
				`${failures.length} dynamic entities failed presentation realization.`,
			);
		}
		return new Map(
			records.map((record) => {
				const entity = record.entity;
				const installed = this.#spawnedPresentations.get(entity.identity.guid);
				return [
					entity.identity.guid,
					installed?.generation === entity.generation
						? "installed"
						: "deferred",
				] as const;
			}),
		);
	}

	/** Realize one accepted level when its current residency or parent is available. */
	async #realizeAcceptedDynamicEntity(
		record: DesiredDynamicEntityRecord,
	): Promise<void> {
		if (
			this.#spawnedDesiredEntities.get(record.entity.identity.guid) !== record
		)
			return;
		const entity = record.entity;
		if (
			entity.placement.kind === "world" &&
			!this.#isDynamicScopeReady(entity)
		) {
			this.#deferDynamicEntity(record, {
				kind: "residency",
				residencyKey: dynamicResidencyKey(entity),
			});
			this.#retireDynamicPresentationTree(entity.identity.guid);
			return;
		}
		if (entity.placement.kind === "attached") {
			const parent = this.#spawnedPresentations.get(entity.placement.parent);
			const desiredParent = this.#spawnedDesiredEntities.get(
				entity.placement.parent,
			);
			if (
				parent === undefined ||
				parent.generation !== desiredParent?.entity.generation
			) {
				this.#deferDynamicEntity(record, {
					kind: "parent",
					parentGuid: entity.placement.parent,
				});
				this.#retireDynamicPresentationTree(entity.identity.guid);
				return;
			}
		}
		this.#clearDynamicEntityDeferral(record);
		if (record.realization !== null) {
			await record.realization;
			return;
		}
		const guid = entity.identity.guid;
		const visual = this.#retainSpawnedVisual(
			guid,
			record.visualKey,
			entity,
		).catch((cause) => {
			throw dynamicEntityPresentationFailure(entity, cause);
		});
		const continuation = this.#realizeDynamicEntity(record, visual).finally(
			() => {
				if (record.realization === continuation) record.realization = null;
			},
		);
		record.realization = continuation;
		this.#trackRealizationContinuation(continuation);
		await continuation;
		await this.#realizeDesiredDynamicChildren(guid);
	}

	/** Realize only descendants whose desired attachment names this installed parent. */
	async #realizeDesiredDynamicChildren(parentGuid: number): Promise<void> {
		for (const childGuid of this.#spawnedDesiredChildren.get(parentGuid) ??
			[]) {
			const child = this.#spawnedDesiredEntities.get(childGuid);
			if (child === undefined) continue;
			await this.#realizeAcceptedDynamicEntity(child);
		}
	}

	/** Accept one entity level and update its attachment dependency index atomically. */
	#acceptDesiredDynamicEntity(
		entity: DynamicEntityView,
	): DesiredDynamicEntityRecord {
		const guid = entity.identity.guid;
		const previous = this.#spawnedDesiredEntities.get(guid);
		const visualKey = dynamicVisualKey(entity);
		const placementIdentity = dynamicPlacementIdentity(entity);
		if (
			previous !== undefined &&
			previous.entity.generation > entity.generation
		) {
			throw new Error(
				`Dynamic entity ${formatDynamicGuid(guid)} regressed from generation ${previous.entity.generation} to ${entity.generation}.`,
			);
		}
		if (
			previous?.entity.generation === entity.generation &&
			previous.visualKey !== visualKey
		) {
			throw new Error(
				`Dynamic entity ${formatDynamicGuid(guid)} changed immutable visual facts without changing generation.`,
			);
		}
		const sameGeneration = previous?.entity.generation === entity.generation;
		const attachmentTopologyChanged =
			previous !== undefined &&
			previous.placementIdentity !== placementIdentity &&
			(previous.entity.placement.kind === "attached" ||
				entity.placement.kind === "attached");
		if (
			previous !== undefined &&
			sameGeneration &&
			!attachmentTopologyChanged
		) {
			this.#clearDynamicEntityDeferral(previous);
			previous.entity = entity;
			previous.placementIdentity = placementIdentity;
			return previous;
		}
		if (previous !== undefined) {
			this.#retireDynamicPresentationTree(guid);
			this.#forgetDesiredDynamicEntity(
				guid,
				previous.visualKey === visualKey ? "retain-visual" : "release-visual",
			);
		}
		const record: DesiredDynamicEntityRecord = {
			deferral: null,
			entity,
			placementIdentity,
			realization: null,
			visualKey,
		};
		this.#spawnedDesiredEntities.set(guid, record);
		if (entity.placement.kind === "attached") {
			let children = this.#spawnedDesiredChildren.get(entity.placement.parent);
			if (children === undefined) {
				children = new Set();
				this.#spawnedDesiredChildren.set(entity.placement.parent, children);
			}
			children.add(guid);
		}
		return record;
	}

	/** Remove one desired level and each index entry it owns. */
	#forgetDesiredDynamicEntity(
		guid: number,
		visualDisposition: "release-visual" | "retain-visual",
	): void {
		const record = this.#spawnedDesiredEntities.get(guid);
		if (record === undefined) return;
		this.#clearDynamicEntityDeferral(record);
		if (record.entity.placement.kind === "attached") {
			const parentGuid = record.entity.placement.parent;
			const children = this.#spawnedDesiredChildren.get(parentGuid);
			children?.delete(guid);
			if (children?.size === 0) this.#spawnedDesiredChildren.delete(parentGuid);
		}
		this.#spawnedDesiredEntities.delete(guid);
		if (visualDisposition === "release-visual") {
			const visualKey = this.#spawnedVisualKeys.get(guid);
			if (visualKey !== undefined) this.#releaseSpawnedVisual(guid, visualKey);
		}
	}

	/** Replace one desired record's missing prerequisite and its reverse index entry. */
	#deferDynamicEntity(
		record: DesiredDynamicEntityRecord,
		deferral: DynamicEntityDeferral,
	): void {
		this.#clearDynamicEntityDeferral(record);
		record.deferral = deferral;
		let guids: Set<number> | undefined;
		if (deferral.kind === "parent") {
			guids = this.#spawnedDeferredParents.get(deferral.parentGuid);
			if (guids === undefined) {
				guids = new Set();
				this.#spawnedDeferredParents.set(deferral.parentGuid, guids);
			}
		} else {
			guids = this.#spawnedDeferredResidencies.get(deferral.residencyKey);
			if (guids === undefined) {
				guids = new Set();
				this.#spawnedDeferredResidencies.set(deferral.residencyKey, guids);
			}
		}
		guids.add(record.entity.identity.guid);
	}

	/** Clear one desired record's reverse dependency entry. */
	#clearDynamicEntityDeferral(record: DesiredDynamicEntityRecord): void {
		const deferral = record.deferral;
		if (deferral === null) return;
		if (deferral.kind === "parent") {
			const guids = this.#spawnedDeferredParents.get(deferral.parentGuid);
			guids?.delete(record.entity.identity.guid);
			if (guids?.size === 0)
				this.#spawnedDeferredParents.delete(deferral.parentGuid);
		} else {
			const guids = this.#spawnedDeferredResidencies.get(deferral.residencyKey);
			guids?.delete(record.entity.identity.guid);
			if (guids?.size === 0)
				this.#spawnedDeferredResidencies.delete(deferral.residencyKey);
		}
		record.deferral = null;
	}

	/**
	 * Replace the current scene with one generation-scoped destination installation.
	 *
	 * This deliberately layers over the existing interest coordinator: static preparation, worker
	 * ownership, eviction, and dynamic realization remain the same machinery used by continuous
	 * streaming. The receipt returned here is a different contract from `SceneInterestReceipt` —
	 * it names the exact products that must become resident before a transition may reveal them.
	 */
	async activateScene(
		request: SceneActivationRequest,
	): Promise<SceneActivationReceipt> {
		if (!Number.isInteger(request.generation) || request.generation < 0) {
			throw new Error(
				"Scene activation generation must be a non-negative integer.",
			);
		}
		if (this.#destroyed)
			throw new Error("Cannot activate a scene after runtime shutdown.");
		const interest = this.updateSceneInterest(request.target);
		const receipt: SceneActivationReceipt = {
			generation: request.generation,
			revision: interest.revision,
			requiredLayers: cloneSceneInterest(this.#sceneInterest),
		};
		this.#sceneActivation = receipt;
		return receipt;
	}

	/** Poll exact installation products without exposing scene-private maps or resource leases. */
	sceneActivationStatus(
		receipt: SceneActivationReceipt,
	): SceneActivationStatus {
		if (this.#sceneActivation !== receipt) {
			return {
				kind: "failed",
				receipt,
				diagnostic: "Scene activation was superseded by a newer destination.",
			};
		}
		for (const [landblockId, layers] of receipt.requiredLayers) {
			for (const layer of layers) {
				const failure = this.#sceneLayerFailures.get(
					sceneLayerKey(landblockId, layer),
				);
				if (failure?.revision === receipt.revision) {
					return {
						kind: "failed",
						receipt,
						diagnostic: failure.diagnostic,
					};
				}
				if (!this.#isSceneLayerInstalled(landblockId, layer)) {
					return { kind: "pending", receipt };
				}
			}
		}
		return { kind: "ready", receipt };
	}

	/** Release the replacement barrier after the mode-specific handoff has completed. */
	completeSceneActivation(generation: number): void {
		if (this.#sceneActivation?.generation !== generation) return;
		this.#sceneActivation = null;
	}

	/** A world root can install once its authoritative resident scope is available. */
	#isDynamicScopeReady(entity: DynamicEntityView): boolean {
		if (entity.placement.kind !== "world") return false;
		// Plural membership may include physically reached scopes that are not part of current scene
		// interest. The scene graph indexes those facts without requiring their topology; only the
		// pose's resident scope must exist so placement and camera resolution have an authority.
		const placement = dynamicEntityPlacement(entity);
		const demandedLayers = this.#sceneInterest.get(placement.landblockId);
		if (placement.envCellId === null) {
			if (!demandedLayers?.has(LandblockLayerKind.Terrain)) return false;
			return this.#terrain.hasInstalledSource(placement.landblockId);
		}
		if (!demandedLayers?.has(LandblockLayerKind.EnvCells)) return false;
		return this.#scene.hasEnvCellScope({
			envCellId: placement.envCellId,
			landblockId: placement.landblockId,
		});
	}

	/** Check one exact static layer's published product, never a source or request revision. */
	#isSceneLayerInstalled(
		landblockId: LandblockOwnerId,
		layer: LandblockLayerKind,
	): boolean {
		if (layer === LandblockLayerKind.Terrain)
			return this.#terrain.hasResidentDrawUnit(landblockId);
		if (layer === LandblockLayerKind.EnvCells)
			return this.#envCellLayerDiagnostics.has(
				landblockLayerToOwnerId(landblockId, layer),
			);
		return this.#staticObjectLayerDiagnostics.has(
			landblockLayerToOwnerId(landblockId, layer),
		);
	}

	/** Apply one accepted host tick without re-running asynchronous visual realization. */
	applyDynamicEntityTick(
		batch: DynamicEntityTickBatch,
		receivedAtMs: number,
	): void {
		if (this.#destroyed)
			throw new Error(
				"Cannot apply a dynamic entity tick after runtime shutdown.",
			);
		for (const advance of batch.advances) {
			const entity = advance.entity;
			const guid = entity.identity.guid;
			const desired = this.#spawnedDesiredEntities.get(guid);
			if (desired?.entity.generation !== entity.generation) continue;
			if (desired.visualKey !== dynamicVisualKey(entity)) {
				throw new Error(
					`Dynamic entity ${formatDynamicGuid(guid)} changed immutable visual facts within generation ${entity.generation}.`,
				);
			}
			desired.entity = entity;
			desired.placementIdentity = dynamicPlacementIdentity(entity);
			const installed = this.#spawnedPresentations.get(guid);
			if (installed?.generation !== entity.generation) continue;
			this.#applySpawnedPresentationState(installed, entity);
			this.#dynamics.updatePlacementPath(
				installed.nodeId,
				advance,
				batch.durationMs,
				receivedAtMs,
			);
			installed.placementIdentity = desired.placementIdentity;
		}
		for (const entity of batch.updates) {
			const guid = entity.identity.guid;
			const desired = this.#spawnedDesiredEntities.get(guid);
			if (desired?.entity.generation !== entity.generation) continue;
			if (desired.visualKey !== dynamicVisualKey(entity)) {
				throw new Error(
					`Dynamic entity ${formatDynamicGuid(guid)} changed immutable visual facts within generation ${entity.generation}.`,
				);
			}
			if (dynamicPathIdentity(desired.entity) !== dynamicPathIdentity(entity)) {
				throw new Error(
					`Dynamic entity ${formatDynamicGuid(guid)} received a path-changing tick update without an advance.`,
				);
			}
			desired.entity = entity;
			desired.placementIdentity = dynamicPlacementIdentity(entity);
			const installed = this.#spawnedPresentations.get(guid);
			if (installed?.generation !== entity.generation) continue;
			this.#applySpawnedPresentationState(installed, entity);
			installed.placementIdentity = desired.placementIdentity;
		}
	}

	/**
	 * Swap one entity's rendered clip to the level its latest view states.
	 *
	 * Idempotent, because a view restates the current level on every tick and re-entering a clip
	 * would restart it. That is what lets an entity realized late start playing correctly: the
	 * level is applied at install from whatever view is current, with no transition to have
	 * witnessed. The entity's whole motion closure was staged before it activated, so this resolves
	 * from memory and loads nothing. An unplayable clip was already complained about at preparation
	 * and simply leaves the current pose in place.
	 *
	 * A `null` level names an entity with no playback at all, and there is no stop: the host drops
	 * an entity's playback only along with the entity, so nothing that has played can reach one.
	 *
	 * The level is recorded before the clip resolves, so an unplayable one is refused once rather
	 * than re-attempted on every view that restates it.
	 */
	#applyDynamicEntityClip(
		installed: DynamicEntityPresentationRecord,
		clip: DynamicEntityPlayingClip | null,
	): void {
		if (clip === null || samePlayingClip(installed.playingClip, clip)) return;
		installed.playingClip = clip;
		const animation = this.#dynamics.getMotionClip(
			installed.nodeId,
			datAssetId(clip.animationId),
		);
		if (animation === null) return;
		this.#animation.playClip(
			installed.ownerId,
			{
				generation: installed.behaviorGeneration,
				targetId: behaviorTargetId(installed.nodeId),
			},
			playingClip(
				animation,
				clip.lowFrame,
				clip.highFrame,
				clip.framerate,
				clip.completion,
			),
		);
	}

	async #realizeDynamicEntity(
		record: DesiredDynamicEntityRecord,
		visual: Promise<DecodedStaticPresentation>,
	): Promise<void> {
		let entity = record.entity;
		const guid = entity.identity.guid;
		const installedCurrent = this.#spawnedPresentations.get(guid);
		if (installedCurrent?.generation === entity.generation) {
			if (installedCurrent.visualKey !== record.visualKey) {
				throw new Error(
					`Dynamic entity ${formatDynamicGuid(guid)} changed immutable visual facts without changing generation.`,
				);
			}
			this.#applyDynamicEntityState(installedCurrent, record);
			return;
		}
		const resolved = await visual;
		if (this.#spawnedDesiredEntities.get(guid) !== record) return;
		entity = record.entity;
		const stagingPlacement = this.#spawnedStagingPlacement(entity);
		if (stagingPlacement === null) return;
		const ownerId = dynamicEntityOwnerId(guid);
		const activation = await this.#prepareDynamicOwner(ownerId, [
			adaptDynamicEntityPresentation(entity, resolved, stagingPlacement),
		]);
		if (this.#spawnedDesiredEntities.get(guid) !== record) {
			activation.release();
			return;
		}
		const [nodeId] = activation.nodeIds;
		if (nodeId === undefined || activation.nodeIds.length !== 1) {
			activation.release();
			throw new Error(
				`Dynamic entity ${formatDynamicGuid(guid)} prepared ${activation.nodeIds.length} scene roots.`,
			);
		}
		activation.commit();
		const installed: DynamicEntityPresentationRecord = {
			behaviorGeneration: activation.generation,
			generation: entity.generation,
			nodeId,
			ownerId,
			placementIdentity: record.placementIdentity,
			playingClip: null,
			presentationStateIdentity: "",
			visualKey: record.visualKey,
		};
		this.#spawnedPresentations.set(guid, installed);
		if (entity.placement.kind === "attached") {
			const parent = this.#spawnedPresentations.get(entity.placement.parent);
			if (!parent) {
				throw new Error(
					`Attached dynamic entity ${formatDynamicGuid(guid)} lost parent ${formatDynamicGuid(entity.placement.parent)} during synchronous activation.`,
				);
			}
			try {
				this.#dynamics.attachEntity(
					nodeId,
					parent.nodeId,
					entity.placement.parentLocation,
					dynamicEntityPlacementKey(entity.placement.placement),
				);
			} catch (cause) {
				this.#retireDynamicOwner(ownerId);
				this.#spawnedPresentations.delete(guid);
				throw cause;
			}
		}
		const latestDesired = this.#spawnedDesiredEntities.get(guid);
		if (latestDesired !== record) {
			throw new Error(
				`Dynamic entity ${formatDynamicGuid(guid)} changed generation during synchronous activation commit.`,
			);
		}
		this.#applyDynamicEntityState(installed, latestDesired);
	}

	/** Apply everything one view says about an installed presentation, placement included. */
	#applyDynamicEntityState(
		installed: DynamicEntityPresentationRecord,
		record: DesiredDynamicEntityRecord,
	): void {
		const entity = record.entity;
		if (
			entity.placement.kind === "world" &&
			installed.placementIdentity !== record.placementIdentity
		) {
			this.#dynamics.updatePlacement(
				installed.nodeId,
				dynamicEntityPlacement(entity),
			);
			installed.placementIdentity = record.placementIdentity;
		}
		this.#applySpawnedPresentationState(installed, entity);
	}

	/** Resolve the temporary world placement needed only while an attached visual is staged. */
	#spawnedStagingPlacement(
		entity: DynamicEntityView,
	): SceneSpatialPlacement | null {
		if (entity.placement.kind === "world")
			return dynamicEntityPlacement(entity);
		const parent = this.#spawnedPresentations.get(entity.placement.parent);
		if (!parent) return null;
		return this.#dynamics.resolvedRootPlacement(parent.nodeId);
	}

	/**
	 * Apply what one view says a presentation should look like and be playing.
	 *
	 * Both are levels the view restates every time it arrives, and every path that applies a view
	 * to an installed presentation goes through here. Keeping them together is what stops a path
	 * from carrying visibility forward while leaving playback on whatever it happened to catch.
	 */
	#applySpawnedPresentationState(
		installed: DynamicEntityPresentationRecord,
		entity: DynamicEntityView,
	): void {
		const identity = dynamicPresentationStateIdentity(entity);
		if (installed.presentationStateIdentity !== identity) {
			this.#dynamics.updatePresentationState(installed.nodeId, {
				cloaked: entity.physics.cloaked,
				hidden: entity.physics.hidden,
				lighting: entity.physics.lighting,
				noDraw: entity.physics.noDraw,
			});
			installed.presentationStateIdentity = identity;
		}
		this.#applyDynamicEntityClip(installed, entity.playingClip);
	}

	#retainSpawnedVisual(
		guid: number,
		visualKey: string,
		entity: DynamicEntityView,
	): Promise<DecodedStaticPresentation> {
		const previousKey = this.#spawnedVisualKeys.get(guid);
		if (previousKey !== undefined && previousKey !== visualKey) {
			this.#releaseSpawnedVisual(guid, previousKey);
		}
		this.#spawnedVisualKeys.set(guid, visualKey);
		let cached = this.#spawnedVisuals.get(visualKey);
		if (cached === undefined) {
			const source = this.#setupVisualSource;
			if (source === null)
				throw new Error(
					"This runtime has no SetupModel visual source capability.",
				);
			const completion = source.load(
				entity.presentation.content.setupDid,
				entity.presentation.appearance,
			);
			cached = { completion, users: new Set() };
			this.#spawnedVisuals.set(visualKey, cached);
			void completion.catch(() => {
				if (this.#spawnedVisuals.get(visualKey) === cached)
					this.#spawnedVisuals.delete(visualKey);
			});
		}
		cached.users.add(guid);
		return cached.completion;
	}

	#releaseSpawnedVisual(guid: number, visualKey: string): void {
		const cached = this.#spawnedVisuals.get(visualKey);
		cached?.users.delete(guid);
		if (cached?.users.size === 0) this.#spawnedVisuals.delete(visualKey);
		if (this.#spawnedVisualKeys.get(guid) === visualKey)
			this.#spawnedVisualKeys.delete(guid);
	}

	/** Retire an unrealizable scene node without confusing deferred authority with deletion. */
	#retireDeferredDynamicEntity(guid: number): void {
		const installed = this.#spawnedPresentations.get(guid);
		if (installed === undefined) return;
		this.#retireDynamicOwner(installed.ownerId);
		this.#spawnedPresentations.delete(guid);
	}

	/** Retire one installed presentation subtree while preserving every desired child level. */
	#retireDynamicPresentationTree(guid: number): void {
		for (const childGuid of this.#spawnedDesiredChildren.get(guid) ?? [])
			this.#retireDynamicPresentationTree(childGuid);
		this.#retireDeferredDynamicEntity(guid);
	}

	/** Replace profile-resolved static content demand without moving the camera. */
	updateSceneInterest(request: SceneInterestRequest): SceneInterestReceipt {
		validateSceneInterestRadiiOrThrow(request.radii);
		this.#resolvedSceneInterestTarget = request.target;
		if (request.target.kind === "outdoor") {
			const landblockId = request.target.requested.landblockId;
			this.#sceneInterest = computeOutdoorSceneInterest(
				landblockId,
				request.radii,
				request.ambientOutdoorEnvCellOwners,
			);
			this.#terrainFogCoverage = {
				terrainRadius: request.radii.terrainRadius,
			};
		} else {
			this.#sceneInterest = computeDungeonSceneInterest(
				request.target.requested.landblockId,
			);
			this.#terrainFogCoverage = null;
		}
		this.#withdrawOutOfScopeDynamicEntities();
		return this.#applySceneInterest(this.#sceneInterest);
	}

	/** Evict every requested static layer without moving the camera. */
	clearSceneInterest(): SceneInterestReceipt {
		this.#terrainFogCoverage = null;
		this.#sceneInterest = new Map();
		this.#resolvedSceneInterestTarget = null;
		this.#sceneActivation = null;
		this.#withdrawOutOfScopeDynamicEntities();
		return this.#applySceneInterest(this.#sceneInterest);
	}

	/** Retire only desired world roots made ineligible by an explicit interest replacement. */
	#withdrawOutOfScopeDynamicEntities(): void {
		for (const record of this.#spawnedDesiredEntities.values()) {
			const entity = record.entity;
			if (
				entity.placement.kind !== "world" ||
				this.#isDynamicScopeReady(entity)
			)
				continue;
			this.#deferDynamicEntity(record, {
				kind: "residency",
				residencyKey: dynamicResidencyKey(entity),
			});
			this.#retireDynamicPresentationTree(entity.identity.guid);
		}
	}

	/** Snapshot the current replacement demand and resolved target for diagnostics and harnesses. */
	sceneInterestState(): {
		readonly interest: SceneInterestMap;
		readonly resolvedTarget: ResolvedSceneInterestTarget | null;
	} {
		return {
			interest: cloneSceneInterest(this.#sceneInterest),
			resolvedTarget: this.#resolvedSceneInterestTarget,
		};
	}

	/** Snapshot current outdoor fog coverage without exposing mutable runtime state. */
	terrainFogCoverage(): TerrainFogCoverage | null {
		return this.#terrainFogCoverage === null
			? null
			: { ...this.#terrainFogCoverage };
	}

	/** Subscribe to source/topology availability without exposing runtime-owned resources. */
	subscribeSceneAvailability(listener: SceneAvailabilityListener): () => void {
		this.#sceneAvailabilityListeners.add(listener);
		return () => this.#sceneAvailabilityListeners.delete(listener);
	}

	/**
	 * Place the audio listener, in canonical scene space.
	 *
	 * Passing `null` withdraws listener ownership and fades existing voices while a mode is in
	 * portal-space staging. Otherwise this is deliberately a frontend input rather than something
	 * derived from the primary camera. Where
	 * the ears are is a client decision: a game client puts them on the player, while the explorer
	 * flies a free camera and may want them somewhere else entirely. The runtime owns the frame
	 * conversion and the retail spatial maths, not the choice.
	 */
	setAudioListener(placement: AudioListenerPlacement | null): void {
		if (placement === null) {
			this.#audioListenerEnabled = false;
			this.#audioListenerPosition = sceneVector3([0, 0, 0]);
			this.#audioListenerEnvCellId = null;
			this.#audio.silence();
			return;
		}
		const { envCellId, position, rotation } = placement;
		if (
			!position.every(Number.isFinite) ||
			![rotation.w, rotation.x, rotation.y, rotation.z].every(Number.isFinite)
		) {
			throw new Error("Audio listener placement must be finite.");
		}
		this.#audioListenerPosition = position;
		this.#audioListenerEnvCellId = envCellId;
		const { w, x, y, z } = rotation;
		this.#audio.setListener({
			position,
			// First column of the rotation, which is its local +X: the listener's right hand.
			right: renderVector3([
				1 - 2 * (y * y + z * z),
				2 * (x * y + w * z),
				2 * (x * z - w * y),
			]),
		});
		this.#audioListenerEnabled = true;
	}

	/**
	 * Install the active region's ambient facts and stage every sound table they can reach.
	 *
	 * Ambience is selected by the ground rather than by a hook, so nothing else will pull these
	 * tables in; without staging them here every scheduled sound resolves to nothing.
	 */
	async installAmbientRegion(facts: AmbientRegionFacts): Promise<void> {
		this.#ambientRegion = createAmbientRegionResolution(facts);
		// Baked entries and scheduled slots carry the previous region's slot ids, so both go with
		// the region; a bed still playing fades out through its supplier reading zero.
		this.#ambientBakes.clear();
		this.#ambient.resetForRegion(this.#ambientRegion.descriptorsBySlot.length);
		this.#ambientScanCellX = null;
		this.#ambientScanCellZ = null;
		this.#ambientScanEnvCellId = null;
		for (const handle of this.#ambientSoundTableHandles.values()) {
			handle.release();
		}
		this.#ambientSoundTableHandles.clear();
		this.#ambientSoundTables.clear();

		const staged = await Promise.all(
			ambientSoundTableIds(facts).map(async (soundTableId) => {
				const handle = await this.#soundTables.acquire(soundTableId);
				return [soundTableId, handle] as const;
			}),
		);
		for (const [soundTableId, handle] of staged) {
			this.#ambientSoundTableHandles.set(soundTableId, handle);
			this.#ambientSoundTables.set(soundTableId, handle.asset);
		}
	}

	/** Resolve one ambient descriptor's `SoundType` against its staged table. */
	#resolveAmbientSound(soundTableId: DatAssetId, soundType: number) {
		const table = this.#ambientSoundTables.get(soundTableId);
		const candidates = table?.entries.get(soundType);
		if (!candidates) return null;
		const candidate = selectSoundCandidate(candidates, Math.random());
		if (!candidate) return null;
		// The candidate's authored volume is deliberately dropped: retail's ambient path plays at
		// the descriptor's volume and reads only the candidate's probability.
		return { probability: candidate.probability, soundId: candidate.soundId };
	}

	/**
	 * Re-scan the surrounding terrain when the listener changes cell.
	 *
	 * Retail rebuilds on cell transition (`Ambient::InitSounds` takes a `Position`), and the scan
	 * walks every cell of every installed landblock, so running it per frame would be pure waste:
	 * ambience cannot change while the listener stays put.
	 *
	 * When the listener is inside an EnvCell whose authored flags do not include `SeenOutside`
	 * (EnvCell flag 0x01), outdoor surface terrain ambience is silenced (acclient.c:140501-140526).
	 */
	#refreshAmbient(timeSeconds: number): boolean {
		const region = this.#ambientRegion;
		if (!region) return false;
		const position = this.#audioListenerPosition;
		// Terrain first: landblocks stream in after the first refresh, and a listener standing
		// still while its surroundings arrive would otherwise never hear them.
		const rebaked = this.#ambientBakes.reconcile(
			this.#terrain.installationRevision,
			this.#listAmbientTerrain,
			region.resolve,
		);
		// The scan-cell size is the authored terrain cell size, read from the terrain in hand
		// rather than restated as a constant. Before any terrain installs there is nothing to scan
		// and the revision diff, not the cell trigger, fires the first real refresh.
		const cellSize = this.#ambientBakes.cellSize;
		const cellX = cellSize === null ? 0 : Math.floor(position[0] / cellSize);
		const cellZ = cellSize === null ? 0 : Math.floor(position[2] / cellSize);
		if (
			!rebaked &&
			cellX === this.#ambientScanCellX &&
			cellZ === this.#ambientScanCellZ &&
			this.#audioListenerEnvCellId === this.#ambientScanEnvCellId
		) {
			return false;
		}
		this.#ambientScanCellX = cellX;
		this.#ambientScanCellZ = cellZ;
		this.#ambientScanEnvCellId = this.#audioListenerEnvCellId;

		// Skipping the walk indoors is an optimization only; the ambient system enforces the same
		// gate through its `listenerHearsOutdoors` dependency, so the two cadences cannot diverge.
		const scanResult = !this.#ambientListenerSeenOutside()
			? EMPTY_AMBIENT_SCAN_RESULT
			: scanAmbientSources(
					position,
					this.#ambientBakes.blocks(),
					region.descriptorsBySlot,
				);

		this.#ambient.refresh(scanResult, timeSeconds);
		return true;
	}

	/**
	 * Whether outdoor terrain ambience reaches the listener where it stands.
	 *
	 * Inside an EnvCell whose authored flags lack `SeenOutside` (flag 0x01), surface ambience is
	 * silenced (acclient.c:140501-140526). The ambient system consumes this through one dependency
	 * for both of its cadences; the runtime additionally reads it to skip building scans indoors.
	 */
	#ambientListenerSeenOutside(): boolean {
		return this.#audioListenerEnvCellId !== null
			? this.#scene.getEnvCellSeenOutside(this.#audioListenerEnvCellId) !==
					false
			: true;
	}

	/** Installed terrain with identity, expressed in the scene frame the bake retains. */
	*#ambientTerrainBlocks(): Generator<InstalledAmbientTerrain> {
		for (const {
			generation,
			landblockId,
		} of this.#terrain.listInstalledTerrain()) {
			const origin = createLandblockWorldOrigin(landblockId);
			yield {
				block: {
					gridSize: generation.gridSize,
					heights: generation.heights,
					origin: sceneVector3([origin.x, origin.y, origin.z]),
					terrainSamples: generation.terrainSamples,
					tileSize: generation.tileSize,
				},
				landblockId,
			};
		}
	}

	/**
	 * Apply user audio settings, one volume per retail sound category.
	 *
	 * A volume of zero is the same observable behaviour as retail's per-category enable flag being
	 * off, so no separate flag exists.
	 */
	setAudioSettings(settings: AudioSettings): void {
		this.#audio.setSettings(settings);
	}

	/** Resolve a candidate viewport before camera policy decides whether it may become active. */
	resolveViewportExtent(cssWidth: number, cssHeight: number): RenderExtent {
		return resolveRenderExtent(
			cssWidth,
			cssHeight,
			this.#frameSettings.quality.renderScale,
		);
	}

	/** Replace the authoritative primary camera and its exact drawing extent atomically. */
	setPrimaryView(view: PrimaryCameraView): void {
		const { camera, extent } = view;
		const { position, rotation } = camera.placement;
		if (
			![position.x, position.y, position.z].every(Number.isFinite) ||
			![rotation.w, rotation.x, rotation.y, rotation.z].every(Number.isFinite)
		) {
			throw new Error("Primary camera placement must be finite.");
		}
		validateRenderExtent(extent, "Primary camera view");
		this.#camera = {
			far: camera.far,
			fov: camera.fov,
			near: camera.near,
			placement: {
				envCellId: camera.placement.envCellId,
				landblockId: camera.placement.landblockId,
				position: sceneVec3(new Vec3(position.x, position.y, position.z)),
				rotation: new Quat(rotation.w, rotation.x, rotation.y, rotation.z),
			},
		};
		this.#primaryViewExtent = { ...extent };
	}

	/** Replace the frontend-resolved environment without changing scene residency or interest. */
	setSceneEnvironment(environment: ResolvedSceneEnvironment): void {
		this.#environment = environment;
	}

	/**
	 * Make the active region's celestial sky resident.
	 *
	 * Region-scoped like terrain and landblock layers, so the runtime owns it: it already holds the
	 * texture-preparation port and the renderer the sky needs. A backend without a sky capability
	 * simply resolves without one rather than failing the region load.
	 */
	async installSky(source: SkySourcePresentations): Promise<void> {
		await this.#renderer?.sky?.install(source, this.#texturePreparer);
	}

	/** Replace frontend-selected dynamic display choices without altering world data. */
	setFrameSettings(settings: FrameSettings): void {
		this.#frameSettings = settings;
	}

	/** Update the app-local portal compositor state without touching authority or scene demand. */
	setPortalTransition(transition: PortalTransitionFrame | undefined): void {
		if (transition === undefined) {
			this.#portalTransition = undefined;
			this.#portalTransitionAnimationGeneration = null;
			this.#portalTransitionFramePosition = 0;
			this.#portalTransitionLastTimeSeconds = null;
			return;
		}
		if (
			!Number.isSafeInteger(transition.generation) ||
			transition.generation < 0
		) {
			throw new Error(
				"Portal transition generation must be a non-negative safe integer.",
			);
		}
		if (
			!Number.isFinite(transition.progress) ||
			transition.progress < 0 ||
			transition.progress > 1
		) {
			throw new Error("Portal transition progress must be within [0, 1].");
		}
		this.#portalTransition = transition;
	}

	/** Play one of the validated head-locked sounds authored for the portal transition. */
	playPortalTransitionSound(kind: "enter" | "exit"): void {
		const assets = this.#portalTransitionAssets;
		if (assets === null)
			throw new Error("Portal transition audio is not installed.");
		const soundId =
			kind === "enter"
				? assets.catalog.enterSoundId
				: assets.catalog.exitSoundId;
		this.#audio.triggerListenerLocked(soundId);
	}

	/** Advance the direct portal animation cursor and dispatch only its authored sound hooks. */
	#advancePortalTransition(
		timeSeconds: number,
	): PortalTransitionFrame | undefined {
		const transition = this.#portalTransition;
		const clip = this.#portalTransitionClip;
		if (
			transition === undefined ||
			transition.phase === "revealed-awaiting-handoff" ||
			clip === null
		) {
			this.#portalTransitionAnimationGeneration = null;
			this.#portalTransitionFramePosition = 0;
			this.#portalTransitionLastTimeSeconds = null;
			return transition;
		}
		if (this.#portalTransitionAnimationGeneration !== transition.generation) {
			this.#portalTransitionAnimationGeneration = transition.generation;
			this.#portalTransitionFramePosition = clipEntryFrame(clip);
			this.#portalTransitionLastTimeSeconds = timeSeconds;
		} else {
			const previous = this.#portalTransitionLastTimeSeconds ?? timeSeconds;
			const elapsedSeconds = Math.max(0, timeSeconds - previous);
			const advanced = advancePlayingFrame(
				clip,
				this.#portalTransitionFramePosition,
				elapsedSeconds,
			);
			this.#portalTransitionFramePosition = advanced.framePosition;
			this.#portalTransitionLastTimeSeconds = timeSeconds;
			this.#dispatchPortalAnimationHooks(advanced.departedFrames);
		}
		return {
			...transition,
			// This is deliberately fractional: the renderer samples it at the display cadence rather
			// than rounding to the 40 authored frames-per-second ticks.
			animationFramePosition: this.#portalTransitionFramePosition,
		};
	}

	#dispatchPortalAnimationHooks(departedFrames: readonly number[]): void {
		const animation = this.#portalTransitionClip?.animation;
		if (!animation) return;
		for (const frameIndex of departedFrames) {
			for (const hook of animation.hooks) {
				if (
					hook.frameIndex !== frameIndex ||
					(hook.direction !== "both" && hook.direction !== "forward") ||
					hook.kind !== "sound-tweaked"
				) {
					continue;
				}
				this.#audio.triggerListenerLocked(
					hook.soundId,
					hook.volume,
					hook.probability,
				);
			}
		}
	}

	/**
	 * Install the validated setup, animation, and audio closure into shared runtime residency.
	 *
	 * The portal is not a dynamic scene entity: it owns one stable template lease and one direct
	 * animation cursor. Sharing the template repository still gives it the exact geometry/atlas
	 * lifetime and rollback guarantees used by ordinary dynamics without inventing a fake behavior
	 * target or scene placement.
	 */
	async installPortalTransitionAssets(
		assets: PortalTransitionAssets,
	): Promise<void> {
		if (this.#destroyed)
			throw new Error(
				"Cannot install portal transition assets after runtime shutdown.",
			);
		if (this.#portalTransitionAssets !== null)
			throw new Error("Portal transition assets are already installed.");
		const setupId = assets.visual.setupId;
		if (setupId === null)
			throw new Error("Portal transition visual has no setup identity.");
		const animation = prepareAnimation(
			assets.animation,
			assets.catalog.animationId,
			assets.catalog.animationFramesPerSecond,
		);
		const source: DynamicPresentationSource = {
			behavior: assets.visual.behavior,
			identity: "portal-transition",
			localBounds: assets.visual.localBounds,
			presentation: assets.visual.presentation,
			scale: new Vec3(1, 1, 1),
			setupId: setupId as DatAssetId,
		};
		const staged = this.#objectVisualTemplates.stageOwner([source]);
		let template: ObjectVisualTemplate;
		try {
			const templates = await staged.completion;
			const prepared = templates.get(objectVisualTemplateKey(source));
			if (!prepared)
				throw new Error(
					`Portal transition template ${objectVisualTemplateKey(source)} was not prepared.`,
				);
			template = prepared;
			staged.commit(PORTAL_TRANSITION_RESOURCE_OWNER_ID);
		} catch (cause) {
			staged.release();
			throw cause;
		}
		try {
			this.#renderer?.installPortalTransitionVisual?.({
				animation,
				template,
			});
		} catch (cause) {
			this.#objectVisualTemplates.dropOwner(
				PORTAL_TRANSITION_RESOURCE_OWNER_ID,
			);
			throw cause;
		}
		this.#portalTransitionAssets = assets;
		this.#portalTransitionClip = playingClip(
			animation,
			0,
			animation.frameCount - 1,
			assets.catalog.animationFramesPerSecond,
			"loop",
		);
	}

	/**
	 * Nominate the spawned entity carrying the viewer light; null returns it to the camera.
	 *
	 * Only the frontend knows whether the viewer is driving a body at all, which is the same split
	 * retail has: `SmartBox` nominates, and the renderer places what it is given.
	 */
	setViewerLightCarrier(guid: number | null): void {
		this.#viewerLightCarrier = guid;
	}

	/** Set offscreen visual sampling cadence; zero preserves full render cadence. */
	setOffscreenAnimationSampleIntervalSeconds(intervalSeconds: number): void {
		this.#animationPresentation.setOffscreenSampleIntervalSeconds(
			intervalSeconds,
		);
	}

	/** Return one consistent read of the active renderer's optional diagnostics capability. */
	getRendererFrameDiagnostics(): RendererFrameDiagnosticsSnapshot | null {
		return this.#renderer?.frameDiagnostics?.snapshot() ?? null;
	}

	/** Dedicated terrain-worker queue and transfer facts for streaming diagnostics. */
	getTerrainWorkerDiagnostics(): ClosedWorkerPoolDiagnostics {
		return this.#terrainGenerator.getDiagnostics();
	}

	/** Explicitly enable or tear down renderer profiling for diagnostic frontends. */
	setRendererFrameProfilingEnabled(enabled: boolean): void {
		const renderer = this.#renderer;
		if (!renderer) throw new Error("Renderer is unavailable.");
		if (!renderer.frameDiagnostics) {
			throw new Error("Renderer does not support explicit frame profiling.");
		}
		renderer.frameDiagnostics.setProfilingEnabled(enabled);
	}

	/** Delimit a measurement window so the next renderer profile mean covers only it. */
	resetRendererFrameProfile(): void {
		this.#renderer?.frameDiagnostics?.resetProfile();
	}

	/** Size how far the next frame's baked object draws could merge, for partitioning decisions. */
	captureBakedDrawMergeCensus(): Promise<BakedDrawMergeCensus> {
		const diagnostics = this.#renderer?.frameDiagnostics;
		if (!diagnostics) {
			throw new Error("Renderer does not support a baked draw merge census.");
		}
		return diagnostics.captureBakedDrawMergeCensus();
	}

	/** Snapshot active authored dynamics and any hook-blocked static visual fallbacks. */
	getAuthoredDynamicResidentDiagnostics(): readonly AuthoredDynamicResidentDiagnostic[] {
		return [...this.#authoredDynamicResidents.values()].flat();
	}

	/** Snapshot dynamic preparation, playback, effect, and publication facts at their owners. */
	getAuthoredDynamicRuntimeDiagnostics() {
		return {
			animation: this.#animation.getDiagnostics(),
			audio: this.#audio.getDiagnostics(),
			ambient: this.#ambient.getDiagnostics(),
			ambientBakes: this.#ambientBakes.getDiagnostics(),
			dynamics: this.#dynamics.getDiagnostics(),
			behavior: this.#behaviorRouter.getDiagnostics(),
			particles: this.#particles.getDiagnostics(),
			physicsScripts: this.#physicsScriptSystem.getDiagnostics(),
			skyScripts: { activeCount: this.#skyScripts.activeCount },
			effects: this.#effects.getDiagnostics(),
			presentationCadence: this.#animationPresentation.getDiagnostics(),
			residents: this.getAuthoredDynamicResidentDiagnostics(),
		};
	}

	/** Snapshot the required portal closure without exposing mutable renderer or repository state. */
	getPortalTransitionDiagnostics(): PortalTransitionRuntimeDiagnostics {
		const assets = this.#portalTransitionAssets;
		const clip = this.#portalTransitionClip;
		const transition = this.#portalTransition;
		const texture = this.#textures.getDiagnostics();
		return {
			animation:
				assets === null || clip === null
					? null
					: {
							frameCount: clip.animation.frameCount,
							framePosition: this.#portalTransitionFramePosition,
							framesPerSecond: clip.framesPerSecond,
							id: clip.animation.id,
							partCount: clip.animation.partCount,
						},
			installed: assets !== null,
			outstandingHandles: {
				portalTemplateOwner: assets === null ? 0 : 1,
				portalWaveBuffers: assets?.waveIds.length ?? 0,
			},
			persistent: {
				geometryResourceBytes: this.#geometry.getResourceBytes(),
				geometryResourceCount: this.#geometry.getResourceCount(),
				textureAtlasPageBytes: texture.activeAtlasPageBytes,
				textureAtlasPageCount: texture.activeAtlasPages,
				textureSourceBytes: texture.residentSourceBytes,
			},
			sourceBytes: assets?.sourceBytes ?? null,
			templates: this.#objectVisualTemplates.getDiagnostics(),
			transition:
				transition === undefined
					? null
					: {
							generation: transition.generation,
							phase: transition.phase,
							progress: transition.progress,
						},
		};
	}

	/** Snapshot app-local outdoor-static lifecycle, resource, and atlas-arbitration diagnostics. */
	getStaticObjectRuntimeDiagnostics(): StaticObjectRuntimeDiagnostics {
		const staticObjects = this.#staticObjects.getDiagnostics();
		return {
			envCellLayers: [...this.#envCellLayerDiagnostics.values()].sort(
				(left, right) => left.landblockId.localeCompare(right.landblockId),
			),
			geometryResourceCount: this.#geometry.getResourceCount(),
			geometryResourceBytes: this.#geometry.getResourceBytes(),
			layers: [...this.#staticObjectLayerDiagnostics.values()].sort(
				(left, right) =>
					left.landblockId.localeCompare(right.landblockId) ||
					left.layer.localeCompare(right.layer),
			),
			staticObjectNodeCount: staticObjects.nodeCount,
			staticObjectOwnerCount: staticObjects.ownerCount,
			staticLayerPublicationCount: this.#staticLayerPublicationCount,
			outdoorLightScopeCount: this.#outdoorLights.ownedScopeCount,
			textureFactCollectionDurationMs: this.#textureFactCollectionDurationMs,
			textureFactCollectionCount: this.#textureFactCollectionCount,
			texture: this.#textures.getDiagnostics(),
			textureAtlasPages: this.#textures.getAtlasPageDiagnostics(),
		};
	}

	/** Resolve one active atlas page's opaque resource for an explicit Explorer readback. */
	getTextureAtlasPageResource(pageId: TexturePageId): Texture2DResourceKey {
		return this.#textures.getAtlasPageResource(pageId);
	}

	/** Promote the complete prepared regional static-detail set into device ownership once. */
	installActiveRegionStaticDetails(
		binding: ActiveRegionStaticDetailBinding,
	): void {
		const owner = activeRegionResourceToOwnerId(binding.activeRegionKey);
		try {
			for (const role of STATIC_DETAIL_ROLES) {
				const detail = binding.roles[role];
				this.#textures.installAssetTexture(owner, {
					height: detail.surface.height,
					key: detail.key,
					pixels: detail.surface.pixels,
					purpose: TexturePurpose.ObjectDetail,
					sourceAssetId: detail.sourceAssetId,
					width: detail.surface.width,
				});
			}
		} catch (cause) {
			if (owner !== this.#activeRegionStaticDetailOwner) {
				this.#textures.dropOwner(owner);
			}
			throw cause;
		}
		const previousOwner = this.#activeRegionStaticDetailOwner;
		this.#activeRegionStaticDetailOwner = owner;
		this.#activeRegionStaticDetails.clear();
		// Compiled object draws embed the detail binding these roles select.
		this.#renderer?.invalidateResolvedResources?.("region-static-detail");
		for (const role of STATIC_DETAIL_ROLES) {
			const detail = binding.roles[role];
			this.#activeRegionStaticDetails.set(role, {
				key: detail.key,
				tiling: detail.tiling,
			});
		}
		if (previousOwner !== null && previousOwner !== owner) {
			this.#textures.dropOwner(previousOwner);
		}
	}

	/**
	 * Resolve one spawned entity's live root origin, for a follower that must not lag it.
	 *
	 * Returns the scene graph's own resolution rather than the last host pose, so a follower sees
	 * the same interpolated position the entity is drawn at. `null` for an entity that is not
	 * currently presented, which is an ordinary state during realization rather than an error.
	 */
	dynamicEntityOrigin(
		guid: number,
	): import("../scene").ResolvedSceneOrigin | null {
		const installed = this.#spawnedPresentations.get(guid);
		if (!installed) return null;
		return this.#scene.getResolvedOrigin(installed.nodeId) ?? null;
	}

	/** Return every resident scene-scope candidate for one canonical scene-space point. */
	queryWorldPointResidencyCandidates(
		point: Vec3,
	): import("../scene").ScenePointResidencyCandidates | null {
		return this.#scene.queryWorldPointResidencyCandidates(point);
	}

	/** Test a world point against one explicitly selected resident EnvCell. */
	queryEnvCellPointContainment(
		residency: SceneResidency,
		point: Vec3,
	): boolean | null {
		return residency.envCellId === null
			? null
			: this.#scene.queryEnvCellPointContainment(residency.envCellId, point);
	}

	/** Whether this landblock currently owns any atomically published EnvCell topology. */
	hasEnvCellTopology(landblockId: SceneResidency["landblockId"]): boolean {
		return this.#scene.hasEnvCellTopology(landblockId);
	}

	/** Whether the exact host-selected EnvCell scope is available to the renderer. */
	hasEnvCellScope(residency: SceneResidency): boolean {
		return this.#scene.hasEnvCellScope(residency);
	}

	/** Sample canonical outdoor terrain as soon as its source commits, before GPU realization. */
	queryOutdoorTerrainSurface(point: Vec3): TerrainSurfaceSample | null {
		return this.#terrain.querySurfaceAtWorldPoint(point);
	}

	/**
	 * Terrain facts the overhead map draws from.
	 *
	 * These terrain members and `mapGeometry` are the whole of what the map reads from the runtime,
	 * and they satisfy `MapTerrainSource` structurally so the map depends on no runtime type. The
	 * terrain revision is its residency change fact, exactly as it is for the ambient bakes.
	 */
	get terrainInstallationRevision(): number {
		return this.#terrain.installationRevision;
	}

	listInstalledTerrain(): Iterable<InstalledTerrain> {
		return this.#terrain.listInstalledTerrain();
	}

	terrainColorPalette(): Float32Array | null {
		return this.#terrain.terrainColorPalette();
	}

	/**
	 * Where one spawned entity is being drawn right now.
	 *
	 * Read from the scene rather than from a feed snapshot, because the scene is what presentation
	 * rate actually updates: ordinary integrated advances move entities every host tick without
	 * republishing any view, so anything that follows a moving entity — a map anchor, a blip — must
	 * ask here or it will hold a pose from the last discontinuous correction.
	 *
	 * Null once an entity is no longer realized.
	 */
	spawnedEntityPlacement(guid: number): ScenePlacement | null {
		const nodeId = this.#spawnedPresentations.get(guid)?.nodeId;
		if (nodeId === undefined) return null;
		const node = this.#scene.getNode(nodeId);
		// Only a root carries residency, and every spawned entity is realized as one.
		if (!node || node.parentId !== null) return null;
		return {
			envCellId: node.envCellId,
			landblockId: node.landblockId,
			localTransform: node.localTransform,
		};
	}

	/**
	 * Every realized spawned entity paired with where it is being drawn right now.
	 *
	 * The identity half comes from the runtime's own desired-entity record rather than from any
	 * inspector snapshot, so nothing that draws entities depends on a diagnostics path.
	 */
	*listPresentedSpawnedEntities(): Generator<{
		readonly view: DynamicEntityView;
		readonly placement: ScenePlacement;
	}> {
		for (const [guid, record] of this.#spawnedDesiredEntities) {
			const placement = this.spawnedEntityPlacement(guid);
			if (placement) yield { placement, view: record.entity };
		}
	}

	/** Change fact for consumers that sample live dynamic placement on their own cadence. */
	get dynamicEntityPlacementRevision(): number {
		return this.#dynamicPlacements.revision;
	}

	/** Derived map geometry currently resident, for the overhead map to draw. */
	get mapGeometry(): MapGeometryStore {
		return this.#mapGeometry;
	}

	/** Return installed environment-cell bounds for frontend-owned interior placement policy. */
	queryEnvCellBounds(residency: SceneResidency): AABB3 | null {
		return residency.envCellId === null
			? null
			: this.#scene.queryEnvCellBounds(residency.envCellId);
	}

	tick(): void {
		if (this.#destroyed) return;
		this.#drainCommitArtifacts();
		const failures = this.#dynamicRealizationFailures.splice(0);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(
				failures,
				`${failures.length} deferred dynamic entities failed presentation realization.`,
			);
		}
		this.#dynamicPlacements.advance(performance.now());
	}

	/** Advance ordered runtime state and draw one frontend-scheduled frame. */
	frame(timeSeconds: number): void {
		if (this.#destroyed) throw new Error("Game runtime has been destroyed.");
		this.tick();
		this.render(timeSeconds);
	}

	/** Draw the current runtime state after a frontend-owned tick measurement. */
	render(timeSeconds: number): void {
		if (this.#destroyed) throw new Error("Game runtime has been destroyed.");
		const renderer = this.#renderer;
		if (!renderer) throw new Error("Game runtime has no renderer device.");
		const extent = this.#primaryViewExtent;
		if (extent === null) {
			throw new Error("Game runtime has no committed primary camera view.");
		}
		this.#lastFrameTimeSeconds = timeSeconds;
		const portalTransition = this.#advancePortalTransition(timeSeconds);
		// Retail runs script hooks before this frame's animation hooks for static objects
		// (`animate_static_object`, acclient.c:309368-309409), and statics are this population.
		const tick = this.#tickProfiler;
		tick?.beginTick();
		// Reconciled before the clocks advance, so a script activated by this tick's sky state runs
		// its `t=0` records on the same tick rather than a frame late.
		this.#skyScripts.sync(
			this.#environment.sky,
			this.#frameSettings.weatherEnabled,
		);
		// Before either producer dispatches: a command applied this frame lands on state that has
		// already reached this frame's behavior step, exactly as it did when animation drove it.
		this.#effects.advance(timeSeconds);
		this.#physicsScriptSystem.advance(timeSeconds);
		tick?.mark("scriptAdvance");
		this.#particles.advance(timeSeconds);
		const ambientRefreshed = this.#audioListenerEnabled
			? this.#refreshAmbient(timeSeconds)
			: false;
		if (this.#audioListenerEnabled) {
			const updateAudioControl = this.#audioControlCadence.shouldUpdate(
				timeSeconds,
				ambientRefreshed,
			);
			if (updateAudioControl) this.#ambient.updateLiveWeights();
			this.#ambient.advance(timeSeconds);
			// After ambience so a voice admitted on this control tick is placed against the same pose.
			if (updateAudioControl) this.#audio.updatePlacements();
		}
		tick?.mark("particleAdvance");
		const animationFrame = this.#animation.advance(timeSeconds);
		const presentationSelection = this.#animationPresentation.select(
			animationFrame,
			timeSeconds,
		);
		tick?.mark("animationAdvance");
		this.#dynamics.publishPresentation(
			this.#animation.sample(
				animationFrame,
				presentationSelection.selectedNodeIds,
			),
		);
		tick?.mark("presentationPublish");
		// Cohorts are rebuilt every frame from live emitters rather than retained, and cull at
		// emitter granularity before any instance record is written.
		// Culled at emitter granularity against the previous frame's selection. Cohorts are built
		// before the renderer selects, so this is one frame behind; the owner's bounds already
		// include the particle envelope, so an emitter entering view is selected on the frame its
		// envelope crosses the frustum rather than when its mesh does.
		renderer.particles?.submit(
			this.#particles.collectDrawRanges((target) =>
				this.#particleRenderOwner(target),
			),
			{
				data: this.#particles.recordData,
				dirtySlots: this.#particles.takeDirtyRecordSlots(),
			},
		);
		tick?.mark("particleRanges");
		const anchorLandblockId = this.#camera.placement.landblockId;
		const feedback = renderer.drawFrame({
			anchorLandblockId,
			dynamicLights: this.#dynamics.getRuntimeLights(),
			environment: {
				...this.#environment,
				distanceFog: resolveTerrainCoverageFog(
					this.#environment.distanceFog,
					this.#terrainFogCoverage,
				),
			},
			extent,
			frameSettings: this.#frameSettings,
			portalTransition,
			outdoorLights: this.#outdoorLights,
			timeSeconds,
			viewerLightOrigin: resolveViewerLightOrigin(
				this.#viewerLightCarrier === null
					? null
					: this.spawnedEntityPlacement(this.#viewerLightCarrier),
				this.#camera.placement.position,
			),
			views: [
				{
					camera: this.#camera,
					cameraInsideSealedCell: this.#cameraInsideSealedCell(),
				},
			],
		});
		tick?.mark("render");
		this.#selectedDynamicNodeIds = new Set(feedback.selectedDynamicNodeIds);
		this.#animationPresentation.completeFrame(feedback, timeSeconds);
		tick?.mark("frameCompletion");
		tick?.finishTick();
	}

	/** Per-phase update-tick timing; null unless a frontend injected a profiler. */
	getTickProfile(): RuntimeTickProfile | null {
		return this.#tickProfiler?.getProfile() ?? null;
	}

	/**
	 * Resolve whether the camera sits in a cell that cannot see outdoors.
	 *
	 * An uninstalled cell keeps outdoor lighting: absence of scope data is not evidence that a
	 * cell is sealed, and forcing interior ambient on it would darken the world during loading.
	 */
	#cameraInsideSealedCell(): boolean {
		const envCellId = this.#camera.placement.envCellId;
		if (envCellId === null) return false;
		return this.#scene.getEnvCellSeenOutside(envCellId) === false;
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#setupVisualSource?.destroy?.();
		const spawned = [...this.#spawnedDesiredEntities.keys()];
		for (const guid of spawned) this.#retireDynamicPresentationTree(guid);
		for (const guid of spawned)
			this.#forgetDesiredDynamicEntity(guid, "release-visual");
		this.#spawnedVisuals.clear();
		this.#spawnedVisualKeys.clear();
		this.#destroyed = true;
		this.#sceneInterestCoordinator.destroy();
		this.#commitArtifacts.length = 0;
		await Promise.all([
			this.#staticLayerRealizer.destroy(),
			this.#envCellRealizer.destroy(),
		]);
		await Promise.allSettled([...this.#realizationContinuations]);
		await this.#renderer?.destroy();
		this.#renderer = null;
		this.#portalTransitionAssets = null;
		this.#portalTransitionClip = null;
		this.#portalTransitionAnimationGeneration = null;
		this.#portalTransitionFramePosition = 0;
		this.#portalTransitionLastTimeSeconds = null;
		this.#animationPresentation.clear();
		this.#animation.destroy();
		this.#physicsScriptSystem.destroy();
		this.#audio.destroy();
		this.#skyScripts.destroy();
		this.#particleEmitters.destroy();
		for (const handle of this.#ambientSoundTableHandles.values()) {
			handle.release();
		}
		this.#ambientSoundTableHandles.clear();
		this.#ambientSoundTables.clear();
		this.#soundTables.destroy();
		this.#particleMeshes.destroy();
		this.#targetSoundTables.clear();
		await this.#dynamics.destroy();
		this.#envCells.destroy();
		await this.#terrain.destroy();
		await this.#terrainGenerator.destroy();
		this.#residentAtlas.destroy();
		await this.#textures.destroy();
		await this.#texturePreparer.destroy();
		this.#activeRegionStaticDetails.clear();
		this.#activeRegionStaticDetailOwner = null;
		this.#geometry.destroy();
	}

	#applySceneInterest(interest: SceneInterestMap): SceneInterestReceipt {
		return this.#sceneInterestCoordinator.reconcile(interest);
	}

	#drainCommitArtifacts(): void {
		while (this.#commitArtifacts.length > 0) {
			const pending = this.#commitArtifacts.shift();
			if (!pending) continue;
			const { artifact, revision } = pending;
			if (
				!this.#sceneInterestCoordinator.ownsDispatch(
					{ id: artifact.landblockId, layer: artifact.layer },
					revision,
				)
			) {
				continue;
			}
			this.#commitLandblockLayer(artifact, revision);
		}
	}

	#commitLandblockLayer(
		artifact: LandblockLayerCommit,
		revision: SceneInterestRevision,
	): void {
		this.#sceneLayerFailures.delete(
			sceneLayerKey(artifact.landblockId, artifact.layer),
		);
		const ownerId = landblockLayerToOwnerId(
			artifact.landblockId,
			artifact.layer,
		);
		if (artifact.layer === LandblockLayerKind.Terrain) {
			this.#installTerrainLayer(ownerId, artifact);
			this.#publishSceneAvailability({
				kind: "outdoor-terrain-source-available",
				landblockId: artifact.landblockId,
				revision,
			});
			return;
		}
		if (artifact.layer === LandblockLayerKind.EnvCells) {
			this.#realizeEnvCellLayer(ownerId, artifact, revision);
			return;
		}
		if (isOutdoorStaticLayer(artifact.layer)) {
			this.#realizeOutdoorStaticLayer(ownerId, artifact, revision);
			return;
		}
		throw new Error(`Layer ${artifact.layer} has no publication contract.`);
	}

	#installTerrainLayer(
		ownerId: OwnerId,
		artifact: Extract<
			LandblockLayerCommit,
			{
				layer: LandblockLayerKind.Terrain;
			}
		>,
	): void {
		this.#terrain.install(terrainSourceToOwnerId(artifact.landblockId), {
			localBounds: TERRAIN_ROOT_BOUNDS,
			placement: createLandblockPlacement(artifact.landblockId),
			source: {
				generation: artifact.commit.generation,
				landblockId: artifact.landblockId,
				presentation: artifact.commit.presentation,
			},
		});
	}

	#realizeOutdoorStaticLayer(
		ownerId: OwnerId,
		artifact: Extract<
			LandblockLayerCommit,
			{ readonly layer: OutdoorStaticLayerKind }
		>,
		revision: SceneInterestRevision,
	): void {
		const factCollectionStartedAt = performance.now();
		const textureRequirements = collectStaticObjectTextureDependencies(
			artifact.commit.source,
		);
		this.#textureFactCollectionDurationMs +=
			performance.now() - factCollectionStartedAt;
		this.#textureFactCollectionCount += 1;
		this.#trackRealizationContinuation(
			this.#staticLayerRealizer
				.realize({
					layer: artifact.layer,
					owner: ownerId,
					prepareCompanion: () =>
						this.#prepareStaticAuthoredDynamics(
							ownerId,
							artifact.layer,
							artifact.landblockId,
							artifact.commit.source.dynamicSources,
						),
					revision,
					source: artifact.commit.source,
					textureRequirements,
				})
				.then(async (result) => {
					if (result.kind !== "published") return;
					if (artifact.commit.source.kind === LandblockLayerKind.Buildings) {
						this.#mapGeometry.installBuildings(artifact.commit.source);
					}
					this.#staticObjectLayerDiagnostics.set(ownerId, {
						...(result.geometry?.geometryDiagnostics ??
							EMPTY_STATIC_OBJECT_GEOMETRY_DIAGNOSTICS),
						cullingGroup: artifact.layer,
						expectedResidentCount:
							artifact.commit.source.staticResidents.length +
							artifact.commit.source.dynamicSources.length,
						layer: artifact.layer,
						landblockId: artifact.landblockId,
						materializedStaticResidentCount:
							artifact.commit.source.staticResidents.length,
						promotedDynamicResidentCount:
							artifact.commit.source.dynamicSources.length,
						resolvedStaticResidentCount:
							artifact.commit.source.staticResidents.length,
						runtimeDynamicResidentCount:
							artifact.commit.source.dynamicSources.length,
						sceneNodeCount: result.geometry?.objects.length ?? 0,
						staticArtifactInstalled: result.geometry !== null,
					});
				})
				.catch((error) => {
					if (
						!this.#sceneInterestCoordinator.ownsDispatch(
							{ id: artifact.landblockId, layer: artifact.layer },
							revision,
						)
					)
						return;
					console.error(error);
					this.#publishSceneAvailability({
						kind: "scene-content-failed",
						layer: artifact.layer,
						message: error instanceof Error ? error.message : String(error),
						residency: { envCellId: null, landblockId: artifact.landblockId },
						revision,
					});
				}),
		);
	}

	#realizeEnvCellLayer(
		ownerId: OwnerId,
		artifact: Extract<
			LandblockLayerCommit,
			{
				layer: LandblockLayerKind.EnvCells;
			}
		>,
		revision: SceneInterestRevision,
	): void {
		const plan = artifact.commit.plan;
		if (plan.landblockId !== artifact.landblockId) {
			throw new Error(
				`EnvCell plan belongs to ${plan.landblockId}, expected ${artifact.landblockId}.`,
			);
		}
		const textureRequirements = mergeAssetTextureFacts(
			[
				...plan.shellTextureRequirements,
				...plan.residentJobs.flatMap((job) => job.textureRequirements),
			],
			"EnvCell layer",
		);
		this.#trackRealizationContinuation(
			this.#envCellRealizer
				.realize({
					layer: LandblockLayerKind.EnvCells,
					owner: ownerId,
					prepareCompanion: () =>
						this.#prepareStaticAuthoredDynamics(
							ownerId,
							artifact.layer,
							artifact.landblockId,
							plan.dynamicSources,
						),
					revision,
					source: plan,
					textureRequirements,
				})
				.then(async (result) => {
					if (result.kind !== "published") return;
					this.#mapGeometry.installInterior({
						apertures: plan.apertures,
						crossings: plan.crossings,
						landblockId: artifact.landblockId,
						shells: plan.shells,
					});
					this.#envCellLayerDiagnostics.set(ownerId, {
						...plan.diagnostics,
						...result.geometry.residentGeometryDiagnostics,
						indoorDepthContinuousCrossingCount: plan.crossings.filter(
							(crossing) =>
								crossing.spatialRelationship.kind === "indoor-depth-continuous",
						).length,
						indoorTopologyBoundaryCrossingCount: plan.crossings.filter(
							(crossing) =>
								crossing.spatialRelationship.kind ===
								"indoor-topology-boundary",
						).length,
						exteriorTransitionCrossingCount: plan.crossings.filter(
							(crossing) =>
								crossing.spatialRelationship.kind === "exterior-transition",
						).length,
						landblockId: artifact.landblockId,
						potentiallyVisibleReferenceCount: plan.scopes.reduce(
							(count, scope) => count + scope.potentiallyVisibleEnvCellIds.size,
							0,
						),
						sceneResidentNodeCount:
							result.geometry.residents?.objects.length ?? 0,
						sceneShellNodeCount: result.geometry.environment.cellShells.length,
						visibilityIslandCount: new Set(
							result.geometry.environment.scopes.map(
								(scope) => scope.visibilityIslandId,
							),
						).size,
					});
					this.#publishSceneAvailability({
						kind: "env-cell-topology-available",
						landblockId: artifact.landblockId,
						revision,
					});
				})
				.catch((error) => {
					if (
						!this.#sceneInterestCoordinator.ownsDispatch(
							{
								id: artifact.landblockId,
								layer: LandblockLayerKind.EnvCells,
							},
							revision,
						)
					) {
						return;
					}
					console.error(error);
					this.#publishSceneAvailability({
						kind: "scene-content-failed",
						layer: artifact.layer,
						message: error instanceof Error ? error.message : String(error),
						residency: {
							envCellId: null,
							landblockId: artifact.landblockId,
						},
						revision,
					});
				}),
		);
	}

	/** Stage every visual and behavior dependency before one dynamic owner can publish. */
	async #prepareDynamicOwner(
		ownerId: DynamicOwnerId,
		sources: readonly PlacedDynamicPresentationSource[],
	) {
		if (this.#destroyed)
			throw new Error("Cannot prepare dynamics after runtime shutdown.");
		const installation = this.#dynamics.replaceOwner(ownerId, sources);
		const outcome = await installation.ready;
		if (outcome === "superseded")
			throw new Error(`Dynamic owner ${ownerId} preparation was superseded.`);
		const prepared = installation.getPreparedEntities();
		let animationStage: ReturnType<
			AnimationSystem<ResourceOwnerId>["stageOwner"]
		>;
		try {
			animationStage = this.#animation.stageOwner(
				ownerId,
				prepared.flatMap(({ animation, nodeId, source }) =>
					animation.kind === "activatable"
						? [
								{
									animation: animation.animation,
									residentIdentity: source.identity,
									target: {
										generation: installation.generation,
										targetId: behaviorTargetId(nodeId),
									},
								},
							]
						: [],
				),
			);
		} catch (cause) {
			installation.release();
			throw cause;
		}
		let scriptStage: ReturnType<
			PhysicsScriptSystem<DynamicOwnerId | SkyOwnerId>["stageOwner"]
		> | null = null;
		try {
			scriptStage = this.#physicsScriptSystem.stageOwner(
				ownerId,
				prepared.flatMap(({ nodeId, scriptClosure }) =>
					scriptClosure === null
						? []
						: [
								{
									closure: scriptClosure,
									target: {
										generation: installation.generation,
										targetId: behaviorTargetId(nodeId),
									},
									timeSeconds: this.#lastFrameTimeSeconds,
								},
							],
				),
			);
			// Particle meshes are part of an emitter's drawable closure, not a post-publish warmup.
			await this.#stageParticleMeshes(prepared);
			installation.prepareCommit(animationStage.samples);
		} catch (cause) {
			animationStage.release();
			scriptStage?.release();
			installation.release();
			throw cause;
		}
		if (scriptStage === null)
			throw new Error("Dynamic script staging completed without a stage.");
		const committedScriptStage = scriptStage;
		const nextTargets = new Set(
			prepared.map(({ nodeId }) => behaviorTargetId(nodeId)),
		);
		let state: "prepared" | "committed" | "released" = "prepared";
		return {
			prepared,
			nodeIds: installation.nodeIds,
			generation: installation.generation,
			commit: () => {
				if (state !== "prepared")
					throw new Error(`Cannot commit dynamic owner in state ${state}.`);
				const previousTargets = this.#dynamicBehaviorTargets.get(ownerId);
				// No script or animation can advance between these synchronous commits. Publishing
				// the entity last makes the complete replacement observable as one runtime action.
				animationStage.commit();
				committedScriptStage.commit();
				installation.commit();
				for (const targetId of previousTargets ?? []) {
					this.#particles.destroy({ generation: 0, targetId }, 0);
					this.#targetSoundTables.delete(targetId);
				}
				for (const entity of prepared) {
					if (entity.soundTable !== null)
						this.#targetSoundTables.set(
							behaviorTargetId(entity.nodeId),
							entity.soundTable,
						);
				}
				this.#dynamicBehaviorTargets.set(ownerId, nextTargets);
				state = "committed";
			},
			release: () => {
				if (state !== "prepared") return;
				animationStage.release();
				committedScriptStage.release();
				installation.release();
				state = "released";
			},
		};
	}

	async #prepareStaticAuthoredDynamics(
		ownerId: OwnerId,
		layer: LandblockLayerKind,
		landblockId: LandblockOwnerId,
		sources: readonly AuthoredDynamicSource[],
	): Promise<StaticLayerCompanionPublication> {
		if (this.#destroyed)
			throw new Error(
				"Cannot prepare authored dynamics after runtime shutdown.",
			);
		for (const source of sources) {
			if (source.placement.landblockId !== landblockId) {
				throw new Error(
					`Authored dynamic placement belongs to ${source.placement.landblockId}, expected ${landblockId}.`,
				);
			}
		}
		const activation = await this.#prepareDynamicOwner(
			ownerId,
			sources.map(adaptAuthoredDynamicPresentation),
		);
		const diagnostics = activation.prepared.map(
			({ animation, source }): AuthoredDynamicResidentDiagnostic => ({
				blockingHooks:
					animation.kind === "retain-static-presentation"
						? animation.blockingHooks.map((hook) => ({
								animationId: animation.animation.id,
								authoredOrder: hook.authoredOrder,
								command: animationHookCommand(hook),
								frameIndex: hook.frameIndex,
							}))
						: [],
				defaultAnimationId: source.behavior.animationId,
				landblockId,
				layer,
				presentationMode:
					animation.kind === "activatable"
						? "animated"
						: "static-visual-fallback",
				residentId: source.identity,
				setupSourceId: source.setupId,
			}),
		);
		return {
			commit: () => {
				activation.commit();
				this.#authoredDynamicResidents.set(ownerId, diagnostics);
			},
			release: () => {
				activation.release();
			},
		};
	}

	#evictStaticLayer(
		landblockId: LandblockOwnerId,
		layer: LandblockLayerKind,
		revision: SceneInterestRevision,
	): void {
		const ownerId = landblockLayerToOwnerId(landblockId, layer);
		if (isOutdoorStaticLayer(layer)) {
			void this.#staticLayerRealizer.evict(ownerId, revision);
		} else if (layer === LandblockLayerKind.EnvCells) {
			void this.#envCellRealizer.evict(ownerId, revision);
		} else {
			this.#staticObjects.evict(ownerId, revision);
		}
		if (layer === LandblockLayerKind.Buildings) {
			this.#mapGeometry.evictBuildings(landblockId);
		} else if (layer === LandblockLayerKind.EnvCells) {
			this.#mapGeometry.evictInterior(landblockId);
		}
		this.#authoredDynamicResidents.delete(ownerId);
		this.#staticObjectLayerDiagnostics.delete(ownerId);
		this.#envCellLayerDiagnostics.delete(ownerId);
		this.#sceneLayerFailures.delete(sceneLayerKey(landblockId, layer));
		this.#retireDynamicOwner(ownerId);
		this.#envCells.removeOwner(ownerId);
		if (layer === LandblockLayerKind.Terrain) {
			this.#terrain.removeOwner(terrainSourceToOwnerId(landblockId));
		}
		this.#textures.dropOwner(ownerId);
	}

	/** Retire every presentation and behavior resource for one exact dynamic owner immediately. */
	#retireDynamicOwner(ownerId: DynamicOwnerId): void {
		for (const targetId of this.#dynamicBehaviorTargets.get(ownerId) ?? []) {
			this.#particles.destroy({ generation: 0, targetId }, 0);
			this.#targetSoundTables.delete(targetId);
		}
		this.#dynamicBehaviorTargets.delete(ownerId);
		this.#animation.removeOwner(ownerId);
		this.#physicsScriptSystem.removeOwner(ownerId);
		this.#dynamics.removeOwner(ownerId);
	}

	#publishSceneAvailability(event: SceneAvailabilityEvent): void {
		if (event.kind === "scene-content-failed") {
			this.#sceneLayerFailures.set(
				sceneLayerKey(event.residency.landblockId, event.layer),
				{
					diagnostic: event.message,
					revision: event.revision,
				},
			);
		} else if (event.kind === "scene-content-unavailable") {
			this.#sceneLayerFailures.set(
				sceneLayerKey(event.residency.landblockId, event.layer),
				{
					diagnostic: `No source content is available for ${event.layer} at ${event.residency.landblockId}.`,
					revision: event.revision,
				},
			);
		}
		if (event.kind === "outdoor-terrain-source-available") {
			this.#wakeDeferredDynamicResidencies(
				`${event.landblockId}:outdoor`,
				"exact",
			);
		} else if (event.kind === "env-cell-topology-available") {
			this.#wakeDeferredDynamicResidencies(
				`${event.landblockId}:env-cell:`,
				"prefix",
			);
		}
		for (const listener of this.#sceneAvailabilityListeners) listener(event);
	}

	/** Wake only desired roots indexed under one newly published static residency fact. */
	#wakeDeferredDynamicResidencies(
		residencyKey: string,
		match: "exact" | "prefix",
	): void {
		const records: DesiredDynamicEntityRecord[] = [];
		for (const [key, guids] of this.#spawnedDeferredResidencies) {
			if (
				(match === "exact" && key !== residencyKey) ||
				(match === "prefix" && !key.startsWith(residencyKey))
			)
				continue;
			for (const guid of guids) {
				const record = this.#spawnedDesiredEntities.get(guid);
				if (record !== undefined) records.push(record);
			}
		}
		if (records.length === 0) return;
		const continuation = Promise.all(
			records.map((record) => this.#realizeAcceptedDynamicEntity(record)),
		).then(() => undefined);
		const guarded = continuation.catch((error: unknown) => {
			this.#dynamicRealizationFailures.push(error);
		});
		this.#trackRealizationContinuation(guarded);
	}

	#trackRealizationContinuation(continuation: Promise<void>): void {
		this.#realizationContinuations.add(continuation);
		void continuation.then(
			() => this.#realizationContinuations.delete(continuation),
			() => this.#realizationContinuations.delete(continuation),
		);
	}
}

/** Closed static geometry adapter shared by outdoor and EnvCell resident realization. */
class RuntimeStaticObjectGeometryPreparer implements StaticLayerGeometryPreparer<
	ResolvedStaticObjectLayerSource,
	StaticObjectLayerArtifact | null,
	OwnerId
> {
	readonly #worker: StaticObjectGeometryWorker;

	constructor(worker: StaticObjectGeometryWorker) {
		this.#worker = worker;
	}

	async prepare(options: {
		readonly layer: StaticLayerKind;
		readonly partition?: string;
		readonly owner: OwnerId;
		readonly revision: SceneInterestRevision;
		readonly source: ResolvedStaticObjectLayerSource;
		readonly textureRequirements: readonly import("../textures/types").AssetTextureFact[];
	}): Promise<StaticObjectLayerArtifact | null> {
		const geometry = await this.#worker.prepare({
			layer: options.layer,
			resourceNamespace: staticRevisionToInstallNamespace(
				options.owner,
				options.revision,
				options.partition,
			),
			source: options.source,
		});
		return assembleStaticObjectArtifact({
			geometry,
			resourceNamespace: staticRevisionToInstallNamespace(
				options.owner,
				options.revision,
				options.partition,
			),
			source: options.source,
			textureRequirements: options.textureRequirements,
		});
	}

	destroy(): void {
		this.#worker.destroy();
	}
}

/** Non-browser adapter retaining the same source-to-artifact contract without workers. */
class InlineStaticObjectGeometryPreparer extends RuntimeStaticObjectGeometryPreparer {
	constructor() {
		super({
			prepare: (job) => Promise.resolve(prepareStaticObjectGeometry(job)),
			destroy: () => undefined,
		} as StaticObjectGeometryWorker);
	}
}

function cloneSceneInterest(interest: SceneInterestMap): SceneInterestMap {
	return new Map(
		[...interest.entries()].map(([landblockId, layers]) => [
			landblockId,
			new Set(layers),
		]),
	);
}

function sceneLayerKey(
	landblockId: LandblockOwnerId,
	layer: LandblockLayerKind,
): string {
	return `${landblockId}:${layer}`;
}

/** Parse an outdoor static publisher owner, failing loudly if a non-outdoor layer reached it. */
function parseOutdoorLayerOwner(owner: OwnerId): {
	readonly landblockId: LandblockOwnerId;
	readonly layer: OutdoorStaticLayerKind;
} {
	const parsed = parseLandblockLayerOwnerId(owner);
	if (!isOutdoorStaticLayer(parsed.layer)) {
		throw new Error(`Outdoor static publisher received ${parsed.layer}.`);
	}
	return { landblockId: parsed.landblockId, layer: parsed.layer };
}

function createLandblockPlacement(
	landblockId: LandblockOwnerId,
): ScenePlacement {
	return {
		envCellId: null,
		landblockId,
		localTransform: Mat4.identity(),
	};
}
