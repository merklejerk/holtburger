import type { AssetBridge } from "../../assets/asset-bridge";
import { log, LogLevel } from "../../logs";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
	type DynamicEntityCommit,
} from "../commit/types";
import { INVALID_ID, type EnvCellId, type LandblockId } from "../game-types";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import { LeaseRegistry } from "../ownership";
import type {
	FrameInput,
	Renderer,
	TerrainFrameInput,
} from "../renderer/renderer";
import { RenderResourceRegistry } from "../renderer/render-resources";
import {
	RenderScene,
	type ObjectFrameOccurrence,
} from "../renderer/render-scene";
import type { TerrainTextureBindings } from "../renderer/terrain-program-input";
import type { RendererResourceManager } from "../renderer/resource-manager";
import {
	SceneGraph,
	type SceneNodeId,
	type ScenePlacement,
	type VisibleScene,
} from "../scene";
import {
	WorkerTerrainGenerator,
	type TerrainGenerator,
} from "../terrain/terrain-generator";
import { TerrainService } from "../terrain/terrain-service";
import { type ResolvedTerrainTextureFacts } from "../terrain/types";
import { TextureManager } from "../textures/texture-manager";
import {
	WorkerTexturePreparer,
	type TexturePreparer,
} from "../textures/texture-preparer";
import type { TextureKey } from "../textures/types";
import {
	commitBundleOwnerId,
	landblockLayerToOwnerId,
	spawnedEntityToOwnerId,
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

/** Bridges source commits, scene topology, runtime residency, and renderer frame assembly. */
export class GameRuntime {
	/** Canonical scene topology, residency, transforms, and spatial-query membership. */
	readonly #scene = new SceneGraph();
	/** Persistent logical object resources, independent of scene-node occurrences. */
	readonly #renderResourceRegistry = new RenderResourceRegistry();
	/** Renderer occurrences attached to canonical scene nodes. */
	readonly #renderScene = new RenderScene(this.#renderResourceRegistry);
	/** Runtime layer/spawn ownership of scene-root lifetimes. */
	readonly #sceneNodeLeases = new LeaseRegistry<OwnerId, SceneNodeId>();
	/** Logical texture preparation, device bindings, and shared owner retention. */
	readonly #textures: TextureManager<OwnerId>;
	/** Dynamic terrain sources, generation state, and realized terrain resources. */
	readonly #terrain: TerrainService;
	/** Runtime-owned terrain-generation worker terminated during runtime shutdown. */
	readonly #terrainGenerator: TerrainGenerator;
	/** Backend that consumes assembled frame input. */
	readonly #renderer: Renderer;
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
		renderer: Renderer,
		commitPipeline: CommitPipeline,
		dependencies: GameRuntimeDependencies,
	) {
		this.#renderer = renderer;
		this.#commitPipeline = commitPipeline;
		this.#terrainGenerator = dependencies.terrainGenerator;
		this.#textures = new TextureManager<OwnerId>(
			renderResources,
			dependencies.texturePreparer,
		);
		this.#terrain = new TerrainService(
			dependencies.terrainGenerator,
			renderResources,
		);
	}

	/** Construct production runtime workers and inject them into runtime-owned systems. */
	static async build(
		renderResources: RendererResourceManager,
		renderer: Renderer,
		commitPipeline: CommitPipeline,
		hostAssets: AssetBridge,
	): Promise<GameRuntime> {
		const [terrainGenerator, texturePreparer] = await Promise.all([
			WorkerTerrainGenerator.build(),
			WorkerTexturePreparer.build(hostAssets),
		]);
		return new GameRuntime(renderResources, renderer, commitPipeline, {
			terrainGenerator,
			texturePreparer,
		});
	}

	/** Construct runtime from explicit ports for focused integration tests. */
	static buildForTesting(
		renderResources: RendererResourceManager,
		renderer: Renderer,
		commitPipeline: CommitPipeline,
		dependencies: GameRuntimeDependencies,
	): GameRuntime {
		return new GameRuntime(
			renderResources,
			renderer,
			commitPipeline,
			dependencies,
		);
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
	}

	updateFrame(): void {
		if (this.#destroyed) return;
		const visibleScene = this.#scene.updateVisibility(this.#camera);
		this.#renderer.drawFrame(this.#createFrameInput(visibleScene));
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
		await this.#terrain.destroy();
		await this.#terrainGenerator.destroy();

		for (const ownerId of [...this.#sceneNodeLeases.iterOwners()]) {
			this.#sceneNodeLeases.dropOwner(ownerId);
		}
		this.#releaseUnownedSceneNodes();
		await this.#textures.destroy();
	}

	#createFrameInput(visibleScene: VisibleScene): FrameInput {
		const visibleRenderOccurrences =
			this.#renderScene.resolveVisibleOccurrences(
				visibleScene.nodeIds,
				(nodeId) => this.#scene.resolvePlacement(nodeId),
			);
		const objects: ObjectFrameOccurrence[] = [];
		const terrain: TerrainFrameInput[] = [];
		for (const occurrence of visibleRenderOccurrences) {
			if (occurrence.kind === "object") {
				objects.push(occurrence);
				continue;
			}
			const resources = this.#terrain.getDrawResources(
				occurrence.placement.landblockId,
				this.#worldAnchor,
			);
			if (!resources || !this.#hasTerrainTextures(resources.textures)) continue;
			terrain.push({
				placement: occurrence.placement,
				resources,
				program: {
					composition: resources.composition,
					surfaceField: resources.surfaceField,
					textures: this.#resolveTerrainTextureBindings(resources.textures),
				},
			});
		}
		return {
			anchorLandblockId: this.#worldAnchor,
			timeSeconds: performance.now() / 1_000,
			views: [
				{
					camera: this.#camera,
					scene: { objects },
					terrain,
				},
			],
		};
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
			const ownerId = commitBundleOwnerId(artifact);
			this.#installCommitTexturePages(ownerId, artifact);
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
		this.#releaseSceneOwner(ownerId);
		this.#materializeLayerNodes(ownerId, artifact);
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
		void this.#textures.retain(
			ownerId,
			Object.values(artifact.commit.presentation.textures),
		);
		this.#terrain.installSource({
			generation: artifact.commit.generation,
			landblockId: artifact.landblockId,
			presentation: artifact.commit.presentation,
		});
		if (!this.#sceneNodeLeases.hasOwner(ownerId)) {
			const nodeId = this.#createOwnedRoot(
				ownerId,
				createLandblockPlacement(artifact.landblockId),
				TERRAIN_ROOT_BOUNDS,
			);
			this.#renderScene.createInstance({ kind: "terrain", nodeId });
		}
	}

	#commitSpawnedEntity(
		artifact: Extract<CommitBundle, { kind: CommitBundleSourceKind.Spawned }>,
	): void {
		const ownerId = spawnedEntityToOwnerId(artifact.id);
		this.#releaseSceneOwner(ownerId);
		this.#createOwnedRoot(ownerId, artifact.placement, null);
	}

	#materializeLayerNodes(
		ownerId: OwnerId,
		artifact: Extract<
			CommitBundle,
			{ kind: CommitBundleSourceKind.LandblockLayer }
		>,
	): void {
		if (artifact.layer === LandblockLayerKind.EnvCells) {
			for (const cell of artifact.commit.cells) {
				this.#createOwnedRoot(
					ownerId,
					createEnvCellPlacement(artifact.landblockId, cell.id),
					cell.bounds,
				);
			}
		} else {
			this.#createOwnedRoot(
				ownerId,
				createLandblockPlacement(artifact.landblockId),
				null,
			);
		}

		for (const dynamic of artifact.dynamicEntities) {
			this.#materializeDynamicRoot(ownerId, artifact.landblockId, dynamic);
		}
	}

	#materializeDynamicRoot(
		ownerId: OwnerId,
		landblockId: LandblockId,
		dynamic: DynamicEntityCommit,
	): void {
		if (dynamic.placement.landblockId !== landblockId) {
			throw new Error(
				`Dynamic placement belongs to ${dynamic.placement.landblockId}, expected ${landblockId}.`,
			);
		}
		void dynamic.presentation;
		void dynamic.appearance;
		this.#createOwnedRoot(ownerId, dynamic.placement, null);
	}

	#createOwnedRoot(
		ownerId: OwnerId,
		placement: ScenePlacement,
		localBounds: AABB3 | null,
	): SceneNodeId {
		const nodeId = this.#scene.createNode({
			localBounds,
			parentId: null,
			...placement,
		});
		this.#sceneNodeLeases.addLease(ownerId, nodeId);
		return nodeId;
	}

	#releaseSceneOwner(ownerId: OwnerId): void {
		this.#sceneNodeLeases.dropOwner(ownerId);
		this.#releaseUnownedSceneNodes();
	}

	#releaseUnownedSceneNodes(): void {
		const releasedNodeIds = this.#sceneNodeLeases.takeEmptyLeases();
		this.#renderScene.removeNodes(releasedNodeIds);
		for (const nodeId of releasedNodeIds) {
			this.#scene.destroyNode(nodeId);
		}
	}

	#installCommitTexturePages(ownerId: OwnerId, artifact: CommitBundle): void {
		for (const page of artifact.texturePages) {
			this.#textures.installAtlasPage(ownerId, page.pageId, page);
		}
	}

	#hasTerrainTextures(textures: {
		readonly colors: TextureKey;
		readonly blendMasks: TextureKey;
		readonly roadMasks: TextureKey;
		readonly detail: TextureKey;
	}): boolean {
		return Object.values(textures).every((key) =>
			this.#textures.hasTexture(key),
		);
	}

	#resolveTerrainTextureBindings(textures: {
		readonly colors: ResolvedTerrainTextureFacts["colors"]["key"];
		readonly blendMasks: ResolvedTerrainTextureFacts["blendMasks"]["key"];
		readonly roadMasks: ResolvedTerrainTextureFacts["roadMasks"]["key"];
		readonly detail: ResolvedTerrainTextureFacts["detail"]["key"];
	}): TerrainTextureBindings {
		return {
			blendMasks: this.#textures.getTextureArrayBinding(textures.blendMasks),
			colors: this.#textures.getTextureArrayBinding(textures.colors),
			detail: this.#textures.getStandaloneTextureBinding(textures.detail),
			roadMasks: this.#textures.getTextureArrayBinding(textures.roadMasks),
		};
	}

	#isInActiveSceneInterest(
		landblockId: LandblockId,
		layer: LandblockLayerKind,
	): boolean {
		return this.#sceneInterest.get(landblockId)?.has(layer) ?? false;
	}

	#evictStaticLayer(landblockId: LandblockId, layer: LandblockLayerKind): void {
		const ownerId = landblockLayerToOwnerId(landblockId, layer);
		this.#releaseSceneOwner(ownerId);
		this.#textures.dropOwner(ownerId);
		if (layer === LandblockLayerKind.Terrain) {
			this.#terrain.removeSource(landblockId);
		}
	}
}

function createLandblockPlacement(landblockId: LandblockId): ScenePlacement {
	return {
		envCellId: null,
		landblockId,
		localTransform: Mat4.identity(),
	};
}

function createEnvCellPlacement(
	landblockId: LandblockId,
	envCellId: EnvCellId,
): ScenePlacement {
	return {
		envCellId,
		landblockId,
		localTransform: Mat4.identity(),
	};
}
