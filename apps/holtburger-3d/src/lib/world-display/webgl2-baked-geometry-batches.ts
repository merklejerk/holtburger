import {
	createWebgl2ArrayBuffer,
	createWebgl2ElementArrayBuffer,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2VertexArrayResource,
} from "./webgl2-gl";
import type { BakedGeometry } from "./baked-geometry";
import type { AtlasTexturePlacement } from "./atlas-layout-planner";
import type {
	BakedIndexedMaterialTableRecord,
	BakedIndexedRenderableDrawSlice,
	BakedRenderableDrawSlice,
	BakedRenderableMaterialSlot,
} from "./baked-renderable-planner";

export interface Webgl2BakedGeometryMaterialSlot {
	key: string;
	index: number;
	atlasTextureIndex: number;
	atlasRect: readonly [number, number, number, number];
	detailAtlasTextureIndex: number | null;
	detailAtlasRect: readonly [number, number, number, number];
	detailTiling: number;
	renderStateKey: string;
	samplingKey: string;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
}

export interface Webgl2BakedGeometryBatchResource {
	key: string;
	landblockId: number;
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource;
	materialSlotBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	materialSlots: readonly Webgl2BakedGeometryMaterialSlot[];
	batchModelMatrix: BakedGeometry["batchModelMatrix"];
	drawSlices: BakedGeometry<BakedRenderableDrawSlice>["drawSlices"];
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

export interface Webgl2BakedIndexedGeometryBatchResource {
	key: string;
	landblockId: number;
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource;
	materialSlotBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	materialTableRecords: readonly BakedIndexedMaterialTableRecord[];
	batchModelMatrix: BakedGeometry["batchModelMatrix"];
	drawSlices: BakedGeometry<BakedIndexedRenderableDrawSlice>["drawSlices"];
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

export function createWebgl2BakedGeometryBatchResource({
	gl,
	geometry,
	landblockId,
	materialSlots,
	placementsByEntryKey,
	detailPlacementsByEntryKey,
}: {
	gl: WebGL2RenderingContext;
	geometry: BakedGeometry<BakedRenderableDrawSlice>;
	landblockId: number;
	materialSlots: readonly BakedRenderableMaterialSlot[];
	placementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>;
	detailPlacementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>;
}): Webgl2BakedGeometryBatchResource {
	const buffers = createWebgl2CompactedGeometryBuffers({ gl, geometry });
	return {
		key: geometry.key,
		landblockId,
		...buffers,
		materialSlots: materialSlots.map((slot) =>
			toWebgl2BakedGeometryMaterialSlot(
				slot,
				placementsByEntryKey,
				detailPlacementsByEntryKey,
			),
		),
		batchModelMatrix: geometry.batchModelMatrix,
		drawSlices: geometry.drawSlices,
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

export function createWebgl2BakedIndexedGeometryBatchResource({
	gl,
	geometry,
	landblockId,
	materialTableRecords,
}: {
	gl: WebGL2RenderingContext;
	geometry: BakedGeometry<BakedIndexedRenderableDrawSlice>;
	landblockId: number;
	materialTableRecords: readonly BakedIndexedMaterialTableRecord[];
}): Webgl2BakedIndexedGeometryBatchResource {
	const buffers = createWebgl2CompactedGeometryBuffers({ gl, geometry });
	return {
		key: geometry.key,
		landblockId,
		...buffers,
		materialTableRecords,
		batchModelMatrix: geometry.batchModelMatrix,
		drawSlices: geometry.drawSlices,
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

export function updateWebgl2BakedGeometryBatchDynamicTables(
	batch:
		| Webgl2BakedGeometryBatchResource
		| Webgl2BakedIndexedGeometryBatchResource,
	geometry: BakedGeometry,
): void {
	if (batch.key !== geometry.key) {
		throw new Error(
			`Cannot update baked batch ${batch.key} with geometry ${geometry.key}.`,
		);
	}
	batch.batchModelMatrix = geometry.batchModelMatrix;
}

function createWebgl2CompactedGeometryBuffers({
	gl,
	geometry,
}: {
	gl: WebGL2RenderingContext;
	geometry: BakedGeometry;
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
		data: geometry.materialSlots,
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

function toWebgl2BakedGeometryMaterialSlot(
	slot: BakedRenderableMaterialSlot,
	placementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>,
	detailPlacementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>,
): Webgl2BakedGeometryMaterialSlot {
	const placement = placementsByEntryKey.get(slot.atlasEntryKey);
	if (!placement) {
		throw new Error(
			`Baked geometry material slot ${slot.key} references missing placement ${slot.atlasEntryKey}.`,
		);
	}
	const detailPlacement = slot.detailAtlasEntryKey
		? detailPlacementsByEntryKey.get(slot.detailAtlasEntryKey)
		: null;
	if (slot.detailAtlasEntryKey && !detailPlacement) {
		throw new Error(
			`Baked geometry material slot ${slot.key} references missing detail placement ${slot.detailAtlasEntryKey}.`,
		);
	}
	return {
		key: slot.key,
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
		wrapS: slot.samplingPolicy.wrapS,
		wrapT: slot.samplingPolicy.wrapT,
	};
}
