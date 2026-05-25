import type { Material, Texture } from "three";

import type {
	PreparedAssetRecord,
	PreparedRenderSurfacePayload,
} from "../assets/types";
import {
	createDerivedPaletteTextureResource,
	describeDerivedPaletteResourceKey,
	type DerivedPaletteDiagnosticHandler,
} from "./derived-palette-resources";
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
import {
	createDefaultMaterialTextureSamplingPolicy,
	describeTextureSamplingPolicy,
	selectRenderSurfaceTextureSamplingPolicy,
	type MaterialTextureSamplingPolicy,
	type TextureSamplingPolicy,
} from "./texture-sampling-policy";

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
	private readonly textureCapabilities: MaterialTextureCapabilities;
	private readonly textureSamplingPolicy: MaterialTextureSamplingPolicy;

	constructor(
		private readonly reportDiagnostic?: MaterialResourceDiagnosticHandler,
		textureCapabilities: MaterialTextureCapabilities = {
			supportsS3tc: false,
			supportsS3tcSrgb: false,
		},
		textureSamplingPolicy: MaterialTextureSamplingPolicy = createDefaultMaterialTextureSamplingPolicy(
			textureCapabilities,
		),
	) {
		this.textureCapabilities = textureCapabilities;
		this.textureSamplingPolicy = textureSamplingPolicy;
	}

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
					slot,
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
		slot: ResolvedMaterialSlot;
		appearance: MaterialAppearanceContext;
		preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
		fallbackColorKey: string;
	}): Material {
		const materialKey = describeMaterialCacheKey({
			appearance: options.appearance,
			materialAssetId: options.slot.materialAssetId,
			materialVariantSignature: options.slot.materialVariantSignature,
			preparedByAssetId: options.preparedByAssetId,
		});
		const cached = this.materialRecords.get(materialKey);
		if (cached) {
			return cached.material;
		}

		const material = createMaterial({
			materialAssetId: options.slot.materialAssetId,
			materialVariantSignature: options.slot.materialVariantSignature,
			preparedByAssetId: options.preparedByAssetId,
			fallbackColorKey: options.fallbackColorKey,
			resolveTexture: (renderSurface, samplingPolicy) =>
				this.getTexture({ renderSurface, samplingPolicy }),
			resolveIndexedTexture: (renderSurface, samplingPolicy) =>
				this.getIndexedTextureResource({ renderSurface, samplingPolicy }),
			resolvePaletteResource: (paletteAssetId, paletteAsset) =>
				this.getPaletteResource({ paletteAssetId, paletteAsset }),
			resolveDerivedPaletteResource: (paletteOptions) =>
				this.getDerivedPaletteResource(paletteOptions),
			reportDiagnostic: (diagnostic) => this.reportOnce(diagnostic),
			textureSamplingPolicy: this.textureSamplingPolicy,
			appearance: options.appearance,
		});
		this.materialRecords.set(materialKey, { material });
		return material;
	}

	getTexture(options: {
		renderSurface: PreparedRenderSurfacePayload;
		samplingPolicy: TextureSamplingPolicy;
	}): Texture | null {
		const textureKey = describeRenderSurfaceTextureResourceKey(
			options.renderSurface,
			options.samplingPolicy,
		);
		const cached = this.textureRecords.get(textureKey);
		if (cached) {
			return cached.texture;
		}

		const texture = createRenderSurfaceTexture(
			options.renderSurface,
			options.samplingPolicy,
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

	getDerivedPaletteResource(options: {
		basePaletteAssetId: string;
		basePaletteAsset: PreparedAssetRecord;
		appearance: MaterialAppearanceContext;
		preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
		reportDiagnostic?: DerivedPaletteDiagnosticHandler;
	}): PaletteTextureResource | null {
		const paletteView = options.appearance.paletteView;
		if (!paletteView) {
			return this.getPaletteResource({
				paletteAssetId: options.basePaletteAssetId,
				paletteAsset: options.basePaletteAsset,
			});
		}
		if (options.basePaletteAsset.payload.kind !== "palette") {
			this.reportOnce({
				key: `derived-palette-base-kind-mismatch:${options.basePaletteAssetId}`,
				message: `Cannot create derived palette because ${options.basePaletteAssetId} is not prepared as a palette.`,
				detail: {
					paletteAssetId: options.basePaletteAssetId,
					preparedKind: options.basePaletteAsset.payload.kind,
				},
			});
			return null;
		}

		const paletteKey = describeDerivedPaletteResourceKey({
			basePaletteAssetId: options.basePaletteAssetId,
			basePaletteAsset: options.basePaletteAsset,
			paletteView,
			preparedByAssetId: options.preparedByAssetId,
		});
		const cached = this.paletteRecords.get(paletteKey);
		if (cached) {
			return cached.resource;
		}

		const resource = createDerivedPaletteTextureResource({
			basePaletteAssetId: options.basePaletteAssetId,
			basePalette: options.basePaletteAsset.payload,
			paletteView,
			preparedByAssetId: options.preparedByAssetId,
			reportDiagnostic: (diagnostic) => {
				this.reportOnce(diagnostic);
				options.reportDiagnostic?.(diagnostic);
			},
		});
		if (!resource) {
			return null;
		}
		this.paletteRecords.set(paletteKey, { resource });
		return resource;
	}

	getIndexedTextureResource(options: {
		renderSurface: PreparedRenderSurfacePayload;
		samplingPolicy: TextureSamplingPolicy;
	}): IndexedTextureResource | null {
		const textureKey = describeRenderSurfaceTextureResourceKey(
			options.renderSurface,
			options.samplingPolicy,
		);
		const cached = this.indexedTextureRecords.get(textureKey);
		if (cached) {
			return cached.resource;
		}

		if (!isIndexedTextureFormat(options.renderSurface.formatRaw)) {
			return null;
		}
		const resource = createIndexedTextureResource(
			options.renderSurface,
			options.samplingPolicy,
		);
		this.indexedTextureRecords.set(textureKey, { resource });
		return resource;
	}

	getDefaultTextureSamplingPolicy(
		renderSurface: PreparedRenderSurfacePayload,
	): TextureSamplingPolicy {
		return selectRenderSurfaceTextureSamplingPolicy(
			renderSurface,
			this.textureSamplingPolicy,
		);
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

function describeRenderSurfaceTextureResourceKey(
	renderSurface: PreparedRenderSurfacePayload,
	samplingPolicy: TextureSamplingPolicy,
): string {
	return [
		describeRenderSurfaceDecodeKey(renderSurface),
		describeTextureSamplingPolicy(samplingPolicy),
	].join("|");
}
