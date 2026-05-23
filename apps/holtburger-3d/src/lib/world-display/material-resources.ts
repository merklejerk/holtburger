import { Color, MeshStandardMaterial, type Material } from "three";

import type {
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
	PreparedPalettePayload,
	PreparedRenderSurfacePayload,
	PreparedRenderTexturePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import type { MaterialGeometrySlot } from "./static-renderable-geometry";

export interface ResolvedMaterialSlot {
	surfaceId: number;
	materialAssetId: string;
}

export interface MaterialResourcePlan {
	signature: string;
	materials: Material[];
	geometrySlots: MaterialGeometrySlot[];
}

interface MaterialResourceRecord {
	material: Material;
}

const FALLBACK_MATERIAL_ASSET_ID = "material/fallback";

export class WorldMaterialResourceCache {
	private readonly materialRecords = new Map<string, MaterialResourceRecord>();

	resolveMaterialPlan(options: {
		slots: readonly ResolvedMaterialSlot[];
		appearanceKey: string;
		preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
		fallbackColorKey: string;
	}): MaterialResourcePlan {
		const slots =
			options.slots.length > 0
				? dedupeMaterialSlots(options.slots)
				: [
						{
							surfaceId: 0,
							materialAssetId: FALLBACK_MATERIAL_ASSET_ID,
						},
					];
		const materials = slots.map((slot) =>
			this.getMaterial({
				materialAssetId: slot.materialAssetId,
				appearanceKey: options.appearanceKey,
				preparedByAssetId: options.preparedByAssetId,
				fallbackColorKey: `${options.fallbackColorKey}:${slot.surfaceId}`,
			}),
		);
		return {
			signature: [
				options.appearanceKey,
				...slots.map((slot) => `${slot.surfaceId}:${slot.materialAssetId}`),
			].join("|"),
			materials,
			geometrySlots: slots.map((slot, index) => ({
				surfaceId: slot.surfaceId,
				materialIndex: index,
			})),
		};
	}

	dispose(): void {
		for (const record of this.materialRecords.values()) {
			record.material.dispose();
		}
		this.materialRecords.clear();
	}

	private getMaterial(options: {
		materialAssetId: string;
		appearanceKey: string;
		preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
		fallbackColorKey: string;
	}): Material {
		const materialKey = `${options.appearanceKey}|${options.materialAssetId}`;
		const cached = this.materialRecords.get(materialKey);
		if (cached) {
			return cached.material;
		}

		const material = createMaterial(options);
		this.materialRecords.set(materialKey, { material });
		return material;
	}
}

export function formatMaterialAssetId(surfaceId: number): string {
	return `material/${formatHex32(surfaceId)}`;
}

function dedupeMaterialSlots(
	slots: readonly ResolvedMaterialSlot[],
): ResolvedMaterialSlot[] {
	const slotBySurfaceId = new Map<number, ResolvedMaterialSlot>();
	for (const slot of slots) {
		slotBySurfaceId.set(slot.surfaceId, slot);
	}
	return [...slotBySurfaceId.values()].sort(
		(left, right) => left.surfaceId - right.surfaceId,
	);
}

function createMaterial(options: {
	materialAssetId: string;
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
	fallbackColorKey: string;
}): Material {
	const recipeAsset = options.preparedByAssetId[options.materialAssetId];
	if (recipeAsset?.payload.kind !== "material-recipe") {
		return createDebugFallbackMaterial(options.fallbackColorKey);
	}

	const recipe = recipeAsset.payload;
	if (recipe.source.kind === "solid-color") {
		return new MeshStandardMaterial({
			color: colorFromArgb(recipe.source.argb),
			flatShading: true,
			metalness: 0.02,
			roughness: 0.88,
			transparent: normalizeLegacyOpacity(recipe.translucency) < 1,
			opacity: normalizeLegacyOpacity(recipe.translucency),
		});
	}

	const renderTexture = firstPreparedRenderTexture(
		recipe,
		options.preparedByAssetId,
	);
	const renderSurface = firstPreparedRenderSurface(
		recipe,
		options.preparedByAssetId,
	);
	const palette = firstPreparedPalette(recipe, options.preparedByAssetId);
	const color = buildTexturePlaceholderColor(recipe, {
		renderTexture,
		renderSurface,
		palette,
	});
	return new MeshStandardMaterial({
		color,
		flatShading: true,
		metalness: 0.02,
		roughness: 0.88,
		transparent: normalizeLegacyOpacity(recipe.translucency) < 1,
		opacity: normalizeLegacyOpacity(recipe.translucency),
	});
}

function firstPreparedRenderTexture(
	recipe: PreparedMaterialRecipePayload,
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): PreparedRenderTexturePayload | null {
	for (const assetId of recipe.dependencies.renderTextureAssetIds) {
		const asset = preparedByAssetId[assetId];
		if (asset?.payload.kind === "render-texture") {
			return asset.payload;
		}
	}
	return null;
}

function firstPreparedRenderSurface(
	recipe: PreparedMaterialRecipePayload,
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): PreparedRenderSurfacePayload | null {
	for (const assetId of recipe.dependencies.renderSurfaceAssetIds) {
		const asset = preparedByAssetId[assetId];
		if (asset?.payload.kind === "render-surface") {
			return asset.payload;
		}
	}
	return null;
}

function firstPreparedPalette(
	recipe: PreparedMaterialRecipePayload,
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): PreparedPalettePayload | null {
	for (const assetId of recipe.dependencies.paletteAssetIds) {
		const asset = preparedByAssetId[assetId];
		if (asset?.payload.kind === "palette") {
			return asset.payload;
		}
	}
	return null;
}

function buildTexturePlaceholderColor(
	recipe: PreparedMaterialRecipePayload,
	dependencies: {
		renderTexture: PreparedRenderTexturePayload | null;
		renderSurface: PreparedRenderSurfacePayload | null;
		palette: PreparedPalettePayload | null;
	},
): Color {
	const seed = [
		recipe.surfaceId,
		dependencies.renderTexture?.renderTextureId ?? 0,
		dependencies.renderSurface?.renderSurfaceId ?? 0,
		dependencies.palette?.paletteId ?? 0,
	].join(":");
	return colorFromString(seed, 0.46, 0.5);
}

function createDebugFallbackMaterial(colorKey: string): Material {
	return new MeshStandardMaterial({
		color: colorFromString(colorKey, 0.54, 0.48),
		flatShading: true,
		metalness: 0.02,
		roughness: 0.9,
	});
}

function colorFromArgb(argb: number): Color {
	const red = (argb >>> 16) & 0xff;
	const green = (argb >>> 8) & 0xff;
	const blue = argb & 0xff;
	return new Color(red / 255, green / 255, blue / 255);
}

function normalizeLegacyOpacity(translucency: number): number {
	const normalized =
		translucency > 1 ? 1 - Math.min(translucency, 255) / 255 : 1 - translucency;
	return Math.max(0, Math.min(1, normalized));
}

function colorFromString(
	value: string,
	saturation: number,
	lightness: number,
): Color {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
	}
	return new Color().setHSL((hash % 360) / 360, saturation, lightness);
}
