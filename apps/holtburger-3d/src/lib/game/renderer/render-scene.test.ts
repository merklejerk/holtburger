import { describe, expect, it } from "vitest";
import { Mat4 } from "../math/types";
import type { ResolvedScenePlacement, SceneNodeId } from "../scene";
import type { GeometryResourceKey } from "./resource-manager";
import { RenderResourceRegistry } from "./render-resources";
import { RenderScene } from "./render-scene";

const GEOMETRY_A = "geometry-resource:1" as const satisfies GeometryResourceKey;
const GEOMETRY_B = "geometry-resource:2" as const satisfies GeometryResourceKey;
const NODE_A = "scene-node:1" as const satisfies SceneNodeId;
const NODE_B = "scene-node:2" as const satisfies SceneNodeId;

describe("RenderScene", () => {
	it("selects terrain and multiple object poses for one visible node", () => {
		const resources = new RenderResourceRegistry();
		const scene = new RenderScene(resources);
		const terrainId = resources.createTerrainResource(
			GEOMETRY_A,
			createTerrainDrawUnits(),
		);
		const objectId = resources.createObjectResource(GEOMETRY_B, [
			createObjectDrawUnit(),
		]);
		scene.createTerrainInstance(NODE_A, terrainId);
		scene.createObjectInstance(NODE_A, objectId, { kind: "baked" });
		scene.createObjectInstance(NODE_A, objectId, {
			kind: "rigid",
			resourceTransform: Mat4.identity(),
		});

		const view = scene.resolveView([NODE_A], () => createPlacement());

		expect(view.terrain).toHaveLength(1);
		expect(view.objects.map(({ instance }) => instance.pose.kind)).toEqual([
			"baked",
			"rigid",
		]);
		expect(view.terrain[0]?.placement).toEqual(createPlacement());
	});

	it("preserves instance identity across resource replacement", () => {
		const resources = new RenderResourceRegistry();
		const scene = new RenderScene(resources);
		const resourceId = resources.createTerrainResource(
			GEOMETRY_A,
			createTerrainDrawUnits(),
		);
		const instanceId = scene.createTerrainInstance(NODE_A, resourceId);
		const replacement = createTerrainDrawUnits(6);

		resources.replaceTerrainResource(resourceId, replacement);

		const view = scene.resolveView([NODE_A], () => createPlacement());
		expect(view.terrain[0]?.instance.id).toBe(instanceId);
		expect(view.terrain[0]?.resource.drawUnits).toBe(replacement);
	});

	it("removes node instances without deciding resource lifetime", () => {
		const resources = new RenderResourceRegistry();
		const scene = new RenderScene(resources);
		const resourceId = resources.createTerrainResource(
			GEOMETRY_A,
			createTerrainDrawUnits(),
		);
		scene.createTerrainInstance(NODE_A, resourceId);
		scene.createTerrainInstance(NODE_B, resourceId);

		scene.removeNodes([NODE_A, NODE_B]);

		expect(
			scene.resolveView([NODE_A, NODE_B], () => createPlacement()),
		).toEqual({
			objects: [],
			terrain: [],
		});
		expect(resources.getTerrainResource(resourceId).geometryKey).toBe(
			GEOMETRY_A,
		);
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

function createPlacement(): ResolvedScenePlacement {
	return {
		envCellId: null,
		landblockId: "0x0000ffff",
		localToLandblock: Mat4.identity(),
	};
}
