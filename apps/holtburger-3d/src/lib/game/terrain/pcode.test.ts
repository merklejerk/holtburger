import { describe, expect, it } from "vitest";
import {
	roadCodeAt,
	rotationsToMatch,
	selectRoadAlphaMap,
	selectRoadOverlays,
	selectTerrainAlphaMap,
	selectTerrainOverlays,
	terrainCodeAt,
} from "./pcode";

describe("terrain pcode", () => {
	it("decodes retail corner packing and derives terrain overlay shapes", () => {
		const pcode = packPcode([1, 2, 3, 0], [4, 5, 6, 7]);
		expect(terrainCodeAt(pcode, "southwest")).toBe(4);
		expect(terrainCodeAt(pcode, "northwest")).toBe(7);
		expect(roadCodeAt(pcode, "southeast")).toBe(2);
		expect(selectTerrainOverlays(pcode)).toEqual({
			baseTerrainCode: 4,
			overlays: [
				{ shapeCode: 2, terrainCode: 5 },
				{ shapeCode: 4, terrainCode: 6 },
				{ shapeCode: 8, terrainCode: 7 },
			],
		});
	});

	it("collapses repeated terrain corners and resolves canonical map rotations", () => {
		const pcode = packPcode([0, 0, 0, 0], [1, 1, 2, 2]);
		expect(selectTerrainOverlays(pcode)).toEqual({
			baseTerrainCode: 1,
			overlays: [{ shapeCode: 12, terrainCode: 2 }],
		});
		expect(
			selectTerrainAlphaMap(
				pcode,
				2,
				[{ blendMaskTextureId: "corner", terrainCode: 1 }],
				[],
			),
		).toMatchObject({ rotations: 1 });
		expect(rotationsToMatch(9, 3)).toBe(1);
	});

	it("derives road fill and road overlay codes before selecting a rotated map", () => {
		expect(selectRoadOverlays(packPcode([1, 1, 1, 1], [0, 0, 0, 0]))).toEqual({
			fullRoad: true,
			overlays: [],
		});
		expect(selectRoadOverlays(packPcode([1, 1, 1, 0], [0, 0, 0, 0]))).toEqual({
			fullRoad: false,
			overlays: [{ roadCode: 3 }, { roadCode: 6 }],
		});
		expect(
			selectRoadAlphaMap(packPcode([1, 0, 0, 0], [0, 0, 0, 0]), 2, [
				{ roadCode: 1, roadMaskTextureId: "road" },
			]),
		).toMatchObject({ rotations: 1 });
	});
});

function packPcode(
	roadCodes: readonly [number, number, number, number],
	terrainCodes: readonly [number, number, number, number],
): number {
	return (
		(1 << 28) |
		(roadCodes[0] << 26) |
		(roadCodes[1] << 24) |
		(roadCodes[2] << 22) |
		(roadCodes[3] << 20) |
		(terrainCodes[0] << 15) |
		(terrainCodes[1] << 10) |
		(terrainCodes[2] << 5) |
		terrainCodes[3]
	);
}
