import { log, LogLevel } from "../../logs";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
	type DynamicEntityCommit,
} from "../commit/types";
import { INVALID_ID, type EnvCellId, type LandblockId } from "../game-types";
import { Mat4, Quat, Vec3, type AABB3 } from "../math/types";
import type { FrameInput, Renderer } from "../renderer/renderer";
import {
	RenderResourceRegistry,
	type TerrainRenderDrawUnit,
	type TerrainRenderResourceId,
} from "../renderer/render-resources";
import { RenderScene } from "../renderer/render-scene";
import type {
	RendererResourceManager,
	RenderResourceKey,
} from "../renderer/resource-manager";
import {
	SceneGraph,
	type SceneNodeId,
	type ScenePlacement,
	type VisibleScene,
} from "../scene";
import {
	TerrainService,
	type TerrainSceneChange,
} from "../terrain/terrain-service";
import { AtlasManager } from "../textures/atlas-manager";
import type { TextureKey } from "../textures/types";
import { LeaseRegistry } from "./ownership";
import {
	diffSceneInterest,
	LandblockLayerKind,
	type SceneInterestMap,
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

function validateLoDConfigOrThrow(cfg: LoDConfig): void {
	const { landblockRadius } = cfg;
	if (
		landblockRadius <= 0 ||
		cfg.buildingRadius > landblockRadius ||
		cfg.explicitObjectRadius > landblockRadius ||
		cfg.generatedObjectRadius > landblockRadius ||
		cfg.envCellRadius > landblockRadius
	) {
		throw new Error("Invalid scene config.");
	}
}

enum OwnerVariant {
	LandblockLayer = "landblock-layer",
	Spawned = "spawned",
}

export function landblockLayerToOwnerId(
	landblockId: LandblockId,
	layer: LandblockLayerKind,
): OwnerId {
	return `${OwnerVariant.LandblockLayer}:${landblockId}/${layer}`;
}

function spawnedEntityToOwnerId(entityId: string): OwnerId {
	return `${OwnerVariant.Spawned}:${entityId}`;
}

type OwnerId =
	| `${OwnerVariant.LandblockLayer}:${LandblockId}/${LandblockLayerKind}`
	| `${OwnerVariant.Spawned}:${string}`;

export class GameRuntime {
	readonly #scene: SceneGraph = new SceneGraph();
	readonly #renderResourceRegistry = new RenderResourceRegistry();
	readonly #renderScene = new RenderScene(this.#renderResourceRegistry);
	readonly #textureLeases = new LeaseRegistry<OwnerId, TextureKey>();
	readonly #rendererLeases = new LeaseRegistry<OwnerId, RenderResourceKey>();
	readonly #sceneNodeLeases = new LeaseRegistry<OwnerId, SceneNodeId>();
	readonly #atlases: AtlasManager;
	/** Domain identity lookup for independently spawned dynamic roots. */
	readonly #dynamicNodeIdsByEntity = new Map<string, SceneNodeId>();
	/** Stable scene and render identities carrying generated terrain meshes. */
	readonly #terrainRenderRecords = new Map<
		LandblockId,
		{
			readonly nodeId: SceneNodeId;
			readonly resourceId: TerrainRenderResourceId;
		}
	>();
	readonly #terrain: TerrainService = new TerrainService();
	readonly #renderResources: RendererResourceManager;
	readonly #renderer: Renderer;
	readonly #commitPipeline: CommitPipeline;
	#camera: Camera = DEFAULT_CAMERA;
	#lodConfig: LoDConfig = DEFAULT_LOD_CONFIG;
	#worldAnchor: LandblockId = INVALID_ID;
	#commitArtifacts: CommitBundle[] = [];
	#sceneInterest: SceneInterestMap = new Map();

	protected constructor(
		renderResources: RendererResourceManager,
		renderer: Renderer,
		commitPipeline: CommitPipeline,
	) {
		this.#renderResources = renderResources;
		this.#renderer = renderer;
		this.#commitPipeline = commitPipeline;
		this.#atlases = new AtlasManager(renderResources);
	}

	static build(
		renderResources: RendererResourceManager,
		renderer: Renderer,
		commitPipeline: CommitPipeline,
	): GameRuntime {
		return new GameRuntime(renderResources, renderer, commitPipeline);
	}

	get lodConfig(): LoDConfig {
		return Object.assign({}, this.#lodConfig);
	}

	setLoDConfig(cfg: LoDConfig): void {
		validateLoDConfigOrThrow(cfg);
		Object.assign(this.#lodConfig, cfg);
		this.#updateWorldInterest(this.#worldAnchor);
		// ...
	}

	setWorldAnchor(landblockId: LandblockId) {
		if (this.#worldAnchor === landblockId) return;
		this.#updateWorldInterest(landblockId);
		this.#worldAnchor = landblockId;
	}

	tick(): void {
		// Reserved for simulation stepping and deterministic state updates.
		// Keep no-op for now while frame rendering is the only active path.
		// TODO: drain commit artifacts.
		this.#drainCommitArtifacts();
		this.#updateTerrainResidency();
	}

	updateFrame(): void {
		const visibleScene = this.#scene.updateVisibility(this.#camera);
		this.#renderer.drawFrame(this.#createFrameInput(visibleScene));
	}

	updateDynamicEntityPlacement(
		entityId: string,
		placement: ScenePlacement,
	): boolean {
		const nodeId = this.#dynamicNodeIdsByEntity.get(entityId);
		if (!nodeId) return false;
		this.#scene.updateRootPlacement(nodeId, placement);
		return true;
	}

	async destroy() {}

	#createFrameInput(visibleScene: VisibleScene): FrameInput {
		return {
			anchorLandblockId: this.#worldAnchor,
			timeSeconds: performance.now() / 1_000,
			views: [
				{
					kind: "primary",
					camera: this.#camera,
					scene: this.#renderScene.resolveView(visibleScene.nodeIds, (nodeId) =>
						this.#scene.resolvePlacement(nodeId),
					),
				},
			],
		};
	}

	#updateWorldInterest(newAnchor: LandblockId) {
		const interest = computeNewWorldInterest(newAnchor, this.#lodConfig);
		const { newLayers, evictedLayers } = diffSceneInterest(
			this.#sceneInterest,
			interest,
		);
		this.#sceneInterest = interest;
		for (const { id, layer } of evictedLayers) {
			this.#evictStaticLayer(id, layer);
		}
		(async () => {
			try {
				this.#commitArtifacts.push(
					...(await this.#commitPipeline.prepareLandblockLayers(newLayers)),
				);
			} catch (err) {
				log(err, LogLevel.Error);
			}
		})();
	}

	#drainCommitArtifacts() {
		while (this.#commitArtifacts.length > 0) {
			const artifact = this.#commitArtifacts.shift()!;
			// Drop if no longer in scene interest.
			if (artifact.kind === CommitBundleSourceKind.LandblockLayer) {
				if (
					!this.#isInActiveSceneInterest(artifact.landblockId, artifact.layer)
				) {
					continue;
				}
			}
			for (const page of artifact.atlasPages) {
				this.#atlases.upsertPage(page.pageId, {
					format: page.format,
					pageBits: page.pageBits,
					purpose: page.purpose,
					width: page.width,
					height: page.height,
					textures: page.textures,
				});
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
			this.#terrain.installSource(artifact.landblockId, artifact.commit);
			return;
		}

		this.#releaseSceneOwner(ownerId);
		this.#materializeLayerNodes(ownerId, artifact);
	}

	#commitSpawnedEntity(
		artifact: Extract<CommitBundle, { kind: CommitBundleSourceKind.Spawned }>,
	): void {
		const ownerId = spawnedEntityToOwnerId(artifact.id);
		this.#releaseSceneOwner(ownerId);
		const nodeId = this.#createOwnedRoot(ownerId, artifact.placement, null);
		this.#dynamicNodeIdsByEntity.set(artifact.id, nodeId);
	}

	#updateTerrainResidency(): void {
		this.#terrain.updateResidency({
			camera: this.#camera,
			landblockRadius: this.#lodConfig.landblockRadius,
		});
		this.#applyTerrainSceneChanges(this.#terrain.drainSceneChanges());
	}

	#applyTerrainSceneChanges(changes: readonly TerrainSceneChange[]): void {
		for (const change of changes) {
			const landblockId =
				change.kind === "upsert-landblock-mesh"
					? change.mesh.landblockId
					: change.landblockId;
			const ownerId = landblockLayerToOwnerId(
				landblockId,
				LandblockLayerKind.Terrain,
			);

			if (change.kind === "upsert-landblock-mesh") {
				let record = this.#terrainRenderRecords.get(landblockId);
				if (record === undefined) {
					const nodeId = this.#createOwnedRoot(
						ownerId,
						createLandblockPlacement(landblockId),
						change.mesh.bounds,
					);
					const geometryKey = this.#renderResources.createGeometry(
						change.mesh.geometry,
					);
					const resourceId = this.#renderResourceRegistry.createTerrainResource(
						geometryKey,
						createTerrainDrawUnits(change.mesh),
					);
					this.#renderScene.createTerrainInstance(nodeId, resourceId);
					this.#rendererLeases.addLease(ownerId, geometryKey);
					record = { nodeId, resourceId };
					this.#terrainRenderRecords.set(landblockId, record);
				} else {
					this.#scene.updateBounds(record.nodeId, change.mesh.bounds);
					const resource = this.#renderResourceRegistry.getTerrainResource(
						record.resourceId,
					);
					this.#renderResources.replaceGeometry(
						resource.geometryKey,
						change.mesh.geometry,
					);
					this.#renderResourceRegistry.replaceTerrainResource(
						record.resourceId,
						createTerrainDrawUnits(change.mesh),
					);
				}
			} else {
				this.#releaseSceneOwner(ownerId);
				this.#removeTerrainRenderRecord(landblockId);
				this.#rendererLeases.dropOwner(ownerId);
				this.#releaseUnownedRendererResources();
			}
		}
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
			// The current commits contain one baked render payload per non-env-cell layer.
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
		// Renderer materialization will consume the presentation and appearance.
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
		const releasedNodeIds = this.#sceneNodeLeases.takeEmptyLeases();
		this.#renderScene.removeNodes(releasedNodeIds);
		for (const nodeId of releasedNodeIds) {
			this.#scene.destroyNode(nodeId);
		}
	}

	#removeTerrainRenderRecord(landblockId: LandblockId): void {
		const record = this.#terrainRenderRecords.get(landblockId);
		if (!record) return;
		this.#renderResourceRegistry.removeTerrainResource(record.resourceId);
		this.#terrainRenderRecords.delete(landblockId);
	}

	#releaseUnownedRendererResources(): void {
		for (const resource of this.#rendererLeases.takeEmptyLeases()) {
			this.#renderResources.releaseResource(resource);
		}
	}

	#isInActiveSceneInterest(
		landblockId: LandblockId,
		layer: LandblockLayerKind,
	): boolean {
		return this.#sceneInterest.get(landblockId)?.has(layer) ?? false;
	}

	#evictStaticLayer(landblockId: LandblockId, layer: LandblockLayerKind) {
		const ownerId = landblockLayerToOwnerId(landblockId, layer);
		this.#releaseSceneOwner(ownerId);
		this.#textureLeases.dropOwner(ownerId);
		for (const textureKey of this.#textureLeases.takeEmptyLeases()) {
			this.#atlases.releaseTexture(textureKey);
		}
		if (layer === LandblockLayerKind.Terrain) {
			this.#removeTerrainRenderRecord(landblockId);
		}
		this.#rendererLeases.dropOwner(ownerId);
		this.#releaseUnownedRendererResources();
		if (layer === LandblockLayerKind.Terrain) {
			this.#terrain.removeSource(landblockId);
		}
	}
}

type TerrainMesh = Extract<
	TerrainSceneChange,
	{ kind: "upsert-landblock-mesh" }
>["mesh"];

function createTerrainDrawUnits(
	mesh: TerrainMesh,
): readonly TerrainRenderDrawUnit[] {
	return mesh.patches.map((patch) => ({
		indexCount: patch.indexCount,
		indexStart: patch.indexStart,
		material: {
			colorTexture: patch.colorTexture,
			detailTexture: patch.detailTexture,
			roadMaskTexture: patch.roadMaskTexture,
		},
	}));
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
