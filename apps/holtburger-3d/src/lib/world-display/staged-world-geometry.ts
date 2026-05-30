import type {
	PreparedFloat32Array,
	PreparedPolygonSetRenderGeometry,
	PreparedTerrainMesh,
} from "../assets/types";
import type { Vec3Dto } from "../host/contracts";

export interface StagedWorldIndexedGeometry {
	positions: Float32Array;
	uvs: Float32Array | null;
	indices: Uint16Array | Uint32Array;
	vertexCount: number;
	triangleCount: number;
}

export function buildStagedTerrainGeometry(
	mesh: PreparedTerrainMesh,
	options: { pcode?: number } = {},
): StagedWorldIndexedGeometry {
	const quadsByIndex = new Map(
		mesh.quads.map((quad) => [quad.quadIndex, quad]),
	);
	const triangles = mesh.triangles.filter((triangle) => {
		if (options.pcode === undefined) {
			return true;
		}
		const quad = quadsByIndex.get(triangle.quadIndex);
		return quad?.pcode === options.pcode;
	});
	const duplicateVertices = options.pcode !== undefined;
	if (!duplicateVertices) {
		const positions = new Float32Array(mesh.vertices.length * 3);
		for (const [vertexIndex, vertex] of mesh.vertices.entries()) {
			writeVec3(positions, vertexIndex, {
				x: vertex.x,
				y: vertex.z,
				z: -vertex.y,
			});
		}

		const indices = createIndexArray(mesh.vertices.length, triangles.length * 3);
		for (const [triangleIndex, triangle] of triangles.entries()) {
			const firstIndex = triangleIndex * 3;
			indices[firstIndex] = triangle.a;
			indices[firstIndex + 1] = triangle.b;
			indices[firstIndex + 2] = triangle.c;
		}

		return {
			positions,
			uvs: null,
			indices,
			vertexCount: mesh.vertices.length,
			triangleCount: triangles.length,
		};
	}

	const vertexCount = triangles.length * 3;
	const positions = new Float32Array(vertexCount * 3);
	const uvs = new Float32Array(vertexCount * 2);
	const indices = createIndexArray(vertexCount, vertexCount);
	for (const [triangleIndex, triangle] of triangles.entries()) {
		const quad = quadsByIndex.get(triangle.quadIndex) ?? null;
		const firstVertex = triangleIndex * 3;
		for (const [corner, sourceVertexIndex] of [
			triangle.a,
			triangle.b,
			triangle.c,
		].entries()) {
			const targetVertexIndex = firstVertex + corner;
			const vertex = mesh.vertices[sourceVertexIndex];
			writeVec3(positions, targetVertexIndex, {
				x: vertex.x,
				y: vertex.z,
				z: -vertex.y,
			});
			writeVec2(
				uvs,
				targetVertexIndex,
				quad ? terrainQuadUv(quad, sourceVertexIndex) : [0, 0],
			);
			indices[targetVertexIndex] = targetVertexIndex;
		}
	}
	return {
		positions,
		uvs,
		indices,
		vertexCount,
		triangleCount: triangles.length,
	};
}

export function buildStagedPolygonSetGeometry(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	options: {
		surfaceId?: number | null;
		materialVariantSignature?: string | null;
	} = {},
): StagedWorldIndexedGeometry {
	const sourcePositions = toFloat32Array(renderGeometry.positions);
	const sourceUvs = toFloat32Array(renderGeometry.uvs);
	const triangles = renderGeometry.triangles.filter(
		(triangle) =>
			(options.surfaceId === undefined ||
				triangle.surfaceId === options.surfaceId) &&
			(options.materialVariantSignature === undefined ||
				(triangle.materialVariantSignature ?? null) ===
					options.materialVariantSignature),
	);
	const vertexCount = triangles.length * 3;
	const positions = new Float32Array(vertexCount * 3);
	const uvs = new Float32Array(vertexCount * 2);
	const indices = createIndexArray(vertexCount, triangles.length * 3);

	for (const [triangleIndex, triangle] of triangles.entries()) {
		const firstIndex = triangleIndex * 3;
		for (let triangleVertex = 0; triangleVertex < 3; triangleVertex += 1) {
			const sourceVertexIndex = triangle.firstVertex + triangleVertex;
			const targetVertexIndex = firstIndex + triangleVertex;
			copyVec3(positions, targetVertexIndex, sourcePositions, sourceVertexIndex);
			copyVec2(uvs, targetVertexIndex, sourceUvs, sourceVertexIndex);
			indices[targetVertexIndex] = targetVertexIndex;
		}
	}

	return {
		positions,
		uvs,
		indices,
		vertexCount,
		triangleCount: triangles.length,
	};
}

export function buildStagedPortalApertureGeometry(
	points: readonly Vec3Dto[],
): StagedWorldIndexedGeometry {
	const positions = new Float32Array(points.length * 3);
	for (const [pointIndex, point] of points.entries()) {
		writeVec3(positions, pointIndex, point);
	}

	const triangleCount = Math.max(0, points.length - 2);
	const indices = createIndexArray(points.length, triangleCount * 3);
	for (let pointIndex = 1; pointIndex < points.length - 1; pointIndex += 1) {
		const triangleIndex = pointIndex - 1;
		const firstIndex = triangleIndex * 3;
		indices[firstIndex] = 0;
		indices[firstIndex + 1] = pointIndex;
		indices[firstIndex + 2] = pointIndex + 1;
	}

	return {
		positions,
		uvs: null,
		indices,
		vertexCount: points.length,
		triangleCount,
	};
}

function writeVec3(target: Float32Array, vertexIndex: number, vertex: Vec3Dto) {
	const offset = vertexIndex * 3;
	target[offset] = vertex.x;
	target[offset + 1] = vertex.y;
	target[offset + 2] = vertex.z;
}

function writeVec2(
	target: Float32Array,
	vertexIndex: number,
	value: readonly [number, number],
): void {
	const offset = vertexIndex * 2;
	target[offset] = value[0];
	target[offset + 1] = value[1];
}

function terrainQuadUv(
	quad: PreparedTerrainMesh["quads"][number],
	vertexIndex: number,
): [number, number] {
	const cornerIndex = quad.vertexIndices.indexOf(vertexIndex);
	switch (cornerIndex) {
		case 0:
			return [0, 0];
		case 1:
			return [1, 0];
		case 2:
			return [1, 1];
		case 3:
			return [0, 1];
		default:
			return [0, 0];
	}
}

function copyVec3(
	target: Float32Array,
	targetVertexIndex: number,
	source: Float32Array,
	sourceVertexIndex: number,
): void {
	const targetOffset = targetVertexIndex * 3;
	const sourceOffset = sourceVertexIndex * 3;
	target[targetOffset] = source[sourceOffset] ?? 0;
	target[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
	target[targetOffset + 2] = source[sourceOffset + 2] ?? 0;
}

function copyVec2(
	target: Float32Array,
	targetVertexIndex: number,
	source: Float32Array,
	sourceVertexIndex: number,
): void {
	const targetOffset = targetVertexIndex * 2;
	const sourceOffset = sourceVertexIndex * 2;
	target[targetOffset] = source[sourceOffset] ?? 0;
	target[targetOffset + 1] = source[sourceOffset + 1] ?? 0;
}

function createIndexArray(
	vertexCount: number,
	indexCount: number,
): Uint16Array | Uint32Array {
	return vertexCount > 65535
		? new Uint32Array(indexCount)
		: new Uint16Array(indexCount);
}

function toFloat32Array(values: PreparedFloat32Array): Float32Array {
	return values instanceof Float32Array ? values : new Float32Array(values);
}
