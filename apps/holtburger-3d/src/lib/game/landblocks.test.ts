import { describe, expect, it } from "vitest";
import {
	createLandblockOffset,
	createLandblockWorldOrigin,
	createOutdoorTerrainWindowBounds,
	getLandblockCoordinates,
	landblockAtWorldPoint,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "./landblocks";
import { AABB2, Vec2, Vec3 } from "./math/types";

describe("landblock coordinates", () => {
	it("decodes outdoor coordinates from prefixed and unprefixed ids", () => {
		expect(getLandblockCoordinates("0x1234ffff")).toEqual({ x: 0x12, y: 0x34 });
		expect(getLandblockCoordinates("1234abcd")).toEqual({ x: 0x12, y: 0x34 });
	});

	it("creates AC-to-render offsets relative to the anchor landblock", () => {
		expect(createLandblockOffset("0x1113ffff", "0x1010ffff")).toEqual({
			x: OUTDOOR_LANDBLOCK_WORLD_SIZE,
			y: 0,
			z: -3 * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		});
	});

	it("maps between landblock origins and canonical scene-space points", () => {
		expect(createLandblockWorldOrigin("0x0102ffff")).toEqual(
			new Vec3(
				OUTDOOR_LANDBLOCK_WORLD_SIZE,
				0,
				-2 * OUTDOOR_LANDBLOCK_WORLD_SIZE,
			),
		);
		expect(landblockAtWorldPoint(new Vec3(193, 20, -385))).toBe("0x0102ffff");
	});

	it("creates a world X/Z terrain window with the outdoor-grid edge clamped", () => {
		expect(createOutdoorTerrainWindowBounds("0x0000ffff", 1)).toEqual(
			new AABB2(
				new Vec2(0, -OUTDOOR_LANDBLOCK_WORLD_SIZE * 2),
				new Vec2(OUTDOOR_LANDBLOCK_WORLD_SIZE * 2, 0),
			),
		);
	});

	it("rejects scene-space points outside the outdoor grid", () => {
		expect(landblockAtWorldPoint(new Vec3(-1, 0, -1))).toBeNull();
		expect(
			landblockAtWorldPoint(
				new Vec3(256 * OUTDOOR_LANDBLOCK_WORLD_SIZE, 0, -1),
			),
		).toBeNull();
	});

	it("rejects malformed ids", () => {
		expect(() => getLandblockCoordinates("not-a-landblock")).toThrow(
			"Invalid landblock id",
		);
	});
});
