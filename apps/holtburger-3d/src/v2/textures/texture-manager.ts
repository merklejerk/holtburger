import type { AssetService } from "../assets/contracts";
import { createHostAssetKey } from "../assets/keys";
import type { TexturePlacementUpdate } from "../renderer/types";
import type {
	PreparedTextureUseIdentity,
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
		const payload = parsePreparedTexturePayload(prepared.payload, textureUse.source);
		const levelZero = payload.levels.find((level) => level.level === 0);
		if (!levelZero) {
			throw new Error(
				`Prepared texture ${textureUse.textureUseId} has no mip level 0.`,
			);
		}
		if (
			payload.outputFormat !== "rgba8" ||
			payload.mipPolicy !== "none" ||
			payload.colorSpace !== "linear"
		) {
			throw new Error(
				`Prepared texture ${textureUse.textureUseId} uses unsupported direct texture policy ${payload.outputFormat}/${payload.mipPolicy}/${payload.colorSpace}. Only rgba8/none/linear is supported in Phase 8.`,
			);
		}
		const expectedByteLength = levelZero.width * levelZero.height * 4;
		if (levelZero.bytes.byteLength !== expectedByteLength) {
			throw new Error(
				`Prepared texture ${textureUse.textureUseId} expected ${expectedByteLength} rgba8 bytes, got ${levelZero.bytes.byteLength}.`,
			);
		}

		const placement: RuntimeTexturePlacement = {
			format: "rgba8",
			height: levelZero.height,
			kind: "direct-texture",
			pixels: levelZero.bytes,
			placementRevision: 1,
			rect: [0, 0, levelZero.width, levelZero.height],
			textureRefId: `texture-ref:${textureUse.textureUseId}`,
			textureUseId: textureUse.textureUseId,
			width: levelZero.width,
		};
		this.#placementsByTextureUseId.set(textureUse.textureUseId, placement);
		return placement;
	}
}

type RuntimeTexturePlacement = TexturePlacementUpdate["placements"][number];

function createPreparedTextureHostKey(source: PreparedTextureUseIdentity) {
	const query = new URLSearchParams({
		cs: source.colorSpace,
		mips: source.mipPolicy,
		out: source.outputFormat,
		usage: source.usage,
	});

	return createHostAssetKey(
		"prepared-texture",
		`${source.renderSurfaceId.toString(16).padStart(8, "0")}?${query.toString()}`,
	);
}

function parsePreparedTexturePayload(
	payload: unknown,
	source: PreparedTextureUseIdentity,
): PreparedTexturePayloadLike {
	if (
		typeof payload !== "object" ||
		payload === null ||
		(payload as { kind?: unknown }).kind !== "prepared-texture"
	) {
		throw new Error(
			`Prepared texture payload for render surface ${source.renderSurfaceId} is not a prepared-texture payload.`,
		);
	}

	const candidate = payload as PreparedTexturePayloadLike;
	if (
		candidate.renderSurfaceId !== source.renderSurfaceId ||
		candidate.usage !== source.usage ||
		candidate.outputFormat !== source.outputFormat ||
		candidate.mipPolicy !== source.mipPolicy ||
		candidate.colorSpace !== source.colorSpace
	) {
		throw new Error(
			`Prepared texture payload for render surface ${source.renderSurfaceId} does not match the requested texture-use policy.`,
		);
	}

	return candidate;
}

interface PreparedTexturePayloadLike {
	readonly kind: "prepared-texture";
	readonly renderSurfaceId: number;
	readonly usage: string;
	readonly outputFormat: string;
	readonly mipPolicy: string;
	readonly colorSpace: string;
	readonly levels: readonly PreparedTextureLevelLike[];
}

interface PreparedTextureLevelLike {
	readonly level: number;
	readonly width: number;
	readonly height: number;
	readonly format: string;
	readonly bytes: Uint8Array;
}
