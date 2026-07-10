import { log, LogLevel } from "../../logs";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
} from "../commit/types";
import { INVALID_ID, type LandblockId } from "../game-types";
import { Quat, Vec3 } from "../math/types";
import type {
	FramePlan,
	Renderer,
	RenderResourceKey,
} from "../renderer/renderer";
import {
	landblockLayerToSceneBundleKey,
	sceneEntityKey,
	SceneGraph,
	spawnedSceneBundleKey,
	type SceneBundleKey,
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
	position: Vec3.zero(),
	rotation: Quat.identity(),
	near: 0.5,
	far: 800,
	fov: 90,
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

type OwnerId =
	| `${OwnerVariant.LandblockLayer}:${LandblockId}/${LandblockLayerKind}`
	| `${OwnerVariant.Spawned}:${string}`;

export class GameRuntime {
	readonly #scene: SceneGraph = new SceneGraph();
	readonly #textureLeases = new LeaseRegistry<OwnerId, TextureKey>();
	readonly #sceneLeases = new LeaseRegistry<OwnerId, SceneBundleKey>();
	readonly #rendererLeases = new LeaseRegistry<OwnerId, RenderResourceKey>();
	readonly #atlases: AtlasManager = new AtlasManager();
	readonly #terrain: TerrainService = new TerrainService();
	readonly #renderer: Renderer;
	readonly #commitPipeline: CommitPipeline;
	#camera: Camera = DEFAULT_CAMERA;
	#lodConfig: LoDConfig = DEFAULT_LOD_CONFIG;
	#worldAnchor: LandblockId = INVALID_ID;
	#commitArtifacts: CommitBundle[] = [];
	#sceneInterest: SceneInterestMap = new Map();

	protected constructor(renderer: Renderer, commitPipeline: CommitPipeline) {
		this.#renderer = renderer;
		this.#commitPipeline = commitPipeline;
	}

	static build(
		renderer: Renderer,
		commitPipeline: CommitPipeline,
	): GameRuntime {
		return new GameRuntime(renderer, commitPipeline);
	}

	get lodConfig(): LoDConfig {
		return Object.assign({}, this.lodConfig);
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
		this.#renderer.drawFrame(this.#planFrame(visibleScene));
	}

	destroy(): void {
		this.#renderer.destroy();
	}

	#planFrame(visibleScene: VisibleScene): FramePlan {
		void visibleScene;
		return {};
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
					purpose: page.purpose,
					width: page.width,
					height: page.height,
					textures: new Set(page.textures),
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
		const bundleKey = landblockLayerToSceneBundleKey(
			artifact.landblockId,
			artifact.layer,
		);

		if (artifact.layer === LandblockLayerKind.Terrain) {
			this.#terrain.installSource(artifact.landblockId, artifact.commit);
			this.#scene.createTerrainBundle(bundleKey);
			return;
		}

		this.#scene.createStaticBundle(bundleKey);
		// Static-authored dynamic entities will be added under this bundle key.
	}

	#commitSpawnedEntity(
		artifact: Extract<CommitBundle, { kind: CommitBundleSourceKind.Spawned }>,
	): void {
		const bundleKey = spawnedSceneBundleKey(artifact.id);
		this.#scene.createDynamicBundle(bundleKey);
		this.#scene.createDynamicEntity(
			bundleKey,
			sceneEntityKey(`spawned/${artifact.id}`),
			"runtime-spawned",
		);
	}

	#updateTerrainResidency(): void {
		this.#terrain.updateResidency({
			camera: this.#camera,
			config: {
				landblockRadius: this.#lodConfig.landblockRadius,
			},
		});
		this.#applyTerrainSceneChanges(this.#terrain.drainSceneChanges());
	}

	#applyTerrainSceneChanges(changes: readonly TerrainSceneChange[]): void {
		for (const change of changes) {
			const landblockId =
				change.kind === "upsert-landblock-mesh"
					? change.mesh.landblockId
					: change.landblockId;
			const entityKey = sceneEntityKey(`terrain/${landblockId}`);
			const bundleKey = landblockLayerToSceneBundleKey(
				landblockId,
				LandblockLayerKind.Terrain,
			);

			if (change.kind === "upsert-landblock-mesh") {
				void change.mesh;
				this.#scene.upsertTerrainEntity(bundleKey, entityKey);
			} else {
				this.#scene.destroyEntity(entityKey);
			}
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
		this.#scene.destroyBundle(
			landblockLayerToSceneBundleKey(landblockId, layer),
		);
		this.#sceneLeases.dropOwner(ownerId);
		for (const bundleKey of this.#sceneLeases.takeEmptyLeases()) {
			this.#scene.destroyBundle(bundleKey);
		}
		this.#textureLeases.dropOwner(ownerId);
		for (const textureKey of this.#textureLeases.takeEmptyLeases()) {
			this.#atlases.releaseTexture(textureKey);
		}
		this.#rendererLeases.dropOwner(ownerId);
		for (const resKey of this.#textureLeases.takeEmptyLeases()) {
			this.#renderer.releaseResource(resKey);
		}
		if (layer === LandblockLayerKind.Terrain) {
			this.#terrain.removeSource(landblockId);
		}
	}
}
