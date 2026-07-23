import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import type { DatAssetId } from "../game-types";
import type { AssetTextureSource, TextureArraySource } from "./texture-manager";
import {
	type AssetTextureFact,
	type TextureArrayFact,
	texturePurposePolicy,
	type TexturePixelFormat,
	type TextureKey,
	type TexturePurpose,
} from "./types";

/** One decoded DAT surface returned to a runtime texture-preparation worker. */
export interface PreparedTextureSurface {
	readonly sourceAssetId: DatAssetId;
	readonly format: TexturePixelFormat;
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

/** Host service request issued by one runtime texture-preparation worker job. */
export interface TexturePreparationServiceRequest {
	readonly kind: "prepared-texture-surface";
	readonly purpose: TexturePurpose;
	readonly sourceAssetId: DatAssetId;
}

/** Host response carrying one prepared surface requested by a runtime worker. */
export interface TexturePreparationServiceResponse {
	readonly kind: "prepared-texture-surface";
	readonly purpose: TexturePurpose;
	readonly surface: PreparedTextureSurface;
}

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

	static async build(pixelSource: TexturePixelSource): Promise<WorkerTexturePreparer> {
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
			const surface = await this.#requestSurface(
				fact.purpose,
				fact.sourceAssetId,
			);
			return {
				height: surface.height,
				key: fact.key,
				pixels: surface.pixels,
				purpose: fact.purpose,
				sourceAssetId: fact.sourceAssetId,
				width: surface.width,
			};
		}

		const surfaces = await Promise.all(
			fact.sourceAssetIds.map((sourceAssetId) =>
				this.#requestSurface(fact.purpose, sourceAssetId),
			),
		);
		const first = surfaces[0];
		if (!first) throw new Error(`Texture array ${fact.key} has no surfaces.`);
		for (const surface of surfaces) {
			if (surface.width !== first.width || surface.height !== first.height) {
				throw new Error(
					`Texture array ${fact.key} contains incompatible surface dimensions.`,
				);
			}
		}
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
		purpose: TexturePurpose,
		sourceAssetId: DatAssetId,
	): Promise<PreparedTextureSurface> {
		const response = await this.#pixelSource.loadTexturePixels({
			kind: "prepared-texture-surface",
			purpose,
			sourceAssetId,
		});
		if (
			response.kind !== "prepared-texture-surface" ||
			response.purpose !== purpose ||
			response.surface.sourceAssetId !== sourceAssetId
		) {
			throw new Error(
				`Host returned an incompatible prepared texture for ${sourceAssetId}.`,
			);
		}
		if (response.surface.format !== texturePurposePolicy(purpose).format) {
			throw new Error(
				`Host returned an incompatible pixel format for ${sourceAssetId}.`,
			);
		}
		return response.surface;
	}
}
