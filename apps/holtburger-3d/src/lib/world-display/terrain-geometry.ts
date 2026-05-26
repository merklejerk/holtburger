import { BufferAttribute, BufferGeometry, Color } from "three";

import type { PreparedTerrainMesh, PreparedTerrainQuad } from "../assets/types";

export function buildTerrainMaterialGeometry(
	terrainMesh: PreparedTerrainMesh,
	materialIndexByPcode: ReadonlyMap<number, number>,
): BufferGeometry {
	const geometry = new BufferGeometry();
	const positions: number[] = [];
	const uvs: number[] = [];
	const terrainPcodes: number[] = [];
	const terrainQuadIndices: number[] = [];
	const terrainCornerCodes: number[] = [];
	const quadsByIndex = new Map(
		terrainMesh.quads.map((quad) => [quad.quadIndex, quad]),
	);
	const triangles = terrainMesh.triangles
		.map((triangle) => ({
			triangle,
			quad: quadsByIndex.get(triangle.quadIndex) ?? null,
		}))
		.filter(
			(entry): entry is typeof entry & { quad: PreparedTerrainQuad } =>
				entry.quad !== null && materialIndexByPcode.has(entry.quad.pcode),
		)
		.sort((left, right) => left.quad.pcode - right.quad.pcode);
	let activeMaterialIndex: number | null = null;
	let activeGroupStart = 0;

	for (const { triangle, quad } of triangles) {
		const materialIndex = materialIndexByPcode.get(quad.pcode);
		if (materialIndex === undefined) {
			continue;
		}
		if (activeMaterialIndex !== materialIndex) {
			closeActiveGroup(
				geometry,
				activeGroupStart,
				positions.length / 3,
				activeMaterialIndex,
			);
			activeMaterialIndex = materialIndex;
			activeGroupStart = positions.length / 3;
		}

		for (const vertexIndex of [triangle.a, triangle.b, triangle.c]) {
			const vertex = terrainMesh.vertices[vertexIndex];
			positions.push(vertex.x, vertex.z, -vertex.y);
			uvs.push(...terrainQuadUv(quad, vertexIndex));
			terrainPcodes.push(quad.pcode);
			terrainQuadIndices.push(triangle.quadIndex);
			terrainCornerCodes.push(...quad.cornerTerrainCodes);
		}
	}
	closeActiveGroup(
		geometry,
		activeGroupStart,
		positions.length / 3,
		activeMaterialIndex,
	);

	geometry.setAttribute(
		"position",
		new BufferAttribute(new Float32Array(positions), 3),
	);
	geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
	geometry.setAttribute(
		"terrainPcode",
		new BufferAttribute(new Float32Array(terrainPcodes), 1),
	);
	geometry.setAttribute(
		"terrainQuadIndex",
		new BufferAttribute(new Float32Array(terrainQuadIndices), 1),
	);
	geometry.setAttribute(
		"terrainCornerCodes",
		new BufferAttribute(new Float32Array(terrainCornerCodes), 4),
	);
	geometry.computeVertexNormals();
	return geometry;
}

export function buildDebugTerrainGeometry(
	terrainMesh: PreparedTerrainMesh,
): BufferGeometry {
	const geometry = new BufferGeometry();
	const positions: number[] = [];
	const colors: number[] = [];
	const terrainPcodes: number[] = [];
	const terrainQuadIndices: number[] = [];
	const terrainCornerCodes: number[] = [];
	const quadsByIndex = new Map(
		terrainMesh.quads.map((quad) => [quad.quadIndex, quad]),
	);

	for (const triangle of terrainMesh.triangles) {
		const vertices = [triangle.a, triangle.b, triangle.c].map(
			(index) => terrainMesh.vertices[index],
		);
		const quad = quadsByIndex.get(triangle.quadIndex) ?? null;
		const color = buildTerrainColor(
			terrainMesh,
			triangle.terrainType,
			triangle.averageHeight,
		);

		for (const vertex of vertices) {
			positions.push(vertex.x, vertex.z, -vertex.y);
			colors.push(color.r, color.g, color.b);
			terrainPcodes.push(quad?.pcode ?? triangle.terrainType);
			terrainQuadIndices.push(triangle.quadIndex);
			terrainCornerCodes.push(...(quad?.cornerTerrainCodes ?? [0, 0, 0, 0]));
		}
	}

	geometry.setAttribute(
		"position",
		new BufferAttribute(new Float32Array(positions), 3),
	);
	geometry.setAttribute(
		"color",
		new BufferAttribute(new Float32Array(colors), 3),
	);
	geometry.setAttribute(
		"terrainPcode",
		new BufferAttribute(new Float32Array(terrainPcodes), 1),
	);
	geometry.setAttribute(
		"terrainQuadIndex",
		new BufferAttribute(new Float32Array(terrainQuadIndices), 1),
	);
	geometry.setAttribute(
		"terrainCornerCodes",
		new BufferAttribute(new Float32Array(terrainCornerCodes), 4),
	);
	geometry.computeVertexNormals();
	return geometry;
}

function closeActiveGroup(
	geometry: BufferGeometry,
	start: number,
	end: number,
	materialIndex: number | null,
): void {
	if (materialIndex === null || end <= start) {
		return;
	}
	geometry.addGroup(start, end - start, materialIndex);
}

function terrainQuadUv(
	quad: PreparedTerrainQuad,
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

function buildTerrainColor(
	terrainMesh: PreparedTerrainMesh,
	terrainType: number,
	averageHeight: number,
): Color {
	const terrainHues = [152, 104, 44, 190, 128, 24];
	const absoluteHeightFactor = clamp((averageHeight + 12) / 72, 0, 1);
	const localHeightSpan = Math.max(
		terrainMesh.maxHeight - terrainMesh.minHeight,
		1,
	);
	const localHeightFactor = clamp(
		(averageHeight - terrainMesh.minHeight) / localHeightSpan,
		0,
		1,
	);

	return new Color().setHSL(
		terrainHues[terrainType % terrainHues.length] / 360,
		0.34 + absoluteHeightFactor * 0.12,
		0.22 + absoluteHeightFactor * 0.18 + localHeightFactor * 0.08,
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
