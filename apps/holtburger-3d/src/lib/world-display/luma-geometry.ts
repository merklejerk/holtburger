import type {
	PreparedFloat32Array,
	PreparedPolygonSetRenderGeometry,
	PreparedTerrainMesh,
} from "../assets/types";
import type { Vec3Dto } from "../host/contracts";

export interface LumaIndexedGeometry {
	positions: Float32Array;
	indices: Uint16Array | Uint32Array;
	vertexCount: number;
	triangleCount: number;
}

export function buildLumaTerrainGeometry(
	mesh: PreparedTerrainMesh,
): LumaIndexedGeometry {
	const positions = new Float32Array(mesh.vertices.length * 3);
	for (const [vertexIndex, vertex] of mesh.vertices.entries()) {
		writeVec3(positions, vertexIndex, {
			x: vertex.x,
			y: vertex.z,
			z: -vertex.y,
		});
	}

	const indices = createIndexArray(
		mesh.vertices.length,
		mesh.triangles.length * 3,
	);
	for (const [triangleIndex, triangle] of mesh.triangles.entries()) {
		const firstIndex = triangleIndex * 3;
		indices[firstIndex] = triangle.a;
		indices[firstIndex + 1] = triangle.b;
		indices[firstIndex + 2] = triangle.c;
	}

	return {
		positions,
		indices,
		vertexCount: mesh.vertices.length,
		triangleCount: mesh.triangles.length,
	};
}

export function buildLumaPolygonSetGeometry(
	renderGeometry: PreparedPolygonSetRenderGeometry,
): LumaIndexedGeometry {
	const positions = toFloat32Array(renderGeometry.positions);
	const indices = createIndexArray(
		renderGeometry.vertexCount,
		renderGeometry.triangles.length * 3,
	);

	for (const [triangleIndex, triangle] of renderGeometry.triangles.entries()) {
		const firstIndex = triangleIndex * 3;
		indices[firstIndex] = triangle.firstVertex;
		indices[firstIndex + 1] = triangle.firstVertex + 1;
		indices[firstIndex + 2] = triangle.firstVertex + 2;
	}

	return {
		positions,
		indices,
		vertexCount: renderGeometry.vertexCount,
		triangleCount: renderGeometry.triangles.length,
	};
}

export function buildLumaPortalApertureGeometry(
	points: readonly Vec3Dto[],
): LumaIndexedGeometry {
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
