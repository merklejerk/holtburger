import { describe, expect, it } from "vitest";
import { generateTerrain } from "./terrain-generator";
import {
	selectTerrainMeshStride,
	selectTerrainTransitionDirection,
	TERRAIN_MESH_STRIDES,
	type TerrainGenerationResult,
} from "./types";

describe("generateTerrain", () => {
	it("generates every complete stride/direction variant and pcode field", () => {
		const result = generateTerrain(createSource());

		expect(result.variants).toHaveLength(36);
		expect(result.surfaceFields.map(({ stride }) => stride)).toEqual(
			TERRAIN_MESH_STRIDES,
		);
		expect(result.surfaceFields.map(({ cellPcodes }) => cellPcodes.length)).toEqual([
			64,
			16,
			4,
			1,
		]);
		expect(result.geometry.indices).toBeInstanceOf(Uint16Array);
		expect(result.geometry.positions.length).toBeGreaterThan(0);
		expect(result.geometry.normals.length).toBe(
			result.geometry.positions.length,
		);
		expect(result.geometry.textureCoordinates.length).toBe(
			(result.geometry.positions.length / 3) * 2,
		);
	});

	it("uses canonical southwest/southeast/northeast/northwest pcode order", () => {
		const source = createSource();
		source.terrainSamples[0] = 0b00000100;
		source.terrainSamples[1] = 0b00001001;
		source.terrainSamples[10] = 0b00001110;
		source.terrainSamples[9] = 0b00010011;

		const result = generateTerrain(source);
		expect(result.surfaceFields[0]?.cellPcodes[0]).toBe(
			0x10000000 |
				(0 << 26) |
				(1 << 24) |
				(2 << 22) |
				(3 << 20) |
				(1 << 15) |
				(2 << 10) |
				(3 << 5) |
				4,
		);
	});

	it("adapts the canonical south-to-north grid once and stitches facing stride edges", () => {
		const source = createSource();
		for (let column = 0; column < 9; column += 1) {
			source.heights[8 * 9 + column] = column * 10;
		}
		const result = generateTerrain(source);
		const north = result.variants.find(
			({ variant }) =>
				variant.stride === 2 && variant.transitionDirection === "north",
		);
		if (!north) throw new Error("Missing stride-two north terrain variant.");
		const variantIndices = result.geometry.indices.slice(
			north.indexStart,
			north.indexStart + north.indexCount,
		);
		const firstVertex = Math.min(...variantIndices);
		const northOddVertex = firstVertex + 4 * 5 + 1;
		const position = result.geometry.positions.slice(
			northOddVertex * 3,
			northOddVertex * 3 + 3,
		);

		expect(position).toEqual(new Float32Array([48, 20, -192]));
		expect(north.bounds.min.z).toBe(-192);
		expect(north.bounds.max.z).toBe(0);
	});

	it.each([
		{ column: 1, direction: "north", row: 0 },
		{ column: 1, direction: "south", row: 4 },
		{ column: 0, direction: "east", row: 1 },
		{ column: 4, direction: "west", row: 1 },
	] as const)(
		"applies retail's cardinal half-resolution lowering clamp for $direction",
		({ column, direction, row }) => {
			const result = generateTerrain(createClampSource(direction));
			const variant = result.variants.find(
				({ variant: candidate }) =>
					candidate.stride === 2 && candidate.transitionDirection === direction,
			);
			if (!variant) throw new Error(`Missing stride-two ${direction} terrain variant.`);
			const variantIndices = result.geometry.indices.slice(
				variant.indexStart,
				variant.indexStart + variant.indexCount,
			);
			const firstVertex = Math.min(...variantIndices);
			const height = result.geometry.positions[
				(firstVertex + row * 5 + column) * 3 + 1
			];

			expect(height).toBe(0);
		},
	);

	it("does not apply the cardinal clamp to diagonal transitions", () => {
		const result = generateTerrain(createClampSource("north"));
		const variant = result.variants.find(
			({ variant: candidate }) =>
				candidate.stride === 2 && candidate.transitionDirection === "northeast",
		);
		if (!variant) throw new Error("Missing stride-two northeast terrain variant.");
		const variantIndices = result.geometry.indices.slice(
			variant.indexStart,
			variant.indexStart + variant.indexCount,
		);
		const firstVertex = Math.min(...variantIndices);

		expect(result.geometry.positions[(firstVertex + 1) * 3 + 1]).toBe(20);
	});

	it("keeps the shared edge inside the stride-four ring unadjusted", () => {
		const anchorLandblockId = "0x1111ffff";
		const inner = createSource("0x1411ffff");
		const outer = createSource("0x1511ffff");
		setSharedEastWestBoundary(inner, outer, [0, 0, 0, 0, 60, 0, 0, 0, 0]);

		const innerEdge = selectedTerrainEdge(
			generateTerrain(inner),
			inner.landblockId,
			anchorLandblockId,
			"east",
		);
		const outerEdge = selectedTerrainEdge(
			generateTerrain(outer),
			outer.landblockId,
			anchorLandblockId,
			"west",
		);

		expect(innerEdge).toEqual([0, 60, 0]);
		expect(outerEdge).toEqual(innerEdge);
	});

	it.each([
		{ coarseLandblockId: "0x1411ffff", fineLandblockId: "0x1311ffff" },
		{ coarseLandblockId: "0x1611ffff", fineLandblockId: "0x1511ffff" },
	] as const)(
		"stitches the eastward $fineLandblockId LOD boundary to $coarseLandblockId",
		({ coarseLandblockId, fineLandblockId }) => {
			const anchorLandblockId = "0x1111ffff";
			const fine = createSource(fineLandblockId);
			const coarse = createSource(coarseLandblockId);
			setSharedEastWestBoundary(fine, coarse, [0, 80, 100, -40, 20, 90, -60, 15, 40]);

			const fineEdge = selectedTerrainEdge(
				generateTerrain(fine),
				fine.landblockId,
				anchorLandblockId,
				"east",
			);
			const coarseEdge = selectedTerrainEdge(
				generateTerrain(coarse),
				coarse.landblockId,
				anchorLandblockId,
				"west",
			);

			expect(fineEdge).toEqual(
				interpolateCoarseEdgeAtFineVertices(coarseEdge, fineEdge.length),
			);
		},
	);
});

function createSource(landblockId = "0xda55ffff") {
	return {
		gridSize: 9,
		heightIndices: new Uint8Array(81),
		heights: new Float32Array(81),
		landblockId,
		terrainSamples: new Uint16Array(81),
		tileSize: 24,
	};
}

function createClampSource(
	direction: "north" | "south" | "east" | "west",
) {
	const source = createSource();
	source.heights.fill(20);
	if (direction === "north") {
		source.heights[1] = 10;
		source.heights[3] = 10;
		return source;
	}
	if (direction === "south") {
		source.heights[8 * 9 + 1] = 10;
		source.heights[8 * 9 + 3] = 10;
		return source;
	}
	if (direction === "east") {
		source.heights[9] = 10;
		source.heights[3 * 9] = 10;
		return source;
	}
	source.heights[9 + 8] = 10;
	source.heights[3 * 9 + 8] = 10;
	return source;
}

/** Give adjacent landblocks identical authored heights along their shared east-west edge. */
function setSharedEastWestBoundary(
	west: ReturnType<typeof createSource>,
	east: ReturnType<typeof createSource>,
	heights: readonly number[],
): void {
	for (const [row, height] of heights.entries()) {
		west.heights[row * west.gridSize + (west.gridSize - 1)] = height;
		east.heights[row * east.gridSize] = height;
	}
}

/** Extract one selected mesh boundary in canonical south-to-north vertex order. */
function selectedTerrainEdge(
	result: TerrainGenerationResult,
	landblockId: string,
	anchorLandblockId: string,
	edge: "east" | "west",
): number[] {
	const stride = selectTerrainMeshStride(landblockId, anchorLandblockId);
	const transitionDirection = selectTerrainTransitionDirection(
		landblockId,
		anchorLandblockId,
	);
	const variant = result.variants.find(
		(candidate) =>
			candidate.variant.stride === stride &&
			candidate.variant.transitionDirection === transitionDirection,
	);
	if (!variant) {
		throw new Error(
			`Missing selected ${stride}/${transitionDirection} terrain variant.`,
		);
	}
	const indices = result.geometry.indices.slice(
		variant.indexStart,
		variant.indexStart + variant.indexCount,
	);
	const firstVertex = Math.min(...indices);
	const sideVertices = 8 / stride + 1;
	return Array.from({ length: sideVertices }, (_, row) => {
		const column = edge === "east" ? sideVertices - 1 : 0;
		return result.geometry.positions[
			(firstVertex + row * sideVertices + column) * 3 + 1
		] ?? NaN;
	});
}

/** Sample a coarse terrain edge at every fine-edge vertex, using its rendered line segments. */
function interpolateCoarseEdgeAtFineVertices(
	coarseEdge: readonly number[],
	fineVertexCount: number,
): number[] {
	const coarseSegments = coarseEdge.length - 1;
	const fineSegments = fineVertexCount - 1;
	return Array.from({ length: fineVertexCount }, (_, vertex) => {
		const coarsePosition = (vertex * coarseSegments) / fineSegments;
		const segment = Math.min(Math.floor(coarsePosition), coarseSegments - 1);
		const fraction = coarsePosition - segment;
		const start = coarseEdge[segment] ?? NaN;
		const end = coarseEdge[segment + 1] ?? NaN;
		return start + (end - start) * fraction;
	});
}
