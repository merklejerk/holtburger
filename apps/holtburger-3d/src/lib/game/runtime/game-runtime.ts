import { getMat4Translation } from "../math/matrices";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type { SkySourcePresentations } from "../../assets/decode-sky-record";
import { animationHookCommand } from "../../assets/decode-animation-record";
import { log, LogLevel } from "../../logs";
import type { CommitPipeline, LandblockLayerCommit } from "../commit/types";
import type {
	EnvCellMaterializationDiagnostics,
	EnvCellMaterializationPlan,
} from "../commit/env-cell-materialization";
import type {
	StaticObjectGeometryDiagnostics,
	StaticObjectLayerDiagnostics,
} from "../commit/artifacts";
import { INVALID_ID, type LandblockId } from "../game-types";
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
import type { RendererResourceManager } from "../renderer/resource-manager";
import {
	SceneGraph,
	type ScenePlacement,
	type SceneNodeId,
	type SceneResidency,
} from "../scene";
import {
	InlineTerrainGenerator,
	type TerrainGenerator,
} from "../terrain/terrain-generator";
import { TerrainSystem } from "../terrain/terrain-system";
import { StaticObjectSystem } from "../systems/static-object-system";
import { DynamicEntitySystem } from "../systems/dynamic-entity-system";
import {
	InlineObjectVisualTemplatePreparer,
	ObjectVisualTemplateRepository,
} from "../systems/object-visual-template-repository";
import { EnvCellSystem } from "../systems/env-cell-system";
import { AnimationSystem } from "../systems/animation-system";
import type { PhysicsScriptSource } from "../../assets/physics-script-source";
import { PhysicsScriptRepository } from "../behavior/physics-script-repository";
import { ParticleEmitterRepository } from "../behavior/particle-emitter-repository";
import { ParticleEmitterRuntime } from "../systems/particle-emitter-runtime";
import type { ParticleEmitterSource } from "../../assets/particle-emitter-source";
import { PhysicsScriptSystem } from "../systems/physics-script-system";
import { AudioSystem, type AudioDevice } from "../systems/audio-system";
import { BehaviorEventRouter } from "../behavior/behavior-event-router";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import { EffectSystem } from "../systems/effect-system";
import { AnimationAssetRepository } from "../animation/animation-asset-repository";
import { StaticInstanceStreamManager } from "../systems/static-instance-stream-manager";
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
} from "./owner-ids";
import type { ActiveRegionStaticDetailBinding } from "../resolution/active-region-static-detail";
import {
	STATIC_DETAIL_ROLES,
	type StaticDetailRole,
} from "../resolution/static-detail-role";
import {
	residentKey,
	type AuthoredDynamicSource,
	type ResolvedOutdoorStaticLayerSource,
	type ResolvedStaticObjectLayerSource,
} from "../resolution/landblock-layer";
import {
	computeSceneInterest,
	isOutdoorStaticLayer,
	LandblockLayerKind,
	type OutdoorStaticLayerKind,
	type StaticLayerKind,
	type SceneInterestMap,
	type SceneInterestRequest,
	validateLoDConfigOrThrow,
} from "./scene-interest";
import {
	EnvCellGeometryPreparer,
	type EnvCellRealizationArtifact,
} from "./env-cell-realization";
import type { Camera } from "./types";
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
		position: Vec3.zero(),
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
		bakedFallbackRangeCount: 0,
		bakedGeometryBytes: 0,
		geometryWorkerDurationMs: 0,
		instancedGeometryBytes: 0,
		staticFragmentBytes: 0,
		staticFragmentCohortCount: 0,
		staticFragmentCount: 0,
		staticFragmentDrawUnitCount: 0,
		staticFragmentInstanceCount: 0,
		sourceMaterialSlotCount: 0,
		sourcePartCount: 0,
		sourceRangeCount: 0,
		sourceResidentCount: 0,
		strategy: "empty",
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
	readonly terrainGenerator: TerrainGenerator;
	readonly texturePreparer: TexturePreparer;
	readonly staticGeometryPreparer: StaticLayerGeometryPreparer<
		ResolvedStaticObjectLayerSource,
		StaticObjectLayerArtifact | null,
		OwnerId
	>;
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
	readonly staticObjectNodeCount: number;
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

/** Bridges source commits, scene topology, runtime residency, and frontend frame state. */
export class GameRuntime {
	/** Canonical scene topology, residency, transforms, and spatial-query membership. */
	readonly #scene = new SceneGraph();
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
	readonly #instances: StaticInstanceStreamManager<ResourceOwnerId>;
	/** Dynamic roots, articulated part nodes, and presentation preparation. */
	readonly #dynamics: DynamicEntitySystem<
		OwnerId,
		DynamicGenerationResourceOwnerId
	>;
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
	readonly #particles: ParticleEmitterRuntime;
	readonly #physicsScriptSystem: PhysicsScriptSystem<OwnerId>;
	readonly #audio: AudioSystem;
	/** Current world origin of one behavior target, or `null` once it leaves the scene. */
	#sceneOriginOf(target: {
		readonly nodeId: SceneNodeId;
	}): [number, number, number] | null {
		const placement = this.#scene.getResolvedPlacement(target.nodeId);
		if (!placement) return null;
		const origin = getMat4Translation(placement.localToLandblock);
		return [origin.x, origin.y, origin.z];
	}

	/** Latest advanced frame time, so a mid-frame installation anchors to the current clock. */
	#lastFrameTimeSeconds = 0;
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
	/** Static-realization continuations awaited before runtime-owned resources are destroyed. */
	readonly #realizationContinuations = new Set<Promise<void>>();
	/** Frontend listeners informed when placement facts become available or fail. */
	readonly #sceneAvailabilityListeners = new Set<SceneAvailabilityListener>();
	/** Current primary-view input used for visibility and rendering. */
	#camera: Camera = DEFAULT_CAMERA;
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
					},
		);
		this.#textures = new TextureManager<ResourceOwnerId>(
			renderResources,
			dependencies.texturePreparer,
			this.#residentAtlas,
		);
		this.#instances = new StaticInstanceStreamManager();
		this.#staticObjects = new StaticObjectSystem<OwnerId, ResourceOwnerId>(
			this.#scene,
			this.#geometry,
			this.#instances,
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
					log(
						{
							cause,
							kind: "static-layer-atlas-failed",
							layer,
							owner,
							revision,
						},
						LogLevel.Error,
					),
			},
			geometry: dependencies.staticGeometryPreparer,
			publisher: {
				evict: async (owner, revision) =>
					this.#staticObjects.evict(owner, revision),
				removeExact: async (owner, revision) =>
					this.#staticObjects.removeExact(owner, revision),
				replace: async ({ geometry, layer, owner, revision }) => {
					if (!isOutdoorStaticLayer(layer)) {
						throw new Error(`Outdoor static publisher received ${layer}.`);
					}
					this.#staticObjects.replaceObjects(owner, revision, geometry, layer);
					// Only the Objects layer emits, but every outdoor layer publishes here: an
					// empty set is how a withdrawn layer clears its own entry.
					this.#outdoorLights.install(
						parseLandblockLayerOwnerId(owner).landblockId,
						layer,
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
					log(
						{
							cause,
							kind: "env-cell-atlas-failed",
							layer,
							owner,
							revision,
						},
						LogLevel.Error,
					),
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
		this.#physicsScripts = new PhysicsScriptRepository(
			dependencies.physicsScriptSource,
		);
		this.#particleEmitters = new ParticleEmitterRepository(
			dependencies.particleEmitterSource,
		);
		this.#particles = new ParticleEmitterRuntime({
			clock: () => this.#lastFrameTimeSeconds,
			// Reads an already-staged definition; an unstaged id returns null rather than starting
			// a load inside the frame.
			resolveEmitter: (emitterInfoId) =>
				this.#particleEmitters.getReady(emitterInfoId),
			originOf: (target) => this.#sceneOriginOf(target),
			roll: Math.random,
		});
		this.#dynamics = new DynamicEntitySystem(
			this.#scene,
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
			dynamicGenerationToResourceOwnerId,
		);
		this.#audio = new AudioSystem(
			dependencies.audioDevice,
			Math.random,
			FRONTEND_TUNING.audio.maximumSimultaneousVoices,
		);
		// The script system both produces and consumes `CallPES`, so the two are mutually dependent
		// by design. A holder breaks the construction cycle without making the router mutable.
		const scriptWiring: { system?: PhysicsScriptSystem<OwnerId> } = {};
		this.#behaviorRouter = new BehaviorEventRouter(
			{
				audio: {
					playSound: (target, sound) => {
						// A sound is placed at its emitting node's world position, resolved once at
						// trigger time exactly as retail samples it.
						const origin = this.#sceneOriginOf(target);
						if (origin === null) return "unprepared";
						const outcome = this.#audio.trigger({
							position: origin,
							probability: sound.probability,
							soundId: sound.soundId,
							volume: sound.volume,
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
		this.#physicsScriptSystem = new PhysicsScriptSystem<OwnerId>(
			this.#behaviorRouter,
			Math.random,
		);
		scriptWiring.system = this.#physicsScriptSystem;
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
			instances: this.#instances,
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
	): Promise<GameRuntime> {
		const [terrainGenerator, texturePreparer] = await Promise.all([
			InlineTerrainGenerator.build(),
			WorkerTexturePreparer.build(texturePixelSource),
		]);
		const runtime = new GameRuntime(device.resources, commitPipeline, {
			animationSource,
			audioDevice,
			particleEmitterSource,
			physicsScriptSource,
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

	/** Replace frontend-owned static content interest without moving the camera. */
	updateSceneInterest(request: SceneInterestRequest): SceneInterestReceipt {
		validateLoDConfigOrThrow(request.lod);
		this.#terrainFogCoverage = {
			terrainRadius: request.lod.terrainRadius,
		};
		return this.#applySceneInterest(
			computeSceneInterest(request.anchorLandblockId, request.lod),
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

	/** Replace the authoritative primary camera without changing scene interest. */
	setPrimaryCamera(camera: Camera): void {
		const { position, rotation } = camera.placement;
		if (
			![position.x, position.y, position.z].every(Number.isFinite) ||
			![rotation.w, rotation.x, rotation.y, rotation.z].every(Number.isFinite)
		) {
			throw new Error("Primary camera placement must be finite.");
		}
		const anchorChanged =
			this.#camera.placement.landblockId !== camera.placement.landblockId;
		this.#camera = {
			far: camera.far,
			fov: camera.fov,
			near: camera.near,
			placement: {
				envCellId: camera.placement.envCellId,
				landblockId: camera.placement.landblockId,
				position: new Vec3(position.x, position.y, position.z),
				rotation: new Quat(rotation.w, rotation.x, rotation.y, rotation.z),
			},
		};
		if (anchorChanged) {
			this.#terrain.updateSceneBoundsForAnchor(camera.placement.landblockId);
		}
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
			dynamics: this.#dynamics.getDiagnostics(),
			behavior: this.#behaviorRouter.getDiagnostics(),
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

	/** Trace a desired endpoint from a caller-supplied authoritative actor anchor. */
	tracePortalSegment(
		query: import("../scene").ScenePortalTraceQuery,
	): import("../scene").ScenePortalTraceResult {
		return this.#scene.tracePortalSegment(query);
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
		this.#lastFrameTimeSeconds = timeSeconds;
		// Retail runs script hooks before this frame's animation hooks for static objects
		// (`animate_static_object`, acclient.c:309368-309409), and statics are this population.
		this.#physicsScriptSystem.advance(timeSeconds);
		this.#particles.advance(timeSeconds, (target) =>
			this.#sceneOriginOf(target),
		);
		const animationFrame = this.#animation.advance(timeSeconds);
		const presentationSelection = this.#animationPresentation.select(
			animationFrame,
			timeSeconds,
		);
		this.#dynamics.publishPresentation(
			this.#animation.sample(
				animationFrame,
				presentationSelection.selectedNodeIds,
			),
		);
		const anchorLandblockId = this.#camera.placement.landblockId;
		const feedback = renderer.drawFrame({
			anchorLandblockId,
			environment: {
				...this.#environment,
				distanceFog: resolveTerrainCoverageFog(
					this.#environment.distanceFog,
					this.#terrainFogCoverage,
				),
			},
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
		this.#animationPresentation.completeFrame(feedback, timeSeconds);
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

	updateDynamicEntityPlacement(
		entityId: string,
		placement: ScenePlacement,
	): boolean {
		void entityId;
		void placement;
		// Dynamic entity ownership is intentionally not materialized yet.
		return false;
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
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
		this.#particleEmitters.destroy();
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
		this.#instances.destroy();
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
					log(error, LogLevel.Error);
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
					log(error, LogLevel.Error);
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
		const installation = this.#dynamics.replaceOwner(ownerId, sources);
		const outcome = await installation.ready;
		if (outcome === "superseded")
			throw new Error("Authored dynamic preparation was superseded.");
		const prepared = installation.getPreparedEntities();
		let animationStage: ReturnType<AnimationSystem<OwnerId>["stageOwner"]>;
		try {
			animationStage = this.#animation.stageOwner(
				ownerId,
				prepared.flatMap(({ animation, nodeId, source }) =>
					animation.kind === "activatable"
						? [
								{
									animation: animation.animation,
									residentIdentity: residentKey(source.identity),
									target: { generation: installation.generation, nodeId },
								},
							]
						: [],
				),
			);
		} catch (cause) {
			installation.release();
			throw cause;
		}
		const diagnostics = prepared.map(
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
				residentId: residentKey(source.identity),
				setupSourceId: source.setupId,
			}),
		);
		let state: "prepared" | "committed" | "released" = "prepared";
		try {
			installation.prepareCommit(animationStage.samples);
		} catch (cause) {
			animationStage.release();
			installation.release();
			throw cause;
		}
		return {
			commit: () => {
				if (state !== "prepared")
					throw new Error(`Cannot commit dynamic companion in state ${state}.`);
				try {
					installation.commit();
					animationStage.commit();
					// Script clocks start only after the generation publishes, so a resident cannot
					// dispatch a command against a node that is not yet in the scene.
					for (const entity of prepared) {
						if (entity.scriptClosure === null) continue;
						this.#physicsScriptSystem.install(
							ownerId,
							{
								generation: installation.generation,
								nodeId: entity.nodeId,
							},
							entity.scriptClosure,
							this.#lastFrameTimeSeconds,
						);
					}
				} catch (cause) {
					animationStage.release();
					installation.release();
					state = "released";
					throw cause;
				}
				state = "committed";
				this.#authoredDynamicResidents.set(ownerId, diagnostics);
				for (const diagnostic of diagnostics) {
					log(
						{ kind: "static-authored-dynamic-active", ...diagnostic },
						LogLevel.Info,
					);
				}
			},
			release: () => {
				if (state !== "prepared") return;
				animationStage.release();
				installation.release();
				state = "released";
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
		this.#animation.removeOwner(ownerId);
		this.#physicsScriptSystem.removeOwner(ownerId);
		// Emitters need no explicit removal: `#dynamics.removeOwner` destroys their nodes, and the
		// particle runtime drops any emitter whose target stops publishing a transform.
		this.#dynamics.removeOwner(ownerId);
		this.#envCells.removeOwner(ownerId);
		if (layer === LandblockLayerKind.Terrain) {
			this.#terrain.removeOwner(terrainSourceToOwnerId(landblockId));
		}
		this.#textures.dropOwner(ownerId);
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

function createLandblockPlacement(landblockId: LandblockId): ScenePlacement {
	return {
		envCellId: null,
		landblockId,
		localTransform: Mat4.identity(),
	};
}
