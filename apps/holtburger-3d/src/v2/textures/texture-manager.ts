import type { AssetService } from "../assets/contracts";
import {
	createPreparedTextureHostKey,
	prepareDirectRgbaTextureSource,
} from "../assets/preparation/prepared-texture-source";
import type { TexturePlacementUpdate } from "../renderer/types";
import type {
	StaticBakeTextureUse,
	StaticCoordinatorCommitDelta,
} from "../static/contracts";

interface TextureManagerOptions {
	readonly assetService: AssetService;
}

export class TextureManager {
	readonly #assetService: AssetService;
	readonly #placementsByTextureUseId = new Map<string, RuntimeTexturePlacement>();
	readonly #textureUsesByDrawUnitId = new Map<string, Set<string>>();
	#revision = 0;

	constructor(options: TextureManagerOptions) {
		this.#assetService = options.assetService;
	}

	async applyStaticCommitDelta(
		delta: StaticCoordinatorCommitDelta,
	): Promise<TexturePlacementUpdate | null> {
		const removedTextureRefIds = this.#removeDrawUnitTextureRefs(
			delta.removedDrawUnitIds,
		);
		const placements: RuntimeTexturePlacement[] = [];
		const drawUnitBindings = [];

		for (const textureUse of delta.textureUses) {
			const placement = await this.#resolveDirectTexturePlacement(textureUse);
			placements.push(placement);

			for (const drawUnitId of textureUse.ownerDrawUnitIds) {
				let textureUseIds = this.#textureUsesByDrawUnitId.get(drawUnitId);
				if (!textureUseIds) {
					textureUseIds = new Set<string>();
					this.#textureUsesByDrawUnitId.set(drawUnitId, textureUseIds);
				}
				textureUseIds.add(textureUse.textureUseId);
				drawUnitBindings.push({
					drawUnitId,
					textureRefId: placement.textureRefId,
					textureUseId: textureUse.textureUseId,
				});
			}
		}

		if (
			placements.length === 0 &&
			removedTextureRefIds.length === 0 &&
			drawUnitBindings.length === 0
		) {
			return null;
		}

		this.#revision += 1;

		return {
			drawUnitBindings,
			placements,
			removedTextureRefIds,
			revision: this.#revision,
		};
	}

	#removeDrawUnitTextureRefs(
		removedDrawUnitIds: readonly string[],
	): readonly string[] {
		const removedTextureRefIds: string[] = [];

		for (const drawUnitId of removedDrawUnitIds) {
			const textureUseIds = this.#textureUsesByDrawUnitId.get(drawUnitId);
			if (!textureUseIds) {
				continue;
			}

			this.#textureUsesByDrawUnitId.delete(drawUnitId);
			for (const textureUseId of textureUseIds) {
				const placement = this.#placementsByTextureUseId.get(textureUseId);
				if (!placement) {
					continue;
				}
				this.#placementsByTextureUseId.delete(textureUseId);
				removedTextureRefIds.push(placement.textureRefId);
			}
		}

		return removedTextureRefIds;
	}

	async #resolveDirectTexturePlacement(
		textureUse: StaticBakeTextureUse,
	): Promise<RuntimeTexturePlacement> {
		const existing = this.#placementsByTextureUseId.get(textureUse.textureUseId);
		if (existing) {
			return existing;
		}

		const prepared = await this.#assetService.requestPreparedAsset(
			createPreparedTextureHostKey(textureUse.source),
		);
		const source = prepareDirectRgbaTextureSource(prepared, textureUse.source);

		const placement: RuntimeTexturePlacement = {
			format: "rgba8",
			height: source.height,
			kind: "direct-texture",
			pixels: source.pixels,
			placementRevision: 1,
			rect: [0, 0, source.width, source.height],
			textureRefId: `texture-ref:${textureUse.textureUseId}`,
			textureUseId: textureUse.textureUseId,
			width: source.width,
		};
		this.#placementsByTextureUseId.set(textureUse.textureUseId, placement);
		return placement;
	}
}

type RuntimeTexturePlacement = TexturePlacementUpdate["placements"][number];
