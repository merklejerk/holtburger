import type { LandblockId } from "../game-types";
import type { Camera } from "../runtime/types";
import { LandblockLayerKind } from "../runtime/scene-interest";

/** Stable identity for a scene lifecycle container. */
export type SceneBundleKey = `scene-bundle:${string}`;

/** Stable identity for one renderable scene entity inside a bundle. */
export type SceneEntityKey = `scene-entity:${string}`;

/** Broad scene category owned by a bundle. */
export type SceneBundleKind = "terrain" | "static" | "dynamic";

/** Render entity category; static content can own dynamic entities. */
export type SceneEntityKind = "terrain" | "static" | "dynamic";

/** Origin of a dynamic scene entity. */
export type SceneDynamicAuthoring = "static-derived" | "runtime-spawned";

/** Result of the current visibility pass. */
export interface VisibleScene {
	readonly entityKeys: readonly SceneEntityKey[];
}

interface SceneBundleRecord {
	readonly key: SceneBundleKey;
	readonly kind: SceneBundleKind;
	readonly entityKeys: Set<SceneEntityKey>;
}

interface SceneEntityRecord {
	readonly key: SceneEntityKey;
	readonly bundleKey: SceneBundleKey;
	readonly kind: SceneEntityKind;
	readonly authoring: SceneDynamicAuthoring | null;
}

export function landblockLayerToSceneBundleKey(
	landblockId: LandblockId,
	layer: LandblockLayerKind,
): SceneBundleKey {
	return `scene-bundle:landblock-layer:${landblockId}/${LandblockLayerKind[layer]}`;
}

export function spawnedSceneBundleKey(entityId: string): SceneBundleKey {
	return `scene-bundle:spawned:${entityId}`;
}

export function sceneEntityKey(value: string): SceneEntityKey {
	return `scene-entity:${value}`;
}

export class SceneGraph {
	readonly #bundles = new Map<SceneBundleKey, SceneBundleRecord>();
	readonly #entities = new Map<SceneEntityKey, SceneEntityRecord>();

	createTerrainBundle(key: SceneBundleKey): void {
		this.#createBundle(key, "terrain");
	}

	createStaticBundle(key: SceneBundleKey): void {
		this.#createBundle(key, "static");
	}

	createDynamicBundle(key: SceneBundleKey): void {
		this.#createBundle(key, "dynamic");
	}

	createTerrainEntity(
		bundleKey: SceneBundleKey,
		entityKey: SceneEntityKey,
	): void {
		this.#createEntity(bundleKey, entityKey, "terrain", null);
	}

	upsertTerrainEntity(
		bundleKey: SceneBundleKey,
		entityKey: SceneEntityKey,
	): void {
		this.destroyEntity(entityKey);
		this.createTerrainEntity(bundleKey, entityKey);
	}

	createStaticEntity(
		bundleKey: SceneBundleKey,
		entityKey: SceneEntityKey,
	): void {
		this.#createEntity(bundleKey, entityKey, "static", null);
	}

	createDynamicEntity(
		bundleKey: SceneBundleKey,
		entityKey: SceneEntityKey,
		authoring: SceneDynamicAuthoring,
	): void {
		this.#createEntity(bundleKey, entityKey, "dynamic", authoring);
	}

	destroyBundle(key: SceneBundleKey): boolean {
		const bundle = this.#bundles.get(key);
		if (!bundle) {
			return false;
		}

		for (const entityKey of bundle.entityKeys) {
			this.#entities.delete(entityKey);
		}
		this.#bundles.delete(key);
		return true;
	}

	destroyEntity(entityKey: SceneEntityKey): boolean {
		const entity = this.#entities.get(entityKey);
		if (!entity) {
			return false;
		}

		this.#bundles.get(entity.bundleKey)?.entityKeys.delete(entityKey);
		this.#entities.delete(entityKey);
		return true;
	}

	updateVisibility(camera: Camera): VisibleScene {
		// TODO: query the composed spatial/portal indexes once entities have bounds.
		void camera;
		return { entityKeys: [...this.#entities.keys()] };
	}

	#createBundle(key: SceneBundleKey, kind: SceneBundleKind): void {
		this.destroyBundle(key);
		this.#bundles.set(key, {
			entityKeys: new Set(),
			key,
			kind,
		});
	}

	#createEntity(
		bundleKey: SceneBundleKey,
		entityKey: SceneEntityKey,
		kind: SceneEntityKind,
		authoring: SceneDynamicAuthoring | null,
	): void {
		const bundle = this.#bundles.get(bundleKey);
		if (!bundle) {
			throw new Error(
				`Cannot create scene entity ${entityKey} without bundle ${bundleKey}.`,
			);
		}
		if (this.#entities.has(entityKey)) {
			throw new Error(`Scene entity ${entityKey} already exists.`);
		}

		this.#entities.set(entityKey, {
			authoring,
			bundleKey,
			key: entityKey,
			kind,
		});
		bundle.entityKeys.add(entityKey);
	}
}
