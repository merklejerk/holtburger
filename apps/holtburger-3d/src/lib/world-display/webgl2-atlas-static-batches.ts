import {
	createWebgl2ArrayBuffer,
	createWebgl2ElementArrayBuffer,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2VertexArrayResource,
} from "./webgl2-gl";
import type { AtlasStaticCompactedGeometry } from "./atlas-static-geometry-compactor";
import type { AtlasTexturePlacement } from "./atlas-layout-planner";
import type { AtlasStaticCompactionMaterialSlot } from "./atlas-static-compaction-planner";

export interface Webgl2AtlasStaticMaterialSlot {
	key: string;
	index: number;
	atlasTextureIndex: number;
	atlasRect: readonly [number, number, number, number];
	renderStateKey: string;
	samplingKey: string;
}

export interface Webgl2AtlasStaticBatchResource {
	key: string;
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource;
	materialSlotBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	materialSlots: readonly Webgl2AtlasStaticMaterialSlot[];
	batchModelMatrix: AtlasStaticCompactedGeometry["batchModelMatrix"];
	drawSlices: AtlasStaticCompactedGeometry["drawSlices"];
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

export function createWebgl2AtlasStaticBatchResource({
	gl,
	geometry,
	materialSlots,
	placementsByEntryKey,
}: {
	gl: WebGL2RenderingContext;
	geometry: AtlasStaticCompactedGeometry;
	materialSlots: readonly AtlasStaticCompactionMaterialSlot[];
	placementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>;
}): Webgl2AtlasStaticBatchResource {
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
		key: geometry.key,
		vertexArray,
		positionBuffer,
		uvBuffer,
		materialSlotBuffer,
		indexBuffer,
		indexType:
			geometry.indices instanceof Uint32Array
				? gl.UNSIGNED_INT
				: gl.UNSIGNED_SHORT,
		materialSlots: materialSlots.map((slot) =>
			toWebgl2AtlasStaticMaterialSlot(slot, placementsByEntryKey),
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
			vertexArray.dispose();
			positionBuffer.dispose();
			uvBuffer.dispose();
			materialSlotBuffer.dispose();
			indexBuffer.dispose();
		},
	};
}

export function updateWebgl2AtlasStaticBatchDynamicTables(
	batch: Webgl2AtlasStaticBatchResource,
	geometry: AtlasStaticCompactedGeometry,
): void {
	if (batch.key !== geometry.key) {
		throw new Error(
			`Cannot update atlas static batch ${batch.key} with geometry ${geometry.key}.`,
		);
	}
	batch.batchModelMatrix = geometry.batchModelMatrix;
}

function toWebgl2AtlasStaticMaterialSlot(
	slot: AtlasStaticCompactionMaterialSlot,
	placementsByEntryKey: ReadonlyMap<string, AtlasTexturePlacement>,
): Webgl2AtlasStaticMaterialSlot {
	const placement = placementsByEntryKey.get(slot.atlasEntryKey);
	if (!placement) {
		throw new Error(
			`Atlas static material slot ${slot.key} references missing placement ${slot.atlasEntryKey}.`,
		);
	}
	return {
		key: slot.key,
		index: slot.index,
		atlasTextureIndex: placement.textureIndex,
		atlasRect: [placement.x, placement.y, placement.width, placement.height],
		renderStateKey: slot.renderStateKey,
		samplingKey: slot.samplingKey,
	};
}
