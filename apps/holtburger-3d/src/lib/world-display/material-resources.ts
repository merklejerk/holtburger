import type { Material, Texture } from "three";

import type {
	PreparedAssetRecord,
	PreparedRenderSurfacePayload,
} from "../assets/types";
import {
	createIndexedTextureResource,
	isIndexedTextureFormat,
	type IndexedTextureResource,
} from "./indexed-texture-resources";
import { createMaterial } from "./material-construction";
import type { MaterialAppearanceContext } from "./material-appearance";
import {
	buildMaterialResourcePlan,
	type MaterialResourcePlan,
	type ResolvedMaterialSlot,
} from "./material-plan";
import {
	describeMaterialCacheKey,
	describePaletteResourceKey,
} from "./material-signatures";
import {
	createPaletteTextureResource,
	type PaletteTextureResource,
} from "./palette-resources";
import {
	createRenderSurfaceTexture,
	describeRenderSurfaceDecodeKey,
	type MaterialTextureCapabilities,
} from "./render-surface-texture-resources";

export { formatMaterialAssetId } from "./material-signatures";
export type { MaterialAppearanceContext } from "./material-appearance";
export type {
	MaterialResourcePlan,
	ResolvedMaterialSlot,
} from "./material-plan";

export interface MaterialResourceDiagnostic {
	key: string;
	message: string;
	detail: Record<string, unknown>;
}

type MaterialResourceDiagnosticHandler = (
	diagnostic: MaterialResourceDiagnostic,
) => void;

interface MaterialResourceRecord {
	material: Material;
}

interface TextureResourceRecord {
	texture: Texture;
}

interface PaletteResourceRecord {
	resource: PaletteTextureResource;
}

interface IndexedTextureResourceRecord {
	resource: IndexedTextureResource;
}

export class WorldMaterialResourceCache {
	private readonly materialRecords = new Map<string, MaterialResourceRecord>();
	private readonly textureRecords = new Map<string, TextureResourceRecord>();
	private readonly paletteRecords = new Map<string, PaletteResourceRecord>();
	private readonly indexedTextureRecords = new Map<
		string,
		IndexedTextureResourceRecord
	>();
	private readonly reportedDiagnosticKeys = new Set<string>();

	constructor(
		private readonly reportDiagnostic?: MaterialResourceDiagnosticHandler,
		private readonly textureCapabilities: MaterialTextureCapabilities = {
			supportsS3tc: false,
			supportsS3tcSrgb: false,
		},
	) {}

	resolveMaterialPlan(options: {
		slots: readonly ResolvedMaterialSlot[];
		appearance: MaterialAppearanceContext;
		preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
		fallbackColorKey: string;
	}): MaterialResourcePlan {
		return buildMaterialResourcePlan({
			slots: options.slots,
			appearance: options.appearance,
			fallbackColorKey: options.fallbackColorKey,
			createMaterial: ({ slot, fallbackColorKey }) =>
				this.getMaterial({
					materialAssetId: slot.materialAssetId,
					appearance: options.appearance,
					preparedByAssetId: options.preparedByAssetId,
					fallbackColorKey,
				}),
		});
	}

	dispose(): void {
		for (const record of this.materialRecords.values()) {
			record.material.dispose();
		}
		this.materialRecords.clear();
		for (const record of this.textureRecords.values()) {
			record.texture.dispose();
		}
		this.textureRecords.clear();
		for (const record of this.paletteRecords.values()) {
			record.resource.texture.dispose();
		}
		this.paletteRecords.clear();
		for (const record of this.indexedTextureRecords.values()) {
			record.resource.texture.dispose();
		}
		this.indexedTextureRecords.clear();
	}

	private getMaterial(options: {
		materialAssetId: string;
		appearance: MaterialAppearanceContext;
		preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
		fallbackColorKey: string;
	}): Material {
		const materialKey = describeMaterialCacheKey(options);
		const cached = this.materialRecords.get(materialKey);
		if (cached) {
			return cached.material;
		}

		const material = createMaterial({
			...options,
			resolveTexture: (renderSurface) => this.getTexture({ renderSurface }),
			resolveIndexedTexture: (renderSurface) =>
				this.getIndexedTextureResource({ renderSurface }),
			resolvePaletteResource: (paletteAssetId, paletteAsset) =>
				this.getPaletteResource({ paletteAssetId, paletteAsset }),
			reportDiagnostic: (diagnostic) => this.reportOnce(diagnostic),
		});
		this.materialRecords.set(materialKey, { material });
		return material;
	}

	getTexture(options: {
		renderSurface: PreparedRenderSurfacePayload;
	}): Texture | null {
		const textureKey = describeRenderSurfaceDecodeKey(options.renderSurface);
		const cached = this.textureRecords.get(textureKey);
		if (cached) {
			return cached.texture;
		}

		const texture = createRenderSurfaceTexture(
			options.renderSurface,
			this.textureCapabilities,
		);
		if (!texture) {
			return null;
		}
		this.textureRecords.set(textureKey, { texture });
		return texture;
	}

	getPaletteResource(options: {
		paletteAssetId: string;
		paletteAsset: PreparedAssetRecord;
	}): PaletteTextureResource | null {
		if (options.paletteAsset.payload.kind !== "palette") {
			this.reportOnce({
				key: `palette-resource-kind-mismatch:${options.paletteAssetId}`,
				message: `Cannot create palette resource because ${options.paletteAssetId} is not prepared as a palette.`,
				detail: {
					paletteAssetId: options.paletteAssetId,
					preparedKind: options.paletteAsset.payload.kind,
				},
			});
			return null;
		}

		const paletteKey = describePaletteResourceKey(
			options.paletteAssetId,
			options.paletteAsset,
		);
		const cached = this.paletteRecords.get(paletteKey);
		if (cached) {
			return cached.resource;
		}

		const resource = createPaletteTextureResource(options.paletteAsset.payload);
		this.paletteRecords.set(paletteKey, { resource });
		return resource;
	}

	getIndexedTextureResource(options: {
		renderSurface: PreparedRenderSurfacePayload;
	}): IndexedTextureResource | null {
		const textureKey = describeRenderSurfaceDecodeKey(options.renderSurface);
		const cached = this.indexedTextureRecords.get(textureKey);
		if (cached) {
			return cached.resource;
		}

		if (!isIndexedTextureFormat(options.renderSurface.formatRaw)) {
			return null;
		}
		const resource = createIndexedTextureResource(options.renderSurface);
		this.indexedTextureRecords.set(textureKey, { resource });
		return resource;
	}

	private reportOnce(diagnostic: MaterialResourceDiagnostic): void {
		if (
			!this.reportDiagnostic ||
			this.reportedDiagnosticKeys.has(diagnostic.key)
		) {
			return;
		}
		this.reportedDiagnosticKeys.add(diagnostic.key);
		this.reportDiagnostic(diagnostic);
	}
}
