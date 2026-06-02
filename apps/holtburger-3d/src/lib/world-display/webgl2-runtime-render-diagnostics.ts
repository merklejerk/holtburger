import type { DrawUnitRuntimeDiagnostic } from "./runtime-render-diagnostics";
import type {
	Webgl2WorldDrawUnit,
	Webgl2WorldResourceStore,
} from "./webgl2-world-resources";
import type {
	Webgl2CompactedGeometryBatchResource,
	Webgl2CompactedGeometryFamilyResource,
	Webgl2IndexedPalettedFamilyResource,
	Webgl2RgbaTexturePageFamilyResource,
} from "./webgl2-compacted-geometry-resources";

export function deriveWebgl2DrawUnitRuntimeDiagnostics({
	store,
	drawUnitIds,
}: {
	store: Webgl2WorldResourceStore;
	drawUnitIds: readonly string[];
}): DrawUnitRuntimeDiagnostic[] {
	return drawUnitIds.map((drawUnitId) =>
		describeDrawUnitRuntimeDiagnostic(store, drawUnitId),
	);
}

function describeDrawUnitRuntimeDiagnostic(
	store: Webgl2WorldResourceStore,
	drawUnitId: string,
): DrawUnitRuntimeDiagnostic {
	const drawUnit = store.drawUnitsById.get(drawUnitId) ?? null;
	if (!drawUnit) {
		return {
			drawUnitId,
			submissionPath: "missing-draw-unit",
			drawUnit: null,
			compactedRoutes: [],
		};
	}
	const compactedRoutes = collectCompactedRoutes(store, drawUnit);
	return {
		drawUnitId,
		submissionPath:
			compactedRoutes.length === 0 ? "direct-retained" : "compacted-resource",
		drawUnit: {
			kind: drawUnit.kind,
			materialKind: drawUnit.materialKind,
			materialKey: drawUnit.materialKey,
			triangleCount: drawUnit.triangleCount,
			compactionDecision: drawUnit.compactionEligibility.decision,
			compactionMaterialFamily: drawUnit.compactionEligibility.material.family,
			compactionAlphaPolicy:
				drawUnit.compactionEligibility.material.alphaPolicy,
			compactionMaterialBlockers:
				drawUnit.compactionEligibility.material.blockers,
			compactionGeometryBlockers:
				drawUnit.compactionEligibility.geometry.blockers,
		},
		compactedRoutes,
	};
}

function collectCompactedRoutes(
	store: Webgl2WorldResourceStore,
	drawUnit: Webgl2WorldDrawUnit,
): DrawUnitRuntimeDiagnostic["compactedRoutes"] {
	return [...store.compactedGeometryFamilyResources.values()].flatMap(
		(family) => collectFamilyRoutes(store, family, drawUnit),
	);
}

function collectFamilyRoutes(
	store: Webgl2WorldResourceStore,
	family: Webgl2CompactedGeometryFamilyResource,
	drawUnit: Webgl2WorldDrawUnit,
): DrawUnitRuntimeDiagnostic["compactedRoutes"] {
	const batch =
		store.compactedGeometryBatches.get(family.geometryBatchKey) ?? null;
	if (family.family === "rgba-texture-page") {
		return collectRgbaFamilyRoutes(family, batch, drawUnit);
	}
	return collectIndexedFamilyRoutes(family, batch, drawUnit);
}

function collectRgbaFamilyRoutes(
	family: Webgl2RgbaTexturePageFamilyResource,
	batch: Webgl2CompactedGeometryBatchResource | null,
	drawUnit: Webgl2WorldDrawUnit,
): DrawUnitRuntimeDiagnostic["compactedRoutes"] {
	const sourceMaterialSlotKey =
		drawUnit.atlasEligibility?.materialSlotKey ?? null;
	return family.drawSlices
		.filter((slice) => slice.drawUnitIds.includes(drawUnit.id))
		.map((slice) => {
			const materialSlot =
				sourceMaterialSlotKey === null
					? null
					: (family.materialSlots.find(
							(slot) =>
								slot.sourceMaterialSlotKey === sourceMaterialSlotKey &&
								slice.materialSlotKeys.includes(slot.key),
						) ?? null);
			return {
				family: "rgba-texture-page",
				familyResourceKey: family.key,
				geometryBatchKey: family.geometryBatchKey,
				batchLandblockId: batch?.landblockId ?? null,
				batchAvailable: batch !== null,
				sliceKey: slice.key,
				sliceFirstIndex: slice.firstIndex,
				sliceIndexCount: slice.indexCount,
				sliceDrawUnitCount: slice.drawUnitIds.length,
				sliceMaterialSlotKeys: slice.materialSlotKeys,
				atlasTextureIndex: slice.atlasTextureIndex,
				detailAtlasTextureIndex: slice.detailAtlasTextureIndex,
				materialSlot: materialSlot
					? {
							key: materialSlot.key,
							sourceMaterialSlotKey: materialSlot.sourceMaterialSlotKey,
							index: materialSlot.index,
							atlasTextureIndex: materialSlot.atlasTextureIndex,
							atlasRect: materialSlot.atlasRect,
							detailAtlasTextureIndex: materialSlot.detailAtlasTextureIndex,
							detailAtlasRect: materialSlot.detailAtlasRect,
							detailTiling: materialSlot.detailTiling,
							renderStateKey: materialSlot.renderStateKey,
							samplingKey: materialSlot.samplingKey,
							wrap: `${materialSlot.wrapS}/${materialSlot.wrapT}`,
						}
					: null,
			};
		});
}

function collectIndexedFamilyRoutes(
	family: Webgl2IndexedPalettedFamilyResource,
	batch: Webgl2CompactedGeometryBatchResource | null,
	drawUnit: Webgl2WorldDrawUnit,
): DrawUnitRuntimeDiagnostic["compactedRoutes"] {
	return family.drawSlices
		.filter((slice) => slice.drawUnitIds.includes(drawUnit.id))
		.map((slice) => {
			const materialRecord =
				family.materialTableRecords.find(
					(record) =>
						record.sourceMaterialKey === drawUnit.materialKey &&
						slice.materialSlotKeys.includes(record.key),
				) ?? null;
			return {
				family: "indexed-paletted",
				familyResourceKey: family.key,
				geometryBatchKey: family.geometryBatchKey,
				batchLandblockId: batch?.landblockId ?? null,
				batchAvailable: batch !== null,
				sliceKey: slice.key,
				sliceFirstIndex: slice.firstIndex,
				sliceIndexCount: slice.indexCount,
				sliceDrawUnitCount: slice.drawUnitIds.length,
				sliceMaterialSlotKeys: slice.materialSlotKeys,
				indexFormat: slice.indexFormat,
				indexPageKey: slice.indexPageKey,
				palettePageKey: slice.palettePageKey,
				detailAtlasTextureIndex: slice.detailAtlasTextureIndex,
				materialRecord: materialRecord
					? {
							key: materialRecord.key,
							sourceMaterialKey: materialRecord.sourceMaterialKey,
							indexPageKey: materialRecord.indexPageKey,
							palettePageKey: materialRecord.palettePageKey,
							indexFormat: materialRecord.indexFormat,
							indexPageSize: `${materialRecord.indexPageWidth}x${materialRecord.indexPageHeight}`,
							paletteColorCount: materialRecord.paletteColorCount,
							clipThreshold: materialRecord.clipThreshold,
							wrap: `${materialRecord.wrapS}/${materialRecord.wrapT}`,
							detailAtlasTextureIndex: materialRecord.detailAtlasTextureIndex,
							detailAtlasRect: materialRecord.detailAtlasRect,
							detailTiling: materialRecord.detailTiling,
						}
					: null,
			};
		});
}
