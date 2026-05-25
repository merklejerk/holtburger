import {
	BufferAttribute,
	BufferGeometry,
	Color,
	Matrix4,
	Quaternion as ThreeQuaternion,
	Vector3,
} from "three";

import type {
	PreparedFloat32Array,
	PreparedPolygonSetRenderGeometry,
} from "../assets/types";
import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
import { normalizeMaterialVariantSignature } from "./material-variants";
import type { StaticRenderablePart } from "./static-renderables";

export function buildStaticRenderablePartMatrix(
	part: StaticRenderablePart,
): Matrix4 {
	const matrix = new Matrix4();
	for (const parentPlacement of part.parentPlacements) {
		matrix.multiply(
			buildAcPlacementMatrix(
				parentPlacement,
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1 },
			),
		);
	}
	matrix.multiply(
		buildAcPlacementMatrix(
			part.chunkLocalInstancePlacement,
			{ x: 0, y: 0, z: 0 },
			{
				x: 1,
				y: 1,
				z: 1,
			},
		),
	);
	for (const partPlacement of part.partPlacements) {
		matrix.multiply(
			buildAcPlacementMatrix(
				partPlacement,
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 1, z: 1 },
			),
		);
	}
	matrix.multiply(
		new Matrix4().makeScale(part.scale.x, part.scale.z, part.scale.y),
	);
	return matrix;
}

export function buildGfxObjGeometry(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	materialSlots: readonly MaterialGeometrySlot[] = [],
	options: { compactMaterialGroups?: boolean } = {},
): BufferGeometry {
	const compactedGeometry =
		options.compactMaterialGroups === false
			? null
			: buildMaterialCompactedGfxObjGeometry(renderGeometry, materialSlots);
	if (compactedGeometry) {
		return compactedGeometry;
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute(
		"position",
		new BufferAttribute(toFloat32Array(renderGeometry.positions), 3),
	);
	if (renderGeometry.normals.length === renderGeometry.positions.length) {
		geometry.setAttribute(
			"normal",
			new BufferAttribute(toFloat32Array(renderGeometry.normals), 3),
		);
	} else {
		geometry.computeVertexNormals();
	}
	if (renderGeometry.uvs.length > 0) {
		geometry.setAttribute(
			"uv",
			new BufferAttribute(toFloat32Array(renderGeometry.uvs), 2),
		);
	}
	applyMaterialGroups(geometry, renderGeometry, materialSlots);
	return geometry;
}

export interface MaterialGeometrySlot {
	surfaceId: number;
	materialVariantSignature?: string | null;
	materialIndex: number;
}

function applyMaterialGroups(
	geometry: BufferGeometry,
	renderGeometry: PreparedPolygonSetRenderGeometry,
	materialSlots: readonly MaterialGeometrySlot[],
): void {
	if (materialSlots.length === 0 || renderGeometry.triangles.length === 0) {
		return;
	}

	const materialIndexBySlotKey = new Map(
		materialSlots.map((slot) => [
			describeGeometryMaterialSlotKey(
				slot.surfaceId,
				slot.materialVariantSignature,
			),
			slot.materialIndex,
		]),
	);
	let activeMaterialIndex: number | null = null;
	let activeStartVertex = 0;
	let activeVertexCount = 0;

	for (const triangle of renderGeometry.triangles) {
		const nextMaterialIndex =
			triangle.surfaceId === null
				? 0
				: (materialIndexBySlotKey.get(
						describeGeometryMaterialSlotKey(
							triangle.surfaceId,
							triangle.materialVariantSignature,
						),
					) ?? 0);
		if (activeMaterialIndex === null) {
			activeMaterialIndex = nextMaterialIndex;
			activeStartVertex = triangle.firstVertex;
			activeVertexCount = 3;
			continue;
		}
		if (activeMaterialIndex === nextMaterialIndex) {
			activeVertexCount += 3;
			continue;
		}

		geometry.addGroup(
			activeStartVertex,
			activeVertexCount,
			activeMaterialIndex,
		);
		activeMaterialIndex = nextMaterialIndex;
		activeStartVertex = triangle.firstVertex;
		activeVertexCount = 3;
	}

	if (activeMaterialIndex !== null) {
		geometry.addGroup(
			activeStartVertex,
			activeVertexCount,
			activeMaterialIndex,
		);
	}
}

function buildMaterialCompactedGfxObjGeometry(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	materialSlots: readonly MaterialGeometrySlot[],
): BufferGeometry | null {
	if (materialSlots.length <= 1 || renderGeometry.triangles.length <= 1) {
		return null;
	}

	const materialIndexBySlotKey =
		createMaterialIndexByGeometrySlotKey(materialSlots);
	const triangleRuns = describeTriangleMaterialRuns(
		renderGeometry,
		materialIndexBySlotKey,
	);
	if (triangleRuns.runCount <= triangleRuns.uniqueMaterialCount) {
		return null;
	}

	const positions = toFloat32Array(renderGeometry.positions);
	const normals =
		renderGeometry.normals.length === renderGeometry.positions.length
			? toFloat32Array(renderGeometry.normals)
			: null;
	const uvs =
		renderGeometry.uvs.length > 0 ? toFloat32Array(renderGeometry.uvs) : null;
	const compactedPositions = new Float32Array(positions.length);
	const compactedNormals = normals ? new Float32Array(normals.length) : null;
	const compactedUvs = uvs ? new Float32Array(uvs.length) : null;
	const sortedTriangles = [...triangleRuns.triangles].sort(
		(left, right) =>
			left.materialIndex - right.materialIndex ||
			left.sourceOrder - right.sourceOrder,
	);
	let outputVertex = 0;
	for (const triangle of sortedTriangles) {
		copyVertexComponents(
			positions,
			compactedPositions,
			triangle.firstVertex,
			outputVertex,
			3,
			3,
		);
		if (normals && compactedNormals) {
			copyVertexComponents(
				normals,
				compactedNormals,
				triangle.firstVertex,
				outputVertex,
				3,
				3,
			);
		}
		if (uvs && compactedUvs) {
			copyVertexComponents(
				uvs,
				compactedUvs,
				triangle.firstVertex,
				outputVertex,
				3,
				2,
			);
		}
		outputVertex += 3;
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new BufferAttribute(compactedPositions, 3));
	if (compactedNormals) {
		geometry.setAttribute("normal", new BufferAttribute(compactedNormals, 3));
	} else {
		geometry.computeVertexNormals();
	}
	if (compactedUvs) {
		geometry.setAttribute("uv", new BufferAttribute(compactedUvs, 2));
	}
	addCompactedMaterialGroups(geometry, sortedTriangles);
	return geometry;
}

function createMaterialIndexByGeometrySlotKey(
	materialSlots: readonly MaterialGeometrySlot[],
): Map<string, number> {
	return new Map(
		materialSlots.map((slot) => [
			describeGeometryMaterialSlotKey(
				slot.surfaceId,
				slot.materialVariantSignature,
			),
			slot.materialIndex,
		]),
	);
}

interface TriangleMaterialRun {
	sourceOrder: number;
	firstVertex: number;
	materialIndex: number;
}

function describeTriangleMaterialRuns(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	materialIndexBySlotKey: ReadonlyMap<string, number>,
): {
	triangles: TriangleMaterialRun[];
	runCount: number;
	uniqueMaterialCount: number;
} {
	let previousMaterialIndex: number | null = null;
	let runCount = 0;
	const uniqueMaterialIndices = new Set<number>();
	const triangles = renderGeometry.triangles.map((triangle, sourceOrder) => {
		const materialIndex = resolveTriangleMaterialIndex(
			triangle.surfaceId,
			triangle.materialVariantSignature,
			materialIndexBySlotKey,
		);
		if (materialIndex !== previousMaterialIndex) {
			runCount += 1;
			previousMaterialIndex = materialIndex;
		}
		uniqueMaterialIndices.add(materialIndex);
		return {
			sourceOrder,
			firstVertex: triangle.firstVertex,
			materialIndex,
		};
	});
	return {
		triangles,
		runCount,
		uniqueMaterialCount: uniqueMaterialIndices.size,
	};
}

function resolveTriangleMaterialIndex(
	surfaceId: number | null,
	materialVariantSignature: string | null | undefined,
	materialIndexBySlotKey: ReadonlyMap<string, number>,
): number {
	return surfaceId === null
		? 0
		: (materialIndexBySlotKey.get(
				describeGeometryMaterialSlotKey(surfaceId, materialVariantSignature),
			) ?? 0);
}

function copyVertexComponents(
	source: Float32Array,
	target: Float32Array,
	sourceVertex: number,
	targetVertex: number,
	vertexCount: number,
	componentCount: number,
): void {
	const sourceStart = sourceVertex * componentCount;
	const targetStart = targetVertex * componentCount;
	const componentLength = vertexCount * componentCount;
	target.set(
		source.subarray(sourceStart, sourceStart + componentLength),
		targetStart,
	);
}

function addCompactedMaterialGroups(
	geometry: BufferGeometry,
	triangles: readonly TriangleMaterialRun[],
): void {
	let activeMaterialIndex: number | null = null;
	let activeStartVertex = 0;
	let activeVertexCount = 0;
	triangles.forEach((triangle, triangleIndex) => {
		const nextStartVertex = triangleIndex * 3;
		if (activeMaterialIndex === null) {
			activeMaterialIndex = triangle.materialIndex;
			activeStartVertex = nextStartVertex;
			activeVertexCount = 3;
			return;
		}
		if (activeMaterialIndex === triangle.materialIndex) {
			activeVertexCount += 3;
			return;
		}

		geometry.addGroup(
			activeStartVertex,
			activeVertexCount,
			activeMaterialIndex,
		);
		activeMaterialIndex = triangle.materialIndex;
		activeStartVertex = nextStartVertex;
		activeVertexCount = 3;
	});

	if (activeMaterialIndex !== null) {
		geometry.addGroup(
			activeStartVertex,
			activeVertexCount,
			activeMaterialIndex,
		);
	}
}

function describeGeometryMaterialSlotKey(
	surfaceId: number,
	materialVariantSignature: string | null | undefined,
): string {
	return `${surfaceId}|${normalizeMaterialVariantSignature(
		materialVariantSignature,
	)}`;
}

function toFloat32Array(values: PreparedFloat32Array): Float32Array {
	return values instanceof Float32Array ? values : new Float32Array(values);
}

export function buildStaticRenderableColor(debugColorKey: string): Color {
	let hash = 0;
	for (let index = 0; index < debugColorKey.length; index += 1) {
		hash = (hash * 31 + debugColorKey.charCodeAt(index)) >>> 0;
	}

	return new Color().setHSL((hash % 360) / 360, 0.54, 0.48);
}

export type StaticRenderableInstanceColorMode = "material" | "debug";

export function buildStaticRenderableInstanceColor(
	debugColorKey: string,
	mode: StaticRenderableInstanceColorMode,
): Color {
	return mode === "material"
		? new Color("#ffffff")
		: buildStaticRenderableColor(debugColorKey);
}

export function buildAcPlacementMatrix(
	placement: PlacementTransformDto,
	worldOffset: Vec3Dto,
	scale: { x: number; y: number; z: number },
): Matrix4 {
	return new Matrix4().compose(
		new Vector3(
			placement.origin.x + worldOffset.x,
			placement.origin.z + worldOffset.z,
			-(placement.origin.y + worldOffset.y),
		),
		convertAcQuaternion(placement.orientation),
		new Vector3(scale.x, scale.y, scale.z),
	);
}

function convertAcQuaternion(
	quaternion: PlacementTransformDto["orientation"],
): ThreeQuaternion {
	const acRotation = new Matrix4().makeRotationFromQuaternion(
		new ThreeQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w),
	);
	const acToThree = new Matrix4().set(
		1,
		0,
		0,
		0,
		0,
		0,
		1,
		0,
		0,
		-1,
		0,
		0,
		0,
		0,
		0,
		1,
	);
	const threeToAc = acToThree.clone().invert();
	const threeRotation = acToThree.multiply(acRotation).multiply(threeToAc);
	return new ThreeQuaternion().setFromRotationMatrix(threeRotation);
}
