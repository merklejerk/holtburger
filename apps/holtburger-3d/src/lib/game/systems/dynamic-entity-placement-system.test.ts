import { describe, expect, it } from "vitest";

import { AABB3, Mat4 } from "../math/types";
import { SceneGraph } from "../scene";
import { DynamicEntityPlacementSystem } from "./dynamic-entity-placement-system";

describe("DynamicEntityPlacementSystem", () => {
	it("atomically updates only roots it created and retires their ownership", () => {
		const scene = new SceneGraph();
		const placements = new DynamicEntityPlacementSystem(scene);
		const root = placements.createRoot(
			{
				envCellId: null,
				landblockId: "0x0102ffff",
				localTransform: Mat4.identity(),
			},
			AABB3.zero(),
		);
		const moved = Mat4.identity();
		moved.m41 = 7;
		placements.updateRoot(root, {
			envCellId: "0x03040123",
			landblockId: "0x0304ffff",
			localTransform: moved,
		});
		expect(scene.getResolvedPlacement(root)).toMatchObject({
			envCellId: "0x03040123",
			landblockId: "0x0304ffff",
			localToLandblock: { m41: 7 },
		});

		const foreign = scene.createNode({
			envCellId: null,
			landblockId: "0x0102ffff",
			localBounds: null,
			localTransform: Mat4.identity(),
			parentId: null,
		});
		expect(() =>
			placements.updateRoot(foreign, {
				envCellId: null,
				landblockId: "0x0102ffff",
				localTransform: Mat4.identity(),
			}),
		).toThrow("does not own root");

		placements.destroyRoot(root);
		expect(scene.getNode(root)).toBeUndefined();
		expect(() => placements.destroyRoot(root)).toThrow("does not own root");
	});
});
