import type { LandblockId } from "../game-types";
import type { GeometryKey } from "../geometry/types";
import type { Camera } from "../runtime/types";
import type { VisibleScene } from "../scene";
import type { TerrainDrawUnit } from "../terrain/types";
import type { TextureArrayBinding } from "../textures/texture-manager";
import type {
	GeneratedTextureKey,
	StandaloneTextureKey,
	TextureArrayKey,
} from "../textures/types";
import type {
	GeometryResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";

/** Private read-only query ports captured by one RenderWorld. */
interface RenderWorldSystems {
	readonly scene: {
		updateVisibility(camera: Camera): VisibleScene;
	};
	readonly terrain: {
		getDrawUnit(
			landblockId: LandblockId,
			anchorLandblockId: LandblockId,
		): TerrainDrawUnit | null;
	};
	readonly geometry: {
		getResource(key: GeometryKey): GeometryResourceKey;
	};
	readonly textures: {
		getTexture2DResource(
			key: StandaloneTextureKey | GeneratedTextureKey,
		): Texture2DResourceKey;
		getTextureArrayBinding(key: TextureArrayKey): TextureArrayBinding;
	};
}

/** Read-only renderer view of the runtime systems that own scene and resource state. */
export class RenderWorld {
	readonly #systems: RenderWorldSystems;

	constructor(systems: RenderWorldSystems) {
		this.#systems = systems;
	}

	queryVisibleScene(camera: Camera): VisibleScene {
		return this.#systems.scene.updateVisibility(camera);
	}

	resolveTerrainDrawUnit(
		landblockId: LandblockId,
		anchorLandblockId: LandblockId,
	): TerrainDrawUnit | null {
		return this.#systems.terrain.getDrawUnit(landblockId, anchorLandblockId);
	}

	resolveGeometry(key: GeometryKey): GeometryResourceKey {
		return this.#systems.geometry.getResource(key);
	}

	resolveTexture2D(
		key: StandaloneTextureKey | GeneratedTextureKey,
	): Texture2DResourceKey {
		return this.#systems.textures.getTexture2DResource(key);
	}

	resolveTextureArray(key: TextureArrayKey): TextureArrayBinding {
		return this.#systems.textures.getTextureArrayBinding(key);
	}
}
