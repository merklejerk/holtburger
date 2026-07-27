import { describe, expect, it } from "vitest";
import { createLandblockWorldOrigin } from "../landblocks";
import {
	createPerspectiveMat4,
	createTranslationMat4,
	createViewMat4,
	getMat4Translation,
} from "../math/matrices";
import { createFrustum, type Frustum } from "../math/frustum";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type { SceneNodeId, ScenePortalCrossingInput, SceneScope } from ".";
import { SceneGraph } from ".";

const rootPlacement = {
	envCellId: null,
	landblockId: "0x0001ffff",
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

const TEST_FRUSTUM = createFrustum(
	createPerspectiveMat4(90, 1, 1, 100),
	createViewMat4(Vec3.zero(), Quat.identity()),
	Vec3.zero(),
);

const TOPOLOGY_FRUSTUM = {
	cameraPosition: Vec3.zero(),
	planes: [],
} as const satisfies Frustum;

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
		expect(visiblePlacement(scene, childId)).toEqual({
			envCellId: rootPlacement.envCellId,
			landblockId: rootPlacement.landblockId,
			localToLandblock: rootPlacement.localTransform,
			scope: { kind: "outdoor" },
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
				visiblePlacement(scene, grandchildId).localToLandblock,
			),
		).toEqual(new Vec3(10, 20, 30));

		scene.updateLocalTransform(
			childId,
			createTranslationMat4(new Vec3(0, 40, 0)),
		);
		expect(
			getMat4Translation(
				visiblePlacement(scene, grandchildId).localToLandblock,
			),
		).toEqual(new Vec3(10, 40, 30));
	});

	it("owns spatial values at its API boundary", () => {
		const scene = new SceneGraph();
		const bounds = new AABB3(new Vec3(-1, -2, -3), new Vec3(4, 5, 6));
		const transform = createTranslationMat4(new Vec3(10, 20, 30));
		const nodeId = scene.createNode({
			envCellId: null,
			landblockId: "0x0001ffff",
			localBounds: bounds,
			localTransform: transform,
			parentId: null,
		});

		bounds.min.x = -100;
		transform.m41 = 100;
		const node = scene.getNode(nodeId);
		if (!node?.localBounds) throw new Error("Expected bounded scene node.");
		node.localBounds.max.z = 100;
		node.localTransform.m42 = 100;
		const placement = visiblePlacement(scene, nodeId);
		placement.localToLandblock.m43 = 100;

		expect(scene.getNode(nodeId)).toMatchObject({
			localBounds: new AABB3(new Vec3(-1, -2, -3), new Vec3(4, 5, 6)),
			localTransform: createTranslationMat4(new Vec3(10, 20, 30)),
		});
		expect(
			getMat4Translation(visiblePlacement(scene, nodeId).localToLandblock),
		).toEqual(new Vec3(10, 20, 30));
	});

	it("indexes bounded nodes but permits empty transform nodes", () => {
		const scene = new SceneGraph();
		const rootId = scene.createNode(rootInput);
		const childId = scene.createNode({
			...boundedChildFields,
			parentId: rootId,
		});

		expect(queryTopology(scene, { kind: "outdoor" }).entries).toEqual([
			childId,
		]);

		scene.updateBounds(childId, null);
		expect(queryTopology(scene, { kind: "outdoor" }).entries).toEqual([]);
	});

	it("reuses a primitive visibility selection buffer", () => {
		const scene = new SceneGraph();
		const nodeId = createBoundedRoot(scene, "0x0001ffff", null);
		const first = queryTopology(scene, { kind: "outdoor" });
		const second = queryTopology(scene, { kind: "outdoor" });

		expect(first).toBe(second);
		expect(second.entries).toEqual([nodeId]);
	});

	it("rebuilds dirty culling-group bounds after member changes", () => {
		const scene = new SceneGraph();
		const visible = scene.createNode({
			cullingGroup: "static",
			envCellId: null,
			landblockId: "0x0001ffff",
			localBounds: new AABB3(new Vec3(-1, -1, -5), new Vec3(1, 1, -3)),
			localTransform: Mat4.identity(),
			parentId: null,
		});
		const hidden = scene.createNode({
			cullingGroup: "static",
			envCellId: null,
			landblockId: "0x0001ffff",
			localBounds: new AABB3(new Vec3(90, -1, -5), new Vec3(92, 1, -3)),
			localTransform: Mat4.identity(),
			parentId: null,
		});

		expect(
			scene.queryFrustum(TEST_FRUSTUM, "0x0001ffff", outdoorScope()).entries,
		).toEqual([visible]);
		scene.updateBounds(
			hidden,
			new AABB3(new Vec3(-1, -1, -8), new Vec3(1, 1, -6)),
		);
		expect(
			scene.queryFrustum(TEST_FRUSTUM, "0x0001ffff", outdoorScope()).entries,
		).toEqual([visible, hidden]);
		scene.destroyNode(hidden);
		expect(
			scene.queryFrustum(TEST_FRUSTUM, "0x0001ffff", outdoorScope()).entries,
		).toEqual([visible]);
	});

	it("keeps culling groups independent within one landblock", () => {
		const scene = new SceneGraph();
		const terrain = createGroupedRoot(scene, "terrain");
		const staticNode = createGroupedRoot(scene, "static");

		expect(
			scene.queryFrustum(TEST_FRUSTUM, "0x0001ffff", outdoorScope()).entries,
		).toEqual([terrain, staticNode]);
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
		expect(queryTopology(scene, { kind: "outdoor" }).entries).toEqual([]);
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
			landblockId: "0x0002ffff",
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
		expect(
			queryTopology(scene, {
				envCellId: envCellPlacement.envCellId,
				kind: "env-cell",
				landblockId: envCellPlacement.landblockId,
			}).entries,
		).toContain(childId);
		expect(scene.getResolvedPlacement(childId)).toEqual({
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

	it("resolves outdoor residency directly from a scene-space point", () => {
		const scene = new SceneGraph();
		const point = createLandblockWorldOrigin("0x0102ffff").add(
			new Vec3(1, 20, -1),
		);

		expect(scene.queryWorldPointResidency(point)).toEqual({
			envCellId: null,
			landblockId: "0x0102ffff",
		});
		expect(scene.queryWorldPointResidency(new Vec3(-1, 20, -1))).toBeNull();
	});

	it("prefers one resident env-cell scope containing the scene-space point", () => {
		const scene = new SceneGraph();
		scene.upsertEnvCellScope({
			landblockBounds: new AABB3(new Vec3(10, -5, -30), new Vec3(30, 15, -10)),
			potentiallyVisibleEnvCellIds: new Set(),
			scope: {
				envCellId: "0x01020001",
				kind: "env-cell",
				landblockId: "0x0102ffff",
			},
		});
		const point = createLandblockWorldOrigin("0x0102ffff").add(
			new Vec3(10, 5, -30),
		);

		expect(scene.queryWorldPointResidency(point)).toEqual({
			envCellId: "0x01020001",
			landblockId: "0x0102ffff",
		});
	});

	it("selects the first resident env-cell scope when bounds overlap", () => {
		const scene = new SceneGraph();
		for (const envCellId of ["0x01020001", "0x01020002"]) {
			scene.upsertEnvCellScope({
				landblockBounds: new AABB3(
					new Vec3(10, -5, -30),
					new Vec3(30, 15, -10),
				),
				potentiallyVisibleEnvCellIds: new Set(),
				scope: {
					envCellId,
					kind: "env-cell",
					landblockId: "0x0102ffff",
				},
			});
		}
		const point = createLandblockWorldOrigin("0x0102ffff").add(
			new Vec3(10, 5, -30),
		);

		expect(scene.queryWorldPointResidency(point)).toEqual({
			envCellId: "0x01020001",
			landblockId: "0x0102ffff",
		});
	});

	it("selects every outdoor node and recursively reachable env-cell scope", () => {
		const scene = new SceneGraph();
		const outdoorOne = createBoundedRoot(scene, "0x0001ffff", null);
		const outdoorTwo = createBoundedRoot(scene, "0x0002ffff", null);
		const cellOne = createBoundedRoot(scene, "0x0001ffff", "cell-1");
		const cellTwo = createBoundedRoot(scene, "0x0001ffff", "cell-2");
		const disconnectedCell = createBoundedRoot(
			scene,
			"0x0001ffff",
			"cell-disconnected",
		);
		const outdoor = outdoorScope();
		const cellOneScope = envCellScope("0x0001ffff", "cell-1");
		const cellTwoScope = envCellScope("0x0001ffff", "cell-2");
		upsertCrossing(scene, "outside-to-one", outdoor, cellOneScope);
		upsertCrossing(scene, "one-to-two", cellOneScope, cellTwoScope);

		const visible = queryTopology(scene, outdoor);

		expect(visible.entries).toEqual([outdoorOne, outdoorTwo, cellOne, cellTwo]);
		expect(visible.entries).not.toContain(disconnectedCell);
		expect(visible.crossings.map(({ id }) => id)).toEqual([
			"portal-crossing:outside-to-one",
			"portal-crossing:one-to-two",
		]);
	});

	it("keeps an env-cell query inside its origin without a transition", () => {
		const scene = new SceneGraph();
		const outdoor = createBoundedRoot(scene, "0x0001ffff", null);
		const origin = createBoundedRoot(scene, "0x0001ffff", "cell-origin");
		const other = createBoundedRoot(scene, "0x0001ffff", "cell-other");

		const visible = queryTopology(
			scene,
			envCellScope("0x0001ffff", "cell-origin"),
		);

		expect(visible.entries).toEqual([origin]);
		expect(visible.entries).not.toContain(outdoor);
		expect(visible.entries).not.toContain(other);
	});

	it("reaches all outdoor nodes and their transitions after exiting an env-cell", () => {
		const scene = new SceneGraph();
		const origin = createBoundedRoot(scene, "0x0001ffff", "cell-origin");
		const outdoorOne = createBoundedRoot(scene, "0x0001ffff", null);
		const outdoorTwo = createBoundedRoot(scene, "0x0002ffff", null);
		const target = createBoundedRoot(scene, "0x0002ffff", "cell-target");
		const originScope = envCellScope("0x0001ffff", "cell-origin");
		const targetScope = envCellScope("0x0002ffff", "cell-target");
		const outdoor = outdoorScope();
		upsertCrossing(scene, "origin-to-outside", originScope, outdoor);
		upsertCrossing(scene, "outside-to-target", outdoor, targetScope);
		upsertCrossing(scene, "target-to-outside", targetScope, outdoor);

		const visible = queryTopology(scene, originScope);

		expect(visible.entries).toEqual([origin, outdoorOne, outdoorTwo, target]);
		expect(visible.crossings.map(({ id }) => id)).toEqual([
			"portal-crossing:origin-to-outside",
			"portal-crossing:outside-to-target",
			"portal-crossing:target-to-outside",
		]);
	});

	it("recurses through indoor transitions without revisiting cyclic scopes", () => {
		const scene = new SceneGraph();
		const cellOne = createBoundedRoot(scene, "0x0001ffff", "cell-1");
		const cellTwo = createBoundedRoot(scene, "0x0001ffff", "cell-2");
		const cellOneScope = envCellScope("0x0001ffff", "cell-1");
		const cellTwoScope = envCellScope("0x0001ffff", "cell-2");
		upsertCrossing(scene, "one-to-two", cellOneScope, cellTwoScope);
		upsertCrossing(scene, "two-to-one", cellTwoScope, cellOneScope);

		const visible = queryTopology(scene, cellOneScope);

		expect(visible.entries).toEqual([cellOne, cellTwo]);
		expect(visible.crossings.map(({ id }) => id)).toEqual([
			"portal-crossing:one-to-two",
			"portal-crossing:two-to-one",
		]);
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

function visiblePlacement(scene: SceneGraph, nodeId: SceneNodeId) {
	const visible = queryTopology(scene, { kind: "outdoor" }).entries.includes(
		nodeId,
	);
	if (!visible) throw new Error(`Scene node ${nodeId} is not visible.`);
	const placement = scene.getResolvedPlacement(nodeId);
	if (!placement) throw new Error(`Scene node ${nodeId} has no placement.`);
	return placement;
}

function queryTopology(scene: SceneGraph, origin: SceneScope) {
	return scene.queryFrustum(TOPOLOGY_FRUSTUM, "0x0001ffff", origin);
}

function createBoundedRoot(
	scene: SceneGraph,
	landblockId: string,
	envCellId: string | null,
): SceneNodeId {
	if (envCellId !== null) {
		scene.upsertEnvCellScope({
			landblockBounds: AABB3.zero(),
			potentiallyVisibleEnvCellIds: new Set(),
			scope: envCellScope(landblockId, envCellId),
		});
	}
	return scene.createNode({
		envCellId,
		landblockId,
		localBounds: AABB3.zero(),
		localTransform: Mat4.identity(),
		parentId: null,
	});
}

function createGroupedRoot(
	scene: SceneGraph,
	cullingGroup: string,
): SceneNodeId {
	return scene.createNode({
		cullingGroup,
		envCellId: null,
		landblockId: "0x0001ffff",
		localBounds: new AABB3(new Vec3(-1, -1, -5), new Vec3(1, 1, -3)),
		localTransform: Mat4.identity(),
		parentId: null,
	});
}

function outdoorScope(): SceneScope {
	return { kind: "outdoor" };
}

function envCellScope(
	landblockId: string,
	envCellId: string,
): Extract<SceneScope, { kind: "env-cell" }> {
	return { envCellId, kind: "env-cell", landblockId };
}

function upsertCrossing(
	scene: SceneGraph,
	id: string,
	source: SceneScope,
	target: SceneScope,
): void {
	const crossing: ScenePortalCrossingInput = {
		aperture: {
			id: `portal-aperture:${id}`,
			indices: new Uint32Array(),
			landblockId: "0x0001ffff",
			landblockBounds: AABB3.zero(),
			vertices: new Float32Array(),
			visibleSide: "both",
		},
		id: `portal-crossing:${id}`,
		source,
		target,
	};
	scene.upsertPortalCrossing(crossing);
}
