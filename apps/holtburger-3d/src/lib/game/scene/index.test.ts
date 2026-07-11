import { describe, expect, it } from "vitest";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type { SceneNodeId } from ".";
import { SceneGraph } from ".";

const camera = {
	far: 800,
	fov: 90,
	near: 0.5,
	position: Vec3.zero(),
	rotation: Quat.identity(),
};

const rootPlacement = {
	envCellId: null,
	landblockId: "0001",
	localTransform: Mat4.identity(),
};

const rootInput = {
	...rootPlacement,
	localBounds: null,
	parentId: null,
};

const boundedChildFields = {
	localBounds: AABB3.zero(),
	localTransform: Mat4.identity(),
};

describe("SceneGraph", () => {
	it("assigns root placement to transform descendants", () => {
		const scene = new SceneGraph();
		const rootId = scene.createNode(rootInput);
		const childId = scene.createNode({
			...boundedChildFields,
			parentId: rootId,
		});

		expect(scene.getNode(rootId)).toMatchObject({
			envCellId: rootPlacement.envCellId,
			landblockId: rootPlacement.landblockId,
			localTransform: rootPlacement.localTransform,
			parentId: null,
		});
		expect(scene.getNode(childId)?.parentId).toBe(rootId);
		expect(scene.getRootPlacement(childId)).toEqual(rootPlacement);
	});

	it("indexes bounded nodes but permits empty transform nodes", () => {
		const scene = new SceneGraph();
		const rootId = scene.createNode(rootInput);
		const childId = scene.createNode({
			...boundedChildFields,
			parentId: rootId,
		});

		expect(scene.updateVisibility(camera).nodeIds).toEqual([childId]);

		scene.updateBounds(childId, null);
		expect(scene.updateVisibility(camera).nodeIds).toEqual([]);
	});

	it("destroys transform descendants with their parent", () => {
		const scene = new SceneGraph();
		const rootId = scene.createNode(rootInput);
		const childId = scene.createNode({
			...boundedChildFields,
			parentId: rootId,
		});
		const grandchildId = scene.createNode({
			...boundedChildFields,
			parentId: childId,
		});

		const destroyed = scene.destroyNode(rootId);
		expect(new Set(destroyed)).toEqual(
			new Set([rootId, childId, grandchildId]),
		);
		expect(scene.updateVisibility(camera).nodeIds).toEqual([]);
	});

	it("rejects destruction of a parented node", () => {
		const scene = new SceneGraph();
		const rootId = scene.createNode(rootInput);
		const childId = scene.createNode({
			...boundedChildFields,
			parentId: rootId,
		});

		expect(() => scene.destroyNode(childId)).toThrow(
			`Cannot destroy parented scene node ${childId}.`,
		);
		expect(scene.getNode(rootId)).toBeDefined();
		expect(scene.getNode(childId)).toBeDefined();
	});

	it("updates root placement atomically", () => {
		const scene = new SceneGraph();
		const rootId = scene.createNode(rootInput);
		const envCellPlacement = {
			envCellId: "cell-1",
			landblockId: "0002",
			localTransform: Mat4.identity(),
		};

		scene.updateRootPlacement(rootId, envCellPlacement);

		expect(scene.getNode(rootId)?.id).toBe(rootId);
		expect(scene.getRootPlacement(rootId)).toEqual(envCellPlacement);
	});

	it("requires a parent node to exist", () => {
		const scene = new SceneGraph();

		expect(() =>
			scene.createNode({
				...boundedChildFields,
				parentId: "scene-node:missing" as SceneNodeId,
			}),
		).toThrow("does not exist");
	});
});
