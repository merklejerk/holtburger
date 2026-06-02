import {
	createWebgl2ArrayBuffer,
	createWebgl2ElementArrayBuffer,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2VertexArrayResource,
} from "../../webgl2-gl";
import type {
	CompactedGeometryBatch,
	CompactedGeometrySlice,
} from "../../compaction/compacted-geometry";
import type { AtlasTexturePlacement } from "../../texture-pages/atlas-layout-planner";
import type {
	IndexedPalettedFamilyMaterialTableRecord,
	IndexedPalettedFamilyDrawSlice,
	RgbaTexturePageFamilyDrawSlice,
	RgbaTexturePageFamilyMaterialSlot,
} from "../../compaction/compaction-family-planner";

interface Webgl2RgbaTexturePageFamilyMaterialSlot {
	key: string;
	sourceMaterialSlotKey: string;
	index: number;
	atlasTextureIndex: number;
	atlasRect: readonly [number, number, number, number];
	detailAtlasTextureIndex: number | null;
	detailAtlasRect: readonly [number, number, number, number];
	detailTiling: number;
	renderStateKey: string;
	samplingKey: string;
	alphaPolicy: "opaque" | "cutout";
	alphaTest: number;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
}

interface Webgl2RgbaTexturePageFamilyDrawSlice extends CompactedGeometrySlice {
	atlasTextureIndex: number;
	detailAtlasTextureIndex: number | null;
}

interface Webgl2IndexedPalettedFamilyDrawSlice extends CompactedGeometrySlice {
	indexFormat: "p8" | "index16";
	indexPageKey: string;
	palettePageKey: string;
	detailAtlasTextureIndex: number | null;
}

interface Webgl2IndexedPalettedFamilyMaterialTableRecord extends IndexedPalettedFamilyMaterialTableRecord {
	detailAtlasTextureIndex: number | null;
	detailAtlasRect: readonly [number, number, number, number];
}

export interface Webgl2RgbaTexturePageFamilyResource {
	family: "rgba-texture-page";
	key: string;
	geometryBatchKey: string;
	materialSlots: readonly Webgl2RgbaTexturePageFamilyMaterialSlot[];
	drawSlices: readonly Webgl2RgbaTexturePageFamilyDrawSlice[];
}

export interface Webgl2IndexedPalettedFamilyResource {
	family: "indexed-paletted";
	key: string;
	geometryBatchKey: string;
	materialTableRecords: readonly Webgl2IndexedPalettedFamilyMaterialTableRecord[];
	drawSlices: readonly Webgl2IndexedPalettedFamilyDrawSlice[];
}

export type Webgl2CompactedGeometryFamilyResource =
	| Webgl2RgbaTexturePageFamilyResource
	| Webgl2IndexedPalettedFamilyResource;

export interface Webgl2CompactedGeometryBatchResource {
	key: string;
	landblockId: number;
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource;
	materialSlotBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	batchModelMatrix: CompactedGeometryBatch["batchModelMatrix"];
	vertexCount: number;
	indexCount: number;
	triangleCount: number;
	drawSliceCount: number;
	drawUnitCount: number;
	positionByteLength: number;
	uvByteLength: number;
	materialSlotByteLength: number;
	indexByteLength: number;
	totalByteLength: number;
	dispose(): void;
}

export function createWebgl2CompactedGeometryBatchResource({
	gl,
	geometry,
	landblockId,
}: {
	gl: WebGL2RenderingContext;
	geometry: CompactedGeometryBatch;
	landblockId: number;
}): Webgl2CompactedGeometryBatchResource {
	const buffers = createWebgl2CompactedGeometryBuffers({ gl, geometry });
	return {
		key: geometry.key,
		landblockId,
		...buffers,
		batchModelMatrix: geometry.batchModelMatrix,
		vertexCount: geometry.vertexCount,
		indexCount: geometry.indexCount,
		triangleCount: geometry.triangleCount,
		drawSliceCount: geometry.drawSlices.length,
		drawUnitCount: geometry.drawRanges.length,
		positionByteLength: geometry.positionByteLength,
		uvByteLength: geometry.uvByteLength,
		materialSlotByteLength: geometry.materialSlotByteLength,
		indexByteLength: geometry.indexByteLength,
		totalByteLength: geometry.totalByteLength,
		dispose() {
			disposeWebgl2CompactedGeometryBuffers(buffers);
		},
	};
}

export function createWebgl2RgbaTexturePageFamilyResource({
	geometry,
	materialSlots,
	materialDrawSlices,
	placementsByEntryKey,
	detailPlacementsByEntryKey,
}: {
	geometry: CompactedGeometryBatch;
	materialSlots: readonly RgbaTexturePageFamilyMaterialSlot[];
	materialDrawSlices: readonly RgbaTexturePageFamilyDrawSlice[];
	placementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>;
	detailPlacementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>;
}): Webgl2RgbaTexturePageFamilyResource {
	const materialDrawSliceByKey = new Map(
		materialDrawSlices.map((slice) => [slice.key, slice] as const),
	);
	return {
		family: "rgba-texture-page",
		key: compactedFamilyResourceKey("rgba-texture-page", geometry.key),
		geometryBatchKey: geometry.key,
		materialSlots: materialSlots.map((slot) =>
			toWebgl2RgbaTexturePageFamilyMaterialSlot(
				slot,
				placementsByEntryKey,
				detailPlacementsByEntryKey,
			),
		),
		drawSlices: geometry.drawSlices.map((slice) =>
			toWebgl2RgbaTexturePageFamilyDrawSlice(slice, materialDrawSliceByKey),
		),
	};
}

export function createWebgl2IndexedPalettedFamilyResource({
	geometry,
	materialTableRecords,
	materialDrawSlices,
	detailPlacementsByEntryKey,
}: {
	geometry: CompactedGeometryBatch;
	materialTableRecords: readonly IndexedPalettedFamilyMaterialTableRecord[];
	materialDrawSlices: readonly IndexedPalettedFamilyDrawSlice[];
	detailPlacementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>;
}): Webgl2IndexedPalettedFamilyResource {
	const materialDrawSliceByKey = new Map(
		materialDrawSlices.map((slice) => [slice.key, slice] as const),
	);
	const materialRecordsByKey = new Map(
		materialTableRecords.map((record) => [record.key, record] as const),
	);
	return {
		family: "indexed-paletted",
		key: compactedFamilyResourceKey("indexed-paletted", geometry.key),
		geometryBatchKey: geometry.key,
		materialTableRecords: materialTableRecords.map((record) =>
			toWebgl2IndexedPalettedFamilyMaterialRecord(
				record,
				detailPlacementsByEntryKey,
			),
		),
		drawSlices: geometry.drawSlices.map((slice) =>
			toWebgl2IndexedPalettedFamilyDrawSlice(
				slice,
				materialDrawSliceByKey,
				materialRecordsByKey,
				detailPlacementsByEntryKey,
			),
		),
	};
}

export function updateWebgl2CompactedGeometryBatchDynamicTables(
	batch: Webgl2CompactedGeometryBatchResource,
	geometry: CompactedGeometryBatch,
): void {
	if (batch.key !== geometry.key) {
		throw new Error(
			`Cannot update compacted batch ${batch.key} with geometry ${geometry.key}.`,
		);
	}
	batch.batchModelMatrix = geometry.batchModelMatrix;
}

function compactedFamilyResourceKey(
	family: Webgl2CompactedGeometryFamilyResource["family"],
	geometryBatchKey: string,
): string {
	return `${family}|${geometryBatchKey}`;
}

function createWebgl2CompactedGeometryBuffers({
	gl,
	geometry,
}: {
	gl: WebGL2RenderingContext;
	geometry: CompactedGeometryBatch;
}): {
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource;
	materialSlotBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
} {
	const positionBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${geometry.key}/positions`,
		data: geometry.positions,
	});
	const uvBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${geometry.key}/uvs`,
		data: geometry.uvs,
	});
	const materialSlotBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${geometry.key}/material-slots`,
		data: geometry.materialSlotIndices,
	});
	const indexBuffer = createWebgl2ElementArrayBuffer(gl, {
		label: `${geometry.key}/indices`,
		data: geometry.indices,
	});
	const vertexArray = createWebgl2VertexArray(gl, {
		label: `${geometry.key}/vertex-array`,
		configure() {
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer.buffer);
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer.buffer);
			gl.enableVertexAttribArray(1);
			gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, materialSlotBuffer.buffer);
			gl.enableVertexAttribArray(2);
			gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer.buffer);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
		},
	});
	return {
		vertexArray,
		positionBuffer,
		uvBuffer,
		materialSlotBuffer,
		indexBuffer,
		indexType:
			geometry.indices instanceof Uint32Array
				? gl.UNSIGNED_INT
				: gl.UNSIGNED_SHORT,
	};
}

function disposeWebgl2CompactedGeometryBuffers({
	vertexArray,
	positionBuffer,
	uvBuffer,
	materialSlotBuffer,
	indexBuffer,
}: {
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource;
	materialSlotBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
}): void {
	vertexArray.dispose();
	positionBuffer.dispose();
	uvBuffer.dispose();
	materialSlotBuffer.dispose();
	indexBuffer.dispose();
}

function toWebgl2RgbaTexturePageFamilyDrawSlice(
	slice: CompactedGeometrySlice,
	materialDrawSliceByKey: ReadonlyMap<string, RgbaTexturePageFamilyDrawSlice>,
): Webgl2RgbaTexturePageFamilyDrawSlice {
	const materialSlice = materialDrawSliceByKey.get(slice.key);
	if (!materialSlice) {
		throw new Error(
			`RGBA texture-page family draw slice ${slice.key} has no RGBA family payload.`,
		);
	}
	return {
		...slice,
		atlasTextureIndex: materialSlice.atlasTextureIndex,
		detailAtlasTextureIndex: materialSlice.detailAtlasTextureIndex,
	};
}

function toWebgl2IndexedPalettedFamilyDrawSlice(
	slice: CompactedGeometrySlice,
	materialDrawSliceByKey: ReadonlyMap<string, IndexedPalettedFamilyDrawSlice>,
	materialRecordsByKey: ReadonlyMap<
		string,
		IndexedPalettedFamilyMaterialTableRecord
	>,
	detailPlacementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>,
): Webgl2IndexedPalettedFamilyDrawSlice {
	const materialSlice = materialDrawSliceByKey.get(slice.key);
	if (!materialSlice) {
		throw new Error(
			`Indexed-paletted family draw slice ${slice.key} has no indexed family payload.`,
		);
	}
	const detailAtlasTextureIndices = uniqueNumbers(
		materialSlice.materialSlotKeys.flatMap((slotKey) => {
			const record = materialRecordsByKey.get(slotKey);
			if (!record?.detailAtlasEntryKey) {
				return [];
			}
			const placement = detailPlacementsByEntryKey.get(
				record.detailAtlasEntryKey,
			);
			if (!placement) {
				throw new Error(
					`Indexed-paletted family draw slice ${slice.key} references missing detail placement ${record.detailAtlasEntryKey}.`,
				);
			}
			return [placement.textureIndex];
		}),
	);
	if (detailAtlasTextureIndices.length > 1) {
		throw new Error(
			`Indexed-paletted family draw slice ${slice.key} spans multiple detail atlas textures.`,
		);
	}
	return {
		...slice,
		indexFormat: materialSlice.indexFormat,
		indexPageKey: materialSlice.indexPageKey,
		palettePageKey: materialSlice.palettePageKey,
		detailAtlasTextureIndex: detailAtlasTextureIndices[0] ?? null,
	};
}

function toWebgl2IndexedPalettedFamilyMaterialRecord(
	record: IndexedPalettedFamilyMaterialTableRecord,
	detailPlacementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>,
): Webgl2IndexedPalettedFamilyMaterialTableRecord {
	if (!record.detailAtlasEntryKey) {
		return {
			...record,
			detailAtlasTextureIndex: null,
			detailAtlasRect: [0, 0, 1, 1],
		};
	}
	const placement = detailPlacementsByEntryKey.get(record.detailAtlasEntryKey);
	if (!placement) {
		throw new Error(
			`Indexed-paletted material record ${record.key} references missing detail placement ${record.detailAtlasEntryKey}.`,
		);
	}
	return {
		...record,
		detailAtlasTextureIndex: placement.textureIndex,
		detailAtlasRect: [
			placement.x,
			placement.y,
			placement.width,
			placement.height,
		],
	};
}

function uniqueNumbers(values: readonly number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function toWebgl2RgbaTexturePageFamilyMaterialSlot(
	slot: RgbaTexturePageFamilyMaterialSlot,
	placementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>,
	detailPlacementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>,
): Webgl2RgbaTexturePageFamilyMaterialSlot {
	const placement = placementsByEntryKey.get(slot.atlasEntryKey);
	if (!placement) {
		throw new Error(
			`Compacted geometry material slot ${slot.key} references missing placement ${slot.atlasEntryKey}.`,
		);
	}
	const detailPlacement = slot.detailAtlasEntryKey
		? detailPlacementsByEntryKey.get(slot.detailAtlasEntryKey)
		: null;
	if (slot.detailAtlasEntryKey && !detailPlacement) {
		throw new Error(
			`Compacted geometry material slot ${slot.key} references missing detail placement ${slot.detailAtlasEntryKey}.`,
		);
	}
	return {
		key: slot.key,
		sourceMaterialSlotKey: slot.sourceMaterialSlotKey,
		index: slot.index,
		atlasTextureIndex: placement.textureIndex,
		atlasRect: [placement.x, placement.y, placement.width, placement.height],
		detailAtlasTextureIndex: detailPlacement?.textureIndex ?? null,
		detailAtlasRect: detailPlacement
			? [
					detailPlacement.x,
					detailPlacement.y,
					detailPlacement.width,
					detailPlacement.height,
				]
			: [0, 0, 1, 1],
		detailTiling: slot.detailTiling,
		renderStateKey: slot.renderStateKey,
		samplingKey: slot.samplingKey,
		alphaPolicy: slot.alphaPolicy,
		alphaTest: slot.alphaTest,
		wrapS: slot.samplingPolicy.wrapS,
		wrapT: slot.samplingPolicy.wrapT,
	};
}
