import { describe, expect, it } from "vitest";

import { AABB3, Mat4 } from "../math/types";
import { SceneGraph } from "../scene";
import { DynamicEntityPlacementSystem } from "./dynamic-entity-placement-system";
import type {
	DynamicEntityAdvance,
	DynamicEntityView,
	DynamicEntityWorldPlacement,
} from "../runtime/dynamic-entity-feed";
import { cellId } from "../runtime/dynamic-entity-feed";

describe("DynamicEntityPlacementSystem", () => {
	it("atomically updates only roots it created and retires their ownership", () => {
		const scene = new SceneGraph();
		const placements = new DynamicEntityPlacementSystem(scene);
		const root = placements.createRoot(
			{
				envCellId: null,
				landblockId: "0x0102ffff",
				localTransform: Mat4.identity(),
				spatialMembership: { scopes: [{ kind: "outdoor" }] },
			},
			AABB3.zero(),
		);
		expect(placements.revision).toBe(1);
		const moved = Mat4.identity();
		moved.m41 = 7;
		placements.updateRoot(root, {
			envCellId: "0x03040123",
			landblockId: "0x0304ffff",
			localTransform: moved,
			spatialMembership: {
				scopes: [
					{
						envCellId: "0x03040123",
						kind: "env-cell",
						landblockId: "0x0304ffff",
					},
				],
			},
		});
		expect(placements.revision).toBe(2);
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
				spatialMembership: { scopes: [{ kind: "outdoor" }] },
			}),
		).toThrow("does not own root");

		placements.destroyRoot(root);
		expect(placements.revision).toBe(3);
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
				spatialMembership: { scopes: [{ kind: "outdoor" }] },
			},
			null,
		);
		placements.applyPath(root, advance(0, 10), 100, 1_000);
		const appliedRevision = placements.revision;
		placements.advance(1_050);
		expect(placements.revision).toBe(appliedRevision + 1);
		expect(scene.getResolvedPlacement(root)?.localToLandblock.m41).toBe(5);
		placements.advance(1_100);
		expect(placements.revision).toBe(appliedRevision + 2);
		expect(scene.getResolvedPlacement(root)?.localToLandblock.m41).toBe(10);

		placements.applyPath(root, advance(10, 20), 100, 2_000);
		const reset = advance(20, 99);
		reset.kind = "correction-snap";
		placements.applyPath(root, reset, 0, 2_025);
		placements.advance(2_050);
		expect(scene.getResolvedPlacement(root)?.localToLandblock.m41).toBe(99);
		const settledRevision = placements.revision;
		placements.advance(2_075);
		expect(placements.revision).toBe(settledRevision);

		placements.applyPath(root, advance(99, 100), 100, 3_000);
		const corrected = Mat4.identity();
		corrected.m41 = 101;
		placements.updateRoot(root, {
			envCellId: null,
			landblockId: "0x0102ffff",
			localTransform: corrected,
			spatialMembership: { scopes: [{ kind: "outdoor" }] },
		});
		placements.advance(3_050);
		expect(scene.getResolvedPlacement(root)?.localToLandblock.m41).toBe(101);
	});

	it("keeps path-point membership atomic across a portal transition", () => {
		const scene = new SceneGraph();
		scene.upsertEnvCellScope({
			containmentPlanes: new Float32Array(),
			landblockBounds: AABB3.zero(),
			potentiallyVisibleEnvCellIds: new Set(),
			scope: {
				envCellId: "0x01020100",
				kind: "env-cell",
				landblockId: "0x0102ffff",
			},
			seenOutside: false,
			structureToLandblock: Mat4.identity(),
			visibilityIslandId: "env-cell-island:0x01020100",
		});
		const placements = new DynamicEntityPlacementSystem(scene);
		const root = placements.createRoot(
			{
				envCellId: null,
				landblockId: "0x0102ffff",
				localTransform: Mat4.identity(),
				spatialMembership: { scopes: [{ kind: "outdoor" }] },
			},
			null,
		);
		const crossing = advance(0, 10);
		crossing.path.initial.spatialMembership = {
			reachesOutdoors: true,
			reachedEnvCellIds: [cellId(0x01020100)],
		};
		crossing.path.legs[0]!.end.pose.landblockId = cellId(0x01020100);
		crossing.path.legs[0]!.end.spatialMembership = {
			reachesOutdoors: false,
			reachedEnvCellIds: [cellId(0x01020100)],
		};

		placements.applyPath(root, crossing, 100, 1_000);
		placements.advance(1_050);
		expect(scene.getResolvedSpatialMembership(root)?.scopes).toEqual([
			{ kind: "outdoor" },
			{
				envCellId: "0x01020100",
				kind: "env-cell",
				landblockId: "0x0102ffff",
			},
		]);

		placements.advance(1_100);
		expect(scene.getResolvedSpatialMembership(root)?.scopes).toEqual([
			{
				envCellId: "0x01020100",
				kind: "env-cell",
				landblockId: "0x0102ffff",
			},
		]);
	});
});

function advance(startX: number, endX: number): DynamicEntityAdvance {
	const entity = dynamicEntity(endX);
	return {
		entity,
		kind: "integrated",
		path: {
			initial: {
				pose: dynamicEntity(startX).placement.pose,
				spatialMembership: entity.placement.spatialMembership,
			},
			legs: [
				{
					endFraction: 1,
					end: {
						pose: entity.placement.pose,
						spatialMembership: entity.placement.spatialMembership,
					},
				},
			],
		},
	};
}

function dynamicEntity(
	x: number,
): DynamicEntityView & { placement: DynamicEntityWorldPlacement } {
	return {
		generation: 1,
		motion: null,
		identity: { guid: 1, wcid: 1 },
		display: { name: "Entity", level: null },
		physics: {
			cloaked: false,
			translucency: 0,
			defaultAnimation: false,
			defaultScript: false,
			hidden: false,
			lighting: false,
			noDraw: false,
			participation: "physical",
			semanticMask: 0,
		},
		placement: {
			kind: "world",
			spatialMembership: {
				reachesOutdoors: true,
				reachedEnvCellIds: [],
			},
			contact: "airborne",
			pose: {
				coords: { x, y: 0, z: 0 },
				landblockId: cellId(0x0102_0001),
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			sampleMode: "simulating-velocity",
		},
		presentation: {
			entityClass: "other",
			appearance: {
				paletteDid: null,
				partChanges: [],
				subPalettes: [],
				textureChanges: [],
			},
			content: {
				physicsEffectTableDid: null,
				motionTableDid: null,
				setupDid: 0x0200_0001,
				soundTableDid: null,
			},
			objectScale: 1,
			radar: { blipColor: "Default", behavior: null, obviousRange: null },
		},
	};
}
