import { sceneVec3 } from "../../assets/ac-frame";
import { Vec3 } from "../../game/math/types";
import { describe, expect, it } from "vitest";
import type { LandblockOwnerId } from "../game-types";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type { SceneInterestRevision } from "../runtime/scene-availability";
import { OutdoorLightIndex } from "./outdoor-light-index";
import type { RuntimeLight } from "./runtime-lights";

/** Landblock ids encode x in the high byte and y in the next, both here set explicitly. */
function revision(value: number): SceneInterestRevision {
	return value as SceneInterestRevision;
}

function landblock(x: number, y: number): LandblockOwnerId {
	return `0x${x.toString(16).padStart(2, "0")}${y.toString(16).padStart(2, "0")}ffff` as LandblockOwnerId;
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
		position: sceneVec3(
			new Vec3(
				x * OUTDOOR_LANDBLOCK_WORLD_SIZE + offsetX,
				0,
				-y * OUTDOOR_LANDBLOCK_WORLD_SIZE + offsetZ,
			),
		),
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
		index.install(landblock(1, 1), LandblockLayerKind.Objects, revision(1), [
			lightIn(1, 1, 96, -96),
		]);
		expect(index.isEmpty).toBe(false);
	});

	it("returns a landblock's own lights regardless of where they sit inside it", () => {
		const index = new OutdoorLightIndex();
		// Deep in the interior, far from every boundary.
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(1), [
			lightIn(2, 2, 96, -96, 1),
		]);
		expect(index.resolve(landblock(2, 2)).lights).toHaveLength(1);
	});

	it("includes a neighbour's light whose reach crosses the shared boundary", () => {
		const index = new OutdoorLightIndex();
		// Two units inside its owner, against the boundary with the landblock to its east.
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(1), [
			lightIn(2, 2, 190, -96, 20),
		]);
		expect(index.resolve(landblock(3, 2)).lights).toHaveLength(1);
	});

	it("excludes a neighbour's light that stops short of the boundary", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(1), [
			lightIn(2, 2, 96, -96, 20),
		]);
		expect(index.resolve(landblock(3, 2)).lights).toHaveLength(0);
	});

	it("ignores landblocks beyond the immediate neighbourhood", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(1), [
			lightIn(2, 2, 190, -96, 20),
		]);
		expect(index.resolve(landblock(5, 2)).lights).toHaveLength(0);
	});

	// All three outdoor static layers publish per landblock, and only Objects ever emits. A
	// landblock-only key let a Buildings or Generated publish erase the lamps, which showed up as
	// outdoor lighting that came and went with streaming order.
	it("keeps a landblock's lights when another of its layers publishes empty", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(1), [
			lightIn(2, 2, 96, -96),
		]);
		index.install(
			landblock(2, 2),
			LandblockLayerKind.Buildings,
			revision(1),
			[],
		);
		index.install(
			landblock(2, 2),
			LandblockLayerKind.Generated,
			revision(1),
			[],
		);
		expect(index.resolve(landblock(2, 2)).lights).toHaveLength(1);
		expect(index.isEmpty).toBe(false);
	});

	/** A layer arriving later must not be masked by a memoized empty result. */
	it("invalidates memoized sets when a neighbour installs afterwards", () => {
		const index = new OutdoorLightIndex();
		expect(index.resolve(landblock(3, 2)).lights).toHaveLength(0);
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(1), [
			lightIn(2, 2, 190, -96, 20),
		]);
		expect(index.resolve(landblock(3, 2)).lights).toHaveLength(1);
	});

	it("treats an empty install as a removal", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(1), [
			lightIn(2, 2, 96, -96),
		]);
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(1), []);
		expect(index.isEmpty).toBe(true);
	});
	it("evicts a layer's lights at or below the evicted revision", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(3), [
			lightIn(2, 2, 96, -96),
		]);
		index.evict(landblock(2, 2), LandblockLayerKind.Objects, revision(3));
		expect(index.isEmpty).toBe(true);
		expect(index.resolve(landblock(2, 2)).lights).toHaveLength(0);
	});

	// Re-entry mints a new revision while the old revision's eviction may still be in flight;
	// the late eviction must not delete the lamps the re-entered revision just published.
	it("keeps a newer revision's lights when an older revision is evicted late", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(4), [
			lightIn(2, 2, 96, -96),
		]);
		index.evict(landblock(2, 2), LandblockLayerKind.Objects, revision(3));
		expect(index.resolve(landblock(2, 2)).lights).toHaveLength(1);
	});

	it("invalidates memoized sets when an eviction removes lights", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(1), [
			lightIn(2, 2, 190, -96, 20),
		]);
		expect(index.resolve(landblock(3, 2)).lights).toHaveLength(1);
		index.evict(landblock(2, 2), LandblockLayerKind.Objects, revision(1));
		expect(index.resolve(landblock(3, 2)).lights).toHaveLength(0);
	});

	it("removes exactly the matching revision and no other", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(5), [
			lightIn(2, 2, 96, -96),
		]);
		index.removeExact(landblock(2, 2), LandblockLayerKind.Objects, revision(4));
		expect(index.resolve(landblock(2, 2)).lights).toHaveLength(1);
		index.removeExact(landblock(2, 2), LandblockLayerKind.Objects, revision(5));
		expect(index.isEmpty).toBe(true);
	});

	it("reports the owned scope count as layers install and evict", () => {
		const index = new OutdoorLightIndex();
		index.install(landblock(2, 2), LandblockLayerKind.Objects, revision(1), [
			lightIn(2, 2, 96, -96),
		]);
		index.install(landblock(3, 2), LandblockLayerKind.Objects, revision(1), [
			lightIn(3, 2, 96, -96),
		]);
		expect(index.ownedScopeCount).toBe(2);
		index.evict(landblock(3, 2), LandblockLayerKind.Objects, revision(1));
		expect(index.ownedScopeCount).toBe(1);
	});
});
