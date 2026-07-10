import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
	type StaticLandblockLayerCommitTerrain,
} from "./types";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../runtime/scene-interest";

/** Canonical terrain data retained for runtime-generated terrain LODs. */
interface ResolvedTerrainSource {
	readonly layer: LandblockIdLayer;
	readonly commit: StaticLandblockLayerCommitTerrain;
}

/** Source data resolved for one layer that will be baked for rendering. */
interface ResolvedRenderableLayerSource {
	readonly layer: LandblockIdLayer;
}

/** Texture placement and residency work planned for one resolved layer. */
interface TexturePlacementPlan {
	readonly source: ResolvedRenderableLayerSource;
}

/** Baked render data produced for one layer before commit assembly. */
interface BakedLayer {
	readonly texturePlan: TexturePlacementPlan;
}

/** Atlas pages prepared alongside a baked layer commit. */
interface PreparedAtlasPages {
	readonly pages: CommitBundle["atlasPages"];
}

export class StandardCommitPipeline implements CommitPipeline {
	protected constructor() {}

	static async build(): Promise<StandardCommitPipeline> {
		return new StandardCommitPipeline();
	}

	async prepareLandblockLayers(
		layers: ReadonlySet<LandblockIdLayer>,
	): Promise<readonly CommitBundle[]> {
		return Promise.all(
			[...layers].map((layer) => this.#prepareLandblockLayer(layer)),
		);
	}

	async destroy(): Promise<void> {
		// ...
	}

	async #prepareLandblockLayer(layer: LandblockIdLayer): Promise<CommitBundle> {
		switch (layer.layer) {
			case LandblockLayerKind.Terrain:
				return this.#prepareTerrainLayer(layer);
			default:
				return this.#prepareRenderableLayer(layer);
		}
	}

	async #prepareTerrainLayer(layer: LandblockIdLayer): Promise<CommitBundle> {
		const source = await this.#resolveTerrainSource(layer);

		return this.#assembleTerrainCommitBundle(source);
	}

	async #prepareRenderableLayer(
		layer: LandblockIdLayer,
	): Promise<CommitBundle> {
		const source = await this.#resolveRenderableSource(layer);
		const texturePlan = await this.#planTexturePlacement(source);
		const baked = await this.#bakeLayer(texturePlan);
		const atlasPages = await this.#buildAtlasPages(texturePlan);

		return this.#assembleRenderableCommitBundle(layer, baked, atlasPages);
	}

	async #resolveTerrainSource(
		layer: LandblockIdLayer,
	): Promise<ResolvedTerrainSource> {
		// Resolve canonical terrain metadata; do not generate render meshes here.
		throw new Error(
			`No terrain source resolver is configured for ${describeLayer(layer)}.`,
		);
	}

	async #resolveRenderableSource(
		layer: LandblockIdLayer,
	): Promise<ResolvedRenderableLayerSource> {
		// Dispatch to the buildings/object/generated/env-cell source resolver here.
		throw new Error(
			`No render-layer source resolver is configured for ${describeLayer(layer)}.`,
		);
	}

	async #planTexturePlacement(
		source: ResolvedRenderableLayerSource,
	): Promise<TexturePlacementPlan> {
		// Create texture intents and reserve stable placements for the layer.
		void source;
		throw new Error("Texture placement planning is not implemented.");
	}

	async #bakeLayer(texturePlan: TexturePlacementPlan): Promise<BakedLayer> {
		// Run the domain-specific geometry/material baker with the placement snapshot.
		void texturePlan;
		throw new Error("Layer baking is not implemented.");
	}

	async #buildAtlasPages(
		texturePlan: TexturePlacementPlan,
	): Promise<PreparedAtlasPages> {
		// Build or reuse the atlas pages referenced by the baked layer.
		void texturePlan;
		throw new Error("Atlas page preparation is not implemented.");
	}

	#assembleTerrainCommitBundle(source: ResolvedTerrainSource): CommitBundle {
		// Terrain commits retain source metadata for runtime-generated LODs.
		return {
			atlasPages: [],
			kind: CommitBundleSourceKind.LandblockLayer,
			landblockId: source.layer.id,
			layer: LandblockLayerKind.Terrain,
			commit: source.commit,
		};
	}

	#assembleRenderableCommitBundle(
		layer: LandblockIdLayer,
		baked: BakedLayer,
		atlasPages: PreparedAtlasPages,
	): CommitBundle {
		// Convert baked domain data into the runtime commit union.
		void layer;
		void baked;
		void atlasPages;
		throw new Error("Commit bundle assembly is not implemented.");
	}
}

function describeLayer(layer: LandblockIdLayer): string {
	return `landblock ${layer.id} layer ${LandblockLayerKind[layer.layer]}`;
}
