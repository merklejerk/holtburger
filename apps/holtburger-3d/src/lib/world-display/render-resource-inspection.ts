import type { Webgl2WorldResourceStore } from "./webgl2-world-resources";
import { formatHex32 } from "../landblocks";
import type { IndexedTextureFormat } from "./indexed-material-data";
import type {
	TexturePageBucket,
	TexturePageKind,
	TexturePageSampleClass,
} from "./texture-pages/texture-page-binding";
import type { Webgl2TexturePageSamplerPolicyKey } from "./webgl2/resources/texture-page-upload";

export const RENDER_RESOURCE_INSPECTION_OWNER_KIND = {
	staticBundle: "static-bundle",
	structuredInterior: "structured-interior",
	terrain: "terrain",
} as const;

export type RenderResourceInspectionOwnerKind =
	(typeof RENDER_RESOURCE_INSPECTION_OWNER_KIND)[keyof typeof RENDER_RESOURCE_INSPECTION_OWNER_KIND];

type MaterialResourceInspectionOwnerKind = Extract<
	RenderResourceInspectionOwnerKind,
	| typeof RENDER_RESOURCE_INSPECTION_OWNER_KIND.staticBundle
	| typeof RENDER_RESOURCE_INSPECTION_OWNER_KIND.structuredInterior
>;

export interface RenderResourceInspectionSnapshot {
	readonly generatedAtMs: number;
	readonly summary: RenderResourceInspectionSummary;
	readonly staticBundleLayers: readonly RenderResourceInspectionStaticBundleLayer[];
	readonly structuredInteriorCells: readonly RenderResourceInspectionStructuredInteriorCell[];
	readonly texturePages: readonly RenderResourceInspectionTexturePage[];
	readonly materials: readonly RenderResourceInspectionMaterial[];
	readonly geometry: readonly RenderResourceInspectionGeometry[];
}

export interface RenderResourceInspectionSummary {
	readonly staticBundleLayerCount: number;
	readonly structuredInteriorCellCount: number;
	readonly texturePageCount: number;
	readonly materialCount: number;
	readonly geometryResourceCount: number;
	readonly triangleCount: number;
	readonly texturePageEntryCount: number;
}

export interface RenderResourceInspectionStaticBundleLayer {
	readonly key: string;
	readonly scope: string;
	readonly landblockId: number;
	readonly bundleKind: string;
	readonly sourceObjectCount: number;
	readonly objectRecordCount: number;
	readonly spatialHintCount: number;
	readonly materialCount: number;
	readonly texturePageCount: number;
	readonly compactedBatchCount: number;
	readonly directEntryCount: number;
	readonly triangleCount: number;
}

export interface RenderResourceInspectionStructuredInteriorCell {
	readonly key: string;
	readonly artifactKey: string;
	readonly landblockId: number;
	readonly envCellId: number;
	readonly materialSliceCount: number;
	readonly hasFallbackShell: boolean;
	readonly materialCount: number;
	readonly texturePageCount: number;
	readonly triangleCount: number;
}

export interface RenderResourceInspectionTexturePage {
	readonly key: string;
	readonly ownerKind: RenderResourceInspectionOwnerKind;
	readonly ownerKey: string;
	readonly bucket: TexturePageBucket;
	readonly sampleClass: TexturePageSampleClass;
	readonly pageKind: TexturePageKind;
	readonly indexedFormat: IndexedTextureFormat | null;
	readonly width: number;
	readonly height: number;
	readonly entryCount: number;
	readonly coveredPixelCount: number;
	readonly coverageRatio: number;
	readonly samplerPolicyKey: Webgl2TexturePageSamplerPolicyKey;
	readonly mipmapsGenerated: boolean;
}

export interface RenderResourceTexturePageIdentity {
	readonly ownerKind: RenderResourceInspectionOwnerKind;
	readonly ownerKey: string;
	readonly texturePageKey: string;
}

export interface RenderResourceTexturePreviewEntry {
	readonly virtualRefKey: string;
	readonly sourceAssetId: string;
	readonly rect: readonly [number, number, number, number];
}

export interface RenderResourceTexturePagePreview {
	readonly identity: RenderResourceTexturePageIdentity;
	readonly key: string;
	readonly bucket: TexturePageBucket;
	readonly sampleClass: TexturePageSampleClass;
	readonly pageKind: TexturePageKind;
	readonly indexedFormat: IndexedTextureFormat | null;
	readonly width: number;
	readonly height: number;
	readonly coveredPixelCount: number;
	readonly coverageRatio: number;
	readonly pixels: Uint8ClampedArray<ArrayBuffer>;
	readonly entries: readonly RenderResourceTexturePreviewEntry[];
}

export interface RenderResourceInspectionMaterial {
	readonly key: string;
	readonly ownerKind: MaterialResourceInspectionOwnerKind;
	readonly ownerKey: string;
	readonly familyKey: string;
	readonly alphaPolicy: string | null;
	readonly isTransparent: boolean;
	readonly textureBindingCount: number;
	readonly indexed: boolean;
	readonly detailTextureRefKey: string | null;
	readonly detailTiling: number;
	readonly geometryReferenceCount: number;
	readonly referencedIndexCount: number;
	readonly referencedTriangleCount: number;
}

type RenderResourceInspectionMaterialBase = Omit<
	RenderResourceInspectionMaterial,
	| "geometryReferenceCount"
	| "referencedIndexCount"
	| "referencedTriangleCount"
>;

export interface RenderResourceInspectionGeometry {
	readonly key: string;
	readonly ownerKind: MaterialResourceInspectionOwnerKind;
	readonly ownerKey: string;
	readonly geometryKind: "compacted-batch" | "direct-entry" | "material-slice" | "fallback-shell";
	readonly materialRecordKey: string | null;
	readonly vertexCount: number | null;
	readonly indexCount: number;
	readonly triangleCount: number;
}

export function createEmptyRenderResourceInspectionSnapshot(): RenderResourceInspectionSnapshot {
	return {
		generatedAtMs: 0,
		summary: {
			staticBundleLayerCount: 0,
			structuredInteriorCellCount: 0,
			texturePageCount: 0,
			materialCount: 0,
			geometryResourceCount: 0,
			triangleCount: 0,
			texturePageEntryCount: 0,
		},
		staticBundleLayers: [],
		structuredInteriorCells: [],
		texturePages: [],
		materials: [],
		geometry: [],
	};
}

export function inspectWebgl2WorldResources(
	store: Webgl2WorldResourceStore | null,
): RenderResourceInspectionSnapshot {
	if (!store) {
		return createEmptyRenderResourceInspectionSnapshot();
	}

	const staticBundleLayers = [
		...store.staticBundleLayerResources.layersByKey.values(),
	]
		.map((layer) => {
			const triangleCount = [
				...layer.compactedBatches,
				...layer.directEntries,
			].reduce((total, geometry) => total + geometry.triangleCount, 0);
			return {
				key: layer.key,
				scope: JSON.stringify(layer.scope),
				landblockId: layer.landblockId,
				bundleKind: layer.bundleKind,
				sourceObjectCount: layer.sourceObjectCount,
				objectRecordCount: layer.objectRecordCount,
				spatialHintCount: layer.spatialHintCount,
				materialCount: layer.materialRecords.length,
				texturePageCount: layer.texturePages.length,
				compactedBatchCount: layer.compactedBatches.length,
				directEntryCount: layer.directEntries.length,
				triangleCount,
			};
		})
		.sort(compareByKey);

	const structuredInteriorCells = [
		...store.structuredInteriorResources.cellsByKey.values(),
	]
		.map((cell) => ({
			key: cell.key,
			artifactKey: cell.artifactKey,
			landblockId: cell.landblockId,
			envCellId: cell.envCellId,
			materialSliceCount: cell.materialSlices.length,
			hasFallbackShell: cell.fallbackShell !== null,
			materialCount: cell.materialRecords.length,
			texturePageCount: cell.texturePages.length,
			triangleCount: cell.triangleCount,
		}))
		.sort(compareByKey);

	const texturePages: RenderResourceInspectionTexturePage[] = [];
	const materials: RenderResourceInspectionMaterialBase[] = [];
	const geometry: RenderResourceInspectionGeometry[] = [];

	for (const layer of store.staticBundleLayerResources.layersByKey.values()) {
		texturePages.push(
			...layer.texturePages.map((page) =>
				describeTexturePageResource(page, {
					ownerKind: RENDER_RESOURCE_INSPECTION_OWNER_KIND.staticBundle,
					ownerKey: layer.key,
				}),
			),
		);
		materials.push(
			...layer.materialRecords.map((material) => ({
				key: material.key,
				ownerKind: RENDER_RESOURCE_INSPECTION_OWNER_KIND.staticBundle,
				ownerKey: layer.key,
				familyKey: material.familyKey,
				alphaPolicy: material.family.alphaPolicy,
				isTransparent: material.isTransparent,
				textureBindingCount: material.textureBindings.length,
				indexed: material.indexedMaterial !== undefined,
				detailTextureRefKey: material.detailTextureRefKey,
				detailTiling: material.detailTiling,
			})),
		);
		geometry.push(
			...layer.compactedBatches.map((entry) => ({
				key: entry.key,
				ownerKind: RENDER_RESOURCE_INSPECTION_OWNER_KIND.staticBundle,
				ownerKey: layer.key,
				geometryKind: "compacted-batch" as const,
				materialRecordKey: entry.materialRecordKey,
				vertexCount: entry.vertexCount,
				indexCount: entry.indexCount,
				triangleCount: entry.triangleCount,
			})),
			...layer.directEntries.map((entry) => ({
				key: entry.key,
				ownerKind: RENDER_RESOURCE_INSPECTION_OWNER_KIND.staticBundle,
				ownerKey: layer.key,
				geometryKind: "direct-entry" as const,
				materialRecordKey: entry.materialRecordKey,
				vertexCount: entry.vertexCount,
				indexCount: entry.indexCount,
				triangleCount: entry.triangleCount,
			})),
		);
	}

	for (const cell of store.structuredInteriorResources.cellsByKey.values()) {
		texturePages.push(
			...cell.texturePages.map((page) =>
				describeTexturePageResource(page, {
					ownerKind: RENDER_RESOURCE_INSPECTION_OWNER_KIND.structuredInterior,
					ownerKey: cell.key,
				}),
			),
		);
		materials.push(
			...cell.materialRecords.map((material) => ({
				key: material.key,
				ownerKind: RENDER_RESOURCE_INSPECTION_OWNER_KIND.structuredInterior,
				ownerKey: cell.key,
				familyKey: material.familyKey,
				alphaPolicy: material.family.alphaPolicy,
				isTransparent: material.isTransparent,
				textureBindingCount: material.textureBindings.length,
				indexed: material.indexedMaterial !== undefined,
				detailTextureRefKey: material.detailTextureRefKey,
				detailTiling: material.detailTiling,
			})),
		);
		geometry.push(
			...cell.materialSlices.map((slice) => ({
				key: slice.key,
				ownerKind: RENDER_RESOURCE_INSPECTION_OWNER_KIND.structuredInterior,
				ownerKey: cell.key,
				geometryKind: "material-slice" as const,
				materialRecordKey: slice.materialRecordKey,
				vertexCount: null,
				indexCount: slice.indexCount,
				triangleCount: slice.triangleCount,
			})),
		);
		if (cell.fallbackShell) {
			geometry.push({
				key: `${cell.key}:fallback-shell`,
				ownerKind: RENDER_RESOURCE_INSPECTION_OWNER_KIND.structuredInterior,
				ownerKey: cell.key,
				geometryKind: "fallback-shell",
				materialRecordKey: null,
				vertexCount: null,
				indexCount: cell.fallbackShell.indexCount,
				triangleCount: cell.fallbackShell.triangleCount,
			});
		}
	}

	for (const page of store.productTerrainTexturePagesByKey.values()) {
		texturePages.push(
			describeTexturePageResource(page, {
				ownerKind: RENDER_RESOURCE_INSPECTION_OWNER_KIND.terrain,
				ownerKey: "terrain-texture-pages",
			}),
		);
	}

	texturePages.sort(compareByKey);
	geometry.sort(compareByKey);
	const materialUsageByKey = buildMaterialUsageByKey(geometry);
	const materialsWithUsage = materials
		.map((material) => {
			const usage = materialUsageByKey.get(material.key);
			return {
				...material,
				geometryReferenceCount: usage?.geometryReferenceCount ?? 0,
				referencedIndexCount: usage?.referencedIndexCount ?? 0,
				referencedTriangleCount: usage?.referencedTriangleCount ?? 0,
			};
		})
		.sort(compareByKey);

	return {
		generatedAtMs: Date.now(),
		summary: {
			staticBundleLayerCount: staticBundleLayers.length,
			structuredInteriorCellCount: structuredInteriorCells.length,
			texturePageCount: texturePages.length,
			materialCount: materials.length,
			geometryResourceCount: geometry.length,
			triangleCount: geometry.reduce(
				(total, resource) => total + resource.triangleCount,
				0,
			),
			texturePageEntryCount: texturePages.reduce(
				(total, page) => total + page.entryCount,
				0,
			),
		},
		staticBundleLayers,
		structuredInteriorCells,
		texturePages,
		materials: materialsWithUsage,
		geometry,
	};
}

export function formatRenderResourceInspectionKeyForDisplay(key: string): string {
	return key
		.replace(
			/\benv-cell:(\d+):(\d+)(?=:)/g,
			(_match, landblockId: string, envCellId: string) =>
				`env-cell:0x${formatHex32(Number(landblockId))}:0x${formatHex32(Number(envCellId))}`,
		)
		.replace(
			/\blandblock:(\d+)(?=:)/g,
			(_match, landblockId: string) =>
				`landblock:0x${formatHex32(Number(landblockId))}`,
		);
}

function compareByKey<T extends { readonly key: string }>(left: T, right: T): number {
	return left.key.localeCompare(right.key);
}

interface InspectableTexturePageResource {
	readonly key: string;
	readonly bucket: TexturePageBucket;
	readonly sampleClass: TexturePageSampleClass;
	readonly pageKind: TexturePageKind;
	readonly indexedFormat?: IndexedTextureFormat | null;
	readonly texture: {
		readonly width: number;
		readonly height: number;
	};
	readonly entries: readonly {
		readonly rect: readonly [number, number, number, number];
	}[];
	readonly samplerPolicyKey: Webgl2TexturePageSamplerPolicyKey;
	readonly mipmapsGenerated: boolean;
}

function describeTexturePageResource(
	page: InspectableTexturePageResource,
	owner: Pick<RenderResourceInspectionTexturePage, "ownerKind" | "ownerKey">,
): RenderResourceInspectionTexturePage {
	const coverage = calculateTexturePageCoverage({
		width: page.texture.width,
		height: page.texture.height,
		rects: page.entries.map((entry) => entry.rect),
	});
	return {
		key: page.key,
		ownerKind: owner.ownerKind,
		ownerKey: owner.ownerKey,
		bucket: page.bucket,
		sampleClass: page.sampleClass,
		pageKind: page.pageKind,
		indexedFormat: page.indexedFormat ?? null,
		width: page.texture.width,
		height: page.texture.height,
		entryCount: page.entries.length,
		coveredPixelCount: coverage.coveredPixelCount,
		coverageRatio: coverage.coverageRatio,
		samplerPolicyKey: page.samplerPolicyKey,
		mipmapsGenerated: page.mipmapsGenerated,
	};
}

export function calculateTexturePageCoverage({
	width,
	height,
	rects,
}: {
	width: number;
	height: number;
	rects: readonly (readonly [number, number, number, number])[];
}): { coveredPixelCount: number; coverageRatio: number } {
	const texture = { width, height };
	const normalizedRects = rects
		.map((rect) => normalizeTexturePageRect(rect, texture))
		.filter((rect) => rect.width > 0 && rect.height > 0);
	if (normalizedRects.length === 0) {
		return { coveredPixelCount: 0, coverageRatio: 0 };
	}

	const xEdges = [...new Set(
		normalizedRects.flatMap((rect) => [rect.x, rect.x + rect.width]),
	)].sort(compareNumericAscending);
	let coveredPixelCount = 0;
	for (let index = 0; index < xEdges.length - 1; index += 1) {
		const left = xEdges[index] ?? 0;
		const right = xEdges[index + 1] ?? left;
		const width = right - left;
		if (width <= 0) {
			continue;
		}

		const spans = normalizedRects
			.filter((rect) => rect.x < right && rect.x + rect.width > left)
			.map((rect) => [rect.y, rect.y + rect.height] as const)
			.sort((first, second) => first[0] - second[0]);
		coveredPixelCount += width * calculateCoveredSpanLength(spans);
	}

	const texturePixelCount = Math.max(0, width) * Math.max(0, height);
	return {
		coveredPixelCount,
		coverageRatio:
			texturePixelCount === 0 ? 0 : coveredPixelCount / texturePixelCount,
	};
}

function normalizeTexturePageRect(
	rect: readonly [number, number, number, number],
	texture: InspectableTexturePageResource["texture"],
): { x: number; y: number; width: number; height: number } {
	const [rawX, rawY, rawWidth, rawHeight] = rect;
	const x = clampNumber(rawX, 0, texture.width);
	const y = clampNumber(rawY, 0, texture.height);
	const maxX = clampNumber(rawX + rawWidth, 0, texture.width);
	const maxY = clampNumber(rawY + rawHeight, 0, texture.height);
	return {
		x,
		y,
		width: Math.max(0, maxX - x),
		height: Math.max(0, maxY - y),
	};
}

function calculateCoveredSpanLength(
	spans: readonly (readonly [number, number])[],
): number {
	let coveredLength = 0;
	let currentStart: number | null = null;
	let currentEnd = 0;
	for (const [start, end] of spans) {
		if (currentStart === null) {
			currentStart = start;
			currentEnd = end;
			continue;
		}
		if (start > currentEnd) {
			coveredLength += currentEnd - currentStart;
			currentStart = start;
			currentEnd = end;
			continue;
		}
		currentEnd = Math.max(currentEnd, end);
	}
	if (currentStart !== null) {
		coveredLength += currentEnd - currentStart;
	}
	return coveredLength;
}

function compareNumericAscending(left: number, right: number): number {
	return left - right;
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

interface MaterialUsageCounts {
	geometryReferenceCount: number;
	referencedIndexCount: number;
	referencedTriangleCount: number;
}

function buildMaterialUsageByKey(
	geometry: readonly RenderResourceInspectionGeometry[],
): Map<string, MaterialUsageCounts> {
	const usageByKey = new Map<string, MaterialUsageCounts>();
	for (const resource of geometry) {
		if (resource.materialRecordKey === null) {
			continue;
		}

		const usage = usageByKey.get(resource.materialRecordKey) ?? {
			geometryReferenceCount: 0,
			referencedIndexCount: 0,
			referencedTriangleCount: 0,
		};
		usage.geometryReferenceCount += 1;
		usage.referencedIndexCount += resource.indexCount;
		usage.referencedTriangleCount += resource.triangleCount;
		usageByKey.set(resource.materialRecordKey, usage);
	}

	return usageByKey;
}
