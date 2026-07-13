import { describe, expect, it } from "vitest";
import {
	createLandblockOffset,
	getLandblockCoordinates,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "./landblocks";

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

	it("rejects malformed ids", () => {
		expect(() => getLandblockCoordinates("not-a-landblock")).toThrow(
			"Invalid landblock id",
		);
	});
});
