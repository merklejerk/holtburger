import { describe, expect, it } from "vitest";
import type { LandblockId } from "../game-types";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { LandblockLayerKind } from "../runtime/scene-interest";
import { OutdoorLightIndex } from "./outdoor-light-index";
import type { RuntimeLight } from "./runtime-lights";

/** Landblock ids encode x in the high byte and y in the next, both here set explicitly. */
function landblock(x: number, y: number): LandblockId {
	return `0x${x.toString(16).padStart(2, "0")}${y.toString(16).padStart(2, "0")}ffff` as LandblockId;
}

/** A light placed at a world offset from a landblock's own origin. */
function lightIn(
	x: number,
	y: number,
	offsetX: number,
	offsetZ: number,
	range = 20,
): RuntimeLight {
	return {
		position: {
			x: x * OUTDOOR_LANDBLOCK_WORLD_SIZE + offsetX,
			y: 0,
			z: -y * OUTDOOR_LANDBLOCK_WORLD_SIZE + offsetZ,
		},
		color: { red: 1, green: 1, blue: 1 },
		range,
		intensity: 10,
	};
}

describe("OutdoorLightIndex", () => {
	it("reports empty until a landblock installs a light", () => {
		const index = new OutdoorLightIndex();
		expect(index.isEmpty).toBe(true);
		expect(index.resolve(landblock(1, 1)).lights).toHaveLength(0);
		index.install(landblock(1, 1), LandblockLayerKind.Objects, [
			lightIn(1, 1, 96, -96),
		]);
		expect(index.isEmpty).toBe(false);
	});

	it("returns a landblock's own lights regardless of where they sit inside it", () => {
		const index = new OutdoorLightIndex();
		// Deep in the interior, far from every boundary.
		index.install(landblock(2, 2), LandblockLayerKind.Objects, [
			lightIn(2, 2, 96, -96, 1),
		]);
		expect(index.resolve(landblock(2, 2)).lights).toHaveLength(1);
	});

	it("includes a neighbour's light whose reach crosses the shared boundary", () => {
		const index = new OutdoorLightIndex();
		// Two units inside its owner, against the boundary with the landblock to its east.
		index.install(landblock(2, 2), LandblockLayerKind.Objects, [
			lightIn(2, 2, 190, -96, 20),
		]);
		expect(index.resolve(landblock(3, 2)).lights).toHaveLength(1);
	});

	it("excludes a neighbour's light that stops short of the boundary", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, [
			lightIn(2, 2, 96, -96, 20),
		]);
		expect(index.resolve(landblock(3, 2)).lights).toHaveLength(0);
	});

	it("ignores landblocks beyond the immediate neighbourhood", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, [
			lightIn(2, 2, 190, -96, 20),
		]);
		expect(index.resolve(landblock(5, 2)).lights).toHaveLength(0);
	});

	// All three outdoor static layers publish per landblock, and only Objects ever emits. A
	// landblock-only key let a Buildings or Generated publish erase the lamps, which showed up as
	// outdoor lighting that came and went with streaming order.
	it("keeps a landblock's lights when another of its layers publishes empty", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, [
			lightIn(2, 2, 96, -96),
		]);
		index.install(landblock(2, 2), LandblockLayerKind.Buildings, []);
		index.install(landblock(2, 2), LandblockLayerKind.Generated, []);
		expect(index.resolve(landblock(2, 2)).lights).toHaveLength(1);
		expect(index.isEmpty).toBe(false);
	});

	/** A layer arriving later must not be masked by a memoized empty result. */
	it("invalidates memoized sets when a neighbour installs afterwards", () => {
		const index = new OutdoorLightIndex();
		expect(index.resolve(landblock(3, 2)).lights).toHaveLength(0);
		index.install(landblock(2, 2), LandblockLayerKind.Objects, [
			lightIn(2, 2, 190, -96, 20),
		]);
		expect(index.resolve(landblock(3, 2)).lights).toHaveLength(1);
	});

	it("treats an empty install as a removal", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, [
			lightIn(2, 2, 96, -96),
		]);
		index.install(landblock(2, 2), LandblockLayerKind.Objects, []);
		expect(index.isEmpty).toBe(true);
	});
});
