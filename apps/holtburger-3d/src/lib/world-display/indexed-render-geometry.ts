import type {
	PreparedFloat32Array,
	PreparedPolygonSetRenderGeometry,
} from "../assets/types";
import type { Vec3Dto } from "../host/contracts";

export interface RenderIndexedGeometry {
	signature: string;
	positions: Float32Array;
	uvs: Float32Array | null;
	indices: Uint16Array | Uint32Array;
	vertexCount: number;
	triangleCount: number;
}

export function buildPolygonSetRenderGeometry(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	options: {
		surfaceId?: number | null;
		materialVariantSignature?: string | null;
		sourceSignature?: string;
	} = {},
): RenderIndexedGeometry {
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
			copyVec3(
				positions,
				targetVertexIndex,
				sourcePositions,
				sourceVertexIndex,
			);
			copyVec2(uvs, targetVertexIndex, sourceUvs, sourceVertexIndex);
			indices[targetVertexIndex] = targetVertexIndex;
		}
	}

	return {
		signature: describePolygonSetRenderGeometrySignature({
			renderGeometry,
			sourceSignature: options.sourceSignature,
			surfaceId: options.surfaceId,
			materialVariantSignature: options.materialVariantSignature,
			triangleCount: triangles.length,
		}),
		positions,
		uvs,
		indices,
		vertexCount,
		triangleCount: triangles.length,
	};
}

export function buildPortalApertureRenderGeometry(
	points: readonly Vec3Dto[],
	sourceSignature = `portal-aperture:points=${points.length}`,
): RenderIndexedGeometry {
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
		signature: sourceSignature,
		positions,
		uvs: null,
		indices,
		vertexCount: points.length,
		triangleCount,
	};
}

function describePolygonSetRenderGeometrySignature({
	renderGeometry,
	sourceSignature,
	surfaceId,
	materialVariantSignature,
	triangleCount,
}: {
	renderGeometry: PreparedPolygonSetRenderGeometry;
	sourceSignature?: string;
	surfaceId?: number | null;
	materialVariantSignature?: string | null;
	triangleCount: number;
}): string {
	return [
		sourceSignature ?? "polygon-set",
		`source-v=${renderGeometry.vertexCount}`,
		`source-t=${renderGeometry.triangles.length}`,
		`surface=${surfaceId === undefined ? "any" : (surfaceId ?? "none")}`,
		`variant=${materialVariantSignature === undefined ? "any" : (materialVariantSignature ?? "base")}`,
		`t=${triangleCount}`,
	].join("|");
}

function writeVec3(target: Float32Array, vertexIndex: number, vertex: Vec3Dto) {
	const offset = vertexIndex * 3;
	target[offset] = vertex.x;
	target[offset + 1] = vertex.y;
	target[offset + 2] = vertex.z;
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
