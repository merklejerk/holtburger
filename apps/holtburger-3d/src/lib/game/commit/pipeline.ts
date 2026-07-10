import { type CommitBundle, type CommitPipeline } from "./types";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
} from "../runtime/scene-interest";

/** Source data resolved for one requested landblock layer. */
interface ResolvedLayerSource {
	readonly layer: LandblockIdLayer;
}

/** Texture placement and residency work planned for one resolved layer. */
interface TexturePlacementPlan {
	readonly source: ResolvedLayerSource;
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
		const source = await this.#resolveSource(layer);
		const texturePlan = await this.#planTexturePlacement(source);
		const baked = await this.#bakeLayer(texturePlan);
		const atlasPages = await this.#buildAtlasPages(texturePlan);

		return this.#assembleCommitBundle(layer, baked, atlasPages);
	}

	async #resolveSource(layer: LandblockIdLayer): Promise<ResolvedLayerSource> {
		// Dispatch to the terrain/object/generated/env-cell source resolver here.
		throw new Error(
			`No source resolver is configured for ${describeLayer(layer)}.`,
		);
	}

	async #planTexturePlacement(
		source: ResolvedLayerSource,
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

	#assembleCommitBundle(
		layer: LandblockIdLayer,
		baked: BakedLayer,
		atlasPages: PreparedAtlasPages,
	): CommitBundle {
		// Convert the domain-specific baked result into the runtime commit union.
		void layer;
		void baked;
		void atlasPages;
		throw new Error("Commit bundle assembly is not implemented.");
	}
}

function describeLayer(layer: LandblockIdLayer): string {
	return `landblock ${layer.id} layer ${LandblockLayerKind[layer.layer]}`;
}
