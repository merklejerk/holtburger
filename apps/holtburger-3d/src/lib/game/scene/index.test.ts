import { describe, expect, it } from "vitest";
import { createTranslationMat4, getMat4Translation } from "../math/matrices";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type { SceneNodeId, VisibleSceneEntry } from ".";
import { SceneGraph } from ".";

const camera = {
	far: 800,
	fov: 90,
	near: 0.5,
	placement: {
		envCellId: null,
		landblockId: "0x0001ffff",
		position: Vec3.zero(),
		rotation: Quat.identity(),
	},
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
	it("returns inherited root placement beside selected bounded descendants", () => {
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
		expect(visibleEntry(scene, childId).placement).toEqual({
			envCellId: rootPlacement.envCellId,
			landblockId: rootPlacement.landblockId,
			localToLandblock: rootPlacement.localTransform,
			scope: { kind: "outdoor", landblockId: rootPlacement.landblockId },
		});
	});

	it("reindexes descendants when a parent transform changes", () => {
		const scene = new SceneGraph();
		const rootId = scene.createNode({
			...rootInput,
			localTransform: createTranslationMat4(new Vec3(10, 0, 0)),
		});
		const childId = scene.createNode({
			...boundedChildFields,
			localTransform: createTranslationMat4(new Vec3(0, 20, 0)),
			parentId: rootId,
		});
		const grandchildId = scene.createNode({
			...boundedChildFields,
			localTransform: createTranslationMat4(new Vec3(0, 0, 30)),
			parentId: childId,
		});

		expect(
			getMat4Translation(
				visibleEntry(scene, grandchildId).placement.localToLandblock,
			),
		).toEqual(new Vec3(10, 20, 30));

		scene.updateLocalTransform(
			childId,
			createTranslationMat4(new Vec3(0, 40, 0)),
		);
		expect(
			getMat4Translation(
				visibleEntry(scene, grandchildId).placement.localToLandblock,
			),
		).toEqual(new Vec3(10, 40, 30));
	});

	it("indexes bounded nodes but permits empty transform nodes", () => {
		const scene = new SceneGraph();
		const rootId = scene.createNode(rootInput);
		const childId = scene.createNode({
			...boundedChildFields,
			parentId: rootId,
		});

		expect(
			scene
				.queryFrustum(camera, {
					kind: "outdoor",
					landblockId: camera.placement.landblockId,
				})
				.entries.map(({ nodeId }) => nodeId),
		).toEqual([childId]);

		scene.updateBounds(childId, null);
		expect(
			scene.queryFrustum(camera, {
				kind: "outdoor",
				landblockId: camera.placement.landblockId,
			}).entries,
		).toEqual([]);
	});

	it("requires systems to destroy transform trees from leaves to roots", () => {
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

		expect(() => scene.destroyNode(rootId)).toThrow("still has children");
		scene.destroyNode(grandchildId);
		scene.destroyNode(childId);
		scene.destroyNode(rootId);
		expect(
			scene.queryFrustum(camera, {
				kind: "outdoor",
				landblockId: camera.placement.landblockId,
			}).entries,
		).toEqual([]);
	});

	it("permits destruction of parented leaves", () => {
		const scene = new SceneGraph();
		const rootId = scene.createNode(rootInput);
		const childId = scene.createNode({
			...boundedChildFields,
			parentId: rootId,
		});

		scene.destroyNode(childId);
		expect(scene.getNode(rootId)).toBeDefined();
		expect(scene.getNode(childId)).toBeUndefined();
	});

	it("reindexes descendants when root residency changes", () => {
		const scene = new SceneGraph();
		const rootId = scene.createNode(rootInput);
		const childId = scene.createNode({
			...boundedChildFields,
			parentId: rootId,
		});
		const envCellPlacement = {
			envCellId: "cell-1",
			landblockId: "0002",
			localTransform: createTranslationMat4(new Vec3(10, 20, 30)),
		};

		scene.updateRootPlacement(rootId, envCellPlacement);
		scene.upsertEnvCellScope({
			landblockBounds: null,
			potentiallyVisibleEnvCellIds: new Set(),
			scope: {
				envCellId: envCellPlacement.envCellId,
				kind: "env-cell",
				landblockId: envCellPlacement.landblockId,
			},
		});

		expect(scene.getNode(rootId)?.id).toBe(rootId);
		const envEntry = scene
			.queryFrustum(camera, {
				envCellId: envCellPlacement.envCellId,
				kind: "env-cell",
				landblockId: envCellPlacement.landblockId,
			})
			.entries.find(({ nodeId }) => nodeId === childId);
		expect(envEntry?.placement).toEqual({
			envCellId: envCellPlacement.envCellId,
			landblockId: envCellPlacement.landblockId,
			localToLandblock: envCellPlacement.localTransform,
			scope: {
				envCellId: envCellPlacement.envCellId,
				kind: "env-cell",
				landblockId: envCellPlacement.landblockId,
			},
		});
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

function visibleEntry(
	scene: SceneGraph,
	nodeId: SceneNodeId,
): VisibleSceneEntry {
	const entry = scene
		.queryFrustum(camera, {
			kind: "outdoor",
			landblockId: camera.placement.landblockId,
		})
		.entries.find((candidate) => candidate.nodeId === nodeId);
	if (!entry) throw new Error(`Scene node ${nodeId} is not visible.`);
	return entry;
}
