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
import type { DynamicEntityVisualSource } from "../../assets/dynamic-entity-visual-source";
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
import { INVALID_ID, type EnvCellId, type LandblockId } from "../game-types";
import { GeometryManager } from "../geometry/geometry-manager";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import {
	DEFAULT_FRAME_SETTINGS,
	type FrameSettings,
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
import { TerrainSystem } from "../terrain/terrain-system";
import { StaticObjectSystem } from "../systems/static-object-system";
import { DynamicEntitySystem } from "../systems/dynamic-entity-system";
import { DynamicEntityPlacementSystem } from "../systems/dynamic-entity-placement-system";
import {
	InlineObjectVisualTemplatePreparer,
	ObjectVisualTemplateRepository,
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
	type DynamicGenerationResourceOwnerId,
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
	type SpawnedDynamicOwnerId,
	spawnedDynamicOwnerId,
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
	adaptSpawnedDynamicPresentation,
	datAssetId,
	spawnedDynamicPlacement,
	spawnedDynamicPlacementKey,
} from "./spawned-dynamic-presentation";
import type {
	DynamicEntityAdvanceBatch,
	DynamicEntityPlayingClip,
	DynamicEntityView,
} from "./dynamic-entity-feed";
import { playingClip } from "../animation/animation-playback";
import type { PlacedDynamicPresentationSource } from "../systems/dynamic-presentation-source";
import {
	computeSceneInterest,
	isOutdoorStaticLayer,
	LandblockLayerKind,
	type OutdoorStaticLayerKind,
	type StaticLayerKind,
	type SceneInterestMap,
	type SceneInterestRequest,
	validateSceneInterestRadiiOrThrow,
} from "./scene-interest";
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
		landblockId: INVALID_ID,
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
export interface GameRuntimeDependencies {
	readonly animationSource: AnimationAssetSource;
	readonly physicsScriptSource: PhysicsScriptSource;
	readonly audioDevice: AudioDevice;
	readonly particleEmitterSource: ParticleEmitterSource;
	readonly soundTableSource: SoundTableSource;
	readonly particleMeshSource: ParticleMeshSource;
	/** Optional live-entity visual capability; null for runtimes that never consume a focused feed. */
	readonly dynamicEntityVisualSource: DynamicEntityVisualSource | null;
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
export interface GameRuntimeWorkerFactories {
	readonly createTerrainWorker: () => ClosedWorkerPort;
}

/** Device boundary used by runtime to construct its private renderer facade. */
export interface GameRuntimeRenderDevice {
	readonly resources: RendererResourceManager;
	buildRenderer(world: RenderWorld): Promise<Renderer>;
}

/** One completed static artifact retained with the currently relevant interest revision. */
interface PendingCommitArtifact {
	readonly artifact: LandblockLayerCommit;
	readonly revision: SceneInterestRevision;
}

interface SpawnedDynamicPresentationRecord {
	readonly generation: number;
	/**
	 * Dynamics owner generation this node's behavior targets carry.
	 *
	 * Distinct from `generation`, which is the host's semantic entity generation: a later clip
	 * projection has to name the target the animation record was staged under, not the entity's.
	 */
	readonly behaviorGeneration: number;
	readonly nodeId: SceneNodeId;
	readonly ownerId: SpawnedDynamicOwnerId;
	readonly visualKey: string;
	/**
	 * Clip level this presentation last applied, so a restated level is not re-entered.
	 *
	 * Mutable because it tracks what this record is doing, not what it is. Every other field
	 * identifies the record and is fixed for its lifetime.
	 */
	playingClip: DynamicEntityPlayingClip | null;
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
	readonly landblockId: LandblockId;
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
	readonly landblockId: LandblockId;
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

/** One realized EnvCell source plan plus worker consumption facts. */
export interface EnvCellLayerRuntimeDiagnostics
	extends EnvCellMaterializationDiagnostics, StaticObjectGeometryDiagnostics {
	/** Directed seams proven safe for ordinary depth continuity. */
	readonly indoorDepthContinuousCrossingCount: number;
	/** Directed indoor seams that retain a topology-mask boundary. */
	readonly indoorTopologyBoundaryCrossingCount: number;
	/** Directed indoor/outdoor transitions that always retain a scene-domain boundary. */
	readonly exteriorTransitionCrossingCount: number;
	readonly landblockId: LandblockId;
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

function formatDynamicGuid(guid: number): string {
	return `0x${(guid >>> 0).toString(16).padStart(8, "0")}`;
}

/** Bridges source commits, scene topology, runtime residency, and frontend frame state. */
export class GameRuntime {
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
	/** Dynamic roots, articulated part nodes, and presentation preparation. */
	readonly #dynamics: DynamicEntitySystem<
		DynamicOwnerId,
		DynamicGenerationResourceOwnerId
	>;
	readonly #dynamicEntityVisualSource: DynamicEntityVisualSource | null;
	/** Latest desired current views are liveness tokens and late-readiness endpoints, not authority. */
	readonly #spawnedDesiredEntities = new Map<number, DynamicEntityView>();
	/** Installed frontend resources keyed by producer identity. */
	readonly #spawnedPresentations = new Map<
		number,
		SpawnedDynamicPresentationRecord
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
	 * Read from the same resolved placement as {@link GameRuntime.#sceneOriginOf}, so it reflects
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
	 * The liveness half of {@link GameRuntime.#originOf}, split out because per-frame consumers ask
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
	/** Terrain interest constraining the frontend's effective distance-fog range. */
	#terrainFogCoverage: TerrainFogCoverage | null = null;
	/** Prevents new work and late async publication after runtime shutdown begins. */
	#destroyed = false;

	protected constructor(
		renderResources: RendererResourceManager,
		commitPipeline: CommitPipeline,
		dependencies: GameRuntimeDependencies,
	) {
		this.#tickProfiler = dependencies.tickProfiler;
		this.#dynamicEntityVisualSource = dependencies.dynamicEntityVisualSource;
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
		this.#dynamics = new DynamicEntitySystem(
			this.#scene,
			this.#dynamicPlacements,
			new ObjectVisualTemplateRepository<
				DynamicGenerationResourceOwnerId,
				AtlasRequirementHandle<ResourceOwnerId>
			>(
				this.#geometry,
				this.#residentAtlas,
				new InlineObjectVisualTemplatePreparer(),
			),
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
			play: (trigger) => this.#audio.trigger(trigger),
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
		device: GameRuntimeRenderDevice,
		commitPipeline: CommitPipeline,
		texturePixelSource: TexturePixelSource,
		animationSource: AnimationAssetSource,
		physicsScriptSource: PhysicsScriptSource,
		audioDevice: AudioDevice,
		particleEmitterSource: ParticleEmitterSource,
		soundTableSource: SoundTableSource,
		particleMeshSource: ParticleMeshSource,
		dynamicEntityVisualSource: DynamicEntityVisualSource | null,
		roll?: UniformRoll,
		tickProfiler?: RuntimeTickProfiler,
		workerFactories?: GameRuntimeWorkerFactories,
	): Promise<GameRuntime> {
		const [terrainGenerator, texturePreparer] = await Promise.all([
			workerFactories === undefined
				? WorkerTerrainGenerator.build()
				: new WorkerTerrainGenerator({
						createWorker: workerFactories.createTerrainWorker,
					}),
			WorkerTexturePreparer.build(texturePixelSource),
		]);
		const runtime = new GameRuntime(device.resources, commitPipeline, {
			animationSource,
			audioDevice,
			particleEmitterSource,
			physicsScriptSource,
			particleMeshSource,
			dynamicEntityVisualSource,
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
		});
		runtime.#renderer = await device.buildRenderer(runtime.#renderWorld);
		return runtime;
	}

	/** Construct runtime from explicit ports for focused integration tests. */
	static buildForTesting(
		renderResources: RendererResourceManager,
		commitPipeline: CommitPipeline,
		dependencies: GameRuntimeDependencies,
	): GameRuntime {
		return new GameRuntime(renderResources, commitPipeline, dependencies);
	}

	/** Reconcile the focused producer mirror into shared dynamic presentation ownership. */
	async reconcileSpawnedDynamicEntities(
		entities: readonly DynamicEntityView[],
	): Promise<void> {
		if (this.#destroyed)
			throw new Error(
				"Cannot reconcile spawned entities after runtime shutdown.",
			);
		if (this.#dynamicEntityVisualSource === null && entities.length > 0) {
			throw new Error(
				"This runtime has no dynamic-entity visual source capability.",
			);
		}
		const requested = new Map<number, DynamicEntityView>();
		for (const entity of entities) {
			const guid = entity.identity.guid;
			if (requested.has(guid))
				throw new Error(
					`Spawned dynamic reconciliation repeats GUID ${formatDynamicGuid(guid)}.`,
				);
			requested.set(guid, entity);
		}
		const stale = new Set(
			[...this.#spawnedDesiredEntities.keys()].filter(
				(guid) => !requested.has(guid),
			),
		);
		for (const guid of stale) this.#removeSpawnedDynamicTree(guid, stale);
		const worldRequests: Array<{
			entity: DynamicEntityView;
			visualKey: string;
			visual: Promise<DecodedStaticPresentation>;
		}> = [];
		const attachedRequests: typeof worldRequests = [];
		for (const entity of requested.values()) {
			const guid = entity.identity.guid;
			const visualKey = dynamicVisualKey(entity);
			this.#spawnedDesiredEntities.set(guid, entity);
			const visual = this.#retainSpawnedVisual(guid, visualKey, entity);
			if (entity.placement.kind === "world")
				worldRequests.push({ entity, visualKey, visual });
			else attachedRequests.push({ entity, visualKey, visual });
		}
		const prepare = (request: (typeof worldRequests)[number]) => {
			const continuation = this.#upsertSpawnedDynamicEntity(
				request.entity,
				request.visualKey,
				request.visual,
			);
			this.#trackRealizationContinuation(continuation);
			return continuation;
		};
		const worldOutcomes = await Promise.allSettled(worldRequests.map(prepare));
		const outcomes = [
			...worldOutcomes,
			...(await Promise.allSettled(attachedRequests.map(prepare))),
		];
		const failures = outcomes.flatMap((outcome) =>
			outcome.status === "rejected" ? [outcome.reason] : [],
		);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(
				failures,
				`${failures.length} spawned dynamic entities failed presentation reconciliation.`,
			);
		}
	}

	/** Apply one accepted host tick without re-running asynchronous visual reconciliation. */
	applySpawnedDynamicEntityAdvances(
		batch: DynamicEntityAdvanceBatch,
		receivedAtMs: number,
	): void {
		if (this.#destroyed)
			throw new Error(
				"Cannot advance spawned entities after runtime shutdown.",
			);
		for (const advance of batch.advances) {
			const entity = advance.entity;
			const guid = entity.identity.guid;
			const desired = this.#spawnedDesiredEntities.get(guid);
			if (desired?.generation !== entity.generation) continue;
			if (dynamicVisualKey(desired) !== dynamicVisualKey(entity)) {
				throw new Error(
					`Dynamic entity ${formatDynamicGuid(guid)} changed immutable visual facts within generation ${entity.generation}.`,
				);
			}
			this.#spawnedDesiredEntities.set(guid, entity);
			const installed = this.#spawnedPresentations.get(guid);
			if (installed?.generation !== entity.generation) continue;
			this.#applySpawnedPresentationState(installed, entity);
			this.#dynamics.updatePlacementPath(
				installed.nodeId,
				advance,
				batch.durationMs,
				receivedAtMs,
			);
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
	#applySpawnedDynamicClip(
		installed: SpawnedDynamicPresentationRecord,
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

	async #upsertSpawnedDynamicEntity(
		entity: DynamicEntityView,
		visualKey: string,
		visual: Promise<DecodedStaticPresentation>,
	): Promise<void> {
		const guid = entity.identity.guid;
		const installedCurrent = this.#spawnedPresentations.get(guid);
		if (installedCurrent?.generation === entity.generation) {
			if (installedCurrent.visualKey !== visualKey) {
				throw new Error(
					`Dynamic entity ${formatDynamicGuid(guid)} changed immutable visual facts without changing generation.`,
				);
			}
			this.#applySpawnedDynamicState(installedCurrent, entity);
			return;
		}
		const resolved = await visual;
		if (
			this.#spawnedDesiredEntities.get(guid)?.generation !== entity.generation
		)
			return;
		const stagingPlacement = this.#spawnedStagingPlacement(entity);
		if (stagingPlacement === null) return;
		const ownerId = spawnedDynamicOwnerId(guid);
		const activation = await this.#prepareDynamicOwner(ownerId, [
			adaptSpawnedDynamicPresentation(entity, resolved, stagingPlacement),
		]);
		if (
			this.#spawnedDesiredEntities.get(guid)?.generation !== entity.generation
		) {
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
		const installed: SpawnedDynamicPresentationRecord = {
			behaviorGeneration: activation.generation,
			generation: entity.generation,
			nodeId,
			ownerId,
			visualKey,
			playingClip: null,
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
					spawnedDynamicPlacementKey(entity.placement.placement),
				);
			} catch (cause) {
				this.#retireDynamicOwner(ownerId);
				this.#spawnedPresentations.delete(guid);
				throw cause;
			}
		}
		const latestDesired = this.#spawnedDesiredEntities.get(guid);
		if (latestDesired?.generation !== entity.generation) {
			throw new Error(
				`Dynamic entity ${formatDynamicGuid(guid)} changed generation during synchronous activation commit.`,
			);
		}
		this.#applySpawnedDynamicState(installed, latestDesired);
	}

	/** Apply everything one view says about an installed presentation, placement included. */
	#applySpawnedDynamicState(
		installed: SpawnedDynamicPresentationRecord,
		entity: DynamicEntityView,
	): void {
		if (entity.placement.kind === "world") {
			this.#dynamics.updatePlacement(
				installed.nodeId,
				spawnedDynamicPlacement(entity),
			);
		}
		this.#applySpawnedPresentationState(installed, entity);
	}

	/** Resolve the temporary world placement needed only while an attached visual is staged. */
	#spawnedStagingPlacement(
		entity: DynamicEntityView,
	): SceneSpatialPlacement | null {
		if (entity.placement.kind === "world")
			return spawnedDynamicPlacement(entity);
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
		installed: SpawnedDynamicPresentationRecord,
		entity: DynamicEntityView,
	): void {
		this.#dynamics.updatePresentationState(installed.nodeId, {
			cloaked: entity.physics.cloaked,
			hidden: entity.physics.hidden,
			lighting: entity.physics.lighting,
			noDraw: entity.physics.noDraw,
		});
		this.#applySpawnedDynamicClip(installed, entity.playingClip);
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
			const source = this.#dynamicEntityVisualSource;
			if (source === null)
				throw new Error(
					"This runtime has no dynamic-entity visual source capability.",
				);
			const completion = source.load(entity.presentation);
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

	#removeSpawnedDynamicEntity(guid: number): void {
		this.#spawnedDesiredEntities.delete(guid);
		const visualKey = this.#spawnedVisualKeys.get(guid);
		if (visualKey !== undefined) this.#releaseSpawnedVisual(guid, visualKey);
		const installed = this.#spawnedPresentations.get(guid);
		if (installed !== undefined) {
			this.#retireDynamicOwner(installed.ownerId);
			this.#spawnedPresentations.delete(guid);
		}
	}

	/** Remove attached descendants before their parent scene tree. */
	#removeSpawnedDynamicTree(guid: number, stale: ReadonlySet<number>): void {
		for (const [childGuid, child] of this.#spawnedDesiredEntities) {
			if (
				stale.has(childGuid) &&
				child.placement.kind === "attached" &&
				child.placement.parent === guid
			) {
				this.#removeSpawnedDynamicTree(childGuid, stale);
			}
		}
		if (this.#spawnedDesiredEntities.has(guid))
			this.#removeSpawnedDynamicEntity(guid);
	}

	/** Replace frontend-owned static content interest without moving the camera. */
	updateSceneInterest(request: SceneInterestRequest): SceneInterestReceipt {
		validateSceneInterestRadiiOrThrow(request.radii);
		this.#terrainFogCoverage = {
			terrainRadius: request.radii.terrainRadius,
		};
		return this.#applySceneInterest(
			computeSceneInterest(request.anchorLandblockId, request.radii),
		);
	}

	/** Evict every frontend-requested static layer without moving the camera. */
	clearSceneInterest(): SceneInterestReceipt {
		this.#terrainFogCoverage = null;
		return this.#applySceneInterest(new Map());
	}

	/** Subscribe to source/topology availability without exposing runtime-owned resources. */
	subscribeSceneAvailability(listener: SceneAvailabilityListener): () => void {
		this.#sceneAvailabilityListeners.add(listener);
		return () => this.#sceneAvailabilityListeners.delete(listener);
	}

	/**
	 * Place the audio listener, in canonical scene space.
	 *
	 * Deliberately a frontend input rather than something derived from the primary camera. Where
	 * the ears are is a client decision: a game client puts them on the player, while the explorer
	 * flies a free camera and may want them somewhere else entirely. The runtime owns the frame
	 * conversion and the retail spatial maths, not the choice.
	 */
	setAudioListener(placement: AudioListenerPlacement): void {
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

	/** Snapshot app-local outdoor-static lifecycle, resource, and atlas-arbitration diagnostics. */
	getStaticObjectRuntimeDiagnostics(): StaticObjectRuntimeDiagnostics {
		const staticObjects = this.#staticObjects.getDiagnostics();
		return {
			envCellLayers: [...this.#envCellLayerDiagnostics.values()].sort(
				(left, right) => left.landblockId.localeCompare(right.landblockId),
			),
			geometryResourceCount: this.#geometry.getResourceCount(),
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
	 * currently presented, which is an ordinary state during reconciliation rather than an error.
	 */
	spawnedDynamicEntityOrigin(
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

	/** Return installed environment-cell bounds for frontend-owned interior placement policy. */
	queryEnvCellBounds(residency: SceneResidency): AABB3 | null {
		return residency.envCellId === null
			? null
			: this.#scene.queryEnvCellBounds(residency.envCellId);
	}

	tick(): void {
		if (this.#destroyed) return;
		this.#drainCommitArtifacts();
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
		const ambientRefreshed = this.#refreshAmbient(timeSeconds);
		const updateAudioControl = this.#audioControlCadence.shouldUpdate(
			timeSeconds,
			ambientRefreshed,
		);
		if (updateAudioControl) this.#ambient.updateLiveWeights();
		this.#ambient.advance(timeSeconds);
		// After ambience so a voice admitted on this control tick is placed against the same pose.
		if (updateAudioControl) this.#audio.updatePlacements();
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
			outdoorLights: this.#outdoorLights,
			timeSeconds,
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
		const spawned = new Set(this.#spawnedDesiredEntities.keys());
		for (const guid of spawned) this.#removeSpawnedDynamicTree(guid, spawned);
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
		if (isOutdoorStaticLayer(artifact.layer) && "source" in artifact.commit) {
			this.#realizeOutdoorStaticLayer(
				ownerId,
				artifact as typeof artifact & {
					readonly layer: OutdoorStaticLayerKind;
					readonly commit: import("../commit/types").StaticObjectLayerSourceCommit;
				},
				revision,
			);
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
		artifact: {
			readonly landblockId: LandblockId;
			readonly layer: OutdoorStaticLayerKind;
			readonly commit: import("../commit/types").StaticObjectLayerSourceCommit;
		},
		revision: SceneInterestRevision,
	): void {
		if (artifact.commit.source.kind !== artifact.layer) {
			throw new Error(
				`Static realization layer ${artifact.layer} does not match source ${artifact.commit.source.kind}.`,
			);
		}
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
		landblockId: LandblockId,
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
		landblockId: LandblockId,
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
		this.#authoredDynamicResidents.delete(ownerId);
		this.#staticObjectLayerDiagnostics.delete(ownerId);
		this.#envCellLayerDiagnostics.delete(ownerId);
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
		for (const listener of this.#sceneAvailabilityListeners) listener(event);
	}

	#trackRealizationContinuation(continuation: Promise<void>): void {
		this.#realizationContinuations.add(continuation);
		void continuation.finally(() => {
			this.#realizationContinuations.delete(continuation);
		});
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

/** Parse an outdoor static publisher owner, failing loudly if a non-outdoor layer reached it. */
function parseOutdoorLayerOwner(owner: OwnerId): {
	readonly landblockId: LandblockId;
	readonly layer: OutdoorStaticLayerKind;
} {
	const parsed = parseLandblockLayerOwnerId(owner);
	if (!isOutdoorStaticLayer(parsed.layer)) {
		throw new Error(`Outdoor static publisher received ${parsed.layer}.`);
	}
	return { landblockId: parsed.landblockId, layer: parsed.layer };
}

function createLandblockPlacement(landblockId: LandblockId): ScenePlacement {
	return {
		envCellId: null,
		landblockId,
		localTransform: Mat4.identity(),
	};
}
