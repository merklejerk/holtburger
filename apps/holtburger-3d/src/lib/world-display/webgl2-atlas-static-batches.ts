import {
	createWebgl2ArrayBuffer,
	createWebgl2ElementArrayBuffer,
	createWebgl2VertexArray,
	type Webgl2BufferResource,
	type Webgl2VertexArrayResource,
} from "./webgl2-gl";
import type { AtlasStaticCompactedGeometry } from "./atlas-static-geometry-compactor";

export interface Webgl2AtlasStaticBatchResource {
	key: string;
	vertexArray: Webgl2VertexArrayResource;
	positionBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource;
	materialSlotBuffer: Webgl2BufferResource;
	transformSlotBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	vertexCount: number;
	indexCount: number;
	triangleCount: number;
	drawSliceCount: number;
	drawUnitCount: number;
	positionByteLength: number;
	uvByteLength: number;
	materialSlotByteLength: number;
	transformSlotByteLength: number;
	indexByteLength: number;
	totalByteLength: number;
	dispose(): void;
}

export function createWebgl2AtlasStaticBatchResource({
	gl,
	geometry,
}: {
	gl: WebGL2RenderingContext;
	geometry: AtlasStaticCompactedGeometry;
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
	const transformSlotBuffer = createWebgl2ArrayBuffer(gl, {
		label: `${geometry.key}/transform-slots`,
		data: geometry.transformSlots,
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
			gl.bindBuffer(gl.ARRAY_BUFFER, transformSlotBuffer.buffer);
			gl.enableVertexAttribArray(3);
			gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
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
		transformSlotBuffer,
		indexBuffer,
		indexType:
			geometry.indices instanceof Uint32Array
				? gl.UNSIGNED_INT
				: gl.UNSIGNED_SHORT,
		vertexCount: geometry.vertexCount,
		indexCount: geometry.indexCount,
		triangleCount: geometry.triangleCount,
		drawSliceCount: geometry.drawSlices.length,
		drawUnitCount: geometry.drawRanges.length,
		positionByteLength: geometry.positionByteLength,
		uvByteLength: geometry.uvByteLength,
		materialSlotByteLength: geometry.materialSlotByteLength,
		transformSlotByteLength: geometry.transformSlotByteLength,
		indexByteLength: geometry.indexByteLength,
		totalByteLength: geometry.totalByteLength,
		dispose() {
			vertexArray.dispose();
			positionBuffer.dispose();
			uvBuffer.dispose();
			materialSlotBuffer.dispose();
			transformSlotBuffer.dispose();
			indexBuffer.dispose();
		},
	};
}
