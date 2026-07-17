import type { AssetBridge } from "../../assets/asset-bridge";
import type { DatAssetId } from "../game-types";
import type {
	ResolvedEnvCellLayerSource,
	ResolvedLandblockLayerSource,
	ResolvedObjectLayerSource,
	ResolvedTerrainLayerSource,
} from "../resolution/landblock-layer";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../runtime/scene-interest";
import type { TexturePlacement } from "../textures/texture-manager";
import type { TextureAtlasEntryKey } from "../textures/types";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
	type StaticLandblockLayerCommitBuildings,
	type StaticLandblockLayerCommitEnvCells,
	type StaticLandblockLayerCommitGenerated,
	type StaticLandblockLayerCommitObjects,
	type StaticLandblockLayerCommitTerrain,
} from "./types";

/** One source texture assigned a stable page key and placement. */
interface PlannedTexturePlacement {
	readonly sourceAssetId: DatAssetId;
	readonly textureKey: TextureAtlasEntryKey;
	readonly placement: TexturePlacement;
}

/** Texture placement work consumed by static bakers and atlas-page assembly. */
interface TexturePlacementPlan {
	readonly textures: readonly PlannedTexturePlacement[];
}

/** Baked renderer payload discriminated by its source layer. */
type BakedStaticLayer =
	| {
			readonly kind: LandblockLayerKind.Buildings;
			readonly commit: StaticLandblockLayerCommitBuildings;
	  }
	| {
			readonly kind: LandblockLayerKind.Objects;
			readonly commit: StaticLandblockLayerCommitObjects;
	  }
	| {
			readonly kind: LandblockLayerKind.Generated;
			readonly commit: StaticLandblockLayerCommitGenerated;
	  }
	| {
			readonly kind: LandblockLayerKind.EnvCells;
			readonly commit: StaticLandblockLayerCommitEnvCells;
	  };

/** Texture pages prepared alongside one layer commit. */
interface PreparedTexturePages {
	readonly pages: CommitBundle["texturePages"];
}

export class StandardCommitPipeline implements CommitPipeline {
	readonly #hostAssets: AssetBridge;

	protected constructor(hostAssets: AssetBridge) {
		this.#hostAssets = hostAssets;
	}

	static async build(hostAssets: AssetBridge): Promise<StandardCommitPipeline> {
		return new StandardCommitPipeline(hostAssets);
	}

	async prepareLandblockLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<readonly CommitBundle[]> {
		return Promise.all(
			[...layers].map((layer) => this.#prepareLandblockLayer(layer)),
		);
	}

	async destroy(): Promise<void> {}

	async #prepareLandblockLayer(layer: LandblockIdLayer): Promise<CommitBundle> {
		const source = await this.#hostAssets.resolveLandblockLayer(layer);
		if (source.kind !== layer.layer || source.landblockId !== layer.id) {
			throw new Error(
				`Resolved ${source.landblockId}/${source.kind} for ${describeLayer(layer)}.`,
			);
		}

		return source.kind === LandblockLayerKind.Terrain
			? this.#prepareTerrainLayer(source)
			: this.#prepareStaticLayer(source);
	}

	#prepareTerrainLayer(source: ResolvedTerrainLayerSource): CommitBundle {
		return {
			texturePages: [],
			commit: this.#createTerrainSourceCommit(source),
			dynamicEntities: [],
			kind: CommitBundleSourceKind.LandblockLayer,
			landblockId: source.landblockId,
			layer: LandblockLayerKind.Terrain,
		};
	}

	async #prepareStaticLayer(
		source: ResolvedObjectLayerSource | ResolvedEnvCellLayerSource,
	): Promise<CommitBundle> {
		const texturePlan = await this.#planTexturePlacement(source);
		const [baked, texturePages] = await Promise.all([
			this.#bakeStaticLayer(source, texturePlan),
			this.#buildTexturePages(texturePlan),
		]);

		return this.#assembleStaticCommitBundle(source, baked, texturePages);
	}

	async #planTexturePlacement(
		source: ResolvedLandblockLayerSource,
	): Promise<TexturePlacementPlan> {
		// Discover texture intents from resolved materials, then reserve atlas slots.
		void source;
		throw new Error("Texture placement planning is not implemented.");
	}

	#createTerrainSourceCommit(
		source: ResolvedTerrainLayerSource,
	): StaticLandblockLayerCommitTerrain {
		return {
			generation: source.generation,
			presentation: source.presentation,
		};
	}

	async #bakeStaticLayer(
		source: ResolvedObjectLayerSource | ResolvedEnvCellLayerSource,
		texturePlan: TexturePlacementPlan,
	): Promise<BakedStaticLayer> {
		// Dispatch to object, instanced-scenery, building, or env-cell bakers.
		void source;
		void texturePlan;
		throw new Error("Static layer baking is not implemented.");
	}

	async #buildTexturePages(
		texturePlan: TexturePlacementPlan,
	): Promise<PreparedTexturePages> {
		// Resolve source pixels and build pages for the reserved placements.
		void texturePlan;
		throw new Error("Texture page preparation is not implemented.");
	}

	#assembleStaticCommitBundle(
		source: ResolvedObjectLayerSource | ResolvedEnvCellLayerSource,
		baked: BakedStaticLayer,
		texturePages: PreparedTexturePages,
	): CommitBundle {
		if (source.kind !== baked.kind) {
			throw new Error(
				`Baked ${baked.kind} payload for ${source.landblockId}/${source.kind}.`,
			);
		}

		const fields = {
			texturePages: texturePages.pages,
			dynamicEntities: source.dynamicResidents,
			kind: CommitBundleSourceKind.LandblockLayer as const,
			landblockId: source.landblockId,
		};
		switch (baked.kind) {
			case LandblockLayerKind.Buildings:
				return { ...fields, commit: baked.commit, layer: baked.kind };
			case LandblockLayerKind.Objects:
				return { ...fields, commit: baked.commit, layer: baked.kind };
			case LandblockLayerKind.Generated:
				return { ...fields, commit: baked.commit, layer: baked.kind };
			case LandblockLayerKind.EnvCells:
				return { ...fields, commit: baked.commit, layer: baked.kind };
		}
	}
}

function describeLayer(layer: LandblockIdLayer): string {
	return `landblock ${layer.id} layer ${layer.layer}`;
}
