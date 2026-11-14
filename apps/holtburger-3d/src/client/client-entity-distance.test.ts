import { expect, it } from "vitest";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";
import {
	cellId,
	type DynamicEntityWorldPlacement,
} from "../lib/game/runtime/dynamic-entity-feed";
import { distanceBetweenDynamicWorldPoses } from "./client-entity-distance";

function pose(
	landblockId: number,
	x: number,
): DynamicEntityWorldPlacement["pose"] {
	return {
		landblockId: cellId(landblockId),
		coords: { x, y: 0, z: 0 },
		rotation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

it("measures entity reach across adjacent landblock frames", () => {
	const player = pose(0x0101_0100, OUTDOOR_LANDBLOCK_WORLD_SIZE - 1);
	const vendor = pose(0x0201_0100, 1);
	expect(distanceBetweenDynamicWorldPoses(player, vendor)).toBe(2);
});
