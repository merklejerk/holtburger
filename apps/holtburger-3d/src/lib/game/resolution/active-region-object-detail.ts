import type { ActiveRegionSource } from "../../assets/active-region-source";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import type { DatAssetId } from "../game-types";
import { resolveActiveRegionTerrainPresentation } from "../terrain/active-region-terrain-resolver";
import {
	createAssetTextureKey,
	TexturePixelFormat,
	TexturePurpose,
	type AssetTextureKey,
} from "../textures/types";
import type { PreparedTextureSurface } from "../textures/texture-preparer";

/** The one regional building-detail texture shared by every building landblock in its scope. */
export interface ActiveRegionObjectDetailBinding {
	readonly activeRegionKey: string;
	readonly key: AssetTextureKey;
	readonly sourceAssetId: DatAssetId;
	readonly tiling: number;
	readonly surface: PreparedTextureSurface;
}

/**
 * Owns the building-detail presentation payload independently of individual landblocks.
 *
 * Phase 2 retains CPU pixels here; the later commit pipeline promotes this same binding to the
 * texture manager exactly once instead of adding it to every landblock pack job.
 */
export class ActiveRegionObjectDetailOwner {
	readonly #pixelSource: TexturePixelSource;
	#binding: ActiveRegionObjectDetailBinding | null = null;
	#pending: {
		readonly activeRegionKey: string;
		readonly promise: Promise<ActiveRegionObjectDetailBinding>;
	} | null = null;
	/** Invalidates a late request when a region is replaced or the owner tears down. */
	#generation = 0;

	constructor(pixelSource: TexturePixelSource) {
		this.#pixelSource = pixelSource;
	}

	/** Install or reuse one active-region-owned building-detail payload. */
	install(
		activeRegion: ActiveRegionSource,
	): Promise<ActiveRegionObjectDetailBinding> {
		const activeRegionKey = `${activeRegion.provenance.sourceRecordId}@${activeRegion.provenance.version}`;
		if (this.#binding?.activeRegionKey === activeRegionKey) {
			return Promise.resolve(this.#binding);
		}
		if (this.#pending?.activeRegionKey === activeRegionKey) {
			return this.#pending.promise;
		}
		const generation = ++this.#generation;
		const promise = this.#prepare(activeRegion, activeRegionKey).then(
			(binding) => {
				if (this.#generation !== generation) {
					throw new Error(
						"Active-region building-detail request was superseded.",
					);
				}
				this.#binding = binding;
				return binding;
			},
		);
		const pending = { activeRegionKey, promise };
		this.#pending = pending;
		return promise.finally(() => {
			if (this.#pending === pending) this.#pending = null;
		});
	}

	/** Current binding for materialization contexts; absent until the active region is installed. */
	get binding(): ActiveRegionObjectDetailBinding | null {
		return this.#binding;
	}

	/** Release the active-region-owned CPU payload before replacing or destroying the scope. */
	teardown(): void {
		this.#generation += 1;
		this.#binding = null;
	}

	async #prepare(
		activeRegion: ActiveRegionSource,
		activeRegionKey: string,
	): Promise<ActiveRegionObjectDetailBinding> {
		const detail = resolveActiveRegionTerrainPresentation(
			activeRegion,
		).detailRoles.find((role) => role.role === "building");
		if (!detail) {
			throw new Error(
				"Installed active region has no building detail texture role.",
			);
		}
		const sourceAssetId = detail.textureId;
		const response = await this.#pixelSource.loadTexturePixels({
			kind: "prepared-object-texture",
			purpose: TexturePurpose.ObjectDetail,
			sourceAssetId,
		});
		if (
			response.kind !== "prepared-object-texture" ||
			response.purpose !== TexturePurpose.ObjectDetail ||
			response.surface.sourceAssetId !== sourceAssetId ||
			response.surface.format !== TexturePixelFormat.RGBA8
		) {
			throw new Error(
				"Host returned an incompatible active-region building-detail texture.",
			);
		}
		return {
			activeRegionKey,
			key: createAssetTextureKey(TexturePurpose.ObjectDetail, detail.textureId),
			sourceAssetId: detail.textureId,
			surface: response.surface,
			tiling: detail.tiling,
		};
	}
}
