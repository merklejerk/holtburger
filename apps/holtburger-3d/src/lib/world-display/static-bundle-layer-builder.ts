import {
	getPreparedAssetDependencies,
	type PreparedAssetRecord,
} from "../assets/types";
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
	type StaticBundleTexturePage,
	type StaticLandblockBundleLayerDiagnostics,
	type StaticLandblockRenderBundleLayer,
	type VirtualTexturePageRef,
} from "./static-bundle-layer";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import {
	planAtlasLayout,
	type AtlasLayoutPolicy,
} from "./texture-pages/atlas-layout-planner";

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
	textureRefKey: string | null;
	compactable: boolean;
	reason: string | null;
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	indices: Uint16Array | Uint32Array;
}

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
	const texturePageRefs = collectVirtualTexturePageRefs(preparedByAssetId);
	const texturePages = buildLayerTexturePages({
		scopeKey: formatStaticBundleLayerScopeKey(job.scope),
		texturePageRefs,
		policy: policy.atlasLayout,
	});
	const surfaces = sourceObjects.flatMap((object) =>
		buildObjectSurfaces(object, preparedByAssetId, texturePageRefs),
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
		const textureRef =
			texturePageRefs.find((ref) =>
				ref.sourceAssetId.includes(materialAssetId),
			) ??
			texturePageRefs[index] ??
			null;
		const geometry = gfxObj.renderGeometry;
		const positions = toFloat32Array(geometry.positions);
		const normals = toFloat32Array(geometry.normals);
		const uvs = toFloat32Array(geometry.uvs);
		const indices = createSequentialTriangleIndices(geometry.triangleCount);
		const compactable =
			geometry.triangleCount > 0 &&
			positions.length >= geometry.triangleCount * 9 &&
			uvs.length >= geometry.triangleCount * 6 &&
			!materialAssetId.includes("direct");
		return {
			key: `${object.objectKey}:part:${index}:${gfxObjAssetId}`,
			object,
			gfxObjAssetId,
			materialAssetId,
			textureRefKey: textureRef?.key ?? null,
			compactable,
			reason: compactable ? null : "noncompactable-surface",
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
			familyKey: surface.compactable ? "static-compact-rgba" : "static-direct",
			texturePageRefKeys: surface.textureRefKey ? [surface.textureRefKey] : [],
			isTransparent: false,
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
	const compactableSurfaces = surfaces.filter((surface) => surface.compactable);
	if (compactableSurfaces.length === 0) {
		return [];
	}
	const positions = concatFloat32Arrays(
		compactableSurfaces.map((surface) => surface.positions),
	);
	const normals = concatFloat32Arrays(
		compactableSurfaces.map((surface) => surface.normals),
	);
	const uvs = concatFloat32Arrays(
		compactableSurfaces.map((surface) => surface.uvs),
	);
	const indices = concatOffsetIndices(compactableSurfaces);
	const firstSurface = compactableSurfaces[0];
	if (!firstSurface) {
		return [];
	}
	return [
		{
			key: `${renderChunkKey}:compacted:0`,
			renderChunkKey,
			familyKey: "static-compact-rgba",
			materialRecordKey: `material:${firstSurface.materialAssetId}`,
			objectKeys: uniqueSortedStrings(
				compactableSurfaces.map((surface) => surface.object.objectKey),
			),
			positions,
			normals,
			uvs,
			indices,
		},
	];
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
			bounds: null,
		}))
		.sort((left, right) => left.key.localeCompare(right.key));
}

function collectVirtualTexturePageRefs(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): VirtualTexturePageRef[] {
	return [...preparedByAssetId.values()]
		.flatMap((asset): VirtualTexturePageRef[] => {
			if (asset.payload.kind !== "prepared-texture") {
				return [];
			}
			const payload = asset.payload;
			const level = payload.levels[0];
			if (!level) {
				throw new Error(
					`Prepared texture ${asset.request.assetId} has no mip level 0.`,
				);
			}
			return [
				{
					key: `texture:${asset.request.assetId}`,
					sourceAssetId: asset.request.assetId,
					usageBucket: payload.usage === "detail" ? "detail" : "base-color",
					sampleClass: "rgba-color",
					width: level.width,
					height: level.height,
					wrapS: "clamp",
					wrapT: "clamp",
					samplingDomain: payload.colorSpace === "data" ? "data" : "color",
					lookup: payload.colorSpace === "data" ? "exact" : "color-filtered",
					bytes: level.bytes,
				},
			];
		})
		.sort((left, right) => left.key.localeCompare(right.key));
}

function buildLayerTexturePages(options: {
	scopeKey: string;
	texturePageRefs: readonly VirtualTexturePageRef[];
	policy: AtlasLayoutPolicy;
}): StaticBundleTexturePage[] {
	const refsByBucket = groupTextureRefsByBucket(options.texturePageRefs);
	const pages: StaticBundleTexturePage[] = [];
	for (const refs of refsByBucket.values()) {
		if (refs.length === 1) {
			const ref = refs[0];
			if (ref) {
				pages.push(createSingleEntryTexturePage(options.scopeKey, ref));
			}
			continue;
		}
		const layout = planAtlasLayout({
			entries: refs.map((ref) => ({
				key: ref.key,
				width: ref.width,
				height: ref.height,
			})),
			policy: options.policy,
		});
		for (const texturePage of layout.texturePages) {
			const placements = texturePage.placements
				.map((placement) => {
					const ref = refs.find(
						(candidate) => candidate.key === placement.atlasEntryKey,
					);
					if (!ref) {
						throw new Error(
							`Texture page placement references missing ref ${placement.atlasEntryKey}.`,
						);
					}
					return { placement, ref };
				})
				.sort((left, right) => left.ref.key.localeCompare(right.ref.key));
			const usageBucket = placements[0]?.ref.usageBucket;
			const sampleClass = placements[0]?.ref.sampleClass;
			if (!usageBucket || !sampleClass) {
				continue;
			}
			pages.push({
				key: `${options.scopeKey}:page:${usageBucket}:${texturePage.textureIndex}`,
				scopeKey: options.scopeKey,
				pageKind: "packed-atlas",
				usageBucket,
				sampleClass,
				width: texturePage.width,
				height: texturePage.height,
				bytes: packAtlasBytes(
					texturePage.width,
					texturePage.height,
					placements,
				),
				entries: placements.map(({ placement, ref }) => ({
					virtualRefKey: ref.key,
					sourceAssetId: ref.sourceAssetId,
					rect: [
						placement.x / texturePage.width,
						placement.y / texturePage.height,
						(placement.x + placement.width) / texturePage.width,
						(placement.y + placement.height) / texturePage.height,
					],
				})),
			});
		}
		for (const overflow of layout.overflows) {
			const ref = refs.find(
				(candidate) => candidate.key === overflow.atlasEntryKey,
			);
			if (ref) {
				pages.push(createSingleEntryTexturePage(options.scopeKey, ref));
			}
		}
	}
	return pages.sort((left, right) => left.key.localeCompare(right.key));
}

function groupTextureRefsByBucket(
	refs: readonly VirtualTexturePageRef[],
): Map<string, VirtualTexturePageRef[]> {
	const refsByBucket = new Map<string, VirtualTexturePageRef[]>();
	for (const ref of refs) {
		const key = `${ref.usageBucket}:${ref.sampleClass}`;
		const bucket = refsByBucket.get(key);
		if (bucket) {
			bucket.push(ref);
		} else {
			refsByBucket.set(key, [ref]);
		}
	}
	return refsByBucket;
}

function createSingleEntryTexturePage(
	scopeKey: string,
	ref: VirtualTexturePageRef,
): StaticBundleTexturePage {
	return {
		key: `${scopeKey}:page:single:${ref.key}`,
		scopeKey,
		pageKind: "single-entry",
		usageBucket: ref.usageBucket,
		sampleClass: ref.sampleClass,
		width: ref.width,
		height: ref.height,
		bytes: ref.bytes
			? new Uint8Array(ref.bytes)
			: new Uint8Array(ref.width * ref.height * 4),
		entries: [
			{
				virtualRefKey: ref.key,
				sourceAssetId: ref.sourceAssetId,
				rect: [0, 0, 1, 1],
			},
		],
	};
}

function packAtlasBytes(
	width: number,
	height: number,
	placements: readonly {
		placement: { x: number; y: number; width: number; height: number };
		ref: VirtualTexturePageRef;
	}[],
): Uint8Array {
	const bytes = new Uint8Array(width * height * 4);
	for (const { placement, ref } of placements) {
		if (!ref.bytes) {
			continue;
		}
		for (let row = 0; row < placement.height; row += 1) {
			const sourceOffset = row * placement.width * 4;
			const targetOffset = ((placement.y + row) * width + placement.x) * 4;
			bytes.set(
				ref.bytes.subarray(sourceOffset, sourceOffset + placement.width * 4),
				targetOffset,
			);
		}
	}
	return bytes;
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
