import {
	resolveNormalizedPreparedTextureAssetIds,
	type MaterialTextureUsage,
} from "../assets/material-texture-preparation-policy";
import {
	createDefaultMaterialTextureSamplingPolicy,
	selectVariantTextureSamplingPolicy,
	type TextureWrapMode,
} from "./texture-pages/texture-sampling-policy";
import type {
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
	PreparedRenderSurfacePayload,
	PreparedTexturePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import {
	createCompactionEligibility,
	type CompactionAlphaPolicy,
	type CompactionMaterialFamily,
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
	DIRECT_CLIP_MAP_ALPHA_TEST,
	isBase1ClipMapSurface,
	type LegacyMaterialBehaviorDto,
} from "./material-behavior";
import { createPaletteData } from "./palette-data";
import { hasSourceAlpha } from "./render-surface-texture-data";
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

export type StaticMaterialTextureRouteRequest =
	| string
	| {
			materialAssetId: string;
			materialRecordKey?: string;
			materialVariantSignature?: string | null;
	  };

interface NormalizedStaticMaterialTextureRouteRequest {
	materialAssetId: string;
	materialRecordKey: string;
	materialVariantSignature: string | null;
}

interface StaticMaterialPreparedTextureRoute {
	kind: "prepared-texture";
	materialAssetId: string;
	materialRecordKey: string;
	materialVariantSignature: string | null;
	preparedTextureAssetId: string;
	renderSurfaceAssetId: string;
	usage: MaterialTextureUsage;
	wrapS: TextureWrapMode;
	wrapT: TextureWrapMode;
}

interface StaticMaterialIndexedTexelRoute {
	kind: "indexed-texels";
	materialAssetId: string;
	materialRecordKey: string;
	materialVariantSignature: string | null;
	renderSurfaceAssetId: string;
	indexedFormat: IndexedTextureFormat;
	bytes: Uint8Array;
	width: number;
	height: number;
	wrapS: TextureWrapMode;
	wrapT: TextureWrapMode;
}

interface StaticMaterialPaletteRoute {
	kind: "palette-lookup";
	materialAssetId: string;
	materialRecordKey: string;
	materialVariantSignature: string | null;
	paletteAssetId: string;
	bytes: Uint8Array;
	colorCount: number;
}

const STATIC_MATERIAL_TEXTURE_USAGES: readonly MaterialTextureUsage[] = [
	"raw",
];
const STATIC_MATERIAL_FAMILY_KEY_PREFIX = "static:";
const STATIC_MATERIAL_ALPHA_POLICY_KEY = "alpha";
const STATIC_MATERIAL_LEGACY_RGBA_TEXTURE_PAGE_FAMILY_KEY =
	"rgba-texture-page";
const STATIC_MATERIAL_LEGACY_INDEXED_PALETTED_FAMILY_KEY =
	"indexed-paletted";

const STATIC_MATERIAL_FAMILIES = new Set<string>([
	"flat-constant-color",
	"textured-opaque",
	"transparent-blended",
	"opacity-translucent",
	"indexed-paletted",
	"debug-pipeline",
	"unknown-unsupported",
]);
const STATIC_MATERIAL_ALPHA_POLICIES = new Set<string>([
	"opaque",
	"cutout",
	"transparent-blend",
	"opacity-translucent",
	"unknown",
]);

function normalizeStaticMaterialTextureRouteRequests(
	requests: readonly StaticMaterialTextureRouteRequest[],
): NormalizedStaticMaterialTextureRouteRequest[] {
	const requestsByKey = new Map<string, NormalizedStaticMaterialTextureRouteRequest>();
	for (const request of requests) {
		const normalized =
			typeof request === "string"
				? {
						materialAssetId: request,
						materialRecordKey: request,
						materialVariantSignature: null,
					}
				: {
						materialAssetId: request.materialAssetId,
						materialRecordKey:
							request.materialRecordKey ?? request.materialAssetId,
						materialVariantSignature:
							request.materialVariantSignature ?? null,
					};
		requestsByKey.set(
			[
				normalized.materialAssetId,
				normalized.materialRecordKey,
				normalized.materialVariantSignature ?? "base",
			].join("|"),
			normalized,
		);
	}
	return [...requestsByKey.values()].sort((left, right) =>
		[
			left.materialAssetId,
			left.materialRecordKey,
			left.materialVariantSignature ?? "base",
		]
			.join("|")
			.localeCompare(
				[
					right.materialAssetId,
					right.materialRecordKey,
					right.materialVariantSignature ?? "base",
				].join("|"),
			),
	);
}

function resolveStaticMaterialRouteWrapMode({
	renderSurface,
	materialVariantSignature,
}: {
	renderSurface: PreparedRenderSurfacePayload;
	materialVariantSignature: string | null;
}): { wrapS: TextureWrapMode; wrapT: TextureWrapMode } {
	const policy = selectVariantTextureSamplingPolicy(
		renderSurface,
		createDefaultMaterialTextureSamplingPolicy(),
		materialVariantSignature,
	);
	return {
		wrapS: policy.wrapS,
		wrapT: policy.wrapT,
	};
}

type StaticMaterialFamilyKind =
	| CompactionMaterialFamily
	| typeof STATIC_MATERIAL_LEGACY_RGBA_TEXTURE_PAGE_FAMILY_KEY;
type StaticMaterialSerializedFamilyKind = Exclude<
	StaticMaterialFamilyKind,
	typeof STATIC_MATERIAL_LEGACY_RGBA_TEXTURE_PAGE_FAMILY_KEY
>;

export type StaticMaterialFamilyDescriptor =
	| {
			readonly key: string;
			readonly kind: "flat-color";
			readonly sourceFamily: "flat-constant-color";
			readonly alphaPolicy: CompactionAlphaPolicy | null;
	  }
	| {
			readonly key: string;
			readonly kind: "texture-page";
			readonly sourceFamily:
				| "textured-opaque"
				| "transparent-blended"
				| "opacity-translucent"
				| typeof STATIC_MATERIAL_LEGACY_RGBA_TEXTURE_PAGE_FAMILY_KEY;
			readonly alphaPolicy: CompactionAlphaPolicy | null;
	  }
	| {
			readonly key: string;
			readonly kind: "indexed-paletted";
			readonly alphaPolicy: CompactionAlphaPolicy | null;
	  }
	| {
			readonly key: string;
			readonly kind: "unsupported";
			readonly sourceFamily: Exclude<
				StaticMaterialFamilyKind,
				| "textured-opaque"
				| "transparent-blended"
				| "opacity-translucent"
				| typeof STATIC_MATERIAL_LEGACY_RGBA_TEXTURE_PAGE_FAMILY_KEY
			>;
			readonly alphaPolicy: CompactionAlphaPolicy | null;
			readonly reason: string;
	  };


export function collectStaticMaterialTextureRoutes(
	requests: readonly StaticMaterialTextureRouteRequest[],
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): StaticMaterialTextureRoute[] {
	const routesByKey = new Map<string, StaticMaterialTextureRoute>();
	for (const request of normalizeStaticMaterialTextureRouteRequests(requests)) {
		const materialAssetId = request.materialAssetId;
		const material = getPreparedPayload(
			preparedByAssetId,
			materialAssetId,
			"material-recipe",
		);
		const indexedRoutes = collectIndexedMaterialTextureRoutes({
			request,
			material,
			preparedByAssetId,
		});
		for (const route of indexedRoutes) {
			routesByKey.set(formatStaticMaterialTextureRouteKey(route), route);
		}
		const usages =
			indexedRoutes.length > 0 ? ([] as const) : STATIC_MATERIAL_TEXTURE_USAGES;
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
						materialRecordKey: request.materialRecordKey,
						materialVariantSignature: request.materialVariantSignature,
						preparedTextureAssetId,
						renderSurfaceAssetId,
						usage,
						...resolveStaticMaterialRouteWrapMode({
							renderSurface,
							materialVariantSignature: request.materialVariantSignature,
						}),
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
					key: formatStaticMaterialTextureRefKey(route),
					sourceAssetId: route.renderSurfaceAssetId,
					usageBucket: "indexed-texels",
					sampleClass: "indexed-data",
					indexedFormat: route.indexedFormat,
					width: route.width,
					height: route.height,
					wrapS: route.wrapS,
					wrapT: route.wrapT,
					samplingDomain: "data",
					lookup: "exact",
					bytes: route.bytes,
				};
			}
			if (route.kind === "palette-lookup") {
				return {
					key: formatStaticMaterialTextureRefKey(route),
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
				key: formatStaticMaterialTextureRefKey(route),
				sourceAssetId: route.preparedTextureAssetId,
				usageBucket: mapPreparedTextureUsageBucket(payload),
				sampleClass: mapPreparedTextureSampleClass(payload),
				width: level.width,
				height: level.height,
				wrapS: route.wrapS,
				wrapT: route.wrapT,
				samplingDomain: mapPreparedTextureSamplingDomain(payload),
				lookup: mapPreparedTextureLookup(payload),
				bytes: level.bytes,
			};
		})
		.sort((left, right) => left.key.localeCompare(right.key));
}

export function findStaticMaterialTextureRefs(
	materialRecordKey: string,
	texturePageRefs: readonly VirtualTexturePageRef[],
	materialTextureRoutes: readonly StaticMaterialTextureRoute[],
): VirtualTexturePageRef[] {
	return materialTextureRoutes
		.filter((candidate) => candidate.materialRecordKey === materialRecordKey)
		.map((route) =>
			texturePageRefs.find(
				(ref) => ref.key === formatStaticMaterialTextureRefKey(route),
			),
		)
		.filter((ref): ref is VirtualTexturePageRef => ref !== undefined)
		.sort((left, right) => left.key.localeCompare(right.key));
}

export function resolveStaticMaterialReadiness(options: {
	materialAssetId: string;
	materialRecordKey?: string;
	materialVariantSignature?: string | null;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
	texturePageRefs: readonly VirtualTexturePageRef[];
	materialTextureRoutes: readonly StaticMaterialTextureRoute[];
}): CompactionMaterialReadiness {
	const material = getPreparedPayload(
		options.preparedByAssetId,
		options.materialAssetId,
		"material-recipe",
	);
	const indexedRenderSurface = findIndexedRenderSurface(
		material,
		options.preparedByAssetId,
	);
	const directRenderSurface = indexedRenderSurface
		? null
		: findDirectRenderSurface(material, options.preparedByAssetId);
	const behavior = indexedRenderSurface
		? deriveLegacyMaterialBehaviorDto({
				recipe: material,
				usesIndexedClipDiscard: true,
			})
		: deriveLegacyMaterialBehaviorDto({
				recipe: material,
				hasSourceAlpha: directRenderSurface
					? hasSourceAlpha(directRenderSurface.renderSurface.formatRaw)
					: false,
			});
	const materialRecordKey = options.materialRecordKey ?? options.materialAssetId;
	const materialRoutes = options.materialTextureRoutes.filter(
		(route) => route.materialRecordKey === materialRecordKey,
	);
	const texturePageBindings = materialRoutes
		.map((route) => {
			const ref = options.texturePageRefs.find(
				(candidate) => candidate.key === formatStaticMaterialTextureRefKey(route),
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
				(ref) => ref.key === formatStaticMaterialTextureRefKey(baseRoute),
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
		behavior,
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

export function resolveStaticMaterialColor(options: {
	material: PreparedMaterialRecipePayload;
	behavior: LegacyMaterialBehaviorDto | null;
}): readonly [number, number, number, number] {
	const behaviorColor = options.behavior?.color ?? [1, 1, 1];
	const behaviorOpacity = options.behavior?.opacity ?? 1;
	if (options.material.source.kind === "solid-color") {
		const source = decodeArgbColor(options.material.source.argb);
		return [
			source[0] * behaviorColor[0],
			source[1] * behaviorColor[1],
			source[2] * behaviorColor[2],
			source[3] * behaviorOpacity,
		];
	}
	return [
		behaviorColor[0],
		behaviorColor[1],
		behaviorColor[2],
		behaviorOpacity,
	];
}

export function resolveStaticIndexedMaterialRecord(options: {
	materialAssetId: string;
	materialRecordKey?: string;
	materialTextureRoutes: readonly StaticMaterialTextureRoute[];
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): StaticBundleIndexedMaterialRecord | undefined {
	const materialRecordKey = options.materialRecordKey ?? options.materialAssetId;
	const indexRoute = options.materialTextureRoutes.find(
		(route): route is StaticMaterialIndexedTexelRoute =>
			route.kind === "indexed-texels" &&
			route.materialRecordKey === materialRecordKey,
	);
	if (!indexRoute) {
		return undefined;
	}
	const paletteRoute = options.materialTextureRoutes.find(
		(route): route is StaticMaterialPaletteRoute =>
			route.kind === "palette-lookup" &&
			route.materialRecordKey === materialRecordKey,
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
		wrapS: indexRoute.wrapS,
		wrapT: indexRoute.wrapT,
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
		? ([] as const)
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
	const family = decision.material.family;
	return `${STATIC_MATERIAL_FAMILY_KEY_PREFIX}${family}:${STATIC_MATERIAL_ALPHA_POLICY_KEY}=${decision.material.alphaPolicy}`;
}

export function parseStaticMaterialFamilyKey(
	familyKey: string,
): StaticMaterialFamilyDescriptor | null {
	if (familyKey === STATIC_MATERIAL_LEGACY_RGBA_TEXTURE_PAGE_FAMILY_KEY) {
		return {
			key: familyKey,
			kind: "texture-page",
			sourceFamily: STATIC_MATERIAL_LEGACY_RGBA_TEXTURE_PAGE_FAMILY_KEY,
			alphaPolicy: null,
		};
	}
	if (familyKey === STATIC_MATERIAL_LEGACY_INDEXED_PALETTED_FAMILY_KEY) {
		return {
			key: familyKey,
			kind: "indexed-paletted",
			alphaPolicy: null,
		};
	}
	if (!familyKey.startsWith(STATIC_MATERIAL_FAMILY_KEY_PREFIX)) {
		return null;
	}
	const body = familyKey.slice(STATIC_MATERIAL_FAMILY_KEY_PREFIX.length);
	const alphaSegment = `:${STATIC_MATERIAL_ALPHA_POLICY_KEY}=`;
	const alphaSegmentIndex = body.lastIndexOf(alphaSegment);
	if (alphaSegmentIndex <= 0) {
		return null;
	}
	const family = body.slice(0, alphaSegmentIndex);
	const alphaPolicy = body.slice(alphaSegmentIndex + alphaSegment.length);
	if (
		!STATIC_MATERIAL_FAMILIES.has(family) ||
		!STATIC_MATERIAL_ALPHA_POLICIES.has(alphaPolicy)
	) {
		return null;
	}
	return describeStaticMaterialFamilyKey({
		key: familyKey,
		family: family as StaticMaterialSerializedFamilyKind,
		alphaPolicy: alphaPolicy as CompactionAlphaPolicy,
	});
}

export function resolveStaticMaterialFamilyAlphaTest(
	family: StaticMaterialFamilyDescriptor,
): number {
	if (family.kind === "texture-page" && family.alphaPolicy === "cutout") {
		return DIRECT_CLIP_MAP_ALPHA_TEST;
	}
	return 0;
}

function describeStaticMaterialFamilyKey(options: {
	key: string;
	family: StaticMaterialSerializedFamilyKind;
	alphaPolicy: CompactionAlphaPolicy;
}): StaticMaterialFamilyDescriptor {
	switch (options.family) {
		case "indexed-paletted":
			if (options.alphaPolicy === "opacity-translucent") {
				return {
					key: options.key,
					kind: "unsupported",
					sourceFamily: options.family,
					alphaPolicy: options.alphaPolicy,
					reason: `indexed static material family has unsupported alpha policy ${options.alphaPolicy}`,
				};
			}
			return {
				key: options.key,
				kind: "indexed-paletted",
				alphaPolicy: options.alphaPolicy,
			};
		case "flat-constant-color":
			return {
				key: options.key,
				kind: "flat-color",
				sourceFamily: options.family,
				alphaPolicy: options.alphaPolicy,
			};
		case "textured-opaque":
		case "transparent-blended":
		case "opacity-translucent":
			return {
				key: options.key,
				kind: "texture-page",
				sourceFamily: options.family,
				alphaPolicy: options.alphaPolicy,
			};
		case "debug-pipeline":
		case "unknown-unsupported":
			return {
				key: options.key,
				kind: "unsupported",
				sourceFamily: options.family,
				alphaPolicy: options.alphaPolicy,
				reason: `static material family ${options.family} is not submitted by the static bundle texture-page path`,
			};
	}
}

function decodeArgbColor(
	argb: number,
): readonly [number, number, number, number] {
	return [
		((argb >>> 16) & 0xff) / 255,
		((argb >>> 8) & 0xff) / 255,
		(argb & 0xff) / 255,
		((argb >>> 24) & 0xff) / 255,
	];
}

function collectIndexedMaterialTextureRoutes(options: {
	request: NormalizedStaticMaterialTextureRouteRequest;
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
			materialAssetId: options.request.materialAssetId,
			materialRecordKey: options.request.materialRecordKey,
			materialVariantSignature: options.request.materialVariantSignature,
			renderSurfaceAssetId: indexedRenderSurface.assetId,
			indexedFormat: indexedTexture.format,
			bytes: indexedTexture.sourceBytes,
			width: indexedTexture.width,
			height: indexedTexture.height,
			...resolveStaticMaterialRouteWrapMode({
				renderSurface: indexedRenderSurface.renderSurface,
				materialVariantSignature: options.request.materialVariantSignature,
			}),
		},
		{
			kind: "palette-lookup",
			materialAssetId: options.request.materialAssetId,
			materialRecordKey: options.request.materialRecordKey,
			materialVariantSignature: options.request.materialVariantSignature,
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

function findDirectRenderSurface(
	material: PreparedMaterialRecipePayload,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): { assetId: string; renderSurface: PreparedRenderSurfacePayload } | null {
	if (material.source.kind !== "texture") {
		return null;
	}
	const selectedAssetId = material.source.selectedRenderSurfaceId !== null
		? `render-surface/${formatHex32(material.source.selectedRenderSurfaceId)}`
		: null;
	const candidateAssetIds = selectedAssetId
		? [
				selectedAssetId,
				...material.dependencies.renderSurfaceAssetIds.filter(
					(assetId) => assetId !== selectedAssetId,
				),
			]
		: material.dependencies.renderSurfaceAssetIds;
	for (const renderSurfaceAssetId of candidateAssetIds) {
		const renderSurface = getPreparedPayload(
			preparedByAssetId,
			renderSurfaceAssetId,
			"render-surface",
		);
		if (!isIndexedTextureFormat(renderSurface.formatRaw)) {
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
			return `${route.materialRecordKey}|prepared:${route.preparedTextureAssetId}`;
		case "indexed-texels":
			return `${route.materialRecordKey}|indexed:${route.renderSurfaceAssetId}`;
		case "palette-lookup":
			return `${route.materialRecordKey}|palette:${route.paletteAssetId}`;
	}
}

function formatStaticMaterialTextureRefKey(
	route: StaticMaterialTextureRoute,
): string {
	switch (route.kind) {
		case "prepared-texture":
			return `texture:${route.materialRecordKey}:${route.preparedTextureAssetId}`;
		case "indexed-texels":
			return `texture:${route.materialRecordKey}:${route.renderSurfaceAssetId}:indexed-texels`;
		case "palette-lookup":
			return `texture:${route.materialRecordKey}:${route.paletteAssetId}:palette-lookup`;
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
