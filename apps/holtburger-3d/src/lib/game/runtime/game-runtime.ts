import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import { log, LogLevel } from "../../logs";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
	type DynamicEntityCommit,
} from "../commit/types";
import { INVALID_ID, type LandblockId } from "../game-types";
import { GeometryManager } from "../geometry/geometry-manager";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import {
	DEFAULT_FRAME_SETTINGS,
	type FrameSettings,
	type Renderer,
} from "../renderer/renderer";
import { RenderWorld } from "../renderer/render-world";
import type { RendererResourceManager } from "../renderer/resource-manager";
import { SceneGraph, type ScenePlacement, type SceneResidency } from "../scene";
import {
	InlineTerrainGenerator,
	type TerrainGenerator,
} from "../terrain/terrain-generator";
import { TerrainSystem } from "../terrain/terrain-system";
import { StaticObjectSystem } from "../systems/static-object-system";
import {
	DynamicEntitySystem,
	InlineDynamicVisualPreparer,
} from "../systems/dynamic-entity-system";
import { EnvCellSystem } from "../systems/env-cell-system";
import { AnimationSystem } from "../systems/animation-system";
import { InstanceStreamManager } from "../systems/instance-stream-manager";
import { TextureManager } from "../textures/texture-manager";
import {
	WorkerTexturePreparer,
	type TexturePreparer,
} from "../textures/texture-preparer";
import {
	landblockLayerToOwnerId,
	type ResourceOwnerId,
	spawnedEntityToOwnerId,
	terrainSourceToOwnerId,
	type TerrainResourceOwnerId,
	type OwnerId,
} from "./owner-ids";
import {
	computeSceneInterest,
	diffSceneInterest,
	LandblockLayerKind,
	type LandblockIdLayer,
	type SceneInterestMap,
	type SceneInterestRequest,
	validateLoDConfigOrThrow,
} from "./scene-interest";
import type { Camera } from "./types";
import type {
	SceneAvailabilityEvent,
	SceneAvailabilityListener,
	SceneInterestReceipt,
	SceneInterestRevision,
} from "./scene-availability";
import type { TerrainSurfaceSample } from "../terrain/terrain-surface";
import type { ResolvedSceneEnvironment } from "../environment/scene-environment";
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
	lighting: null,
};

/** Conservative fixed terrain root bound including retail transition lowering. */
const TERRAIN_ROOT_BOUNDS: AABB3 = new AABB3(
	new Vec3(0, -510, -OUTDOOR_LANDBLOCK_WORLD_SIZE),
	new Vec3(OUTDOOR_LANDBLOCK_WORLD_SIZE, 510, 0),
);

/** Runtime-owned collaborators that tests may replace with focused fakes. */
export interface GameRuntimeDependencies {
	readonly terrainGenerator: TerrainGenerator;
	readonly texturePreparer: TexturePreparer;
}

/** Device boundary used by runtime to construct its private renderer facade. */
export interface GameRuntimeRenderDevice {
	readonly resources: RendererResourceManager;
	buildRenderer(world: RenderWorld): Promise<Renderer>;
}

/** One completed static artifact retained with the currently relevant interest revision. */
interface PendingCommitArtifact {
	readonly artifact: CommitBundle;
	readonly revision: SceneInterestRevision;
}

/** Bridges source commits, scene topology, runtime residency, and frontend frame state. */
export class GameRuntime {
	/** Canonical scene topology, residency, transforms, and spatial-query membership. */
	readonly #scene = new SceneGraph();
	/** Logical geometry bindings and shared owner retention. */
	readonly #geometry: GeometryManager<ResourceOwnerId>;
	/** Logical texture preparation, device bindings, and shared owner retention. */
	readonly #textures: TextureManager<ResourceOwnerId>;
	/** Immutable-object nodes, components, and resource publication. */
	readonly #staticObjects: StaticObjectSystem<ResourceOwnerId>;
	readonly #instances: InstanceStreamManager<ResourceOwnerId>;
	/** Dynamic roots, articulated part nodes, and presentation preparation. */
	readonly #dynamics: DynamicEntitySystem<ResourceOwnerId>;
	/** Env-cell scopes, crossings, shell nodes, and portal contributions. */
	readonly #envCells: EnvCellSystem<ResourceOwnerId>;
	/** Rigid-part pose updates sequenced before visibility and drawing. */
	readonly #animation: AnimationSystem<ResourceOwnerId>;
	/** Dynamic terrain sources, generation state, and realized terrain resources. */
	readonly #terrain: TerrainSystem<ResourceOwnerId, TerrainResourceOwnerId>;
	/** Read-only renderer gateway over this runtime's scene and resource systems. */
	readonly #renderWorld: RenderWorld;
	/** Renderer constructed with this runtime's private read-only world facade. */
	#renderer: Renderer | null = null;
	/** Runtime-owned terrain-generation worker terminated during runtime shutdown. */
	readonly #terrainGenerator: TerrainGenerator;
	/** Frontend-owned static commit producer invoked for new scene interest. */
	readonly #commitPipeline: CommitPipeline;
	/** Completed asynchronous commits awaiting the next synchronous runtime tick. */
	readonly #commitArtifacts: PendingCommitArtifact[] = [];
	/** Frontend listeners informed when placement facts become available or fail. */
	readonly #sceneAvailabilityListeners = new Set<SceneAvailabilityListener>();
	/** Current interest revision associated with every retained static layer. */
	readonly #layerInterestRevisions = new Map<string, SceneInterestRevision>();
	#nextSceneInterestRevision = 0;
	/** Current primary-view input used for visibility and rendering. */
	#camera: Camera = DEFAULT_CAMERA;
	/** Frontend-owned static regional presentation state for every render frame. */
	#environment: ResolvedSceneEnvironment = DEFAULT_ENVIRONMENT;
	/** Frontend-selected dynamic display choices forwarded unchanged to each frame. */
	#frameSettings: FrameSettings = DEFAULT_FRAME_SETTINGS;
	/** Terrain interest constraining the frontend's effective distance-fog range. */
	#terrainFogCoverage: TerrainFogCoverage | null = null;
	/** Static layers currently requested or retained independently of the camera. */
	#sceneInterest: SceneInterestMap = new Map();
	/** Prevents new work and late async publication after runtime shutdown begins. */
	#destroyed = false;

	protected constructor(
		renderResources: RendererResourceManager,
		commitPipeline: CommitPipeline,
		dependencies: GameRuntimeDependencies,
	) {
		this.#commitPipeline = commitPipeline;
		this.#terrainGenerator = dependencies.terrainGenerator;
		this.#geometry = new GeometryManager<ResourceOwnerId>(renderResources);
		this.#textures = new TextureManager<ResourceOwnerId>(
			renderResources,
			dependencies.texturePreparer,
		);
		this.#instances = new InstanceStreamManager(renderResources);
		this.#staticObjects = new StaticObjectSystem(
			this.#scene,
			this.#geometry,
			this.#textures,
			this.#instances,
		);
		this.#dynamics = new DynamicEntitySystem(
			this.#scene,
			this.#geometry,
			new InlineDynamicVisualPreparer(),
		);
		this.#envCells = new EnvCellSystem(this.#scene);
		this.#animation = new AnimationSystem(this.#dynamics);
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
			scene: this.#scene,
			staticObjects: this.#staticObjects,
			terrain: this.#terrain,
			textures: this.#textures,
		});
	}

	/** Construct production runtime workers and inject them into runtime-owned systems. */
	static async build(
		device: GameRuntimeRenderDevice,
		commitPipeline: CommitPipeline,
		texturePixelSource: TexturePixelSource,
	): Promise<GameRuntime> {
		const [terrainGenerator, texturePreparer] = await Promise.all([
			InlineTerrainGenerator.build(),
			WorkerTexturePreparer.build(texturePixelSource),
		]);
		const runtime = new GameRuntime(device.resources, commitPipeline, {
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
			anchorLandblockId: request.anchorLandblockId,
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
	}

	/** Replace the frontend-resolved environment without changing scene residency or interest. */
	setSceneEnvironment(environment: ResolvedSceneEnvironment): void {
		this.#environment = environment;
	}

	/** Replace frontend-selected dynamic display choices without altering world data. */
	setFrameSettings(settings: FrameSettings): void {
		this.#frameSettings = settings;
	}

	/** Resolve one canonical scene-space point against resident scene scopes. */
	queryWorldPointResidency(point: Vec3): SceneResidency | null {
		return this.#scene.queryWorldPointResidency(point);
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
		this.#animation.update();
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
		renderer.drawFrame({
			anchorLandblockId: this.#camera.placement.landblockId,
			environment: {
				...this.#environment,
				distanceFog: resolveTerrainCoverageFog(
					this.#environment.distanceFog,
					this.#terrainFogCoverage,
					this.#camera.placement.position,
				),
			},
			frameSettings: this.#frameSettings,
			timeSeconds,
			views: [{ camera: this.#camera }],
		});
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
		this.#commitArtifacts.length = 0;
		await this.#renderer?.destroy();
		this.#renderer = null;
		await this.#dynamics.destroy();
		this.#envCells.destroy();
		await this.#terrain.destroy();
		await this.#terrainGenerator.destroy();

		await this.#textures.destroy();
		this.#geometry.destroy();
		this.#instances.destroy();
	}

	#applySceneInterest(interest: SceneInterestMap): SceneInterestReceipt {
		const revision = this.#createSceneInterestRevision();
		if (this.#destroyed) return { revision };
		const { newLayers, evictedLayers } = diffSceneInterest(
			this.#sceneInterest,
			interest,
		);
		this.#sceneInterest = interest;
		for (const { id, layer } of evictedLayers) {
			this.#layerInterestRevisions.delete(sceneLayerKey(id, layer));
			this.#evictStaticLayer(id, layer);
		}
		for (const [landblockId, layers] of interest) {
			for (const layer of layers)
				this.#layerInterestRevisions.set(
					sceneLayerKey(landblockId, layer),
					revision,
				);
		}
		for (const layer of newLayers) void this.#prepareInterestedLayer(layer);
		return { revision };
	}

	async #prepareInterestedLayer(layer: LandblockIdLayer): Promise<void> {
		try {
			const artifacts = await this.#commitPipeline.prepareLandblockLayers(
				new Set([layer]),
			);
			if (this.#destroyed) return;
			const revision = this.#layerInterestRevisions.get(
				sceneLayerKey(layer.id, layer.layer),
			);
			if (revision === undefined) return;
			if (artifacts.length === 0) {
				this.#publishSceneAvailability({
					kind: "scene-content-failed",
					message: `No ${layer.layer} content is available for ${layer.id}.`,
					residency: { envCellId: null, landblockId: layer.id },
					revision,
				});
				return;
			}
			for (const artifact of artifacts)
				this.#commitArtifacts.push({ artifact, revision });
		} catch (error) {
			log(error, LogLevel.Error);
			const revision = this.#layerInterestRevisions.get(
				sceneLayerKey(layer.id, layer.layer),
			);
			if (revision !== undefined) {
				this.#publishSceneAvailability({
					kind: "scene-content-failed",
					message: error instanceof Error ? error.message : String(error),
					residency: { envCellId: null, landblockId: layer.id },
					revision,
				});
			}
		}
	}

	#drainCommitArtifacts(): void {
		while (this.#commitArtifacts.length > 0) {
			const pending = this.#commitArtifacts.shift();
			if (!pending) continue;
			const { artifact, revision } = pending;
			if (
				artifact.kind === CommitBundleSourceKind.LandblockLayer &&
				!this.#isInActiveSceneInterest(artifact.landblockId, artifact.layer)
			) {
				continue;
			}
			if (artifact.kind === CommitBundleSourceKind.LandblockLayer) {
				this.#commitLandblockLayer(artifact, revision);
			} else {
				this.#commitSpawnedEntity(artifact);
			}
		}
	}

	#commitLandblockLayer(
		artifact: Extract<
			CommitBundle,
			{ kind: CommitBundleSourceKind.LandblockLayer }
		>,
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
			this.#envCells.install(ownerId, artifact.commit.environment);
			for (const { scope } of artifact.commit.environment.scopes) {
				this.#publishSceneAvailability({
					kind: "env-cell-topology-available",
					residency: {
						envCellId: scope.envCellId,
						landblockId: scope.landblockId,
					},
					revision,
				});
			}
		}
		this.#staticObjects.installObjects(ownerId, artifact.commit.staticObjects);
		for (const dynamic of artifact.dynamicEntities) {
			this.#installDynamic(ownerId, artifact.landblockId, dynamic);
		}
	}

	#installTerrainLayer(
		ownerId: OwnerId,
		artifact: Extract<
			CommitBundle,
			{
				kind: CommitBundleSourceKind.LandblockLayer;
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

	#commitSpawnedEntity(
		artifact: Extract<CommitBundle, { kind: CommitBundleSourceKind.Spawned }>,
	): void {
		const ownerId = spawnedEntityToOwnerId(artifact.id);
		this.#installDynamic(
			ownerId,
			artifact.commit.placement.landblockId,
			artifact.commit,
		);
	}

	#installDynamic(
		ownerId: OwnerId,
		landblockId: LandblockId,
		dynamic: DynamicEntityCommit,
	): void {
		if (dynamic.placement.landblockId !== landblockId) {
			throw new Error(
				`Dynamic placement belongs to ${dynamic.placement.landblockId}, expected ${landblockId}.`,
			);
		}
		const nodeId = this.#dynamics.install(ownerId, dynamic);
		const pose = this.#dynamics.getPose(nodeId);
		if (!pose)
			throw new Error(`Installed dynamic ${nodeId} has no initial pose.`);
		this.#animation.install(ownerId, nodeId, pose);
	}

	#isInActiveSceneInterest(
		landblockId: LandblockId,
		layer: LandblockLayerKind,
	): boolean {
		return this.#sceneInterest.get(landblockId)?.has(layer) ?? false;
	}

	#evictStaticLayer(landblockId: LandblockId, layer: LandblockLayerKind): void {
		const ownerId = landblockLayerToOwnerId(landblockId, layer);
		this.#staticObjects.removeOwner(ownerId);
		this.#animation.removeOwner(ownerId);
		this.#dynamics.removeOwner(ownerId);
		this.#envCells.removeOwner(ownerId);
		if (layer === LandblockLayerKind.Terrain) {
			this.#terrain.removeOwner(terrainSourceToOwnerId(landblockId));
		}
		this.#textures.dropOwner(ownerId);
		this.#geometry.dropOwner(ownerId);
	}

	#createSceneInterestRevision(): SceneInterestRevision {
		this.#nextSceneInterestRevision += 1;
		return this.#nextSceneInterestRevision as SceneInterestRevision;
	}

	#publishSceneAvailability(event: SceneAvailabilityEvent): void {
		for (const listener of this.#sceneAvailabilityListeners) listener(event);
	}
}

function sceneLayerKey(
	landblockId: LandblockId,
	layer: LandblockLayerKind,
): string {
	return `${landblockId}/${layer}`;
}

function createLandblockPlacement(landblockId: LandblockId): ScenePlacement {
	return {
		envCellId: null,
		landblockId,
		localTransform: Mat4.identity(),
	};
}
