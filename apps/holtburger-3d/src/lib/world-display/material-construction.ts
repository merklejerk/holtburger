import {
	Color,
	MeshStandardMaterial,
	type Material,
	type Texture,
} from "three";

import type {
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
	PreparedPalettePayload,
	PreparedRenderSurfacePayload,
	PreparedRenderTexturePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import {
	createIndexedMeshStandardMaterial,
	type IndexedMaterialResources,
} from "./indexed-materials";
import {
	isIndexedTextureFormat,
	selectIndexedPalette,
	type IndexedTextureResource,
} from "./indexed-texture-resources";
import type { MaterialResourceDiagnostic } from "./material-resources";
import type { PaletteTextureResource } from "./palette-resources";
import {
	hasSourceAlpha,
	isSupportedCompressedFormat,
	isSupportedDirectColorFormat,
} from "./render-surface-texture-resources";

type MaterialResourceDiagnosticHandler = (
	diagnostic: MaterialResourceDiagnostic,
) => void;

const BYTE_MAX = 255;
const COLOR_HASH_MULTIPLIER = 31;
const HUE_DEGREES = 360;
const LEGACY_OPACITY_BYTE_SCALE = 255;

export function createMaterial(options: {
	materialAssetId: string;
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
	fallbackColorKey: string;
	resolveTexture: (
		renderSurface: PreparedRenderSurfacePayload,
	) => Texture | null;
	resolveIndexedTexture: (
		renderSurface: PreparedRenderSurfacePayload,
	) => IndexedTextureResource | null;
	resolvePaletteResource: (
		paletteAssetId: string,
		paletteAsset: PreparedAssetRecord,
	) => PaletteTextureResource | null;
	reportDiagnostic: MaterialResourceDiagnosticHandler;
}): Material {
	const recipeAsset = options.preparedByAssetId[options.materialAssetId];
	if (recipeAsset?.payload.kind !== "material-recipe") {
		options.reportDiagnostic({
			key: `missing-recipe:${options.materialAssetId}`,
			message: `Using fallback material because ${options.materialAssetId} is not prepared as a material recipe.`,
			detail: {
				materialAssetId: options.materialAssetId,
				preparedKind: recipeAsset?.payload.kind ?? null,
				preparedAssetCounts: countPreparedAssetsByKind(
					options.preparedByAssetId,
				),
				preparedMaterialRecipeCount: countPreparedMaterialRecipes(
					options.preparedByAssetId,
				),
				preparedMaterialAssetIdSamples: samplePreparedMaterialAssetIds(
					options.preparedByAssetId,
				),
			},
		});
		return createDebugFallbackMaterial(options.fallbackColorKey);
	}

	const recipe = recipeAsset.payload;
	if (recipe.provenance.errorCode !== null) {
		options.reportDiagnostic({
			key: `failed-recipe:${options.materialAssetId}:${recipe.provenance.errorCode}`,
			message: `Using fallback material because ${options.materialAssetId} failed to resolve.`,
			detail: {
				materialAssetId: options.materialAssetId,
				errorCode: recipe.provenance.errorCode,
				detail: recipe.provenance.detail,
			},
		});
	}
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
	const renderSurface = firstTextureUploadCandidateRenderSurface(
		recipe,
		options.preparedByAssetId,
	);
	const indexedRenderSurface = firstPreparedIndexedRenderSurface(
		recipe,
		options.preparedByAssetId,
	);
	const palette = firstPreparedPalette(recipe, options.preparedByAssetId);
	const texture = renderSurface ? options.resolveTexture(renderSurface) : null;
	if (texture && renderSurface) {
		const opacity = normalizeLegacyOpacity(recipe.translucency);
		return new MeshStandardMaterial({
			color: "#ffffff",
			map: texture,
			flatShading: true,
			metalness: 0.02,
			roughness: 0.88,
			transparent: opacity < 1 || hasSourceAlpha(renderSurface.formatRaw),
			opacity,
		});
	}
	if (indexedRenderSurface) {
		const indexedResources = resolveIndexedMaterialResources({
			recipe,
			materialAssetId: options.materialAssetId,
			preparedByAssetId: options.preparedByAssetId,
			renderSurface: indexedRenderSurface,
			indexedTexture: options.resolveIndexedTexture(indexedRenderSurface),
			resolvePaletteResource: options.resolvePaletteResource,
			reportDiagnostic: options.reportDiagnostic,
		});
		if (indexedResources) {
			return createIndexedMeshStandardMaterial({
				recipe,
				resources: indexedResources,
			});
		}
		const color = buildTexturePlaceholderColor(recipe, {
			renderTexture,
			renderSurface: indexedRenderSurface,
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

	reportTextureFallbackDiagnostics({
		recipe,
		materialAssetId: options.materialAssetId,
		preparedByAssetId: options.preparedByAssetId,
		renderTexture,
		renderSurface,
		palette,
		texture,
		reportDiagnostic: options.reportDiagnostic,
	});

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

function reportTextureFallbackDiagnostics(options: {
	recipe: PreparedMaterialRecipePayload;
	materialAssetId: string;
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
	renderTexture: PreparedRenderTexturePayload | null;
	renderSurface: PreparedRenderSurfacePayload | null;
	palette: PreparedPalettePayload | null;
	texture: Texture | null;
	reportDiagnostic: MaterialResourceDiagnosticHandler;
}): void {
	for (const assetId of options.recipe.dependencies.renderTextureAssetIds) {
		const asset = options.preparedByAssetId[assetId];
		if (asset?.payload.kind !== "render-texture") {
			options.reportDiagnostic({
				key: `missing-render-texture:${options.materialAssetId}:${assetId}`,
				message: `Using placeholder material because ${options.materialAssetId} is missing render texture ${assetId}.`,
				detail: {
					materialAssetId: options.materialAssetId,
					renderTextureAssetId: assetId,
					preparedKind: asset?.payload.kind ?? null,
				},
			});
		}
	}

	const renderSurfaceAssetIds = textureCandidateRenderSurfaceAssetIds(
		options.recipe,
	);
	for (const assetId of renderSurfaceAssetIds) {
		const asset = options.preparedByAssetId[assetId];
		if (asset?.payload.kind !== "render-surface") {
			options.reportDiagnostic({
				key: `missing-render-surface:${options.materialAssetId}:${assetId}`,
				message: `Using placeholder material because ${options.materialAssetId} is missing render surface ${assetId}.`,
				detail: {
					materialAssetId: options.materialAssetId,
					renderSurfaceAssetId: assetId,
					preparedKind: asset?.payload.kind ?? null,
				},
			});
			continue;
		}
		if (!isSupportedDirectColorFormat(asset.payload.formatRaw)) {
			if (isSupportedCompressedFormat(asset.payload.formatRaw)) {
				continue;
			}
			if (isIndexedTextureFormat(asset.payload.formatRaw)) {
				continue;
			}
			options.reportDiagnostic({
				key: `unsupported-render-surface:${options.materialAssetId}:${assetId}:${asset.payload.formatRaw}`,
				message: `Using placeholder material because ${assetId} uses unsupported format ${asset.payload.format}.`,
				detail: {
					materialAssetId: options.materialAssetId,
					renderSurfaceAssetId: assetId,
					format: asset.payload.format,
					formatRaw: asset.payload.formatRaw,
				},
			});
		}
	}

	for (const assetId of options.recipe.dependencies.paletteAssetIds) {
		const asset = options.preparedByAssetId[assetId];
		if (asset?.payload.kind !== "palette") {
			options.reportDiagnostic({
				key: `missing-palette:${options.materialAssetId}:${assetId}`,
				message: `Material ${options.materialAssetId} references missing palette ${assetId}.`,
				detail: {
					materialAssetId: options.materialAssetId,
					paletteAssetId: assetId,
					preparedKind: asset?.payload.kind ?? null,
				},
			});
		}
	}

	if (options.renderSurface && !options.texture) {
		if (isSupportedCompressedFormat(options.renderSurface.formatRaw)) {
			options.reportDiagnostic({
				key: `compressed-texture-extension-missing:${options.materialAssetId}:${options.renderSurface.renderSurfaceId}`,
				message: `Using placeholder material because ${formatRenderSurfaceAssetId(options.renderSurface.renderSurfaceId)} is ${options.renderSurface.format}, but S3TC compressed texture upload is unavailable.`,
				detail: {
					materialAssetId: options.materialAssetId,
					renderSurfaceId: formatHex32(options.renderSurface.renderSurfaceId),
					format: options.renderSurface.format,
					formatRaw: options.renderSurface.formatRaw,
					width: options.renderSurface.width,
					height: options.renderSurface.height,
					sourceByteLength: options.renderSurface.sourceByteLength,
				},
			});
			return;
		}
		options.reportDiagnostic({
			key: `texture-upload-failed:${options.materialAssetId}:${options.renderSurface.renderSurfaceId}`,
			message: `Using placeholder material because ${formatRenderSurfaceAssetId(options.renderSurface.renderSurfaceId)} could not be uploaded as a texture.`,
			detail: {
				materialAssetId: options.materialAssetId,
				renderSurfaceId: formatHex32(options.renderSurface.renderSurfaceId),
				format: options.renderSurface.format,
				formatRaw: options.renderSurface.formatRaw,
				width: options.renderSurface.width,
				height: options.renderSurface.height,
				sourceByteLength: options.renderSurface.sourceByteLength,
			},
		});
	}
}

function resolveIndexedMaterialResources(options: {
	recipe: PreparedMaterialRecipePayload;
	materialAssetId: string;
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
	renderSurface: PreparedRenderSurfacePayload;
	indexedTexture: IndexedTextureResource | null;
	resolvePaletteResource: (
		paletteAssetId: string,
		paletteAsset: PreparedAssetRecord,
	) => PaletteTextureResource | null;
	reportDiagnostic: MaterialResourceDiagnosticHandler;
}): IndexedMaterialResources | null {
	const renderSurfaceAssetId = formatRenderSurfaceAssetId(
		options.renderSurface.renderSurfaceId,
	);
	if (!options.indexedTexture) {
		options.reportDiagnostic({
			key: `indexed-texture-upload-failed:${options.materialAssetId}:${renderSurfaceAssetId}`,
			message: `Using placeholder material because ${renderSurfaceAssetId} could not be prepared as an indexed texture.`,
			detail: {
				materialAssetId: options.materialAssetId,
				renderSurfaceAssetId,
				format: options.renderSurface.format,
				formatRaw: options.renderSurface.formatRaw,
			},
		});
		return null;
	}

	const paletteSelection = selectIndexedPalette(
		options.recipe,
		options.renderSurface,
	);
	if (!paletteSelection) {
		options.reportDiagnostic({
			key: `indexed-texture-palette-missing:${options.materialAssetId}:${renderSurfaceAssetId}`,
			message: `Using placeholder material because ${renderSurfaceAssetId} is indexed but no palette ID could be resolved.`,
			detail: {
				materialAssetId: options.materialAssetId,
				renderSurfaceAssetId,
				format: options.renderSurface.format,
				formatRaw: options.renderSurface.formatRaw,
				defaultPaletteId: options.renderSurface.defaultPaletteId,
				recipePaletteId:
					options.recipe.source.kind === "texture"
						? options.recipe.source.paletteId
						: null,
			},
		});
		return null;
	}
	const { paletteAssetId } = paletteSelection;

	const paletteAsset = options.preparedByAssetId[paletteAssetId];
	if (paletteAsset?.payload.kind !== "palette") {
		options.reportDiagnostic({
			key: `indexed-texture-palette-unprepared:${options.materialAssetId}:${renderSurfaceAssetId}:${paletteAssetId}`,
			message: `Using placeholder material because ${renderSurfaceAssetId} requires palette ${paletteAssetId}, but it is not prepared.`,
			detail: {
				materialAssetId: options.materialAssetId,
				renderSurfaceAssetId,
				paletteAssetId,
				paletteId: paletteSelection.paletteId,
				paletteSource: paletteSelection.source,
				preparedKind: paletteAsset?.payload.kind ?? null,
			},
		});
		return null;
	}

	if (paletteAsset.payload.colorCount === 0) {
		options.reportDiagnostic({
			key: `indexed-texture-palette-empty:${options.materialAssetId}:${renderSurfaceAssetId}:${paletteAssetId}`,
			message: `Using placeholder material because ${renderSurfaceAssetId} requires empty palette ${paletteAssetId}.`,
			detail: {
				materialAssetId: options.materialAssetId,
				renderSurfaceAssetId,
				paletteAssetId,
				paletteId: paletteSelection.paletteId,
				paletteSource: paletteSelection.source,
				colorCount: paletteAsset.payload.colorCount,
			},
		});
		return null;
	}

	const paletteResource = options.resolvePaletteResource(
		paletteAssetId,
		paletteAsset,
	);
	if (!paletteResource) {
		options.reportDiagnostic({
			key: `indexed-texture-palette-resource-failed:${options.materialAssetId}:${renderSurfaceAssetId}:${paletteAssetId}`,
			message: `Using placeholder material because palette ${paletteAssetId} could not be prepared for ${renderSurfaceAssetId}.`,
			detail: {
				materialAssetId: options.materialAssetId,
				renderSurfaceAssetId,
				paletteAssetId,
				paletteId: paletteSelection.paletteId,
				paletteSource: paletteSelection.source,
			},
		});
		return null;
	}

	if (options.indexedTexture.maxIndex >= paletteResource.colorCount) {
		options.reportDiagnostic({
			key: `indexed-texture-index-out-of-range:${options.materialAssetId}:${renderSurfaceAssetId}:${paletteAssetId}`,
			message: `Using placeholder material because ${renderSurfaceAssetId} references palette index ${options.indexedTexture.maxIndex}, but ${paletteAssetId} has ${paletteResource.colorCount} colors.`,
			detail: {
				materialAssetId: options.materialAssetId,
				renderSurfaceAssetId,
				paletteAssetId,
				paletteId: paletteSelection.paletteId,
				paletteSource: paletteSelection.source,
				maxIndex: options.indexedTexture.maxIndex,
				colorCount: paletteResource.colorCount,
			},
		});
		return null;
	}

	return {
		indexedTexture: options.indexedTexture,
		palette: paletteResource,
	};
}

function countPreparedAssetsByKind(
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const asset of Object.values(preparedByAssetId)) {
		counts[asset.payload.kind] = (counts[asset.payload.kind] ?? 0) + 1;
	}
	return counts;
}

function countPreparedMaterialRecipes(
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): number {
	return Object.values(preparedByAssetId).filter(
		(asset) => asset.payload.kind === "material-recipe",
	).length;
}

function samplePreparedMaterialAssetIds(
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): string[] {
	return Object.keys(preparedByAssetId)
		.filter((assetId) => assetId.startsWith("material/"))
		.sort()
		.slice(0, 12);
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

function firstTextureUploadCandidateRenderSurface(
	recipe: PreparedMaterialRecipePayload,
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): PreparedRenderSurfacePayload | null {
	const assetIds = textureCandidateRenderSurfaceAssetIds(recipe);
	for (const assetId of assetIds) {
		const asset = preparedByAssetId[assetId];
		if (
			asset?.payload.kind === "render-surface" &&
			(isSupportedDirectColorFormat(asset.payload.formatRaw) ||
				isSupportedCompressedFormat(asset.payload.formatRaw))
		) {
			return asset.payload;
		}
	}
	return null;
}

function firstPreparedIndexedRenderSurface(
	recipe: PreparedMaterialRecipePayload,
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): PreparedRenderSurfacePayload | null {
	const assetIds = textureCandidateRenderSurfaceAssetIds(recipe);
	for (const assetId of assetIds) {
		const asset = preparedByAssetId[assetId];
		if (
			asset?.payload.kind === "render-surface" &&
			isIndexedTextureFormat(asset.payload.formatRaw)
		) {
			return asset.payload;
		}
	}
	return null;
}

function textureCandidateRenderSurfaceAssetIds(
	recipe: PreparedMaterialRecipePayload,
): string[] {
	return recipe.source.kind === "texture"
		? recipe.source.renderSurfaceIds.map(formatRenderSurfaceAssetId)
		: recipe.dependencies.renderSurfaceAssetIds;
}

function formatRenderSurfaceAssetId(renderSurfaceId: number): string {
	return `render-surface/${formatHex32(renderSurfaceId)}`;
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
	return new Color(red / BYTE_MAX, green / BYTE_MAX, blue / BYTE_MAX);
}

function normalizeLegacyOpacity(translucency: number): number {
	const normalized =
		translucency > 1
			? 1 - Math.min(translucency, LEGACY_OPACITY_BYTE_SCALE) / BYTE_MAX
			: 1 - translucency;
	return Math.max(0, Math.min(1, normalized));
}

function colorFromString(
	value: string,
	saturation: number,
	lightness: number,
): Color {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * COLOR_HASH_MULTIPLIER + value.charCodeAt(index)) >>> 0;
	}
	return new Color().setHSL(
		(hash % HUE_DEGREES) / HUE_DEGREES,
		saturation,
		lightness,
	);
}
