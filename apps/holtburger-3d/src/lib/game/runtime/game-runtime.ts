import type { AssetBridge } from "../../assets/asset-bridge";
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
import type { Renderer } from "../renderer/renderer";
import { RenderWorld } from "../renderer/render-world";
import type { RendererResourceManager } from "../renderer/resource-manager";
import { SceneGraph, type ScenePlacement } from "../scene";
import {
	WorkerTerrainGenerator,
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
	validateLoDConfigOrThrow,
} from "./scene-interest";
import type { Camera, LoDConfig } from "./types";

const DEFAULT_LOD_CONFIG: LoDConfig = {
	landblockRadius: 4,
	buildingRadius: 3,
	explicitObjectRadius: 1,
	generatedObjectRadius: 1,
	envCellRadius: 1,
};

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
	readonly #commitArtifacts: CommitBundle[] = [];
	/** Current primary-view input used for visibility and rendering. */
	#camera: Camera = DEFAULT_CAMERA;
	/** Current static-layer interest policy. */
	#lodConfig: LoDConfig = DEFAULT_LOD_CONFIG;
	/** Landblock defining both static interest and the anchor-relative render world. */
	#worldAnchor: LandblockId = INVALID_ID;
	/** Static layers currently requested or retained around the world anchor. */
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
		hostAssets: AssetBridge,
	): Promise<GameRuntime> {
		const [terrainGenerator, texturePreparer] = await Promise.all([
			WorkerTerrainGenerator.build(),
			WorkerTexturePreparer.build(hostAssets),
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

	get lodConfig(): LoDConfig {
		return { ...this.#lodConfig };
	}

	setLoDConfig(cfg: LoDConfig): void {
		validateLoDConfigOrThrow(cfg);
		this.#lodConfig = { ...cfg };
		this.#updateWorldInterest(this.#worldAnchor);
	}

	setWorldAnchor(landblockId: LandblockId): void {
		if (this.#worldAnchor === landblockId) return;
		this.#worldAnchor = landblockId;
		this.#updateWorldInterest(landblockId);
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
		const renderer = this.#renderer;
		if (!renderer) throw new Error("Game runtime has no renderer device.");
		renderer.drawFrame({
			anchorLandblockId: this.#worldAnchor,
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

	#updateWorldInterest(newAnchor: LandblockId): void {
		if (this.#destroyed) return;
		const interest = computeSceneInterest(newAnchor, this.#lodConfig);
		const { newLayers, evictedLayers } = diffSceneInterest(
			this.#sceneInterest,
			interest,
		);
		this.#sceneInterest = interest;
		for (const { id, layer } of evictedLayers)
			this.#evictStaticLayer(id, layer);
		void this.#prepareInterestedLayers(newLayers);
	}

	async #prepareInterestedLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<void> {
		try {
			const artifacts =
				await this.#commitPipeline.prepareLandblockLayers(layers);
			if (!this.#destroyed) this.#commitArtifacts.push(...artifacts);
		} catch (error) {
			log(error, LogLevel.Error);
		}
	}

	#drainCommitArtifacts(): void {
		while (this.#commitArtifacts.length > 0) {
			const artifact = this.#commitArtifacts.shift();
			if (!artifact) continue;
			if (
				artifact.kind === CommitBundleSourceKind.LandblockLayer &&
				!this.#isInActiveSceneInterest(artifact.landblockId, artifact.layer)
			) {
				continue;
			}
			if (artifact.kind === CommitBundleSourceKind.LandblockLayer) {
				this.#commitLandblockLayer(artifact);
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
	): void {
		const ownerId = landblockLayerToOwnerId(
			artifact.landblockId,
			artifact.layer,
		);
		if (artifact.layer === LandblockLayerKind.Terrain) {
			this.#installTerrainLayer(ownerId, artifact);
			return;
		}
		if (artifact.layer === LandblockLayerKind.EnvCells) {
			this.#envCells.install(ownerId, artifact.commit.environment);
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
}

function createLandblockPlacement(landblockId: LandblockId): ScenePlacement {
	return {
		envCellId: null,
		landblockId,
		localTransform: Mat4.identity(),
	};
}
