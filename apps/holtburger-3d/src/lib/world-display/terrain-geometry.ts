import { BufferAttribute, BufferGeometry, Color } from "three";

import type { PreparedTerrainMesh } from "../assets/types";

export function buildTerrainGeometry(
	terrainMesh: PreparedTerrainMesh,
): BufferGeometry {
	return buildDebugTerrainGeometry(terrainMesh);
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
