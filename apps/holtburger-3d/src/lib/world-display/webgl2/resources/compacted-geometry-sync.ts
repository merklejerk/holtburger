import { profileBrowserJsScope } from "../../../diagnostics/browser-js-profiler";
import { formatHex32 } from "../../../landblocks";
import { buildCompactedGeometryBatch } from "../../compaction/compacted-geometry";
import type {
	CompactionFamilyPlan,
	IndexedPalettedFamilyMaterialTableRecord,
} from "../../compaction/compaction-family-planner";
import type { RenderChunkTransform } from "../../render-anchor";
import {
	atlasGenerationGraphNodeKey,
	sceneObjectGraphNodeKey,
	staticBatchGraphNodeKey,
	type RendererResourceGraph,
} from "../../renderer-resource-graph";
import type { StagedWorldDrawUnitAssembly } from "../../staged-world-assembly";
import { uniqueSortedStrings } from "../../staged-world-assembly";
import {
	createTexturePageAtlasPlacementsByEntryKey,
	createTexturePageDetailAtlasPlacementsByEntryKey,
	type TexturePageAtlasPlan,
} from "../../texture-pages/texture-page-atlas-planner";
import type { Webgl2WorldResourceStore } from "../../webgl2-world-resources";
import {
	createWebgl2CompactedGeometryBatchResource,
	createWebgl2IndexedPalettedFamilyResource,
	createWebgl2RgbaTexturePageFamilyResource,
	updateWebgl2CompactedGeometryBatchDynamicTables,
	type Webgl2CompactedGeometryBatchResource,
	type Webgl2CompactedGeometryFamilyResource,
} from "./compacted-geometry-resources";

function requiresTextureAtlasGeneration(plan: TexturePageAtlasPlan): boolean {
	return (
		plan.rgbaAtlasReadyDrawUnitIds.length > 0 ||
		plan.detailAtlasTextures.length > 0
	);
}

export function syncWebgl2CompactedGeometryResources({
	gl,
	store,
	plan,
	drawUnits,
	renderChunkTransforms,
	rendererResourceGraph,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	plan: CompactionFamilyPlan;
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
	renderChunkTransforms: readonly RenderChunkTransform[];
	rendererResourceGraph?: RendererResourceGraph;
}): void {
	if (
		store.compactedGeometryBatchGraph &&
		store.compactedGeometryBatchGraph !== rendererResourceGraph
	) {
		releaseWebgl2CompactedGeometryBatchGraphLeases(store);
	}
	store.compactedResourceFallbackSamples = [];
	const retainedGeometryBatchKeys = new Set<string>();
	const retainedFamilyResourceKeys = new Set<string>();
	const detailPlacementsByEntryKey =
		createTexturePageDetailAtlasPlacementsByEntryKey(plan.texturePageAtlasPlan);
	if (
		requiresTextureAtlasGeneration(plan.texturePageAtlasPlan) &&
		!store.textureAtlasGeneration
	) {
		store.compactedResourceFallbackSamples = [
			`compacted batch ${plan.key} waiting for texture atlas generation`,
		];
	}
	if (
		plan.renderFamilies.rgbaTexturePage.compactableDrawUnitIds.length > 0 &&
		store.textureAtlasGeneration
	) {
		const batchPlans = createRgbaTexturePageCompactedLandblockBatchPlans({
			plan,
			drawUnits,
			renderChunkTransforms,
		});
		if (batchPlans.length === 0) {
			store.compactedResourceFallbackSamples = [
				`compacted batch ${plan.key} produced no RGBA texture-page geometry`,
			];
		}
		const placementsByEntryKey = createTexturePageAtlasPlacementsByEntryKey(
			plan.texturePageAtlasPlan,
		);
		for (const batchPlan of batchPlans) {
			const geometry = profileBrowserJsScope(
				"webgl2.resource.buildCompactedGeometryBatch",
				() =>
					buildCompactedGeometryBatch({
						plan: batchPlan.plan,
						drawUnits,
						batchOrigin: batchPlan.batchOrigin,
					}),
			);
			if (!geometry) {
				continue;
			}
			retainWebgl2CompactedGeometryBatch({
				gl,
				store,
				geometry,
				landblockId: batchPlan.landblockId,
				retainedGeometryBatchKeys,
			});
			const familyResource = createWebgl2RgbaTexturePageFamilyResource({
				geometry,
				materialSlots: batchPlan.plan.materialSlots,
				materialDrawSlices: batchPlan.plan.drawSlices,
				placementsByEntryKey,
				detailPlacementsByEntryKey,
			});
			retainedFamilyResourceKeys.add(familyResource.key);
			store.compactedGeometryFamilyResources.set(
				familyResource.key,
				familyResource,
			);
		}
	}
	if (plan.renderFamilies.indexedPaletted.compactableDrawUnitIds.length > 0) {
		const batchPlans = createIndexedPalettedCompactedLandblockBatchPlans({
			plan,
			drawUnits,
			renderChunkTransforms,
		});
		for (const batchPlan of batchPlans) {
			const geometry = profileBrowserJsScope(
				"webgl2.resource.buildCompactedIndexedGeometryBatch",
				() =>
					buildCompactedGeometryBatch({
						plan: batchPlan.plan,
						drawUnits,
						batchOrigin: batchPlan.batchOrigin,
					}),
			);
			if (!geometry) {
				continue;
			}
			retainWebgl2CompactedGeometryBatch({
				gl,
				store,
				geometry,
				landblockId: batchPlan.landblockId,
				retainedGeometryBatchKeys,
			});
			const familyResource = createWebgl2IndexedPalettedFamilyResource({
				geometry,
				materialTableRecords: batchPlan.materialTableRecords,
				materialDrawSlices: batchPlan.plan.drawSlices,
				detailPlacementsByEntryKey,
			});
			retainedFamilyResourceKeys.add(familyResource.key);
			store.compactedGeometryFamilyResources.set(
				familyResource.key,
				familyResource,
			);
		}
	}
	for (const familyKey of store.compactedGeometryFamilyResources.keys()) {
		if (!retainedFamilyResourceKeys.has(familyKey)) {
			store.compactedGeometryFamilyResources.delete(familyKey);
		}
	}
	for (const [batchKey, batch] of store.compactedGeometryBatches) {
		if (!retainedGeometryBatchKeys.has(batchKey)) {
			batch.dispose();
			store.compactedGeometryBatches.delete(batchKey);
			releaseWebgl2CompactedGeometryBatchGraphLease(
				store,
				staticBatchGraphNodeKey(batchKey),
			);
		}
	}
	store.compactedGeometryFamilyResourceCounts = countCompactedFamilyResources(
		store.compactedGeometryFamilyResources,
	);
	store.compactedGeometryBatchCount = store.compactedGeometryBatches.size;
	store.compactedGeometryDrawUnitCount = sumCompactedGeometryBatches(
		store,
		(batch) => batch.drawUnitCount,
	);
	store.compactedGeometryTriangleCount = sumCompactedGeometryBatches(
		store,
		(batch) => batch.triangleCount,
	);
	store.compactedGeometryVertexByteLength = sumCompactedGeometryBatches(
		store,
		(batch) =>
			batch.positionByteLength +
			batch.uvByteLength +
			batch.materialSlotByteLength,
	);
	store.compactedGeometryIndexByteLength = sumCompactedGeometryBatches(
		store,
		(batch) => batch.indexByteLength,
	);
	store.compactedGeometryTotalByteLength = sumCompactedGeometryBatches(
		store,
		(batch) => batch.totalByteLength,
	);
	store.compactedGeometryDrawSliceCount = sumCompactedGeometryBatches(
		store,
		(batch) => batch.drawSliceCount,
	);
	store.compactedGeometryBatchOriginCount = store.compactedGeometryBatches.size;
	store.compactedGeometryTransformTableEntryCount = 0;
	if (!rendererResourceGraph || store.compactedGeometryBatches.size === 0) {
		releaseWebgl2CompactedGeometryBatchGraphLeases(store);
		return;
	}
	store.compactedGeometryBatchGraph = rendererResourceGraph;
	for (const batch of store.compactedGeometryBatches.values()) {
		const batchNodeKey = staticBatchGraphNodeKey(batch.key);
		if (store.compactedGeometryBatchGraphLeasesByKey.has(batchNodeKey)) {
			continue;
		}
		upsertWebgl2CompactedGeometryBatchGraph({
			graph: rendererResourceGraph,
			batch,
			familyResources: [
				...store.compactedGeometryFamilyResources.values(),
			].filter((resource) => resource.geometryBatchKey === batch.key),
			atlasGenerationKey: store.textureAtlasGeneration?.key ?? null,
		});
		store.compactedGeometryBatchGraphLeasesByKey.set(
			batchNodeKey,
			rendererResourceGraph.leaseNode(
				batchNodeKey,
				"webgl2 compacted landblock batch",
			),
		);
	}
}

function retainWebgl2CompactedGeometryBatch({
	gl,
	store,
	geometry,
	landblockId,
	retainedGeometryBatchKeys,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	geometry: NonNullable<ReturnType<typeof buildCompactedGeometryBatch>>;
	landblockId: number;
	retainedGeometryBatchKeys: Set<string>;
}): void {
	retainedGeometryBatchKeys.add(geometry.key);
	const previousBatch = store.compactedGeometryBatches.get(geometry.key);
	if (!previousBatch) {
		const nextBatch = profileBrowserJsScope(
			"webgl2.resource.createCompactedGeometryBatch",
			() =>
				createWebgl2CompactedGeometryBatchResource({
					gl,
					geometry,
					landblockId,
				}),
		);
		store.compactedGeometryBatches.set(nextBatch.key, nextBatch);
		return;
	}
	updateWebgl2CompactedGeometryBatchDynamicTables(previousBatch, geometry);
}

function upsertWebgl2CompactedGeometryBatchGraph({
	graph,
	batch,
	familyResources,
	atlasGenerationKey,
}: {
	graph: RendererResourceGraph;
	batch: Webgl2CompactedGeometryBatchResource;
	familyResources: readonly Webgl2CompactedGeometryFamilyResource[];
	atlasGenerationKey: string | null;
}): void {
	const batchNodeKey = staticBatchGraphNodeKey(batch.key);
	const atlasNodeKey = atlasGenerationKey
		? atlasGenerationGraphNodeKey(atlasGenerationKey)
		: null;
	const sceneNodeKeys = uniqueSortedStrings(
		familyResources.flatMap((resource) =>
			resource.drawSlices.flatMap((slice) => slice.drawUnitIds),
		),
	).map(sceneObjectGraphNodeKey);
	graph.applyBatchUpdate({
		nodes: [
			{
				key: batchNodeKey,
				kind: "static-batch",
				label: `outdoor static atlas batch ${formatHex32(batch.landblockId)}`,
				metadata: {
					landblockId: formatHex32(batch.landblockId),
					drawUnitCount: batch.drawUnitCount,
					drawSliceCount: batch.drawSliceCount,
					triangleCount: batch.triangleCount,
					totalByteLength: batch.totalByteLength,
				},
			},
		],
		dependencyReplacements: [
			{
				nodeKey: batchNodeKey,
				dependencyKeys: [
					...(atlasNodeKey ? [atlasNodeKey] : []),
					...sceneNodeKeys,
				],
			},
		],
	});
}

function createIndexedPalettedCompactedLandblockBatchPlans({
	plan,
	drawUnits,
	renderChunkTransforms,
}: {
	plan: CompactionFamilyPlan;
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
	renderChunkTransforms: readonly RenderChunkTransform[];
}): {
	landblockId: number;
	batchOrigin: RenderChunkTransform["offset"];
	materialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
	plan: {
		key: string;
		compactableDrawUnitIds: readonly string[];
		materialSlots: readonly { key: string; index: number }[];
		drawUnitMaterialSlots: readonly {
			drawUnitId: string;
			materialSlotKey: string;
		}[];
		drawSlices: CompactionFamilyPlan["renderFamilies"]["indexedPaletted"]["drawSlices"];
		triangleCount: number;
	};
}[] {
	const family = plan.renderFamilies.indexedPaletted;
	const drawUnitById = new Map(
		drawUnits.map((drawUnit) => [drawUnit.id, drawUnit]),
	);
	const chunkOffsetByLandblockId = new Map(
		renderChunkTransforms.map(
			(transform) => [transform.chunkLandblockId, transform.offset] as const,
		),
	);
	const drawUnitIdsByLandblockId = new Map<number, string[]>();
	return family.partitions.flatMap((partition) => {
		drawUnitIdsByLandblockId.clear();
		for (const drawUnitId of partition.compactableDrawUnitIds) {
			const drawUnit = drawUnitById.get(drawUnitId);
			if (!drawUnit) {
				throw new Error(
					`Indexed-paletted family plan references missing draw unit ${drawUnitId}.`,
				);
			}
			if (
				drawUnit.kind !== "static" &&
				drawUnit.kind !== "structured-interior"
			) {
				throw new Error(
					`Indexed-paletted family plan references unsupported draw unit ${drawUnit.id} of kind ${drawUnit.kind}.`,
				);
			}
			const group =
				drawUnitIdsByLandblockId.get(drawUnit.owningLandblockId) ?? [];
			group.push(drawUnit.id);
			drawUnitIdsByLandblockId.set(drawUnit.owningLandblockId, group);
		}
		return [...drawUnitIdsByLandblockId.entries()]
			.sort(([left], [right]) => left - right)
			.map(([landblockId, drawUnitIds]) => {
				const batchOrigin = chunkOffsetByLandblockId.get(landblockId);
				if (!batchOrigin) {
					throw new Error(
						`Indexed-paletted family landblock batch ${formatHex32(landblockId)} has no render chunk origin.`,
					);
				}
				return {
					landblockId,
					batchOrigin,
					...createIndexedPalettedCompactedLandblockBatchPlan({
						sourcePlan: plan,
						sourcePartition: partition,
						landblockId,
						drawUnitIds: drawUnitIds.sort(),
						drawUnits,
					}),
				};
			});
	});
}

function createIndexedPalettedCompactedLandblockBatchPlan({
	sourcePlan,
	sourcePartition,
	landblockId,
	drawUnitIds,
	drawUnits,
}: {
	sourcePlan: CompactionFamilyPlan;
	sourcePartition: CompactionFamilyPlan["renderFamilies"]["indexedPaletted"]["partitions"][number];
	landblockId: number;
	drawUnitIds: readonly string[];
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
}): {
	materialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
	plan: {
		key: string;
		compactableDrawUnitIds: readonly string[];
		materialSlots: readonly { key: string; index: number }[];
		drawUnitMaterialSlots: readonly {
			drawUnitId: string;
			materialSlotKey: string;
		}[];
		drawSlices: CompactionFamilyPlan["renderFamilies"]["indexedPaletted"]["drawSlices"];
		triangleCount: number;
	};
} {
	const drawUnitIdSet = new Set(drawUnitIds);
	const drawUnitById = new Map(
		drawUnits.map((drawUnit) => [drawUnit.id, drawUnit]),
	);
	const batchDrawUnits = drawUnitIds.map((drawUnitId) => {
		const drawUnit = drawUnitById.get(drawUnitId);
		if (!drawUnit) {
			throw new Error(
				`Indexed-paletted family landblock batch ${formatHex32(landblockId)} references missing draw unit ${drawUnitId}.`,
			);
		}
		return drawUnit;
	});
	const family = sourcePartition;
	const sourceRecordByKey = new Map(
		family.materialTableRecords.map((record) => [record.key, record] as const),
	);
	const sourceSlotKeyByDrawUnitId = new Map(
		family.drawUnitMaterialSlots.map(
			(record) => [record.drawUnitId, record.materialSlotKey] as const,
		),
	);
	const batchRecordKeys = uniqueSortedStrings(
		drawUnitIds.map((drawUnitId) => {
			const slotKey = sourceSlotKeyByDrawUnitId.get(drawUnitId);
			if (!slotKey) {
				throw new Error(
					`Indexed-paletted family landblock batch ${formatHex32(landblockId)} draw unit ${drawUnitId} has no explicit material slot mapping.`,
				);
			}
			return slotKey;
		}),
	);
	const materialTableRecords = batchRecordKeys.map((recordKey) => {
		const record = sourceRecordByKey.get(recordKey);
		if (!record) {
			throw new Error(
				`Indexed-paletted family landblock batch ${formatHex32(landblockId)} references missing material record ${recordKey}.`,
			);
		}
		return record;
	});
	const localSlotIndexByKey = new Map(
		batchRecordKeys.map((key, index) => [key, index] as const),
	);
	const drawSlices = family.drawSlices
		.map((slice) => {
			const localDrawUnitIds = slice.drawUnitIds.filter((drawUnitId) =>
				drawUnitIdSet.has(drawUnitId),
			);
			const localMaterialSlotKeys = slice.materialSlotKeys.filter((slotKey) =>
				localSlotIndexByKey.has(slotKey),
			);
			const localSlotIndices = localMaterialSlotKeys.map((slotKey) => {
				const index = localSlotIndexByKey.get(slotKey);
				if (index === undefined) {
					throw new Error(
						`Indexed-paletted family landblock batch ${formatHex32(landblockId)} could not remap material slot ${slotKey}.`,
					);
				}
				return index;
			});
			const materialTableSlotStart =
				localSlotIndices.length === 0 ? 0 : Math.min(...localSlotIndices);
			const materialTableSlotEnd =
				localSlotIndices.length === 0 ? 0 : Math.max(...localSlotIndices);
			return {
				...slice,
				key: describeLandblockDrawSliceKey({
					sourceSliceKey: slice.key,
					landblockId,
					materialTableSlotStart,
					materialTableSlotEnd,
					hasMaterialSlots: localSlotIndices.length > 0,
				}),
				materialTableSlotStart,
				materialTableSlotCount:
					localSlotIndices.length === 0
						? 0
						: materialTableSlotEnd - materialTableSlotStart + 1,
				materialSlotKeys: localMaterialSlotKeys,
				drawUnitIds: localDrawUnitIds,
			};
		})
		.filter((slice) => slice.drawUnitIds.length > 0);
	return {
		materialTableRecords,
		plan: {
			key: describeCompactedFamilyLandblockPlanKey({
				sourcePlan,
				sourcePartitionKey: sourcePartition.key,
				family: "indexed-paletted",
				landblockId,
			}),
			compactableDrawUnitIds: drawUnitIds,
			materialSlots: batchRecordKeys.map((key, index) => ({ key, index })),
			drawUnitMaterialSlots: family.drawUnitMaterialSlots
				.filter((record) => drawUnitIdSet.has(record.drawUnitId))
				.map((record) => ({
					drawUnitId: record.drawUnitId,
					materialSlotKey: record.materialSlotKey,
				})),
			drawSlices,
			triangleCount: batchDrawUnits.reduce(
				(total, drawUnit) => total + drawUnit.geometry.triangleCount,
				0,
			),
		},
	};
}

function createRgbaTexturePageCompactedLandblockBatchPlans({
	plan,
	drawUnits,
	renderChunkTransforms,
}: {
	plan: CompactionFamilyPlan;
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
	renderChunkTransforms: readonly RenderChunkTransform[];
}): {
	landblockId: number;
	batchOrigin: RenderChunkTransform["offset"];
	plan: CompactionFamilyPlan;
}[] {
	const drawUnitById = new Map(
		drawUnits.map((drawUnit) => [drawUnit.id, drawUnit]),
	);
	const chunkOffsetByLandblockId = new Map(
		renderChunkTransforms.map(
			(transform) => [transform.chunkLandblockId, transform.offset] as const,
		),
	);
	const family = plan.renderFamilies.rgbaTexturePage;
	const drawUnitIdsByLandblockId = new Map<number, string[]>();
	return family.partitions.flatMap((partition) => {
		drawUnitIdsByLandblockId.clear();
		for (const drawUnitId of partition.compactableDrawUnitIds) {
			const drawUnit = drawUnitById.get(drawUnitId);
			if (!drawUnit) {
				throw new Error(
					`Compacted geometry plan references missing draw unit ${drawUnitId}.`,
				);
			}
			if (
				drawUnit.kind !== "static" &&
				drawUnit.kind !== "structured-interior"
			) {
				throw new Error(
					`Compacted geometry plan references unsupported draw unit ${drawUnit.id} of kind ${drawUnit.kind}.`,
				);
			}
			const owningLandblockId = drawUnit.owningLandblockId;
			const group = drawUnitIdsByLandblockId.get(owningLandblockId) ?? [];
			group.push(drawUnit.id);
			drawUnitIdsByLandblockId.set(owningLandblockId, group);
		}
		return [...drawUnitIdsByLandblockId.entries()]
			.sort(([left], [right]) => left - right)
			.map(([landblockId, drawUnitIds]) => {
				const batchOrigin = chunkOffsetByLandblockId.get(landblockId);
				if (!batchOrigin) {
					throw new Error(
						`Compacted geometry landblock batch ${formatHex32(landblockId)} has no render chunk origin.`,
					);
				}
				return {
					landblockId,
					batchOrigin,
					plan: createRgbaTexturePageCompactedLandblockBatchPlan({
						sourcePlan: plan,
						sourcePartition: partition,
						drawUnits,
						landblockId,
						drawUnitIds: drawUnitIds.sort(),
					}),
				};
			});
	});
}

function createRgbaTexturePageCompactedLandblockBatchPlan({
	sourcePlan,
	sourcePartition,
	drawUnits,
	landblockId,
	drawUnitIds,
}: {
	sourcePlan: CompactionFamilyPlan;
	sourcePartition: CompactionFamilyPlan["renderFamilies"]["rgbaTexturePage"]["partitions"][number];
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
	landblockId: number;
	drawUnitIds: readonly string[];
}): CompactionFamilyPlan {
	const drawUnitIdSet = new Set(drawUnitIds);
	const drawUnitById = new Map(
		drawUnits.map((drawUnit) => [drawUnit.id, drawUnit]),
	);
	const batchDrawUnits = drawUnitIds.map((drawUnitId) => {
		const drawUnit = drawUnitById.get(drawUnitId);
		if (!drawUnit) {
			throw new Error(
				`Compacted geometry landblock batch ${formatHex32(landblockId)} references missing draw unit ${drawUnitId}.`,
			);
		}
		return drawUnit;
	});
	const sourceMaterialSlotByKey = new Map(
		sourcePartition.materialSlots.map((slot) => [slot.key, slot] as const),
	);
	const sourceMaterialSlotKeyByDrawUnitId = new Map(
		sourcePartition.drawUnitMaterialSlots.map(
			(record) => [record.drawUnitId, record.materialSlotKey] as const,
		),
	);
	const batchMaterialSlotKeys = uniqueSortedStrings(
		batchDrawUnits.map((drawUnit) => {
			const slotKey = sourceMaterialSlotKeyByDrawUnitId.get(drawUnit.id);
			if (!slotKey) {
				throw new Error(
					`Compacted geometry landblock batch ${formatHex32(landblockId)} draw unit ${drawUnit.id} has no explicit material slot mapping.`,
				);
			}
			return slotKey;
		}),
	);
	const localMaterialSlots = batchMaterialSlotKeys.map((slotKey, index) => {
		const sourceSlot = sourceMaterialSlotByKey.get(slotKey);
		if (!sourceSlot) {
			throw new Error(
				`Compacted geometry landblock batch ${formatHex32(landblockId)} references missing material slot ${slotKey}.`,
			);
		}
		return { ...sourceSlot, index };
	});
	const localMaterialSlotByKey = new Map(
		localMaterialSlots.map((slot) => [slot.key, slot] as const),
	);
	const sourceSlices = sourcePartition.drawSlices
		.map((slice) => {
			const localDrawUnitIds = slice.drawUnitIds.filter((drawUnitId) =>
				drawUnitIdSet.has(drawUnitId),
			);
			const localMaterialSlotKeys = slice.materialSlotKeys.filter((slotKey) =>
				localMaterialSlotByKey.has(slotKey),
			);
			const localSlotIndices = localMaterialSlotKeys.map((slotKey) => {
				const slot = localMaterialSlotByKey.get(slotKey);
				if (!slot) {
					throw new Error(
						`Compacted geometry landblock batch ${formatHex32(landblockId)} could not remap material slot ${slotKey}.`,
					);
				}
				return slot.index;
			});
			const materialTableSlotStart =
				localSlotIndices.length === 0 ? 0 : Math.min(...localSlotIndices);
			const materialTableSlotEnd =
				localSlotIndices.length === 0 ? 0 : Math.max(...localSlotIndices);
			return {
				...slice,
				key: describeLandblockDrawSliceKey({
					sourceSliceKey: slice.key,
					landblockId,
					materialTableSlotStart,
					materialTableSlotEnd,
					hasMaterialSlots: localSlotIndices.length > 0,
				}),
				materialTableSlotStart,
				materialTableSlotCount:
					localSlotIndices.length === 0
						? 0
						: materialTableSlotEnd - materialTableSlotStart + 1,
				materialSlotKeys: localMaterialSlotKeys,
				drawUnitIds: localDrawUnitIds,
			};
		})
		.filter((slice) => slice.drawUnitIds.length > 0);
	return {
		...sourcePlan,
		key: describeCompactedFamilyLandblockPlanKey({
			sourcePlan,
			sourcePartitionKey: sourcePartition.key,
			family: "rgba-texture-page",
			landblockId,
		}),
		renderFamilies: {
			...sourcePlan.renderFamilies,
			rgbaTexturePage: {
				kind: "rgba-atlas",
				compactableDrawUnitIds: drawUnitIds,
				materialSlots: localMaterialSlots,
				drawUnitMaterialSlots: sourcePartition.drawUnitMaterialSlots
					.filter((record) => drawUnitIdSet.has(record.drawUnitId))
					.map((record) => ({
						drawUnitId: record.drawUnitId,
						materialSlotKey: record.materialSlotKey,
					})),
				drawSlices: sourceSlices,
				partitions: [
					{
						key: `${sourcePartition.key}|landblock=${formatHex32(landblockId)}`,
						compactableDrawUnitIds: drawUnitIds,
						materialSlots: localMaterialSlots,
						drawUnitMaterialSlots: sourcePartition.drawUnitMaterialSlots
							.filter((record) => drawUnitIdSet.has(record.drawUnitId))
							.map((record) => ({
								drawUnitId: record.drawUnitId,
								materialSlotKey: record.materialSlotKey,
							})),
						drawSlices: sourceSlices,
					},
				],
			},
		},
		compactableDrawUnitIds: drawUnitIds,
		materialSlots: localMaterialSlots,
		drawUnitMaterialSlots: sourcePartition.drawUnitMaterialSlots
			.filter((record) => drawUnitIdSet.has(record.drawUnitId))
			.map((record) => ({
				drawUnitId: record.drawUnitId,
				materialSlotKey: record.materialSlotKey,
			})),
		drawSlices: sourceSlices,
		staticObjectKeys: uniqueSortedStrings(
			batchDrawUnits.flatMap((drawUnit) => drawUnit.staticObjectKeys),
		),
		staticPartCount: batchDrawUnits.reduce(
			(total, drawUnit) => total + drawUnit.staticPartCount,
			0,
		),
		triangleCount: batchDrawUnits.reduce(
			(total, drawUnit) => total + drawUnit.geometry.triangleCount,
			0,
		),
	};
}

function sumCompactedGeometryBatches(
	store: Webgl2WorldResourceStore,
	select: (batch: Webgl2CompactedGeometryBatchResource) => number,
): number {
	return [...store.compactedGeometryBatches.values()].reduce(
		(total, batch) => total + select(batch),
		0,
	);
}

function countCompactedFamilyResources(
	resources: ReadonlyMap<string, Webgl2CompactedGeometryFamilyResource>,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const resource of resources.values()) {
		counts[resource.family] = (counts[resource.family] ?? 0) + 1;
	}
	return counts;
}

function describeCompactedFamilyLandblockPlanKey({
	sourcePlan,
	sourcePartitionKey,
	family,
	landblockId,
}: {
	sourcePlan: CompactionFamilyPlan;
	sourcePartitionKey: string;
	family: "rgba-texture-page" | "indexed-paletted";
	landblockId: number;
}): string {
	return [
		"compacted-family-landblock-plan",
		family,
		`landblock=${formatHex32(landblockId)}`,
		`plan=${hashString(sourcePlan.key)}`,
		`partition=${hashString(sourcePartitionKey)}`,
	].join("|");
}

function describeLandblockDrawSliceKey({
	sourceSliceKey,
	landblockId,
	materialTableSlotStart,
	materialTableSlotEnd,
	hasMaterialSlots,
}: {
	sourceSliceKey: string;
	landblockId: number;
	materialTableSlotStart: number;
	materialTableSlotEnd: number;
	hasMaterialSlots: boolean;
}): string {
	return [
		...sourceSliceKey
			.split("|")
			.filter((segment) => !segment.startsWith("table=")),
		`table=${
			hasMaterialSlots
				? `${materialTableSlotStart}-${materialTableSlotEnd}`
				: "none"
		}`,
		`landblock=${formatHex32(landblockId)}`,
	].join("|");
}

function releaseWebgl2CompactedGeometryBatchGraphLease(
	store: Webgl2WorldResourceStore,
	batchNodeKey: string,
): void {
	const lease = store.compactedGeometryBatchGraphLeasesByKey.get(batchNodeKey);
	if (!lease) {
		return;
	}
	if (!store.compactedGeometryBatchGraph) {
		throw new Error("Compacted geometry batch graph lease has no bound graph.");
	}
	store.compactedGeometryBatchGraph.releaseLease(lease);
	store.compactedGeometryBatchGraphLeasesByKey.delete(batchNodeKey);
	if (store.compactedGeometryBatchGraphLeasesByKey.size === 0) {
		store.compactedGeometryBatchGraph = null;
	}
}

export function releaseWebgl2CompactedGeometryBatchGraphLeases(
	store: Webgl2WorldResourceStore,
): void {
	for (const batchNodeKey of [
		...store.compactedGeometryBatchGraphLeasesByKey.keys(),
	]) {
		releaseWebgl2CompactedGeometryBatchGraphLease(store, batchNodeKey);
	}
}

function hashString(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return toUnsignedHex(hash);
}

function toUnsignedHex(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
