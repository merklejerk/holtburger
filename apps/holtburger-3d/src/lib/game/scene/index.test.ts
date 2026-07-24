import { describe, expect, it } from "vitest";
import { createLandblockWorldOrigin } from "../landblocks";
import { createTranslationMat4, getMat4Translation } from "../math/matrices";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type {
	SceneNodeId,
	ScenePortalCrossingInput,
	SceneScope,
	VisibleSceneEntry,
} from ".";
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
				})
				.entries.map(({ nodeId }) => nodeId),
		).toEqual([childId]);

		scene.updateBounds(childId, null);
		expect(
			scene.queryFrustum(camera, {
				kind: "outdoor",
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

		const visible = scene.queryFrustum(camera, outdoor);

		expect(visible.entries.map(({ nodeId }) => nodeId)).toEqual([
			outdoorOne,
			outdoorTwo,
			cellOne,
			cellTwo,
		]);
		expect(visible.entries.map(({ nodeId }) => nodeId)).not.toContain(
			disconnectedCell,
		);
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

		const visible = scene.queryFrustum(
			camera,
			envCellScope("0x0001ffff", "cell-origin"),
		);

		expect(visible.entries.map(({ nodeId }) => nodeId)).toEqual([origin]);
		expect(visible.entries.map(({ nodeId }) => nodeId)).not.toContain(outdoor);
		expect(visible.entries.map(({ nodeId }) => nodeId)).not.toContain(other);
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

		const visible = scene.queryFrustum(camera, originScope);

		expect(visible.entries.map(({ nodeId }) => nodeId)).toEqual([
			origin,
			outdoorOne,
			outdoorTwo,
			target,
		]);
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

		const visible = scene.queryFrustum(camera, cellOneScope);

		expect(visible.entries.map(({ nodeId }) => nodeId)).toEqual([
			cellOne,
			cellTwo,
		]);
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

function visibleEntry(
	scene: SceneGraph,
	nodeId: SceneNodeId,
): VisibleSceneEntry {
	const entry = scene
		.queryFrustum(camera, {
			kind: "outdoor",
		})
		.entries.find((candidate) => candidate.nodeId === nodeId);
	if (!entry) throw new Error(`Scene node ${nodeId} is not visible.`);
	return entry;
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
