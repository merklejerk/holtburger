import {
	resolveNormalizedPreparedTextureAssetIds,
	type MaterialTextureUsage,
} from "../assets/material-texture-preparation-policy";
import type {
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
	PreparedRenderSurfacePayload,
	PreparedTexturePayload,
} from "../assets/types";
import {
	createCompactionEligibility,
	type CompactionMaterialReadiness,
} from "./compaction/compaction-family-planner";
import {
	createIndexedTextureData,
	type IndexedTextureFormat,
	isIndexedTextureFormat,
	selectIndexedPalette,
} from "./indexed-material-data";
import {
	deriveLegacyMaterialBehaviorDto,
	isBase1ClipMapSurface,
} from "./material-behavior";
import { createPaletteData } from "./palette-data";
import type {
	StaticBundleIndexedMaterialRecord,
	VirtualTexturePageRef,
} from "./static-bundle-layer";
import type { TexturePageDescriptor } from "./texture-pages/texture-page-binding";
import { createStaticBundleTexturePageDescriptor } from "./static-bundle-layer-texture-pages";

export type StaticMaterialTextureRoute =
	| StaticMaterialPreparedTextureRoute
	| StaticMaterialIndexedTexelRoute
	| StaticMaterialPaletteRoute;

interface StaticMaterialPreparedTextureRoute {
	kind: "prepared-texture";
	materialAssetId: string;
	preparedTextureAssetId: string;
	renderSurfaceAssetId: string;
	usage: MaterialTextureUsage;
}

interface StaticMaterialIndexedTexelRoute {
	kind: "indexed-texels";
	materialAssetId: string;
	renderSurfaceAssetId: string;
	indexedFormat: IndexedTextureFormat;
	bytes: Uint8Array;
	width: number;
	height: number;
}

interface StaticMaterialPaletteRoute {
	kind: "palette-lookup";
	materialAssetId: string;
	paletteAssetId: string;
	bytes: Uint8Array;
	colorCount: number;
}

const STATIC_MATERIAL_TEXTURE_USAGES: readonly MaterialTextureUsage[] = [
	"raw",
	"detail",
];

export function collectStaticMaterialTextureRoutes(
	materialAssetIds: readonly string[],
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): StaticMaterialTextureRoute[] {
	const routesByKey = new Map<string, StaticMaterialTextureRoute>();
	for (const materialAssetId of uniqueSortedStrings(materialAssetIds)) {
		const material = getPreparedPayload(
			preparedByAssetId,
			materialAssetId,
			"material-recipe",
		);
		const indexedRoutes = collectIndexedMaterialTextureRoutes({
			materialAssetId,
			material,
			preparedByAssetId,
		});
		for (const route of indexedRoutes) {
			routesByKey.set(formatStaticMaterialTextureRouteKey(route), route);
		}
		const usages =
			indexedRoutes.length > 0
				? (["detail"] as const)
				: STATIC_MATERIAL_TEXTURE_USAGES;
		for (const renderSurfaceAssetId of material.dependencies
			.renderSurfaceAssetIds) {
			const renderSurface = getPreparedPayload(
				preparedByAssetId,
				renderSurfaceAssetId,
				"render-surface",
			);
			if (isIndexedTextureFormat(renderSurface.formatRaw)) {
				continue;
			}
			for (const usage of usages) {
				for (const preparedTextureAssetId of resolveNormalizedPreparedTextureAssetIds(
					{ renderSurface, usage },
				)) {
					const route = {
						kind: "prepared-texture" as const,
						materialAssetId,
						preparedTextureAssetId,
						renderSurfaceAssetId,
						usage,
					};
					routesByKey.set(formatStaticMaterialTextureRouteKey(route), route);
				}
			}
		}
	}
	return [...routesByKey.values()].sort((left, right) =>
		formatStaticMaterialTextureRouteKey(left).localeCompare(
			formatStaticMaterialTextureRouteKey(right),
		),
	);
}

export function collectStaticMaterialTexturePageRefs(
	materialTextureRoutes: readonly StaticMaterialTextureRoute[],
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): VirtualTexturePageRef[] {
	return materialTextureRoutes
		.map((route): VirtualTexturePageRef => {
			if (route.kind === "indexed-texels") {
				return {
					key: `texture:${route.materialAssetId}:${route.renderSurfaceAssetId}:indexed-texels`,
					sourceAssetId: route.renderSurfaceAssetId,
					usageBucket: "indexed-texels",
					sampleClass: "indexed-data",
					indexedFormat: route.indexedFormat,
					width: route.width,
					height: route.height,
					wrapS: "clamp",
					wrapT: "clamp",
					samplingDomain: "data",
					lookup: "exact",
					bytes: route.bytes,
				};
			}
			if (route.kind === "palette-lookup") {
				return {
					key: `texture:${route.materialAssetId}:${route.paletteAssetId}:palette-lookup`,
					sourceAssetId: route.paletteAssetId,
					usageBucket: "palette-lookup",
					sampleClass: "palette-data",
					width: route.colorCount,
					height: 1,
					wrapS: "clamp",
					wrapT: "clamp",
					samplingDomain: "data",
					lookup: "exact",
					bytes: route.bytes,
				};
			}
			const payload = getPreparedPayload(
				preparedByAssetId,
				route.preparedTextureAssetId,
				"prepared-texture",
			);
			const level = payload.levels[0];
			if (!level) {
				throw new Error(
					`Prepared texture ${route.preparedTextureAssetId} has no mip level 0.`,
				);
			}
			return {
				key: `texture:${route.materialAssetId}:${route.preparedTextureAssetId}`,
				sourceAssetId: route.preparedTextureAssetId,
				usageBucket: mapPreparedTextureUsageBucket(payload),
				sampleClass: mapPreparedTextureSampleClass(payload),
				width: level.width,
				height: level.height,
				wrapS: "clamp",
				wrapT: "clamp",
				samplingDomain: mapPreparedTextureSamplingDomain(payload),
				lookup: mapPreparedTextureLookup(payload),
				bytes: level.bytes,
			};
		})
		.sort((left, right) => left.key.localeCompare(right.key));
}

export function findStaticMaterialTextureRefs(
	materialAssetId: string,
	texturePageRefs: readonly VirtualTexturePageRef[],
	materialTextureRoutes: readonly StaticMaterialTextureRoute[],
): VirtualTexturePageRef[] {
	return materialTextureRoutes
		.filter((candidate) => candidate.materialAssetId === materialAssetId)
		.map((route) =>
			texturePageRefs.find(
				(ref) => ref.sourceAssetId === routeSourceAssetId(route),
			),
		)
		.filter((ref): ref is VirtualTexturePageRef => ref !== undefined)
		.sort((left, right) => left.key.localeCompare(right.key));
}

export function resolveStaticMaterialReadiness(options: {
	materialAssetId: string;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
	texturePageRefs: readonly VirtualTexturePageRef[];
	materialTextureRoutes: readonly StaticMaterialTextureRoute[];
}): CompactionMaterialReadiness {
	const material = getPreparedPayload(
		options.preparedByAssetId,
		options.materialAssetId,
		"material-recipe",
	);
	const behavior = deriveLegacyMaterialBehaviorDto({ recipe: material });
	const indexedRenderSurface = findIndexedRenderSurface(
		material,
		options.preparedByAssetId,
	);
	const materialRoutes = options.materialTextureRoutes.filter(
		(route) => route.materialAssetId === options.materialAssetId,
	);
	const texturePageBindings = materialRoutes
		.map((route) => {
			const ref = options.texturePageRefs.find(
				(candidate) => candidate.sourceAssetId === routeSourceAssetId(route),
			);
			return ref ? createStaticBundleTexturePageDescriptor(ref) : null;
		})
		.filter((binding): binding is TexturePageDescriptor => binding !== null);
	const baseRoute = materialRoutes.find(
		(route): route is StaticMaterialPreparedTextureRoute =>
			route.kind === "prepared-texture" && route.usage === "raw",
	);
	const baseTexturePageRef = baseRoute
		? (options.texturePageRefs.find(
				(ref) => ref.sourceAssetId === baseRoute.preparedTextureAssetId,
			) ?? null)
		: null;
	const baseTexture = baseRoute
		? getPreparedPayload(
				options.preparedByAssetId,
				baseRoute.preparedTextureAssetId,
				"prepared-texture",
			)
		: null;
	const level = baseTexture?.levels[0] ?? null;
	return {
		kind: indexedRenderSurface
			? "indexed-paletted"
			: material.source.kind === "texture"
				? "direct-texture"
				: "flat",
		behavior: indexedRenderSurface
			? deriveLegacyMaterialBehaviorDto({
					recipe: material,
					usesIndexedClipDiscard: true,
				})
			: behavior,
		texturePages: {
			base:
				baseRoute && baseTexturePageRef && baseTexture && level
					? {
							materialSlotKey: `static-material-slot:${options.materialAssetId}`,
							atlasEntryKey: baseTexturePageRef.key,
							renderStateKey: `static:${behavior.blend.mode}`,
							samplingKey: `${baseTexturePageRef.wrapS}:${baseTexturePageRef.wrapT}:${baseTexturePageRef.lookup}`,
							samplingPolicy: {
								wrapS: baseTexturePageRef.wrapS,
								wrapT: baseTexturePageRef.wrapT,
							},
							atlasEntry: {
								renderSurfaceId: baseTexture.renderSurfaceId,
								preparedTextureAssetId: baseRoute.preparedTextureAssetId,
								level,
								sourceHash: baseTexture.sourceHash,
								sourceFormatRaw: baseTexture.sourceFormatRaw,
							},
						}
					: null,
			bindings: texturePageBindings,
		},
		detailOverlay: {
			hasOverlay: false,
			atlasEntry: null,
		},
	};
}

export function resolveStaticIndexedMaterialRecord(options: {
	materialAssetId: string;
	materialTextureRoutes: readonly StaticMaterialTextureRoute[];
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): StaticBundleIndexedMaterialRecord | undefined {
	const indexRoute = options.materialTextureRoutes.find(
		(route): route is StaticMaterialIndexedTexelRoute =>
			route.kind === "indexed-texels" &&
			route.materialAssetId === options.materialAssetId,
	);
	if (!indexRoute) {
		return undefined;
	}
	const paletteRoute = options.materialTextureRoutes.find(
		(route): route is StaticMaterialPaletteRoute =>
			route.kind === "palette-lookup" &&
			route.materialAssetId === options.materialAssetId,
	);
	if (!paletteRoute) {
		throw new Error(
			`Static indexed material ${options.materialAssetId} has index texels but no palette lookup route.`,
		);
	}
	const material = getPreparedPayload(
		options.preparedByAssetId,
		options.materialAssetId,
		"material-recipe",
	);
	return {
		indexFormat: indexRoute.indexedFormat,
		width: indexRoute.width,
		height: indexRoute.height,
		paletteColorCount: paletteRoute.colorCount,
		wrapS: "clamp",
		wrapT: "clamp",
		clipThreshold: isBase1ClipMapSurface(material.surfaceType) ? 8 : -1,
	};
}

export function collectStaticPreparedTextureRouteAssetIds(
	asset: PreparedAssetRecord,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): string[] {
	if (asset.payload.kind !== "material-recipe") {
		return [];
	}
	const hasIndexedRenderSurface = findIndexedRenderSurface(
		asset.payload,
		preparedByAssetId,
	);
	const usages = hasIndexedRenderSurface
		? (["detail"] as const)
		: STATIC_MATERIAL_TEXTURE_USAGES;
	return asset.payload.dependencies.renderSurfaceAssetIds
		.map((renderSurfaceAssetId) => {
			const renderSurface = getPreparedPayload(
				preparedByAssetId,
				renderSurfaceAssetId,
				"render-surface",
			);
			if (isIndexedTextureFormat(renderSurface.formatRaw)) {
				return [];
			}
			return usages.flatMap((usage) =>
				resolveNormalizedPreparedTextureAssetIds({ renderSurface, usage }),
			);
		})
		.flat();
}

export function formatStaticMaterialFamilyKey(
	decision: ReturnType<typeof createCompactionEligibility>,
): string {
	const family =
		decision.decision === "compacted" ? decision.material.family : "direct";
	return `static:${family}:alpha=${decision.material.alphaPolicy}`;
}

function collectIndexedMaterialTextureRoutes(options: {
	materialAssetId: string;
	material: PreparedMaterialRecipePayload;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): StaticMaterialTextureRoute[] {
	const indexedRenderSurface = findIndexedRenderSurface(
		options.material,
		options.preparedByAssetId,
	);
	if (!indexedRenderSurface) {
		return [];
	}
	const paletteSelection = selectIndexedPalette({
		recipe: options.material,
		renderSurface: indexedRenderSurface.renderSurface,
		appearance: null,
	});
	if (!paletteSelection) {
		return [];
	}
	const palette = getPreparedPayload(
		options.preparedByAssetId,
		paletteSelection.paletteAssetId,
		"palette",
	);
	const indexedTexture = createIndexedTextureData(
		indexedRenderSurface.renderSurface,
	);
	const paletteData = createPaletteData({
		paletteAssetId: paletteSelection.paletteAssetId,
		palette,
	});
	if (indexedTexture.maxIndex >= paletteData.colorCount) {
		return [];
	}
	return [
		{
			kind: "indexed-texels",
			materialAssetId: options.materialAssetId,
			renderSurfaceAssetId: indexedRenderSurface.assetId,
			indexedFormat: indexedTexture.format,
			bytes: indexedTexture.sourceBytes,
			width: indexedTexture.width,
			height: indexedTexture.height,
		},
		{
			kind: "palette-lookup",
			materialAssetId: options.materialAssetId,
			paletteAssetId: paletteSelection.paletteAssetId,
			bytes: paletteData.colorsRgba,
			colorCount: paletteData.colorCount,
		},
	];
}

function findIndexedRenderSurface(
	material: PreparedMaterialRecipePayload,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): { assetId: string; renderSurface: PreparedRenderSurfacePayload } | null {
	for (const renderSurfaceAssetId of material.dependencies
		.renderSurfaceAssetIds) {
		const renderSurface = getPreparedPayload(
			preparedByAssetId,
			renderSurfaceAssetId,
			"render-surface",
		);
		if (isIndexedTextureFormat(renderSurface.formatRaw)) {
			return { assetId: renderSurfaceAssetId, renderSurface };
		}
	}
	return null;
}

function formatStaticMaterialTextureRouteKey(
	route: StaticMaterialTextureRoute,
): string {
	switch (route.kind) {
		case "prepared-texture":
			return `${route.materialAssetId}|prepared:${route.preparedTextureAssetId}`;
		case "indexed-texels":
			return `${route.materialAssetId}|indexed:${route.renderSurfaceAssetId}`;
		case "palette-lookup":
			return `${route.materialAssetId}|palette:${route.paletteAssetId}`;
	}
}

function routeSourceAssetId(route: StaticMaterialTextureRoute): string {
	switch (route.kind) {
		case "prepared-texture":
			return route.preparedTextureAssetId;
		case "indexed-texels":
			return route.renderSurfaceAssetId;
		case "palette-lookup":
			return route.paletteAssetId;
	}
}

function mapPreparedTextureUsageBucket(
	payload: PreparedTexturePayload,
): VirtualTexturePageRef["usageBucket"] {
	if (payload.usage === "detail") {
		return "detail";
	}
	if (payload.usage === "mask") {
		return "alpha-control";
	}
	return "base-color";
}

function mapPreparedTextureSampleClass(
	payload: PreparedTexturePayload,
): VirtualTexturePageRef["sampleClass"] {
	if (payload.usage === "mask") {
		return "control-data";
	}
	return payload.colorSpace === "data" ? "indexed-data" : "rgba-color";
}

function mapPreparedTextureSamplingDomain(
	payload: PreparedTexturePayload,
): VirtualTexturePageRef["samplingDomain"] {
	if (payload.usage === "mask") {
		return "control";
	}
	return payload.colorSpace === "data" ? "data" : "color";
}

function mapPreparedTextureLookup(
	payload: PreparedTexturePayload,
): VirtualTexturePageRef["lookup"] {
	if (payload.usage === "mask") {
		return "control-filtered";
	}
	return payload.colorSpace === "data" ? "exact" : "color-filtered";
}

function getPreparedAsset(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
	assetId: string,
): PreparedAssetRecord {
	const asset = preparedByAssetId.get(assetId);
	if (!asset) {
		throw new Error(
			`Static material artifact closure is missing required asset ${assetId}.`,
		);
	}
	return asset;
}

function getPreparedPayload<
	TKind extends PreparedAssetRecord["payload"]["kind"],
>(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
	assetId: string,
	kind: TKind,
): Extract<PreparedAssetRecord["payload"], { kind: TKind }> {
	const asset = getPreparedAsset(preparedByAssetId, assetId);
	if (asset.payload.kind !== kind) {
		throw new Error(
			`Static material artifact asset ${assetId} was ${asset.payload.kind}, expected ${kind}.`,
		);
	}
	return asset.payload as Extract<
		PreparedAssetRecord["payload"],
		{ kind: TKind }
	>;
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}
