import { describe, expect, it } from "vitest";
import {
	getLandblockCoordinates,
	OUTDOOR_LANDBLOCK_COUNT,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";
import { computeOutdoorSceneInterest } from "../runtime/scene-interest";
import { enumerateAmbientEnvCellOwners } from "../runtime/scene-target";
import {
	createOceanBackdropGeometry,
	oceanBackdropCoordinates,
	OCEAN_HEIGHT,
	OCEAN_TERRAIN_CODE,
} from "./ocean-backdrop";

const last = OUTDOOR_LANDBLOCK_COUNT - 1;
const midpoint = Math.floor(last / 2);
const radius = 2;
const radii = {
	terrainRadius: radius,
	buildingRadius: null,
	explicitObjectRadius: null,
	generatedObjectRadius: null,
	envCellRadius: radius,
};

describe("ocean backdrop", () => {
	it.each([
		[0, midpoint],
		[last, midpoint],
		[midpoint, 0],
		[midpoint, last],
		[0, 0],
		[last, 0],
		[0, last],
		[last, last],
	])("partitions the full viewing window at boundary (%i, %i)", (x, y) => {
		const landblockId =
			`0x${x.toString(16).padStart(2, "0")}${y.toString(16).padStart(2, "0")}ffff` as const;
		const real = computeOutdoorSceneInterest(landblockId, radii, new Set());
		const ocean = oceanBackdropCoordinates({ x, y }, radius);
		const coordinateKey = (p: { x: number; y: number }) => `${p.x},${p.y}`;
		const actual = [...real.keys()]
			.map((id) => coordinateKey(getLandblockCoordinates(id)))
			.concat(ocean.map(coordinateKey));
		const expected = [];
		for (let dy = -radius; dy <= radius; dy++)
			for (let dx = -radius; dx <= radius; dx++)
				expected.push(`${x + dx},${y + dy}`);
		expect(actual.sort()).toEqual(expected.sort());
		expect(new Set(actual).size).toBe(actual.length);
		expect(
			[
				...enumerateAmbientEnvCellOwners(
					{ kind: "outdoor", landblockId },
					radii,
				),
			].sort(),
		).toEqual([...real.keys()].sort());
	});

	it("needs no backdrop for an inland window", () => {
		expect(
			oceanBackdropCoordinates({ x: midpoint, y: midpoint }, radius),
		).toEqual([]);
	});

	it("builds upward-facing sea geometry with the existing landblock UV scale", () => {
		const mesh = createOceanBackdropGeometry();
		const size = OUTDOOR_LANDBLOCK_WORLD_SIZE;
		expect([...mesh.positions]).toEqual([
			0,
			OCEAN_HEIGHT,
			0,
			size,
			OCEAN_HEIGHT,
			0,
			0,
			OCEAN_HEIGHT,
			-size,
			size,
			OCEAN_HEIGHT,
			-size,
		]);
		expect([...mesh.terrainColorCodes]).toEqual(
			Array(4).fill(OCEAN_TERRAIN_CODE),
		);
		expect([...mesh.textureCoordinates]).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
		for (let i = 0; i < mesh.indices.length; i += 3) {
			const [a, b, c] = [...mesh.indices.slice(i, i + 3)].map((index) =>
				mesh.positions.slice(index * 3, index * 3 + 3),
			);
			const upwardCross =
				(b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
			expect(upwardCross).toBeGreaterThan(0);
		}
	});
});
