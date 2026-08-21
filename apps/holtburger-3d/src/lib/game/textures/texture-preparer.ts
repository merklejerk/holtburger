import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import { TERRAIN_TYPE_COUNT } from "../terrain/pcode";
import type {
	DatAssetId,
	PaletteComposite,
	TextureSourceId,
} from "../game-types";
import type { AssetTextureSource, TextureArraySource } from "./texture-manager";
import {
	type AssetTextureFact,
	type ConventionalTextureArrayFact,
	type TerrainColorTextureArrayFact,
	type TerrainColorPalette,
	type TextureArrayFact,
	texturePurposePolicy,
	type TexturePixelFormat,
	type TextureKey,
	TexturePurpose,
	isPackedObjectTexturePurpose,
} from "./types";

/** One decoded DAT surface returned to a runtime texture-preparation worker. */
export interface PreparedTextureSurface {
	readonly sourceAssetId: TextureSourceId;
	readonly format: TexturePixelFormat;
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

/** Host-derived normalized mean for one terrain-color level-zero surface. */
export interface PreparedTerrainColorSurface extends PreparedTextureSurface {
	readonly meanRgb: readonly [number, number, number];
}

/** Existing terrain texture request whose output selection is shared-content-proven. */
interface TerrainColorPreparationServiceRequest {
	readonly kind: "prepared-texture-surface";
	readonly purpose: TexturePurpose.TerrainColor;
	readonly sourceAssetId: DatAssetId;
}

interface ConventionalTerrainPreparationServiceRequest {
	readonly kind: "prepared-texture-surface";
	readonly purpose:
		| TexturePurpose.TerrainBlendMask
		| TexturePurpose.TerrainDetail
		| TexturePurpose.TerrainRoadMask;
	readonly sourceAssetId: DatAssetId;
}

/** Closed request for one selected building/object RenderSurface. */
interface ObjectTexturePreparationServiceRequest {
	readonly kind: "prepared-object-texture";
	readonly purpose:
		| TexturePurpose.ObjectDirectColor
		| TexturePurpose.ObjectIndex8
		| TexturePurpose.ObjectIndex16
		| TexturePurpose.ObjectDetail;
	readonly sourceAssetId: DatAssetId;
}

/** Closed request for one canonical full palette lookup texture, authored or composited. */
interface ObjectPalettePreparationServiceRequest {
	readonly kind: "prepared-object-palette";
	readonly purpose: TexturePurpose.ObjectPalette;
	/** `palette/<dat id>` for an authored palette, or a composition identity. */
	readonly sourceAssetId: TextureSourceId;
	/** Recipe the host materializes when this identity names a composition, not a DAT palette. */
	readonly paletteComposite?: PaletteComposite;
}

/** Narrow, app-local pixel capability request. */
export type TexturePreparationServiceRequest =
	| TerrainColorPreparationServiceRequest
	| ConventionalTerrainPreparationServiceRequest
	| ObjectTexturePreparationServiceRequest
	| ObjectPalettePreparationServiceRequest;

/** Purpose-discriminated host response; only terrain color owns required mean metadata. */
export type TexturePreparationServiceResponse =
	| {
			readonly kind: "prepared-texture-surface";
			readonly purpose: TexturePurpose.TerrainColor;
			readonly surface: PreparedTerrainColorSurface;
	  }
	| {
			readonly kind: "prepared-texture-surface";
			readonly purpose: ConventionalTerrainPreparationServiceRequest["purpose"];
			readonly surface: PreparedTextureSurface;
	  }
	| {
			readonly kind: "prepared-object-texture";
			readonly purpose: ObjectTexturePreparationServiceRequest["purpose"];
			readonly surface: PreparedTextureSurface;
	  }
	| {
			readonly kind: "prepared-object-palette";
			readonly purpose: TexturePurpose.ObjectPalette;
			readonly surface: PreparedTextureSurface;
	  };

/** Complete pixel-bearing source prepared for one stable logical texture key. */
export type PreparedTextureSource = TextureArraySource | AssetTextureSource;

/** Runtime-owned CPU texture preparation boundary. */
export interface TexturePreparer {
	/** Prepare one complete array or standalone texture for its stable logical key. */
	prepare(
		fact: TextureArrayFact | AssetTextureFact,
	): Promise<PreparedTextureSource>;
	/** Stop accepting work and terminate runtime-owned workers. */
	destroy(): Promise<void>;
}

/** Future runtime worker-pool adapter backed by the host asset service channel. */
export class WorkerTexturePreparer implements TexturePreparer {
	readonly #pixelSource: TexturePixelSource;
	/** In-flight preparation jobs coalesced by immutable logical texture identity. */
	readonly #pendingPreparations = new Map<
		TextureKey,
		Promise<PreparedTextureSource>
	>();

	protected constructor(pixelSource: TexturePixelSource) {
		this.#pixelSource = pixelSource;
	}

	static async build(
		pixelSource: TexturePixelSource,
	): Promise<WorkerTexturePreparer> {
		return new WorkerTexturePreparer(pixelSource);
	}

	prepare(
		fact: TextureArrayFact | AssetTextureFact,
	): Promise<PreparedTextureSource> {
		const pending = this.#pendingPreparations.get(fact.key);
		if (pending) return pending;

		const preparation = this.#prepare(fact).finally(() => {
			this.#pendingPreparations.delete(fact.key);
		});
		this.#pendingPreparations.set(fact.key, preparation);
		return preparation;
	}

	async #prepare(
		fact: TextureArrayFact | AssetTextureFact,
	): Promise<PreparedTextureSource> {
		if (fact.kind === "asset") {
			const surface = await this.#requestSurface(assetPreparationRequest(fact));
			return {
				height: surface.height,
				key: fact.key,
				pixels: surface.pixels,
				purpose: fact.purpose,
				sourceAssetId: fact.sourceAssetId,
				width: surface.width,
			};
		}
		if (fact.purpose === TexturePurpose.TerrainColor) {
			return this.#prepareTerrainColorArray(fact);
		}
		return this.#prepareConventionalArray(fact);
	}

	async #prepareTerrainColorArray(
		fact: TerrainColorTextureArrayFact,
	): Promise<TextureArraySource> {
		if (fact.sourceAssetIdsByTerrainCode.length !== TERRAIN_TYPE_COUNT) {
			throw new Error(
				`Terrain color array ${fact.key} maps ${fact.sourceAssetIdsByTerrainCode.length} codes; expected ${TERRAIN_TYPE_COUNT}.`,
			);
		}
		const surfaces = await Promise.all(
			fact.sourceAssetIds.map((sourceAssetId) =>
				this.#requestTerrainColorSurface(sourceAssetId),
			),
		);
		const first = validateCompatibleArraySurfaces(fact, surfaces);
		const meansByAssetId = new Map(
			surfaces.map(({ meanRgb, sourceAssetId }) => [sourceAssetId, meanRgb]),
		);
		const colors = new Float32Array(TERRAIN_TYPE_COUNT * 3);
		for (const [
			terrainCode,
			sourceAssetId,
		] of fact.sourceAssetIdsByTerrainCode.entries()) {
			const mean = meansByAssetId.get(sourceAssetId);
			if (!mean) {
				throw new Error(
					`Terrain color ${sourceAssetId} for code ${terrainCode} is missing from ${fact.key}.`,
				);
			}
			colors.set(mean, terrainCode * 3);
		}
		const palette: TerrainColorPalette = { colors };
		return {
			height: first.height,
			key: fact.key,
			layers: surfaces.map((surface) => ({
				pixels: surface.pixels,
				sourceAssetId: surface.sourceAssetId,
			})),
			palette,
			purpose: fact.purpose,
			width: first.width,
		};
	}

	async #prepareConventionalArray(
		fact: ConventionalTextureArrayFact,
	): Promise<TextureArraySource> {
		const surfaces = await Promise.all(
			fact.sourceAssetIds.map((sourceAssetId) =>
				this.#requestSurface({
					kind: "prepared-texture-surface",
					purpose: fact.purpose,
					sourceAssetId,
				}),
			),
		);
		const first = validateCompatibleArraySurfaces(fact, surfaces);
		return {
			height: first.height,
			key: fact.key,
			layers: surfaces.map((surface) => ({
				pixels: surface.pixels,
				sourceAssetId: surface.sourceAssetId,
			})),
			purpose: fact.purpose,
			width: first.width,
		};
	}

	async destroy(): Promise<void> {
		// Worker-pool termination belongs here once transport is installed.
	}

	async #requestSurface(
		request: TexturePreparationServiceRequest,
	): Promise<PreparedTextureSurface> {
		const response = await this.#pixelSource.loadTexturePixels(request);
		if (
			response.kind !== request.kind ||
			response.purpose !== request.purpose ||
			response.surface.sourceAssetId !== request.sourceAssetId
		) {
			throw new Error(
				`Host returned an incompatible prepared texture for ${request.sourceAssetId}.`,
			);
		}
		if (
			response.surface.format !== texturePurposePolicy(request.purpose).format
		) {
			throw new Error(
				`Host returned an incompatible pixel format for ${request.sourceAssetId}.`,
			);
		}
		return response.surface;
	}

	async #requestTerrainColorSurface(
		sourceAssetId: DatAssetId,
	): Promise<PreparedTerrainColorSurface> {
		const response = await this.#pixelSource.loadTexturePixels({
			kind: "prepared-texture-surface",
			purpose: TexturePurpose.TerrainColor,
			sourceAssetId,
		});
		if (
			response.kind !== "prepared-texture-surface" ||
			response.purpose !== TexturePurpose.TerrainColor ||
			response.surface.sourceAssetId !== sourceAssetId ||
			response.surface.format !==
				texturePurposePolicy(TexturePurpose.TerrainColor).format
		) {
			throw new Error(
				`Host returned an incompatible prepared terrain color for ${sourceAssetId}.`,
			);
		}
		validateMeanRgb(response.surface.meanRgb, sourceAssetId);
		return response.surface;
	}
}

function validateCompatibleArraySurfaces(
	fact: TextureArrayFact,
	surfaces: readonly PreparedTextureSurface[],
): PreparedTextureSurface {
	const first = surfaces[0];
	if (!first) throw new Error(`Texture array ${fact.key} has no surfaces.`);
	for (const surface of surfaces) {
		if (surface.width !== first.width || surface.height !== first.height) {
			throw new Error(
				`Texture array ${fact.key} contains incompatible surface dimensions.`,
			);
		}
	}
	return first;
}

function validateMeanRgb(
	meanRgb: readonly number[],
	sourceAssetId: TextureSourceId,
): void {
	if (meanRgb.length !== 3) {
		throw new Error(
			`Terrain color ${sourceAssetId} returned ${meanRgb.length} mean RGB channels instead of three.`,
		);
	}
	for (const channel of meanRgb) {
		if (!Number.isFinite(channel)) {
			throw new Error(
				`Terrain color ${sourceAssetId} returned a non-finite mean RGB channel.`,
			);
		}
		if (channel < 0 || channel > 1) {
			throw new Error(
				`Terrain color ${sourceAssetId} returned an out-of-range mean RGB channel.`,
			);
		}
	}
}

/** Derive the one canonical host decode request admitted by an asset texture fact. */
function assetPreparationRequest(
	fact: AssetTextureFact,
): TexturePreparationServiceRequest {
	if (fact.purpose === TexturePurpose.ObjectPalette) {
		// A composition already carries its own identity; only an authored DAT palette needs the
		// resource prefix that names its archive family.
		return fact.paletteComposite
			? {
					kind: "prepared-object-palette",
					purpose: fact.purpose,
					sourceAssetId: fact.sourceAssetId,
					paletteComposite: fact.paletteComposite,
				}
			: {
					kind: "prepared-object-palette",
					purpose: fact.purpose,
					sourceAssetId: `palette/${fact.sourceAssetId}`,
				};
	}
	if (isPackedObjectTexturePurpose(fact.purpose)) {
		return {
			kind: "prepared-object-texture",
			purpose: fact.purpose,
			sourceAssetId: `surface-texture/${fact.sourceAssetId}`,
		};
	}
	if (fact.purpose === TexturePurpose.ObjectDetail) {
		return {
			kind: "prepared-object-texture",
			purpose: fact.purpose,
			sourceAssetId: `surface-texture/${fact.sourceAssetId}`,
		};
	}
	return {
		kind: "prepared-texture-surface",
		purpose: fact.purpose,
		sourceAssetId: fact.sourceAssetId,
	};
}
