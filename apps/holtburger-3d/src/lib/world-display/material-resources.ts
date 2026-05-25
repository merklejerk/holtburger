import {
	Color,
	CompressedTexture,
	DataTexture,
	LinearFilter,
	MeshStandardMaterial,
	NoColorSpace,
	RGBA_S3TC_DXT1_Format,
	RGBA_S3TC_DXT3_Format,
	RGBA_S3TC_DXT5_Format,
	RGBAFormat,
	SRGBColorSpace,
	UnsignedByteType,
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
	createIndexedTextureResource,
	isIndexedTextureFormat,
	selectIndexedPalette,
	type IndexedTextureResource,
} from "./indexed-texture-resources";
import {
	createPaletteTextureResource,
	type PaletteTextureResource,
} from "./palette-resources";
import type { MaterialGeometrySlot } from "./static-renderable-geometry";

export interface ResolvedMaterialSlot {
	slotIndex: number;
	surfaceId: number;
	materialAssetId: string;
}

export interface MaterialResourcePlan {
	signature: string;
	materials: Material[];
	geometrySlots: MaterialGeometrySlot[];
}

export interface MaterialResourceDiagnostic {
	key: string;
	message: string;
	detail: Record<string, unknown>;
}

type MaterialResourceDiagnosticHandler = (
	diagnostic: MaterialResourceDiagnostic,
) => void;

export interface MaterialTextureCapabilities {
	supportsS3tc: boolean;
	supportsS3tcSrgb: boolean;
}

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

const FALLBACK_MATERIAL_ASSET_ID = "material/fallback";
const PIXEL_FORMAT_R8G8B8 = 0x14;
const PIXEL_FORMAT_A8R8G8B8 = 0x15;
const PIXEL_FORMAT_X8R8G8B8 = 0x16;
const PIXEL_FORMAT_R5G6B5 = 0x17;
const PIXEL_FORMAT_A4R4G4B4 = 0x1a;
const PIXEL_FORMAT_A8 = 0x1c;
const PIXEL_FORMAT_CUSTOM_LANDSCAPE_R8G8B8 = 0xf3;
const PIXEL_FORMAT_DXT1 = 0x3154_5844;
const PIXEL_FORMAT_DXT3 = 0x3354_5844;
const PIXEL_FORMAT_DXT5 = 0x3554_5844;
const FULL_ALPHA = 255;
const BYTE_MAX = 255;
const R5G6B5_RED_SHIFT = 11;
const R5G6B5_GREEN_SHIFT = 5;
const R5G6B5_RED_MASK = 0x1f;
const R5G6B5_GREEN_MASK = 0x3f;
const R5G6B5_BLUE_MASK = 0x1f;
const A4R4G4B4_ALPHA_SHIFT = 12;
const A4R4G4B4_RED_SHIFT = 8;
const A4R4G4B4_GREEN_SHIFT = 4;
const A4R4G4B4_CHANNEL_MASK = 0x0f;
const COLOR_HASH_MULTIPLIER = 31;
const HUE_DEGREES = 360;
const LEGACY_OPACITY_BYTE_SCALE = 255;

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
		appearanceKey: string;
		preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
		fallbackColorKey: string;
	}): MaterialResourcePlan {
		const slots =
			options.slots.length > 0
				? dedupeMaterialSlots(options.slots)
				: [
						{
							slotIndex: 0,
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
				...slots.map(
					(slot) =>
						`${slot.slotIndex}:${slot.surfaceId}:${slot.materialAssetId}`,
				),
			].join("|"),
			materials,
			geometrySlots: slots.map((slot, index) => ({
				surfaceId: slot.slotIndex + 1,
				materialIndex: index,
			})),
		};
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
		appearanceKey: string;
		preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
		fallbackColorKey: string;
	}): Material {
		const materialKey = [
			options.appearanceKey,
			options.materialAssetId,
			describeMaterialPreparedStateSignature(
				options.materialAssetId,
				options.preparedByAssetId,
			),
		].join("|");
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

		const texture = createTexture(
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

function describeMaterialPreparedStateSignature(
	materialAssetId: string,
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>,
): string {
	const recipeAsset = preparedByAssetId[materialAssetId];
	if (recipeAsset?.payload.kind !== "material-recipe") {
		return describePreparedAssetSignature(materialAssetId, recipeAsset);
	}

	const dependencyAssetIds = [
		...recipeAsset.payload.dependencies.renderTextureAssetIds,
		...recipeAsset.payload.dependencies.renderSurfaceAssetIds,
		...recipeAsset.payload.dependencies.paletteAssetIds,
	];
	return [
		describePreparedAssetSignature(materialAssetId, recipeAsset),
		...dependencyAssetIds
			.sort()
			.map((assetId) =>
				describePreparedAssetSignature(assetId, preparedByAssetId[assetId]),
			),
	].join(";");
}

function describePreparedAssetSignature(
	assetId: string,
	asset: PreparedAssetRecord | undefined,
): string {
	if (!asset) {
		return `${assetId}:missing`;
	}

	const baseSignature = `${assetId}:${asset.payload.kind}:${asset.preparedAt}:${asset.payload.provenance.errorCode ?? "ok"}`;
	if (asset.payload.kind === "render-surface") {
		return [
			baseSignature,
			asset.payload.formatRaw,
			asset.payload.width,
			asset.payload.height,
			asset.payload.sourceByteLength,
			asset.payload.defaultPaletteId ?? "no-palette",
		].join(":");
	}
	if (asset.payload.kind === "palette") {
		return [
			baseSignature,
			asset.payload.paletteId,
			asset.payload.colorCount,
		].join(":");
	}
	if (asset.payload.kind === "material-recipe") {
		return [
			baseSignature,
			asset.payload.surfaceType,
			asset.payload.source.kind,
		].join(":");
	}
	return baseSignature;
}

function describePaletteResourceKey(
	assetId: string,
	asset: PreparedAssetRecord,
): string {
	if (asset.payload.kind !== "palette") {
		return describePreparedAssetSignature(assetId, asset);
	}
	return [
		describePreparedAssetSignature(assetId, asset),
		asset.payload.paletteId,
		asset.payload.colorCount,
	].join(":");
}

export function formatMaterialAssetId(surfaceId: number): string {
	return `material/${formatHex32(surfaceId)}`;
}

function dedupeMaterialSlots(
	slots: readonly ResolvedMaterialSlot[],
): ResolvedMaterialSlot[] {
	const slotByIndex = new Map<number, ResolvedMaterialSlot>();
	for (const slot of slots) {
		slotByIndex.set(slot.slotIndex, slot);
	}
	return [...slotByIndex.values()].sort(
		(left, right) => left.slotIndex - right.slotIndex,
	);
}

function createMaterial(options: {
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

function createTexture(
	renderSurface: PreparedRenderSurfacePayload,
	capabilities: MaterialTextureCapabilities = {
		supportsS3tc: false,
		supportsS3tcSrgb: false,
	},
): Texture | null {
	if (isSupportedCompressedFormat(renderSurface.formatRaw)) {
		return createCompressedTexture(renderSurface, capabilities);
	}
	if (!isSupportedDirectColorFormat(renderSurface.formatRaw)) {
		return null;
	}
	const rgba = decodeDirectColorRenderSurface(renderSurface);
	const texture = new DataTexture(
		rgba,
		renderSurface.width,
		renderSurface.height,
		RGBAFormat,
		UnsignedByteType,
	);
	texture.colorSpace = SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function createCompressedTexture(
	renderSurface: PreparedRenderSurfacePayload,
	capabilities: MaterialTextureCapabilities,
): Texture | null {
	if (!capabilities.supportsS3tc) {
		return null;
	}
	const format = compressedTextureFormat(renderSurface.formatRaw);
	if (format === null) {
		return null;
	}
	const expectedByteLength = expectedCompressedSourceByteLength(renderSurface);
	if (renderSurface.sourceBytes.byteLength !== expectedByteLength) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} ${renderSurface.format} expected ${expectedByteLength} compressed source bytes, got ${renderSurface.sourceBytes.byteLength}.`,
		);
	}
	if (renderSurface.sourceByteLength !== renderSurface.sourceBytes.byteLength) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} declared ${renderSurface.sourceByteLength} source bytes but binary payload carried ${renderSurface.sourceBytes.byteLength}.`,
		);
	}

	const texture = new CompressedTexture(
		[
			{
				data: renderSurface.sourceBytes,
				width: renderSurface.width,
				height: renderSurface.height,
			},
		],
		renderSurface.width,
		renderSurface.height,
		format,
		UnsignedByteType,
		undefined,
		undefined,
		undefined,
		LinearFilter,
		LinearFilter,
		undefined,
		capabilities.supportsS3tcSrgb ? SRGBColorSpace : NoColorSpace,
	);
	texture.needsUpdate = true;
	return texture;
}

function decodeDirectColorRenderSurface(
	renderSurface: PreparedRenderSurfacePayload,
): Uint8Array {
	const pixelCount = assertValidSurfaceDimensions(renderSurface);
	const expectedByteLength = expectedDirectColorSourceByteLength(renderSurface);
	if (renderSurface.sourceBytes.byteLength !== expectedByteLength) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} ${renderSurface.format} expected ${expectedByteLength} source bytes, got ${renderSurface.sourceBytes.byteLength}.`,
		);
	}
	if (renderSurface.sourceByteLength !== renderSurface.sourceBytes.byteLength) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} declared ${renderSurface.sourceByteLength} source bytes but binary payload carried ${renderSurface.sourceBytes.byteLength}.`,
		);
	}

	const rgba = new Uint8Array(pixelCount * 4);
	const source = renderSurface.sourceBytes;
	switch (renderSurface.formatRaw) {
		case PIXEL_FORMAT_R8G8B8:
		case PIXEL_FORMAT_CUSTOM_LANDSCAPE_R8G8B8:
			for (let pixel = 0; pixel < pixelCount; pixel += 1) {
				const sourceOffset = pixel * 3;
				const targetOffset = pixel * 4;
				rgba[targetOffset] = source[sourceOffset] ?? 0;
				rgba[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
				rgba[targetOffset + 2] = source[sourceOffset + 2] ?? 0;
				rgba[targetOffset + 3] = FULL_ALPHA;
			}
			return rgba;
		case PIXEL_FORMAT_A8R8G8B8:
		case PIXEL_FORMAT_X8R8G8B8:
			for (let pixel = 0; pixel < pixelCount; pixel += 1) {
				const sourceOffset = pixel * 4;
				const targetOffset = pixel * 4;
				rgba[targetOffset] = source[sourceOffset + 2] ?? 0;
				rgba[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
				rgba[targetOffset + 2] = source[sourceOffset] ?? 0;
				rgba[targetOffset + 3] =
					renderSurface.formatRaw === PIXEL_FORMAT_A8R8G8B8
						? (source[sourceOffset + 3] ?? FULL_ALPHA)
						: FULL_ALPHA;
			}
			return rgba;
		case PIXEL_FORMAT_R5G6B5:
			for (let pixel = 0; pixel < pixelCount; pixel += 1) {
				const sourceOffset = pixel * 2;
				const targetOffset = pixel * 4;
				const value =
					(source[sourceOffset] ?? 0) | ((source[sourceOffset + 1] ?? 0) << 8);
				rgba[targetOffset] = scaleBitsToByte(
					(value >> R5G6B5_RED_SHIFT) & R5G6B5_RED_MASK,
					5,
				);
				rgba[targetOffset + 1] = scaleBitsToByte(
					(value >> R5G6B5_GREEN_SHIFT) & R5G6B5_GREEN_MASK,
					6,
				);
				rgba[targetOffset + 2] = scaleBitsToByte(value & R5G6B5_BLUE_MASK, 5);
				rgba[targetOffset + 3] = FULL_ALPHA;
			}
			return rgba;
		case PIXEL_FORMAT_A4R4G4B4:
			for (let pixel = 0; pixel < pixelCount; pixel += 1) {
				const sourceOffset = pixel * 2;
				const targetOffset = pixel * 4;
				const value =
					(source[sourceOffset] ?? 0) | ((source[sourceOffset + 1] ?? 0) << 8);
				rgba[targetOffset] = scaleBitsToByte(
					(value >> A4R4G4B4_RED_SHIFT) & A4R4G4B4_CHANNEL_MASK,
					4,
				);
				rgba[targetOffset + 1] = scaleBitsToByte(
					(value >> A4R4G4B4_GREEN_SHIFT) & A4R4G4B4_CHANNEL_MASK,
					4,
				);
				rgba[targetOffset + 2] = scaleBitsToByte(
					value & A4R4G4B4_CHANNEL_MASK,
					4,
				);
				rgba[targetOffset + 3] = scaleBitsToByte(
					(value >> A4R4G4B4_ALPHA_SHIFT) & A4R4G4B4_CHANNEL_MASK,
					4,
				);
			}
			return rgba;
		case PIXEL_FORMAT_A8:
			for (let pixel = 0; pixel < pixelCount; pixel += 1) {
				const targetOffset = pixel * 4;
				const value = source[pixel] ?? 0;
				rgba[targetOffset] = value;
				rgba[targetOffset + 1] = value;
				rgba[targetOffset + 2] = value;
				rgba[targetOffset + 3] = FULL_ALPHA;
			}
			return rgba;
		default:
			throw new Error(
				`Unsupported direct-color RenderSurface format ${renderSurface.formatRaw}.`,
			);
	}
}

function assertValidSurfaceDimensions(
	renderSurface: PreparedRenderSurfacePayload,
): number {
	if (renderSurface.width <= 0 || renderSurface.height <= 0) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} has invalid dimensions ${renderSurface.width}x${renderSurface.height}.`,
		);
	}
	const pixelCount = renderSurface.width * renderSurface.height;
	if (!Number.isSafeInteger(pixelCount)) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} dimensions are too large.`,
		);
	}
	return pixelCount;
}

function expectedDirectColorSourceByteLength(
	renderSurface: PreparedRenderSurfacePayload,
): number {
	const bytesPerPixel = directColorBytesPerPixel(renderSurface.formatRaw);
	if (bytesPerPixel === null) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} format ${renderSurface.format} is not a direct-color upload format.`,
		);
	}
	return renderSurface.width * renderSurface.height * bytesPerPixel;
}

function directColorBytesPerPixel(formatRaw: number): number | null {
	switch (formatRaw) {
		case PIXEL_FORMAT_R8G8B8:
		case PIXEL_FORMAT_CUSTOM_LANDSCAPE_R8G8B8:
			return 3;
		case PIXEL_FORMAT_A8R8G8B8:
		case PIXEL_FORMAT_X8R8G8B8:
			return 4;
		case PIXEL_FORMAT_R5G6B5:
		case PIXEL_FORMAT_A4R4G4B4:
			return 2;
		case PIXEL_FORMAT_A8:
			return 1;
		default:
			return null;
	}
}

function isSupportedDirectColorFormat(formatRaw: number): boolean {
	return directColorBytesPerPixel(formatRaw) !== null;
}

function hasSourceAlpha(formatRaw: number): boolean {
	return (
		formatRaw === PIXEL_FORMAT_A8R8G8B8 ||
		formatRaw === PIXEL_FORMAT_A4R4G4B4 ||
		formatRaw === PIXEL_FORMAT_DXT3 ||
		formatRaw === PIXEL_FORMAT_DXT5
	);
}

function isSupportedCompressedFormat(formatRaw: number): boolean {
	return compressedTextureFormat(formatRaw) !== null;
}

function compressedTextureFormat(
	formatRaw: number,
):
	| typeof RGBA_S3TC_DXT1_Format
	| typeof RGBA_S3TC_DXT3_Format
	| typeof RGBA_S3TC_DXT5_Format
	| null {
	switch (formatRaw) {
		case PIXEL_FORMAT_DXT1:
			return RGBA_S3TC_DXT1_Format;
		case PIXEL_FORMAT_DXT3:
			return RGBA_S3TC_DXT3_Format;
		case PIXEL_FORMAT_DXT5:
			return RGBA_S3TC_DXT5_Format;
		default:
			return null;
	}
}

function expectedCompressedSourceByteLength(
	renderSurface: PreparedRenderSurfacePayload,
): number {
	assertValidSurfaceDimensions(renderSurface);
	const bytesPerBlock = compressedBytesPerBlock(renderSurface.formatRaw);
	if (bytesPerBlock === null) {
		throw new Error(
			`RenderSurface ${formatHex32(renderSurface.renderSurfaceId)} format ${renderSurface.format} is not a compressed upload format.`,
		);
	}
	return (
		Math.floor((renderSurface.width + 3) / 4) *
		Math.floor((renderSurface.height + 3) / 4) *
		bytesPerBlock
	);
}

function compressedBytesPerBlock(formatRaw: number): number | null {
	switch (formatRaw) {
		case PIXEL_FORMAT_DXT1:
			return 8;
		case PIXEL_FORMAT_DXT3:
		case PIXEL_FORMAT_DXT5:
			return 16;
		default:
			return null;
	}
}

function scaleBitsToByte(value: number, bitCount: number): number {
	const maxValue = (1 << bitCount) - 1;
	return Math.round((value / maxValue) * 255);
}

function describeRenderSurfaceDecodeKey(
	renderSurface: PreparedRenderSurfacePayload,
): string {
	return [
		renderSurface.renderSurfaceId,
		renderSurface.formatRaw,
		renderSurface.width,
		renderSurface.height,
		renderSurface.sourceByteLength,
	].join(":");
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
