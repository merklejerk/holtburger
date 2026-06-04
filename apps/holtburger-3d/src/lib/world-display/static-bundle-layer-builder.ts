import {
	getPreparedAssetDependencies,
	type PreparedAssetRecord,
	type PreparedMaterialRecipePayload,
	type PreparedRenderSurfacePayload,
	type PreparedTexturePayload,
} from "../assets/types";
import {
	resolveNormalizedPreparedTextureAssetIds,
	type MaterialTextureUsage,
} from "../assets/material-texture-preparation-policy";
import {
	formatEnvCellAssetId,
	formatHex32,
	formatLandblockOutdoorAssetId,
	formatLandblockTopologyAssetId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import {
	formatStaticBundleLayerScopeKey,
	type StaticBundleCompactedBatch,
	type StaticBundleDirectEntry,
	type StaticBundleLayerWorkerJob,
	type StaticBundleMaterialRecord,
	type StaticBundleObjectRecord,
	type StaticBundleRenderChunk,
	type StaticLandblockBundleLayerDiagnostics,
	type StaticLandblockRenderBundleLayer,
	type VirtualTexturePageRef,
} from "./static-bundle-layer";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import {
	createCompactionEligibility,
	type CompactionEligibility,
	type CompactionMaterialReadiness,
} from "./compaction/compaction-family-planner";
import { deriveLegacyMaterialBehaviorDto } from "./material-behavior";
import type { TexturePageDescriptor } from "./texture-pages/texture-page-binding";
import type { AtlasLayoutPolicy } from "./texture-pages/atlas-layout-planner";
import {
	buildStaticBundleLayerTexturePages,
	createStaticBundleTexturePageDescriptor,
} from "./static-bundle-layer-texture-pages";
import {
	createIndexedTextureData,
	isIndexedTextureFormat,
	selectIndexedPalette,
} from "./indexed-material-data";
import { createPaletteData } from "./palette-data";

interface StaticBundleLayerBuildPolicy {
	buildPolicyRevision: string;
	cpuTexturePagePolicyRevision: string;
	atlasLayout: AtlasLayoutPolicy;
}

export interface BuildStaticBundleLayerOptions {
	job: StaticBundleLayerWorkerJob;
	preparedAssets: readonly PreparedAssetRecord[];
	policy: StaticBundleLayerBuildPolicy;
}

interface StaticBundleSourceObject {
	objectKey: string;
	visibilityKey: RenderBvhItemKey;
	sourceAssetId: string;
	owningLandblockId: number;
	owningEnvCellId: number | null;
	kind: StaticBundleObjectRecord["kind"];
	partAssetIds: readonly string[];
	materialAssetIds: readonly string[];
}

interface StaticBundleBuildSurface {
	key: string;
	object: StaticBundleSourceObject;
	gfxObjAssetId: string;
	materialAssetId: string;
	textureRefKeys: readonly string[];
	compactable: boolean;
	reason: string | null;
	familyKey: string;
	isTransparent: boolean;
	compactionEligibility: CompactionEligibility;
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	indices: Uint16Array | Uint32Array;
}

type StaticBundleMaterialTextureRoute =
	| StaticBundleMaterialPreparedTextureRoute
	| StaticBundleMaterialIndexedTexelRoute
	| StaticBundleMaterialPaletteRoute;

interface StaticBundleMaterialPreparedTextureRoute {
	kind: "prepared-texture";
	materialAssetId: string;
	preparedTextureAssetId: string;
	renderSurfaceAssetId: string;
	usage: MaterialTextureUsage;
}

interface StaticBundleMaterialIndexedTexelRoute {
	kind: "indexed-texels";
	materialAssetId: string;
	renderSurfaceAssetId: string;
	bytes: Uint8Array;
	width: number;
	height: number;
}

interface StaticBundleMaterialPaletteRoute {
	kind: "palette-lookup";
	materialAssetId: string;
	paletteAssetId: string;
	bytes: Uint8Array;
	colorCount: number;
}

const STATIC_BUNDLE_MATERIAL_TEXTURE_USAGES: readonly MaterialTextureUsage[] = [
	"raw",
	"detail",
];

export function buildStaticLandblockRenderBundleLayer({
	job,
	preparedAssets,
	policy,
}: BuildStaticBundleLayerOptions): StaticLandblockRenderBundleLayer {
	if (job.buildPolicyRevision !== policy.buildPolicyRevision) {
		throw new Error(
			`Static bundle job build policy ${job.buildPolicyRevision} does not match builder policy ${policy.buildPolicyRevision}.`,
		);
	}
	if (
		job.cpuTexturePagePolicyRevision !== policy.cpuTexturePagePolicyRevision
	) {
		throw new Error(
			`Static bundle job texture-page policy ${job.cpuTexturePagePolicyRevision} does not match builder policy ${policy.cpuTexturePagePolicyRevision}.`,
		);
	}

	const preparedByAssetId = new Map(
		preparedAssets.map((asset) => [asset.request.assetId, asset] as const),
	);
	const sourceObjects = collectStaticBundleSourceObjects(
		job,
		preparedByAssetId,
	);
	const workerPreparedAssetIds = collectWorkerPreparedDependencyIds(
		job.rootAssetIds,
		preparedByAssetId,
	);
	const materialTextureRoutes = collectMaterialTextureRoutes(
		sourceObjects.flatMap((object) => object.materialAssetIds),
		preparedByAssetId,
	);
	const texturePageRefs = collectVirtualTexturePageRefs(
		materialTextureRoutes,
		preparedByAssetId,
	);
	const texturePages = buildStaticBundleLayerTexturePages({
		scopeKey: formatStaticBundleLayerScopeKey(job.scope),
		texturePageRefs,
		policy: policy.atlasLayout,
	});
	const surfaces = sourceObjects.flatMap((object) =>
		buildObjectSurfaces(
			object,
			preparedByAssetId,
			texturePageRefs,
			materialTextureRoutes,
		),
	);
	const renderChunk = createRenderChunk(job);
	const materialRecords = buildMaterialRecords(surfaces);
	const compactedBatches = buildCompactedBatches(renderChunk.key, surfaces);
	const directEntries = buildDirectEntries(renderChunk.key, surfaces);
	const objectRecords = sourceObjects.map(
		(object): StaticBundleObjectRecord => ({
			objectKey: object.objectKey,
			visibilityKeys: [object.visibilityKey],
			sourceAssetId: object.sourceAssetId,
			owningLandblockId: object.owningLandblockId,
			owningEnvCellId: object.owningEnvCellId,
			kind: object.kind,
		}),
	);
	const diagnostics = buildDiagnostics({
		sourceObjectCount: sourceObjects.length,
		surfaces,
	});

	return {
		key: `static-bundle-layer:${formatStaticBundleLayerScopeKey(job.scope)}:${job.sourceRevision}`,
		scope: job.scope,
		landblockId: job.scope.landblockId,
		layerKind: job.scope.layerKind,
		sourceRevision: job.sourceRevision,
		rootAssetIds: [...job.rootAssetIds].sort(),
		preparedAssetIds: workerPreparedAssetIds,
		renderChunks: [renderChunk],
		compactedBatches,
		directEntries,
		materialRecords,
		texturePageRefs,
		texturePages,
		objectRecords,
		diagnostics,
	};
}

export function collectWorkerPreparedDependencyIds(
	rootAssetIds: readonly string[],
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): string[] {
	const visitedAssetIds = new Set<string>();
	const queue = [...rootAssetIds].sort();
	while (queue.length > 0) {
		const assetId = queue.shift();
		if (!assetId) {
			continue;
		}
		if (visitedAssetIds.has(assetId)) {
			continue;
		}
		visitedAssetIds.add(assetId);
		const asset = preparedByAssetId.get(assetId);
		if (!asset) {
			throw new Error(
				`Static bundle closure is missing required asset ${assetId}.`,
			);
		}
		for (const dependency of getPreparedAssetDependencies(asset)) {
			if (!visitedAssetIds.has(dependency.assetId)) {
				queue.push(dependency.assetId);
			}
		}
		for (const preparedTextureAssetId of collectPreparedTextureRouteAssetIds(
			asset,
			preparedByAssetId,
		)) {
			if (!visitedAssetIds.has(preparedTextureAssetId)) {
				queue.push(preparedTextureAssetId);
			}
		}
		for (const companionAssetId of collectSetupAppearanceCompanionAssetIds(
			asset,
		)) {
			if (!visitedAssetIds.has(companionAssetId)) {
				queue.push(companionAssetId);
			}
		}
		queue.sort();
	}
	return [...visitedAssetIds].sort();
}

function collectStaticBundleSourceObjects(
	job: StaticBundleLayerWorkerJob,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): StaticBundleSourceObject[] {
	if (job.scope.kind === "landblock") {
		const outdoorAssetId = formatLandblockOutdoorAssetId(job.scope.landblockId);
		assertRootIncludes(job, outdoorAssetId);
		const outdoor = getPreparedPayload(
			preparedByAssetId,
			outdoorAssetId,
			"landblock-outdoor",
		);
		return outdoor.statics
			.filter((member) =>
				job.scope.layerKind === "outdoor-buildings"
					? member.kind === "building"
					: member.kind !== "building",
			)
			.map(
				(member): StaticBundleSourceObject => ({
					objectKey: `outdoor-static:${formatHex32(job.scope.landblockId)}:${member.instanceId}`,
					visibilityKey: `outdoor-static:landblock:${formatHex32(job.scope.landblockId)}:instance:${member.instanceId}`,
					sourceAssetId: member.sourceAssetId,
					owningLandblockId: normalizeOutdoorLandblockId(outdoor.landblockId),
					owningEnvCellId: null,
					kind:
						member.kind === "building"
							? "building"
							: member.kind === "generated-scenery"
								? "generated-scenery"
								: "scenery",
					partAssetIds: collectRenderablePartAssetIds(
						member.sourceAssetId,
						preparedByAssetId,
					),
					materialAssetIds: collectRenderableMaterialAssetIds(
						member.sourceAssetId,
						preparedByAssetId,
					),
				}),
			);
	}

	const topologyAssetId = formatLandblockTopologyAssetId(job.scope.landblockId);
	const envCellScope = job.scope;
	const envCellAssetId = formatEnvCellAssetId(envCellScope.envCellId);
	assertRootIncludes(job, topologyAssetId);
	assertRootIncludes(job, envCellAssetId);
	const envCell = getPreparedPayload(
		preparedByAssetId,
		envCellAssetId,
		"env-cell",
	);
	return envCell.statics.map(
		(member): StaticBundleSourceObject => ({
			objectKey: `env-static:${formatHex32(envCellScope.envCellId)}:${member.instanceId}`,
			visibilityKey: `env-static:cell:${formatHex32(envCellScope.envCellId)}:instance:${member.instanceId}`,
			sourceAssetId: member.sourceAssetId,
			owningLandblockId: normalizeOutdoorLandblockId(job.scope.landblockId),
			owningEnvCellId: envCellScope.envCellId,
			kind: "indoor-static",
			partAssetIds: collectRenderablePartAssetIds(
				member.sourceAssetId,
				preparedByAssetId,
			),
			materialAssetIds: collectRenderableMaterialAssetIds(
				member.sourceAssetId,
				preparedByAssetId,
			),
		}),
	);
}

function buildObjectSurfaces(
	object: StaticBundleSourceObject,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
	texturePageRefs: readonly VirtualTexturePageRef[],
	materialTextureRoutes: readonly StaticBundleMaterialTextureRoute[],
): StaticBundleBuildSurface[] {
	return object.partAssetIds.map((gfxObjAssetId, index) => {
		const gfxObj = getPreparedPayload(
			preparedByAssetId,
			gfxObjAssetId,
			"gfx-obj",
		);
		const materialAssetId =
			object.materialAssetIds[index] ??
			object.materialAssetIds[0] ??
			gfxObj.dependencies?.materialAssetIds[0] ??
			"material:missing";
		const textureRefKeys = findMaterialTextureRefs(
			materialAssetId,
			texturePageRefs,
			materialTextureRoutes,
		).map((ref) => ref.key);
		const materialReadiness = resolveStaticBundleMaterialReadiness({
			materialAssetId,
			preparedByAssetId,
			texturePageRefs,
			materialTextureRoutes,
		});
		const geometry = gfxObj.renderGeometry;
		const positions = toFloat32Array(geometry.positions);
		const normals = toFloat32Array(geometry.normals);
		const uvs = toFloat32Array(geometry.uvs);
		const indices = createSequentialTriangleIndices(geometry.triangleCount);
		const geometryCompatible =
			geometry.triangleCount > 0 &&
			positions.length >= geometry.triangleCount * 9 &&
			uvs.length >= geometry.triangleCount * 6;
		const compactionEligibility = createCompactionEligibility({
			geometry: {
				kind: "static",
				owningLandblockId: object.owningLandblockId,
				hasUvBuffer: geometryCompatible,
			},
			material: materialReadiness,
		});
		const compactable =
			geometryCompatible && compactionEligibility.decision === "compacted";
		return {
			key: `${object.objectKey}:part:${index}:${gfxObjAssetId}`,
			object,
			gfxObjAssetId,
			materialAssetId,
			textureRefKeys,
			compactable,
			reason: compactable
				? null
				: describeStaticBundleCompactionBypass(compactionEligibility),
			familyKey: formatStaticBundleMaterialFamilyKey(compactionEligibility),
			isTransparent:
				compactionEligibility.material.alphaPolicy === "transparent-blend" ||
				compactionEligibility.material.alphaPolicy === "opacity-translucent",
			compactionEligibility,
			positions,
			normals,
			uvs,
			indices,
		};
	});
}

function buildMaterialRecords(
	surfaces: readonly StaticBundleBuildSurface[],
): StaticBundleMaterialRecord[] {
	const recordsByKey = new Map<string, StaticBundleMaterialRecord>();
	for (const surface of surfaces) {
		const key = `material:${surface.materialAssetId}`;
		if (recordsByKey.has(key)) {
			continue;
		}
		recordsByKey.set(key, {
			key,
			familyKey: surface.familyKey,
			texturePageRefKeys: surface.textureRefKeys,
			isTransparent: surface.isTransparent,
		});
	}
	return [...recordsByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function buildCompactedBatches(
	renderChunkKey: string,
	surfaces: readonly StaticBundleBuildSurface[],
): StaticBundleCompactedBatch[] {
	return groupCompactedSurfacesByMaterial(surfaces)
		.map((group, index): StaticBundleCompactedBatch => {
			const firstSurface = group[0];
			if (!firstSurface) {
				throw new Error("Static compacted surface group was empty.");
			}
			return {
				key: `${renderChunkKey}:compacted:${index}:${firstSurface.familyKey}:${firstSurface.materialAssetId}`,
				renderChunkKey,
				familyKey: firstSurface.familyKey,
				materialRecordKey: `material:${firstSurface.materialAssetId}`,
				objectKeys: uniqueSortedStrings(
					group.map((surface) => surface.object.objectKey),
				),
				positions: concatFloat32Arrays(
					group.map((surface) => surface.positions),
				),
				normals: concatFloat32Arrays(group.map((surface) => surface.normals)),
				uvs: concatFloat32Arrays(group.map((surface) => surface.uvs)),
				indices: concatOffsetIndices(group),
			};
		})
		.sort((left, right) => left.key.localeCompare(right.key));
}

function groupCompactedSurfacesByMaterial(
	surfaces: readonly StaticBundleBuildSurface[],
): StaticBundleBuildSurface[][] {
	const groupsByKey = new Map<string, StaticBundleBuildSurface[]>();
	for (const surface of surfaces) {
		if (!surface.compactable) {
			continue;
		}
		const key = `${surface.familyKey}|${surface.materialAssetId}`;
		const group = groupsByKey.get(key);
		if (group) {
			group.push(surface);
		} else {
			groupsByKey.set(key, [surface]);
		}
	}
	return [...groupsByKey.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, group]) =>
			[...group].sort((left, right) => left.key.localeCompare(right.key)),
		);
}

function buildDirectEntries(
	renderChunkKey: string,
	surfaces: readonly StaticBundleBuildSurface[],
): StaticBundleDirectEntry[] {
	return surfaces
		.filter((surface) => !surface.compactable)
		.map((surface) => ({
			key: `${renderChunkKey}:direct:${surface.key}`,
			renderChunkKey,
			materialRecordKey: `material:${surface.materialAssetId}`,
			objectKey: surface.object.objectKey,
			positions: surface.positions,
			normals: surface.normals,
			uvs: surface.uvs,
			indices: surface.indices,
			bounds: null,
		}))
		.sort((left, right) => left.key.localeCompare(right.key));
}

function collectVirtualTexturePageRefs(
	materialTextureRoutes: readonly StaticBundleMaterialTextureRoute[],
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

function collectMaterialTextureRoutes(
	materialAssetIds: readonly string[],
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): StaticBundleMaterialTextureRoute[] {
	const routesByKey = new Map<string, StaticBundleMaterialTextureRoute>();
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
			routesByKey.set(formatMaterialTextureRouteKey(route), route);
		}
		const usages =
			indexedRoutes.length > 0
				? (["detail"] as const)
				: STATIC_BUNDLE_MATERIAL_TEXTURE_USAGES;
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
					routesByKey.set(formatMaterialTextureRouteKey(route), route);
				}
			}
		}
	}
	return [...routesByKey.values()].sort((left, right) =>
		formatMaterialTextureRouteKey(left).localeCompare(
			formatMaterialTextureRouteKey(right),
		),
	);
}

function collectIndexedMaterialTextureRoutes(options: {
	materialAssetId: string;
	material: PreparedMaterialRecipePayload;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): StaticBundleMaterialTextureRoute[] {
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

function formatMaterialTextureRouteKey(
	route: StaticBundleMaterialTextureRoute,
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

function findMaterialTextureRefs(
	materialAssetId: string,
	texturePageRefs: readonly VirtualTexturePageRef[],
	materialTextureRoutes: readonly StaticBundleMaterialTextureRoute[],
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

function resolveStaticBundleMaterialReadiness(options: {
	materialAssetId: string;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
	texturePageRefs: readonly VirtualTexturePageRef[];
	materialTextureRoutes: readonly StaticBundleMaterialTextureRoute[];
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
		(route): route is StaticBundleMaterialPreparedTextureRoute =>
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

function routeSourceAssetId(route: StaticBundleMaterialTextureRoute): string {
	switch (route.kind) {
		case "prepared-texture":
			return route.preparedTextureAssetId;
		case "indexed-texels":
			return route.renderSurfaceAssetId;
		case "palette-lookup":
			return route.paletteAssetId;
	}
}

function formatStaticBundleMaterialFamilyKey(
	eligibility: CompactionEligibility,
): string {
	const family =
		eligibility.decision === "compacted"
			? eligibility.material.family
			: "direct";
	return `static:${family}:alpha=${eligibility.material.alphaPolicy}`;
}

function describeStaticBundleCompactionBypass(
	eligibility: CompactionEligibility,
): string {
	const geometryBlocker = eligibility.geometry.blockers[0];
	if (geometryBlocker) {
		return `geometry:${geometryBlocker}`;
	}
	const materialBlocker = eligibility.material.blockers[0];
	if (materialBlocker) {
		return `material:${materialBlocker}`;
	}
	return "noncompactable-surface";
}

function collectPreparedTextureRouteAssetIds(
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
		: STATIC_BUNDLE_MATERIAL_TEXTURE_USAGES;
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

function createRenderChunk(
	job: StaticBundleLayerWorkerJob,
): StaticBundleRenderChunk {
	return {
		key: `${formatStaticBundleLayerScopeKey(job.scope)}:chunk`,
		landblockId: job.scope.landblockId,
		bounds: null,
	};
}

function buildDiagnostics(options: {
	sourceObjectCount: number;
	surfaces: readonly StaticBundleBuildSurface[];
}): StaticLandblockBundleLayerDiagnostics {
	return {
		sourceObjectCount: options.sourceObjectCount,
		compactedSurfaceCount: options.surfaces.filter(
			(surface) => surface.compactable,
		).length,
		directSurfaceCount: options.surfaces.filter(
			(surface) => !surface.compactable,
		).length,
		skippedSurfaceCount: 0,
		missingAssetIds: [],
		skippedReasons: uniqueSortedStrings(
			options.surfaces.flatMap((surface) =>
				surface.reason ? [surface.reason] : [],
			),
		),
	};
}

function collectRenderablePartAssetIds(
	sourceAssetId: string,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): string[] {
	const source = getPreparedAsset(preparedByAssetId, sourceAssetId);
	if (source.payload.kind === "gfx-obj") {
		return [sourceAssetId];
	}
	if (source.payload.kind !== "setup-model") {
		throw new Error(`Static bundle source ${sourceAssetId} is not renderable.`);
	}
	const appearance = preparedByAssetId.get(
		formatSetupAppearanceAssetId(source.payload.setupModelId),
	);
	if (appearance?.payload.kind === "setup-appearance") {
		return appearance.payload.parts.map((part) => part.gfxObjAssetId).sort();
	}
	return source.payload.parts.map((part) => part.gfxObjAssetId).sort();
}

function collectRenderableMaterialAssetIds(
	sourceAssetId: string,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): string[] {
	const source = getPreparedAsset(preparedByAssetId, sourceAssetId);
	if (source.payload.kind === "gfx-obj") {
		return [...(source.payload.dependencies?.materialAssetIds ?? [])].sort();
	}
	if (source.payload.kind !== "setup-model") {
		return [];
	}
	const appearance = preparedByAssetId.get(
		formatSetupAppearanceAssetId(source.payload.setupModelId),
	);
	if (appearance?.payload.kind === "setup-appearance") {
		return appearance.payload.parts
			.flatMap((part) => part.materialSlots.map((slot) => slot.materialAssetId))
			.sort();
	}
	return source.payload.parts
		.flatMap((part) => {
			const gfxObj = preparedByAssetId.get(part.gfxObjAssetId);
			return gfxObj?.payload.kind === "gfx-obj"
				? (gfxObj.payload.dependencies?.materialAssetIds ?? [])
				: [];
		})
		.sort();
}

function collectSetupAppearanceCompanionAssetIds(
	asset: PreparedAssetRecord,
): string[] {
	return asset.payload.kind === "setup-model"
		? [formatSetupAppearanceAssetId(asset.payload.setupModelId)]
		: [];
}

function getPreparedAsset(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
	assetId: string,
): PreparedAssetRecord {
	const asset = preparedByAssetId.get(assetId);
	if (!asset) {
		throw new Error(
			`Static bundle closure is missing required asset ${assetId}.`,
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
			`Static bundle asset ${assetId} was ${asset.payload.kind}, expected ${kind}.`,
		);
	}
	return asset.payload as Extract<
		PreparedAssetRecord["payload"],
		{ kind: TKind }
	>;
}

function assertRootIncludes(
	job: StaticBundleLayerWorkerJob,
	assetId: string,
): void {
	if (!job.rootAssetIds.includes(assetId)) {
		throw new Error(
			`Static bundle job ${job.jobId} missing required root ${assetId}.`,
		);
	}
}

function toFloat32Array(values: number[] | Float32Array): Float32Array {
	return values instanceof Float32Array ? values : new Float32Array(values);
}

function createSequentialTriangleIndices(
	triangleCount: number,
): Uint16Array | Uint32Array {
	const indexCount = triangleCount * 3;
	const indices =
		indexCount > 65535
			? new Uint32Array(indexCount)
			: new Uint16Array(indexCount);
	for (let index = 0; index < indexCount; index += 1) {
		indices[index] = index;
	}
	return indices;
}

function concatFloat32Arrays(arrays: readonly Float32Array[]): Float32Array {
	const length = arrays.reduce((total, array) => total + array.length, 0);
	const result = new Float32Array(length);
	let offset = 0;
	for (const array of arrays) {
		result.set(array, offset);
		offset += array.length;
	}
	return result;
}

function concatOffsetIndices(
	surfaces: readonly StaticBundleBuildSurface[],
): Uint16Array | Uint32Array {
	const vertexCount = surfaces.reduce(
		(total, surface) => total + surface.positions.length / 3,
		0,
	);
	const indexCount = surfaces.reduce(
		(total, surface) => total + surface.indices.length,
		0,
	);
	const result =
		vertexCount > 65535
			? new Uint32Array(indexCount)
			: new Uint16Array(indexCount);
	let indexOffset = 0;
	let vertexOffset = 0;
	for (const surface of surfaces) {
		for (let index = 0; index < surface.indices.length; index += 1) {
			result[indexOffset + index] =
				(surface.indices[index] ?? 0) + vertexOffset;
		}
		indexOffset += surface.indices.length;
		vertexOffset += surface.positions.length / 3;
	}
	return result;
}

function formatSetupAppearanceAssetId(setupModelId: number): string {
	return `setup-appearance/${formatHex32(setupModelId)}`;
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}
