import { describe, expect, it } from "vitest";
import { createPublishedGeometryManager } from "../geometry/geometry-manager.test-utils";
import { Mat4 } from "../math/types";
import type { ResolvedScenePlacement, SceneNodeId } from "../scene";
import type { GeometryKey } from "../geometry/types";
import { RenderResourceRegistry } from "./render-resources";
import { RenderScene } from "./render-scene";

const GEOMETRY = "static-geometry:fixture" as const satisfies GeometryKey;
const NODE_A = "scene-node:1" as const satisfies SceneNodeId;
const NODE_B = "scene-node:2" as const satisfies SceneNodeId;

describe("RenderScene", () => {
	it("selects multiple object poses for one visible node", () => {
		const resources = createRegistry();
		const scene = new RenderScene(resources);
		const objectId = resources.createObjectResource(GEOMETRY, [
			createObjectDrawUnit(),
		]);
		scene.createInstance({
			kind: "object",
			nodeId: NODE_A,
			pose: { kind: "baked" },
			resourceId: objectId,
		});
		scene.createInstance({
			kind: "object",
			nodeId: NODE_A,
			pose: { kind: "rigid", resourceTransform: Mat4.identity() },
			resourceId: objectId,
		});

		const view = scene.resolveVisibleOccurrences([NODE_A], () =>
			createPlacement(),
		);

		expect(
			view.map((instance) =>
				instance.kind === "object"
					? instance.instance.pose.kind
					: instance.kind,
			),
		).toEqual(["baked", "rigid"]);
		expect(view[0]?.placement).toEqual(createPlacement());
	});

	it("selects terrain occurrences through their visible scene roots", () => {
		const resources = createRegistry();
		const scene = new RenderScene(resources);
		scene.createInstance({ kind: "terrain", nodeId: NODE_A });

		const view = scene.resolveVisibleOccurrences([NODE_A], () =>
			createPlacement(),
		);

		expect(view).toEqual([
			{
				kind: "terrain",
				instance: {
					id: "render-instance:0",
					kind: "terrain",
					nodeId: NODE_A,
				},
				placement: createPlacement(),
			},
		]);
	});

	it("removes object occurrences without deciding object resource lifetime", () => {
		const resources = createRegistry();
		const scene = new RenderScene(resources);
		const resourceId = resources.createObjectResource(GEOMETRY, []);
		scene.createInstance({
			kind: "object",
			nodeId: NODE_A,
			pose: { kind: "baked" },
			resourceId,
		});
		scene.createInstance({
			kind: "object",
			nodeId: NODE_B,
			pose: { kind: "baked" },
			resourceId,
		});

		scene.removeNodes([NODE_A, NODE_B]);

		expect(
			scene.resolveVisibleOccurrences([NODE_A, NODE_B], () =>
				createPlacement(),
			),
		).toEqual([]);
		expect(resources.getObjectResource(resourceId).geometry).toBe(GEOMETRY);
	});
});

function createRegistry(): RenderResourceRegistry {
	return new RenderResourceRegistry(createPublishedGeometryManager(GEOMETRY));
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
