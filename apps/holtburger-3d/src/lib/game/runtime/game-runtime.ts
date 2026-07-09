import { log, LogLevel } from "../../logs";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
	type StaticLandblockLayerCommitTerrain,
} from "../commit/types";
import { INVALID_ID, type LandblockId } from "../game-types";
import { Quat, Vec3 } from "../math/types";
import type {
	FramePlan,
	Renderer,
	RenderResourceKey,
} from "../renderer/renderer";
import { SceneGraph, type SceneBundleKey } from "../scene";
import { TerrainBuilder } from "../terrain/terrain-builder";
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
	readonly #terrain: TerrainBuilder = new TerrainBuilder();
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
		CommitPipeline: CommitPipeline,
	): GameRuntime {
		return new GameRuntime(renderer, CommitPipeline);
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
		this.#scene.setCamera(this.#camera);
	}

	updateFrame(): void {
		this.#scene.updateVisibility();
		this.#renderer.drawFrame(this.#planFrame());
	}

	destroy(): void {
		this.#renderer.destroy();
	}

	#planFrame(): FramePlan {
		// ...
	}

	#updateWorldInterest(newAnchor: LandblockId) {
		const interest = computeNewWorldInterest(newAnchor, this.#lodConfig);
		const { newLayers, evictedLayers } = diffSceneInterest(
			this.#sceneInterest,
			interest,
		);
		for (const { id, layer } of evictedLayers) {
			this.#evictStaticLayer(id, layer);
		}
		(async () => {
			try {
				this.#commitArtifacts.push(
					await this.#commitPipeline.prepareLandblockLayers(newLayers),
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
				if (artifact.layer === LandblockLayerKind.Terrain) {
					this.#commitTerrainLayer(artifact.landblockId, artifact.commit);
				}
				// TODO: Handle other layers.
			} else {
				// TODO: Handle spawned...
			}
		}
	}

	#isInActiveSceneInterest(
		landblockId: LandblockId,
		layer: LandblockLayerKind,
	): boolean {
		return this.#sceneInterest.get(landblockId)?.has(layer) ?? false;
	}

	#commitTerrainLayer(
		landblockId: LandblockId,
		commit: StaticLandblockLayerCommitTerrain,
	) {
		this.#terrain.upsert(landblockId, commit);
	}

	#evictStaticLayer(landblockId: LandblockId, layer: LandblockLayerKind) {
		const ownerId = landblockLayerToOwnerId(landblockId, layer);
		this.#sceneLeases.dropOwner(ownerId);
		for (const bundleKey of this.#sceneLeases.takeEmptyLeases()) {
			this.#scene.releaseBundle(bundleKey);
		}
		this.#textureLeases.dropOwner(ownerId);
		for (const textureKey of this.#textureLeases.takeEmptyLeases()) {
			this.#atlases.releaseTexture(textureKey);
		}
		this.#rendererLeases.dropOwner(ownerId);
		for (const resKey of this.#textureLeases.takeEmptyLeases()) {
			this.#renderer.releaseResource(resKey);
		}
		this.#terrain.drop(landblockId);
	}
}
