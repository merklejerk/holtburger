import { profileBrowserJsScope } from "../../../diagnostics/browser-js-profiler";
import { formatHex32 } from "../../../landblocks";
import {
	describeCompactedGeometryJobKey,
	type CompactedGeometryBatch,
	type CompactedGeometrySourceDrawUnit,
} from "../../compaction/compacted-geometry";
import type {
	CompactionFamilyPlan,
	IndexedPalettedFamilyDrawSlice,
	IndexedPalettedFamilyMaterialTableRecord,
} from "../../compaction/compaction-family-planner";
import type { RenderChunkTransform } from "../../render-anchor";
import { createTranslationMat4 } from "../../render-math";
import {
	atlasGenerationGraphNodeKey,
	sceneObjectGraphNodeKey,
	staticBatchGraphNodeKey,
	type RendererResourceGraph,
} from "../../renderer-resource-graph";
import { uniqueSortedStrings } from "../../staged-world-assembly";
import {
	createTexturePageAtlasPlacementsByEntryKey,
	createTexturePageDetailAtlasPlacementsByEntryKey,
	type TexturePageAtlasPlan,
} from "../../texture-pages/texture-page-atlas-planner";
import type { IndexedResourceAtlasPlan } from "../../texture-pages/indexed-resource-atlas-planner";
import type { Webgl2WorldResourceStore } from "../../webgl2-world-resources";
import type { ReadyCompactedGeometryWorkerResult } from "../../worker-resources/compacted-geometry-worker-scheduler";
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

interface RgbaTexturePageCompactedLandblockBatchPlan {
	family: "rgbaAtlas";
	sourcePartitionKey: string;
	desiredJobKey: string;
	landblockId: number;
	batchOrigin: RenderChunkTransform["offset"];
	plan: CompactionFamilyPlan;
}

export interface IndexedPalettedCompactedLandblockBatchPlan {
	family: "indexedPaletteAtlas";
	sourcePartitionKey: string;
	desiredJobKey: string;
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
}

export function syncWebgl2CompactedGeometryResources({
	gl,
	store,
	plan,
	drawUnits,
	renderChunkTransforms,
	rendererResourceGraph,
	indexedResourceAtlasPlan,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	plan: CompactionFamilyPlan;
	drawUnits: readonly CompactedGeometrySourceDrawUnit[];
	renderChunkTransforms: readonly RenderChunkTransform[];
	rendererResourceGraph?: RendererResourceGraph;
	indexedResourceAtlasPlan: IndexedResourceAtlasPlan;
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
	const retainedSchedulerKeys = new Set<string>();
	const readyWorkerResultsByGroupKey = groupReadyCompactedGeometryWorkerResults(
		store.compactedGeometryWorkerScheduler?.consumeReadyResults() ?? [],
	);
	store.compactedGeometryWorkerMetrics =
		store.compactedGeometryWorkerScheduler?.getMetrics() ??
		store.compactedGeometryWorkerMetrics;
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
			const schedulerKey =
				describeCompactedGeometryBatchSchedulerKey(batchPlan);
			retainedSchedulerKeys.add(schedulerKey);
			const readyWorkerResult = readyWorkerResultsByGroupKey.get(schedulerKey);
			if (readyWorkerResult?.result.key === batchPlan.desiredJobKey) {
				if (!readyWorkerResult.result.geometry) {
					throw new Error(
						`Compacted geometry worker returned no geometry for desired group ${schedulerKey}.`,
					);
				}
				const familyResource = createWebgl2RgbaTexturePageFamilyResource({
					geometry: readyWorkerResult.result.geometry,
					textureAtlasGenerationKey: store.textureAtlasGeneration.key,
					materialSlots: batchPlan.plan.materialSlots,
					materialDrawSlices: batchPlan.plan.drawSlices,
					placementsByEntryKey,
					detailPlacementsByEntryKey,
				});
				const committedKeys = commitWebgl2CompactedGeometryBatch({
					gl,
					store,
					geometry: readyWorkerResult.result.geometry,
					landblockId: batchPlan.landblockId,
					familyResource,
					rendererResourceGraph,
					atlasGenerationKey: store.textureAtlasGeneration?.key ?? null,
					schedulerKey,
				});
				retainedGeometryBatchKeys.add(committedKeys.geometryBatchKey);
				retainedFamilyResourceKeys.add(committedKeys.familyResourceKey);
				store.compactedGeometryWorkerScheduler?.markCommitted(
					schedulerKey,
					readyWorkerResult.result.key,
				);
				continue;
			}
			scheduleWebgl2CompactedGeometryBatchWorkerJob({
				store,
				batchPlan,
				drawUnits,
				schedulerKey,
				retainedGeometryBatchKeys,
				retainedFamilyResourceKeys,
			});
		}
	}
	if (plan.renderFamilies.indexedPaletted.compactableDrawUnitIds.length > 0) {
		if (
			!store.indexedResourceAtlasGeneration ||
			!indexedResourceAtlasPlanHasAllIndexedFamilyPlacements(
				plan,
				indexedResourceAtlasPlan,
			)
		) {
			store.compactedResourceFallbackSamples = [
				...store.compactedResourceFallbackSamples,
				`compacted indexed batch ${plan.key} waiting for complete indexed resource atlas placements`,
			].slice(0, 8);
		} else {
			const batchPlans = createIndexedPalettedCompactedLandblockBatchPlans({
				plan,
				drawUnits,
				renderChunkTransforms,
				indexedResourceAtlasPlan,
			});
			for (const batchPlan of batchPlans) {
				const schedulerKey =
					describeCompactedGeometryBatchSchedulerKey(batchPlan);
				retainedSchedulerKeys.add(schedulerKey);
				const readyWorkerResult =
					readyWorkerResultsByGroupKey.get(schedulerKey);
				if (readyWorkerResult?.result.key === batchPlan.desiredJobKey) {
					if (!readyWorkerResult.result.geometry) {
						throw new Error(
							`Compacted geometry worker returned no geometry for desired group ${schedulerKey}.`,
						);
					}
					const familyResource = createWebgl2IndexedPalettedFamilyResource({
						geometry: readyWorkerResult.result.geometry,
						indexedResourceAtlasGenerationKey:
							store.indexedResourceAtlasGeneration.key,
						detailTextureAtlasGenerationKey:
							store.textureAtlasGeneration?.key ?? null,
						materialTableRecords: batchPlan.materialTableRecords,
						materialDrawSlices: batchPlan.plan.drawSlices,
						indexPlacementsByTextureKey:
							indexedResourceAtlasPlan.indexPlacementsByTextureKey,
						palettePlacementsByTextureKey:
							indexedResourceAtlasPlan.palettePlacementsByTextureKey,
						detailPlacementsByEntryKey,
					});
					const committedKeys = commitWebgl2CompactedGeometryBatch({
						gl,
						store,
						geometry: readyWorkerResult.result.geometry,
						landblockId: batchPlan.landblockId,
						familyResource,
						rendererResourceGraph,
						atlasGenerationKey: store.textureAtlasGeneration?.key ?? null,
						schedulerKey,
					});
					retainedGeometryBatchKeys.add(committedKeys.geometryBatchKey);
					retainedFamilyResourceKeys.add(committedKeys.familyResourceKey);
					store.compactedGeometryWorkerScheduler?.markCommitted(
						schedulerKey,
						readyWorkerResult.result.key,
					);
					continue;
				}
				scheduleWebgl2CompactedGeometryBatchWorkerJob({
					store,
					batchPlan,
					drawUnits,
					schedulerKey,
					retainedGeometryBatchKeys,
					retainedFamilyResourceKeys,
				});
			}
		}
	}
	releaseInactiveCompactedGeometrySchedulerGroups({
		store,
		retainedSchedulerKeys,
	});
	for (const familyKey of store.compactedGeometryFamilyResources.keys()) {
		if (!retainedFamilyResourceKeys.has(familyKey)) {
			store.compactedGeometryFamilyResources.delete(familyKey);
		}
	}
	for (const [batchKey, batch] of store.compactedGeometryBatches) {
		if (
			!shouldRetainWebgl2CompactedGeometryBatch({
				store,
				batchKey,
				retainedGeometryBatchKeys,
			})
		) {
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
	store.compactedGeometryWorkerMetrics =
		store.compactedGeometryWorkerScheduler?.getMetrics() ??
		store.compactedGeometryWorkerMetrics;
	if (!rendererResourceGraph || store.compactedGeometryBatches.size === 0) {
		releaseWebgl2CompactedGeometryBatchGraphLeases(store);
	}
}

export function shouldRetainWebgl2CompactedGeometryBatch({
	store,
	batchKey,
	retainedGeometryBatchKeys,
}: {
	store: Webgl2WorldResourceStore;
	batchKey: string;
	retainedGeometryBatchKeys: ReadonlySet<string>;
}): boolean {
	return (
		retainedGeometryBatchKeys.has(batchKey) ||
		store.pendingCompactedGeometryBatchKeys.has(batchKey)
	);
}

type CompactedLandblockBatchPlan =
	| RgbaTexturePageCompactedLandblockBatchPlan
	| IndexedPalettedCompactedLandblockBatchPlan;

interface CommittedCompactedGeometryResourceKeys {
	geometryBatchKey: string;
	familyResourceKey: string;
}

function groupReadyCompactedGeometryWorkerResults(
	results: readonly ReadyCompactedGeometryWorkerResult[],
): Map<string, ReadyCompactedGeometryWorkerResult> {
	return new Map(results.map((result) => [result.groupKey, result] as const));
}

function scheduleWebgl2CompactedGeometryBatchWorkerJob({
	store,
	batchPlan,
	drawUnits,
	schedulerKey,
	retainedGeometryBatchKeys,
	retainedFamilyResourceKeys,
}: {
	store: Webgl2WorldResourceStore;
	batchPlan: CompactedLandblockBatchPlan;
	drawUnits: readonly CompactedGeometrySourceDrawUnit[];
	schedulerKey: string;
	retainedGeometryBatchKeys: Set<string>;
	retainedFamilyResourceKeys: Set<string>;
}): void {
	if (!store.compactedGeometryWorkerScheduler) {
		throw new Error(
			"Compacted geometry generation requires a compacted geometry worker scheduler.",
		);
	}
	const committedBatchKey =
		store.compactedGeometryBatchKeyBySchedulerKey.get(schedulerKey);
	const committedFamilyResourceKey =
		store.compactedGeometryFamilyResourceKeyBySchedulerKey.get(schedulerKey);
	if (committedBatchKey === batchPlan.desiredJobKey) {
		retainedGeometryBatchKeys.add(committedBatchKey);
		updateCommittedCompactedGeometryBatchOrigin({
			store,
			batchKey: committedBatchKey,
			batchOrigin: batchPlan.batchOrigin,
		});
		if (committedFamilyResourceKey) {
			retainedFamilyResourceKeys.add(committedFamilyResourceKey);
		}
		return;
	}
	if (committedBatchKey) {
		store.pendingCompactedGeometryBatchKeys.add(committedBatchKey);
		retainedGeometryBatchKeys.add(committedBatchKey);
	}
	if (committedFamilyResourceKey) {
		retainedFamilyResourceKeys.add(committedFamilyResourceKey);
	}
	store.compactedGeometryWorkerScheduler.scheduleDesired({
		groupKey: schedulerKey,
		desiredJobKey: batchPlan.desiredJobKey,
		plan: batchPlan.plan,
		drawUnits,
		batchOrigin: batchPlan.batchOrigin,
	});
}

function updateCommittedCompactedGeometryBatchOrigin({
	store,
	batchKey,
	batchOrigin,
}: {
	store: Webgl2WorldResourceStore;
	batchKey: string;
	batchOrigin: RenderChunkTransform["offset"];
}): void {
	const batch = store.compactedGeometryBatches.get(batchKey);
	if (!batch) {
		throw new Error(
			`Compacted scheduler references committed batch ${batchKey}, but no batch resource is installed.`,
		);
	}
	batch.batchModelMatrix = createTranslationMat4(batchOrigin);
}

function releaseInactiveCompactedGeometrySchedulerGroups({
	store,
	retainedSchedulerKeys,
}: {
	store: Webgl2WorldResourceStore;
	retainedSchedulerKeys: ReadonlySet<string>;
}): void {
	for (const [schedulerKey, batchKey] of [
		...store.compactedGeometryBatchKeyBySchedulerKey.entries(),
	]) {
		if (retainedSchedulerKeys.has(schedulerKey)) {
			continue;
		}
		store.pendingCompactedGeometryBatchKeys.delete(batchKey);
		store.compactedGeometryBatchKeyBySchedulerKey.delete(schedulerKey);
		store.compactedGeometryFamilyResourceKeyBySchedulerKey.delete(schedulerKey);
	}
}

function describeCompactedGeometryBatchSchedulerKey(
	batchPlan: CompactedLandblockBatchPlan,
): string {
	return [
		batchPlan.family,
		`partition=${hashString(batchPlan.sourcePartitionKey)}`,
		`landblock=${formatHex32(batchPlan.landblockId)}`,
	].join("|");
}

function commitWebgl2CompactedGeometryBatch({
	gl,
	store,
	geometry,
	landblockId,
	familyResource,
	rendererResourceGraph,
	atlasGenerationKey,
	schedulerKey,
}: {
	gl: WebGL2RenderingContext;
	store: Webgl2WorldResourceStore;
	geometry: CompactedGeometryBatch;
	landblockId: number;
	familyResource: Webgl2CompactedGeometryFamilyResource;
	rendererResourceGraph?: RendererResourceGraph;
	atlasGenerationKey: string | null;
	schedulerKey: string | null;
}): CommittedCompactedGeometryResourceKeys {
	if (familyResource.geometryBatchKey !== geometry.key) {
		throw new Error(
			`Compacted family resource ${familyResource.key} references ${familyResource.geometryBatchKey}, not committed geometry ${geometry.key}.`,
		);
	}
	store.pendingCompactedGeometryBatchKeys.delete(geometry.key);
	if (schedulerKey) {
		const previousBatchKey =
			store.compactedGeometryBatchKeyBySchedulerKey.get(schedulerKey);
		if (previousBatchKey && previousBatchKey !== geometry.key) {
			store.pendingCompactedGeometryBatchKeys.delete(previousBatchKey);
		}
		store.compactedGeometryBatchKeyBySchedulerKey.set(
			schedulerKey,
			geometry.key,
		);
		store.compactedGeometryFamilyResourceKeyBySchedulerKey.set(
			schedulerKey,
			familyResource.key,
		);
	}
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
	} else {
		updateWebgl2CompactedGeometryBatchDynamicTables(previousBatch, geometry);
	}
	store.compactedGeometryFamilyResources.set(
		familyResource.key,
		familyResource,
	);
	const committedBatch = store.compactedGeometryBatches.get(geometry.key);
	if (!committedBatch) {
		throw new Error(
			`Compacted geometry commit did not install batch ${geometry.key}.`,
		);
	}
	commitWebgl2CompactedGeometryBatchGraphProjection({
		store,
		rendererResourceGraph,
		batch: committedBatch,
		familyResources: [familyResource],
		atlasGenerationKey,
	});
	return {
		geometryBatchKey: geometry.key,
		familyResourceKey: familyResource.key,
	};
}

function commitWebgl2CompactedGeometryBatchGraphProjection({
	store,
	rendererResourceGraph,
	batch,
	familyResources,
	atlasGenerationKey,
}: {
	store: Webgl2WorldResourceStore;
	rendererResourceGraph?: RendererResourceGraph;
	batch: Webgl2CompactedGeometryBatchResource;
	familyResources: readonly Webgl2CompactedGeometryFamilyResource[];
	atlasGenerationKey: string | null;
}): void {
	if (!rendererResourceGraph) {
		return;
	}
	store.compactedGeometryBatchGraph = rendererResourceGraph;
	const batchNodeKey = staticBatchGraphNodeKey(batch.key);
	upsertWebgl2CompactedGeometryBatchGraph({
		graph: rendererResourceGraph,
		batch,
		familyResources,
		atlasGenerationKey,
	});
	if (store.compactedGeometryBatchGraphLeasesByKey.has(batchNodeKey)) {
		return;
	}
	store.compactedGeometryBatchGraphLeasesByKey.set(
		batchNodeKey,
		rendererResourceGraph.leaseNode(
			batchNodeKey,
			"webgl2 compacted landblock batch",
		),
	);
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

export function createIndexedPalettedCompactedLandblockBatchPlans({
	plan,
	drawUnits,
	renderChunkTransforms,
	indexedResourceAtlasPlan,
}: {
	plan: CompactionFamilyPlan;
	drawUnits: readonly CompactedGeometrySourceDrawUnit[];
	renderChunkTransforms: readonly RenderChunkTransform[];
	indexedResourceAtlasPlan: IndexedResourceAtlasPlan;
}): IndexedPalettedCompactedLandblockBatchPlan[] {
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
				const batchPlan = createIndexedPalettedCompactedLandblockBatchPlan({
					sourcePlan: plan,
					sourcePartition: partition,
					landblockId,
					drawUnitIds: drawUnitIds.sort(),
					drawUnits,
					indexedResourceAtlasPlan,
				});
				return {
					family: "indexedPaletteAtlas",
					sourcePartitionKey: partition.key,
					desiredJobKey: describeCompactedGeometryJobKey({
						plan: batchPlan.plan,
						drawUnits,
						batchOrigin,
					}),
					landblockId,
					batchOrigin,
					...batchPlan,
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
	indexedResourceAtlasPlan,
}: {
	sourcePlan: CompactionFamilyPlan;
	sourcePartition: CompactionFamilyPlan["renderFamilies"]["indexedPaletted"]["partitions"][number];
	landblockId: number;
	drawUnitIds: readonly string[];
	drawUnits: readonly CompactedGeometrySourceDrawUnit[];
	indexedResourceAtlasPlan: IndexedResourceAtlasPlan;
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
	const drawSlices = regroupIndexedPalettedLandblockDrawSlices(
		family.drawSlices
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
			.filter((slice) => slice.drawUnitIds.length > 0),
		{
			indexedResourceAtlasPlan,
			materialRecordByKey: sourceRecordByKey,
			detailPlacementsByEntryKey:
				createTexturePageDetailAtlasPlacementsByEntryKey(
					sourcePlan.texturePageAtlasPlan,
				),
		},
	);
	return {
		materialTableRecords,
		plan: {
			key: describeCompactedFamilyLandblockPlanKey({
				sourcePlan,
				sourcePartitionKey: sourcePartition.key,
				family: "indexed-paletted",
				landblockId,
				atlasPlanKey: indexedResourceAtlasPlan.key,
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

function indexedResourceAtlasPlanHasAllIndexedFamilyPlacements(
	plan: CompactionFamilyPlan,
	indexedResourceAtlasPlan: IndexedResourceAtlasPlan,
): boolean {
	return plan.renderFamilies.indexedPaletted.materialTableRecords.every(
		(record) =>
			indexedResourceAtlasPlan.indexPlacementsByTextureKey.has(
				record.indexPageKey,
			) &&
			indexedResourceAtlasPlan.palettePlacementsByTextureKey.has(
				record.palettePageKey,
			),
	);
}

function regroupIndexedPalettedLandblockDrawSlices(
	drawSlices: readonly IndexedPalettedFamilyDrawSlice[],
	options: {
		indexedResourceAtlasPlan: IndexedResourceAtlasPlan;
		materialRecordByKey: ReadonlyMap<
			string,
			IndexedPalettedFamilyMaterialTableRecord
		>;
		detailPlacementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>;
	},
): IndexedPalettedFamilyDrawSlice[] {
	const groups = new Map<
		string,
		{
			representative: IndexedPalettedFamilyDrawSlice;
			indexAtlasTextureIndex: number;
			paletteAtlasTextureIndex: number;
			detailAtlasTextureIndex: number | null;
			materialTableSlotStart: number;
			materialTableSlotEnd: number;
			materialSlotKeys: Set<string>;
			drawUnitIds: string[];
		}
	>();
	for (const slice of drawSlices) {
		const indexPlacement =
			options.indexedResourceAtlasPlan.indexPlacementsByTextureKey.get(
				slice.indexPageKey,
			);
		const palettePlacement =
			options.indexedResourceAtlasPlan.palettePlacementsByTextureKey.get(
				slice.palettePageKey,
			);
		if (!indexPlacement || !palettePlacement) {
			throw new Error(
				`Indexed-paletted landblock draw slice ${slice.key} has no indexed atlas placement.`,
			);
		}
		const detailAtlasTextureIndex =
			resolveIndexedPalettedSliceDetailAtlasTextureIndex(
				slice,
				options.materialRecordByKey,
				options.detailPlacementsByEntryKey,
			);
		const groupKey = [
			slice.indexFormat,
			`indexAtlas=${indexPlacement.atlasTextureIndex}`,
			`paletteAtlas=${palettePlacement.atlasTextureIndex}`,
			`detailAtlas=${detailAtlasTextureIndex ?? "none"}`,
			slice.renderStateKey,
		].join("|");
		const materialTableSlotEnd =
			slice.materialTableSlotStart + slice.materialTableSlotCount - 1;
		const group = groups.get(groupKey) ?? {
			representative: slice,
			indexAtlasTextureIndex: indexPlacement.atlasTextureIndex,
			paletteAtlasTextureIndex: palettePlacement.atlasTextureIndex,
			detailAtlasTextureIndex,
			materialTableSlotStart: slice.materialTableSlotStart,
			materialTableSlotEnd,
			materialSlotKeys: new Set<string>(),
			drawUnitIds: [],
		};
		group.materialTableSlotStart = Math.min(
			group.materialTableSlotStart,
			slice.materialTableSlotStart,
		);
		group.materialTableSlotEnd = Math.max(
			group.materialTableSlotEnd,
			materialTableSlotEnd,
		);
		for (const materialSlotKey of slice.materialSlotKeys) {
			group.materialSlotKeys.add(materialSlotKey);
		}
		group.drawUnitIds.push(...slice.drawUnitIds);
		groups.set(groupKey, group);
	}
	return [...groups.values()]
		.sort(
			(left, right) =>
				left.representative.indexFormat.localeCompare(
					right.representative.indexFormat,
				) ||
				left.indexAtlasTextureIndex - right.indexAtlasTextureIndex ||
				left.paletteAtlasTextureIndex - right.paletteAtlasTextureIndex ||
				(left.detailAtlasTextureIndex ?? -1) -
					(right.detailAtlasTextureIndex ?? -1) ||
				compareFirstString(left.drawUnitIds, right.drawUnitIds),
		)
		.map((group) => ({
			...group.representative,
			key: [
				"compacted-indexed-atlas-draw-slice",
				group.representative.indexFormat,
				`indexAtlas=${group.indexAtlasTextureIndex}`,
				`paletteAtlas=${group.paletteAtlasTextureIndex}`,
				`detailAtlas=${group.detailAtlasTextureIndex ?? "none"}`,
				`table=${group.materialTableSlotStart}-${group.materialTableSlotEnd}`,
				`draws=${uniqueSortedStrings(group.drawUnitIds).join(",")}`,
			].join("|"),
			indexAtlasTextureIndex: group.indexAtlasTextureIndex,
			paletteAtlasTextureIndex: group.paletteAtlasTextureIndex,
			materialTableSlotStart: group.materialTableSlotStart,
			materialTableSlotCount:
				group.materialTableSlotEnd - group.materialTableSlotStart + 1,
			materialSlotKeys: uniqueSortedStrings([...group.materialSlotKeys]),
			drawUnitIds: uniqueSortedStrings(group.drawUnitIds),
		}));
}

function resolveIndexedPalettedSliceDetailAtlasTextureIndex(
	slice: IndexedPalettedFamilyDrawSlice,
	materialRecordByKey: ReadonlyMap<
		string,
		IndexedPalettedFamilyMaterialTableRecord
	>,
	detailPlacementsByEntryKey: ReadonlyMap<string, { textureIndex: number }>,
): number | null {
	const textureIndices = uniqueNumbers(
		slice.materialSlotKeys.flatMap((slotKey) => {
			const record = materialRecordByKey.get(slotKey);
			if (!record?.detailAtlasEntryKey) {
				return [];
			}
			const placement = detailPlacementsByEntryKey.get(
				record.detailAtlasEntryKey,
			);
			if (!placement) {
				throw new Error(
					`Indexed-paletted landblock draw slice ${slice.key} references missing detail placement ${record.detailAtlasEntryKey}.`,
				);
			}
			return [placement.textureIndex];
		}),
	);
	if (textureIndices.length > 1) {
		throw new Error(
			`Indexed-paletted landblock draw slice ${slice.key} spans multiple detail atlas textures.`,
		);
	}
	return textureIndices[0] ?? null;
}

function compareFirstString(
	leftValues: readonly string[],
	rightValues: readonly string[],
): number {
	return (leftValues[0] ?? "").localeCompare(rightValues[0] ?? "");
}

function uniqueNumbers(values: readonly number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function createRgbaTexturePageCompactedLandblockBatchPlans({
	plan,
	drawUnits,
	renderChunkTransforms,
}: {
	plan: CompactionFamilyPlan;
	drawUnits: readonly CompactedGeometrySourceDrawUnit[];
	renderChunkTransforms: readonly RenderChunkTransform[];
}): RgbaTexturePageCompactedLandblockBatchPlan[] {
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
				const batchPlan = createRgbaTexturePageCompactedLandblockBatchPlan({
					sourcePlan: plan,
					sourcePartition: partition,
					drawUnits,
					landblockId,
					drawUnitIds: drawUnitIds.sort(),
				});
				return {
					family: "rgbaAtlas",
					sourcePartitionKey: partition.key,
					desiredJobKey: describeCompactedGeometryJobKey({
						plan: batchPlan,
						drawUnits,
						batchOrigin,
					}),
					landblockId,
					batchOrigin,
					plan: batchPlan,
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
	drawUnits: readonly CompactedGeometrySourceDrawUnit[];
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
	atlasPlanKey = null,
}: {
	sourcePlan: CompactionFamilyPlan;
	sourcePartitionKey: string;
	family: "rgba-texture-page" | "indexed-paletted";
	landblockId: number;
	atlasPlanKey?: string | null;
}): string {
	return [
		"compacted-family-landblock-plan",
		family,
		`landblock=${formatHex32(landblockId)}`,
		`plan=${hashString(sourcePlan.key)}`,
		...(atlasPlanKey ? [`atlas=${hashString(atlasPlanKey)}`] : []),
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
