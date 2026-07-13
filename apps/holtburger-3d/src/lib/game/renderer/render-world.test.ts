import { describe, expect, it } from "vitest";
import type { GeometryResourceKey } from "./resource-manager";
import { RenderWorld } from "./render-world";
import type { SceneNodeId, ScenePlacement } from "../scene";
import { Mat4 } from "../math/types";

const GEOMETRY_A = "geometry-resource:1" as const satisfies GeometryResourceKey;
const GEOMETRY_B = "geometry-resource:2" as const satisfies GeometryResourceKey;
const NODE_A = "scene-node:1" as const satisfies SceneNodeId;
const NODE_B = "scene-node:2" as const satisfies SceneNodeId;

describe("RenderWorld", () => {
	it("selects terrain and multiple object poses for one visible node", () => {
		const world = new RenderWorld();
		const terrainId = world.createTerrainResource(
			GEOMETRY_A,
			createTerrainDrawUnits(),
		);
		const objectId = world.createObjectResource(GEOMETRY_B, [
			createObjectDrawUnit(),
		]);
		world.createTerrainAttachment(NODE_A, terrainId);
		world.createObjectAttachment(NODE_A, objectId, { kind: "baked" });
		world.createObjectAttachment(NODE_A, objectId, {
			kind: "rigid",
			resourceTransform: Mat4.identity(),
		});

		const view = world.resolveView([NODE_A], () => createPlacement());

		expect(view.terrain).toHaveLength(1);
		expect(view.objects.map(({ attachment }) => attachment.pose.kind)).toEqual([
			"baked",
			"rigid",
		]);
		expect(view.terrain[0]?.placement).toEqual(createPlacement());
	});

	it("preserves attachment identity while replacing terrain draw units", () => {
		const world = new RenderWorld();
		const resourceId = world.createTerrainResource(
			GEOMETRY_A,
			createTerrainDrawUnits(),
		);
		const attachmentId = world.createTerrainAttachment(NODE_A, resourceId);
		const replacement = createTerrainDrawUnits(6);

		world.replaceTerrainResource(resourceId, GEOMETRY_A, replacement);

		const view = world.resolveView([NODE_A], () => createPlacement());
		expect(view.terrain[0]?.attachment.id).toBe(attachmentId);
		expect(view.terrain[0]?.resource.drawUnits).toBe(replacement);
	});

	it("releases shared geometry only after its final attachment is removed", () => {
		const world = new RenderWorld();
		const resourceId = world.createTerrainResource(
			GEOMETRY_A,
			createTerrainDrawUnits(),
		);
		world.createTerrainAttachment(NODE_A, resourceId);
		world.createTerrainAttachment(NODE_B, resourceId);

		expect(world.removeNodes([NODE_A])).toEqual([]);
		expect(world.removeNodes([NODE_B])).toEqual([GEOMETRY_A]);
	});
});

function createTerrainDrawUnits(indexCount = 3) {
	return [
		{
			indexCount,
			indexStart: 0,
			material: {
				colorTexture: "terrain-color:1/wrap-4" as const,
				detailTexture: "terrain-detail:2/wrap-4" as const,
				roadMaskTexture: "terrain-road-mask:3/wrap-4" as const,
			},
		},
	];
}

function createObjectDrawUnit() {
	return {
		indexCount: 3,
		indexStart: 0,
		material: {
			depthWrite: true,
			family: "flat-color" as const,
			pass: "opaque" as const,
			textureKeys: [],
		},
		poseIndex: null,
	};
}

function createPlacement(): ScenePlacement {
	return {
		envCellId: null,
		landblockId: "0x0000ffff",
		localTransform: Mat4.identity(),
	};
}
