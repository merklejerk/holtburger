import { describe, expect, it } from "vitest";

import { AABB3, Mat4 } from "../math/types";
import { SceneGraph } from "../scene";
import { DynamicEntityPlacementSystem } from "./dynamic-entity-placement-system";
import type {
	DynamicEntityAdvance,
	DynamicEntityView,
} from "../runtime/dynamic-entity-feed";

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

	it("evaluates integrated paths at frame cadence and clears them on direct correction", () => {
		const scene = new SceneGraph();
		const placements = new DynamicEntityPlacementSystem(scene);
		const root = placements.createRoot(
			{
				envCellId: null,
				landblockId: "0x0102ffff",
				localTransform: Mat4.identity(),
			},
			null,
		);
		placements.applyPath(root, advance(0, 10), 100, 1_000);
		placements.advance(1_050);
		expect(scene.getResolvedPlacement(root)?.localToLandblock.m41).toBe(5);
		placements.advance(1_100);
		expect(scene.getResolvedPlacement(root)?.localToLandblock.m41).toBe(10);

		placements.applyPath(root, advance(10, 20), 100, 2_000);
		const reset = advance(20, 99);
		reset.kind = "reset";
		placements.applyPath(root, reset, 0, 2_025);
		placements.advance(2_050);
		expect(scene.getResolvedPlacement(root)?.localToLandblock.m41).toBe(99);

		placements.applyPath(root, advance(99, 100), 100, 3_000);
		const corrected = Mat4.identity();
		corrected.m41 = 101;
		placements.updateRoot(root, {
			envCellId: null,
			landblockId: "0x0102ffff",
			localTransform: corrected,
		});
		placements.advance(3_050);
		expect(scene.getResolvedPlacement(root)?.localToLandblock.m41).toBe(101);
	});
});

function advance(startX: number, endX: number): DynamicEntityAdvance {
	const entity = dynamicEntity(endX);
	return {
		entity,
		kind: "integrated",
		path: {
			initial: { pose: dynamicEntity(startX).placement.pose },
			legs: [{ endFraction: 1, end: { pose: entity.placement.pose } }],
		},
	};
}

function dynamicEntity(x: number): DynamicEntityView {
	return {
		generation: 1,
		identity: { guid: 1, name: "Entity", wcid: 1 },
		motion: null,
		physics: {
			cloaked: false,
			defaultAnimation: false,
			defaultScript: false,
			hidden: false,
			lighting: false,
			noDraw: false,
			participation: "physical",
			semanticMask: 0,
		},
		placement: {
			acceleration: { x: 0, y: 0, z: 0 },
			contact: "airborne",
			omega: { x: 0, y: 0, z: 0 },
			pose: {
				coords: { x, y: 0, z: 0 },
				landblockId: 0x0102_0001,
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			sampleMode: "simulating-velocity",
			velocity: { x: 1, y: 0, z: 0 },
		},
		presentation: {
			appearance: {
				paletteDid: null,
				partChanges: [],
				subPalettes: [],
				textureChanges: [],
			},
			content: {
				motionTableDid: null,
				physicsEffectTableDid: null,
				setupDid: 0x0200_0001,
				soundTableDid: null,
			},
			objectScale: 1,
		},
	};
}
