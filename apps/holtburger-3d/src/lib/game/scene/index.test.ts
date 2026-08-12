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
import { INCLUDE_ALL_SCENE_CULLING_GROUPS, SceneGraph } from ".";

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
		const resolvedBounds = scene.getResolvedBounds(nodeId);
		if (!resolvedBounds) throw new Error("Expected resolved scene bounds.");
		resolvedBounds.localBounds.min.y = -100;
		resolvedBounds.placement.localToLandblock.m41 = 100;

		expect(scene.getNode(nodeId)).toMatchObject({
			localBounds: new AABB3(new Vec3(-1, -2, -3), new Vec3(4, 5, 6)),
			localTransform: createTranslationMat4(new Vec3(10, 20, 30)),
		});
		expect(
			getMat4Translation(visiblePlacement(scene, nodeId).localToLandblock),
		).toEqual(new Vec3(10, 20, 30));
		expect(scene.getResolvedBounds(nodeId)).toMatchObject({
			localBounds: new AABB3(new Vec3(-1, -2, -3), new Vec3(4, 5, 6)),
			placement: {
				localToLandblock: createTranslationMat4(new Vec3(10, 20, 30)),
			},
		});
	});

	it("indexes bounded nodes but permits empty transform nodes", () => {
		const scene = new SceneGraph();
		const rootId = scene.createNode(rootInput);
		const childId = scene.createNode({
			...boundedChildFields,
			parentId: rootId,
		});

		expect(queryScopes(scene, { kind: "outdoor" }).entries).toEqual([childId]);

		scene.updateBounds(childId, null);
		expect(queryScopes(scene, { kind: "outdoor" }).entries).toEqual([]);
	});

	it("reuses a primitive visibility selection buffer", () => {
		const scene = new SceneGraph();
		const nodeId = createBoundedRoot(scene, "0x0001ffff", null);
		const first = queryScopes(scene, { kind: "outdoor" });
		const second = queryScopes(scene, { kind: "outdoor" });

		expect(first).toBe(second);
		expect(second.entries).toEqual([nodeId]);
	});

	it("queries a reusable indexed scope selection without requiring an array", () => {
		const scene = new SceneGraph();
		const nodeId = createGroupedRoot(scene, "static");
		const selection = {
			count: 1,
			scopeAt: (ordinal: number) => {
				if (ordinal !== 0) throw new Error("unexpected scope ordinal");
				return outdoorScope();
			},
		};

		expect(
			scene.queryScopeSelectionFrustum(
				TEST_FRUSTUM,
				"0x0001ffff",
				selection,
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		).toEqual([nodeId]);
		expect(() =>
			scene.queryScopeSelectionFrustum(
				TEST_FRUSTUM,
				"0x0001ffff",
				{ ...selection, count: 0 },
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			),
		).toThrow("at least one scope");
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
			scene.queryScopesFrustum(
				TEST_FRUSTUM,
				"0x0001ffff",
				[outdoorScope()],
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		).toEqual([visible]);
		scene.updateBounds(
			hidden,
			new AABB3(new Vec3(-1, -1, -8), new Vec3(1, 1, -6)),
		);
		expect(
			scene.queryScopesFrustum(
				TEST_FRUSTUM,
				"0x0001ffff",
				[outdoorScope()],
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		).toEqual([visible, hidden]);
		scene.destroyNode(hidden);
		expect(
			scene.queryScopesFrustum(
				TEST_FRUSTUM,
				"0x0001ffff",
				[outdoorScope()],
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		).toEqual([visible]);
	});

	it("keeps culling groups independent within one landblock", () => {
		const scene = new SceneGraph();
		const terrain = createGroupedRoot(scene, "terrain");
		createGroupedRoot(scene, "static");
		const visitedGroups: string[] = [];

		expect(
			scene.queryScopesFrustum(
				TEST_FRUSTUM,
				"0x0001ffff",
				[outdoorScope()],
				(cullingGroup) => {
					visitedGroups.push(cullingGroup);
					return cullingGroup === "terrain";
				},
			).entries,
		).toEqual([terrain]);
		expect(visitedGroups).toEqual(["terrain", "static"]);
	});

	it("keeps identical producer groups independent across EnvCell scopes", () => {
		const scene = new SceneGraph();
		const firstScope = envCellScope("0x0001ffff", "cell-a");
		const secondScope = envCellScope("0x0001ffff", "cell-b");
		const first = createEnvCellGroupedRoot(scene, firstScope, "residents");
		const second = createEnvCellGroupedRoot(scene, secondScope, "residents");

		expect(queryScopes(scene, firstScope).entries).toEqual([first]);
		expect(queryScopes(scene, secondScope).entries).toEqual([second]);
	});

	it("selects a protruding resident independently of an off-frustum cell shell", () => {
		const scene = new SceneGraph();
		const scope = envCellScope("0x0001ffff", "cell-a");
		const shell = createEnvCellGroupedRoot(
			scene,
			scope,
			"env-cell-shell",
			new AABB3(new Vec3(90, -1, -5), new Vec3(92, 1, -3)),
		);
		const resident = createEnvCellGroupedRoot(
			scene,
			scope,
			"env-cell-static-residents",
			new AABB3(new Vec3(-1, -1, -5), new Vec3(1, 1, -3)),
		);

		const visible = scene.queryScopesFrustum(
			TEST_FRUSTUM,
			"0x0001ffff",
			[scope],
			INCLUDE_ALL_SCENE_CULLING_GROUPS,
		).entries;
		expect(visible).toEqual([resident]);
		expect(visible).not.toContain(shell);
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
		expect(queryScopes(scene, { kind: "outdoor" }).entries).toEqual([]);
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
			containmentPlanes: new Float32Array(),
			landblockBounds: null,
			potentiallyVisibleEnvCellIds: new Set(),
			scope: {
				envCellId: envCellPlacement.envCellId,
				kind: "env-cell",
				landblockId: envCellPlacement.landblockId,
			},
			structureToLandblock: Mat4.identity(),
			seenOutside: false,
			visibilityIslandId: `env-cell-island:${envCellPlacement.envCellId}`,
		});

		expect(scene.getNode(rootId)?.id).toBe(rootId);
		expect(
			queryScopes(scene, {
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

	it("returns an explicit outdoor candidate from a scene-space point", () => {
		const scene = new SceneGraph();
		const point = createLandblockWorldOrigin("0x0102ffff").add(
			new Vec3(1, 20, -1),
		);

		expect(scene.queryWorldPointResidencyCandidates(point)).toEqual({
			envCells: [],
			outdoor: {
				envCellId: null,
				landblockId: "0x0102ffff",
			},
		});
		expect(
			scene.queryWorldPointResidencyCandidates(new Vec3(-1, 20, -1)),
		).toBeNull();
	});

	it("returns every AABB candidate with its exact containment verdict", () => {
		const scene = new SceneGraph();
		for (const [envCellId, containmentPlanes] of [
			["0x01020002", new Float32Array([-1, 0, 0, 0])],
			["0x01020001", new Float32Array([1, 0, 0, 0])],
		] as const) {
			scene.upsertEnvCellScope({
				containmentPlanes,
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
				structureToLandblock: Mat4.identity(),
				seenOutside: false,
				visibilityIslandId: `env-cell-island:${envCellId}`,
			});
		}
		const point = createLandblockWorldOrigin("0x0102ffff").add(
			new Vec3(20, 5, -20),
		);

		expect(scene.queryWorldPointResidencyCandidates(point)).toEqual({
			envCells: [
				{
					containsPoint: true,
					envCellId: "0x01020001",
					landblockId: "0x0102ffff",
				},
				{
					containsPoint: false,
					envCellId: "0x01020002",
					landblockId: "0x0102ffff",
				},
			],
			outdoor: {
				envCellId: null,
				landblockId: "0x0102ffff",
			},
		});
	});

	it("tests an explicitly selected cell independently of world overlap identity", () => {
		const scene = new SceneGraph();
		scene.upsertEnvCellScope({
			containmentPlanes: new Float32Array([1, 0, 0, 0]),
			landblockBounds: new AABB3(
				new Vec3(200, -5, -30),
				new Vec3(220, 15, -10),
			),
			potentiallyVisibleEnvCellIds: new Set(),
			scope: {
				envCellId: "0x01020001",
				kind: "env-cell",
				landblockId: "0x0102ffff",
			},
			structureToLandblock: createTranslationMat4(new Vec3(200, 0, -20)),
			seenOutside: false,
			visibilityIslandId: "env-cell-island:0x01020001",
		});
		const point = createLandblockWorldOrigin("0x0102ffff").add(
			new Vec3(210, 5, -20),
		);

		expect(scene.queryEnvCellPointContainment("0x01020001", point)).toBe(true);
		expect(
			scene.hasEnvCellScope({
				envCellId: "0x01020001",
				landblockId: "0x0102ffff",
			}),
		).toBe(true);
		expect(
			scene.hasEnvCellScope({
				envCellId: "0x01020001",
				landblockId: "0x0202ffff",
			}),
		).toBe(false);
		expect(
			scene.hasEnvCellScope({
				envCellId: null,
				landblockId: "0x0102ffff",
			}),
		).toBe(false);
	});

	it("broad-phases spatially overlapping cells without assuming outdoor landblock identity", () => {
		const scene = new SceneGraph();
		scene.upsertEnvCellScope({
			containmentPlanes: new Float32Array(),
			landblockBounds: new AABB3(
				new Vec3(192, -5, -30),
				new Vec3(220, 15, -10),
			),
			potentiallyVisibleEnvCellIds: new Set(),
			scope: {
				envCellId: "0x01020001",
				kind: "env-cell",
				landblockId: "0x0102ffff",
			},
			structureToLandblock: Mat4.identity(),
			seenOutside: false,
			visibilityIslandId: "env-cell-island:0x01020001",
		});
		const point = createLandblockWorldOrigin("0x0202ffff").add(
			new Vec3(10, 5, -20),
		);

		expect(scene.queryWorldPointResidencyCandidates(point)).toEqual({
			envCells: [
				{
					containsPoint: true,
					envCellId: "0x01020001",
					landblockId: "0x0102ffff",
				},
			],
			outdoor: {
				envCellId: null,
				landblockId: "0x0202ffff",
			},
		});
	});

	it("selects only the explicit scopes without applying portal topology", () => {
		const scene = new SceneGraph();
		const outdoorOne = createBoundedRoot(scene, "0x0001ffff", null);
		const outdoorTwo = createBoundedRoot(scene, "0x0002ffff", null);
		const cellOne = createBoundedRoot(scene, "0x0001ffff", "cell-1");
		const cellTwo = createBoundedRoot(scene, "0x0001ffff", "cell-2");
		const outdoor = outdoorScope();
		const cellOneScope = envCellScope("0x0001ffff", "cell-1");
		const cellTwoScope = envCellScope("0x0001ffff", "cell-2");
		upsertCrossing(scene, "outside-to-one", outdoor, cellOneScope);
		upsertCrossing(scene, "one-to-two", cellOneScope, cellTwoScope);

		const visible = queryScopes(scene, outdoor, cellTwoScope);

		expect(visible.entries).toEqual([outdoorOne, outdoorTwo, cellTwo]);
		expect(visible.entries).not.toContain(cellOne);
	});

	it("rejects an explicit EnvCell scope that is not resident", () => {
		const scene = new SceneGraph();

		expect(() =>
			queryScopes(scene, envCellScope("0x0001ffff", "missing")),
		).toThrow("is not resident");
	});

	it("retains revisioned topology separately from spatial selection", () => {
		const scene = new SceneGraph();
		createBoundedRoot(scene, "0x0001ffff", "cell-one");
		createBoundedRoot(scene, "0x0001ffff", "cell-two");
		const one = envCellScope("0x0001ffff", "cell-one");
		const two = envCellScope("0x0001ffff", "cell-two");
		const outdoor = outdoorScope();
		upsertCrossing(scene, "outside-to-one", outdoor, one);
		upsertCrossing(scene, "one-to-two", one, two);

		const first = scene.getPortalTopologyView();
		const retained = scene.getPortalTopologyView();

		expect(retained).toBe(first);
		expect(first.scopes.map(({ scope }) => scope)).toEqual([outdoor, one, two]);
		expect(first.crossings.map(({ id }) => id)).toEqual([
			"portal-crossing:one-to-two",
			"portal-crossing:outside-to-one",
		]);
		expect(first.outgoing(outdoor).map(({ id }) => id)).toEqual([
			"portal-crossing:outside-to-one",
		]);
		expect(first.outgoing(one).map(({ id }) => id)).toEqual([
			"portal-crossing:one-to-two",
		]);

		scene.removePortalCrossing("portal-crossing:one-to-two");
		const changed = scene.getPortalTopologyView();
		expect(changed).not.toBe(first);
		expect(changed.revision).toBeGreaterThan(first.revision);
		expect(changed.crossings.map(({ id }) => id)).toEqual([
			"portal-crossing:outside-to-one",
		]);
		expect(changed.outgoing(one)).toEqual([]);
	});

	it("owns one defensive aperture copy per immutable producer aperture", () => {
		const scene = new SceneGraph();
		const aperture = portalAperture("shared");
		const outdoor = outdoorScope();
		const cell = envCellScope("0x0001ffff", "cell");
		upsertCrossing(scene, "first", outdoor, cell, aperture);
		upsertCrossing(scene, "second", cell, outdoor, aperture);

		aperture.vertices[0] = 100;
		const [first, second] = scene.getPortalTopologyView().crossings;
		if (!first || !second) throw new Error("Expected two portal crossings.");

		expect(first.sourceAperture).not.toBe(aperture);
		expect(first.sourceAperture).toBe(first.visibilityAperture);
		expect(first.sourceAperture).toBe(second.sourceAperture);
		expect(first.sourceAperture.vertices[0]).toBe(0);
	});

	it("flat selection includes every resident scope and performs zero portal work", () => {
		const scene = new SceneGraph();
		const outdoor = createBoundedRoot(scene, "0x0001ffff", null);
		const first = createBoundedRoot(scene, "0x0001ffff", "cell-1");
		const second = createBoundedRoot(scene, "0x0001ffff", "cell-2");
		upsertCrossing(
			scene,
			"one-to-two",
			envCellScope("0x0001ffff", "cell-1"),
			envCellScope("0x0001ffff", "cell-2"),
		);

		const visible = scene.queryFlatFrustum(
			TOPOLOGY_FRUSTUM,
			"0x0001ffff",
			INCLUDE_ALL_SCENE_CULLING_GROUPS,
		);

		expect(visible.entries).toEqual([outdoor, first, second]);
	});

	it("uses the identical culling result for flat and the same explicit scope set", () => {
		const scene = new SceneGraph();
		createBoundedRoot(scene, "0x0001ffff", null);
		createBoundedRoot(scene, "0x0001ffff", "cell-1");
		createBoundedRoot(scene, "0x0001ffff", "cell-2");
		const scopes = [
			outdoorScope(),
			envCellScope("0x0001ffff", "cell-1"),
			envCellScope("0x0001ffff", "cell-2"),
		];

		const flat = [
			...scene.queryFlatFrustum(
				TOPOLOGY_FRUSTUM,
				"0x0001ffff",
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		];
		const selected = [
			...scene.queryScopesFrustum(
				TOPOLOGY_FRUSTUM,
				"0x0001ffff",
				scopes,
				INCLUDE_ALL_SCENE_CULLING_GROUPS,
			).entries,
		];

		expect(selected).toEqual(flat);
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
	const visible = queryScopes(scene, { kind: "outdoor" }).entries.includes(
		nodeId,
	);
	if (!visible) throw new Error(`Scene node ${nodeId} is not visible.`);
	const placement = scene.getResolvedPlacement(nodeId);
	if (!placement) throw new Error(`Scene node ${nodeId} has no placement.`);
	return placement;
}

function queryScopes(scene: SceneGraph, ...scopes: readonly SceneScope[]) {
	return scene.queryScopesFrustum(
		TOPOLOGY_FRUSTUM,
		"0x0001ffff",
		scopes,
		INCLUDE_ALL_SCENE_CULLING_GROUPS,
	);
}

function createBoundedRoot(
	scene: SceneGraph,
	landblockId: string,
	envCellId: string | null,
): SceneNodeId {
	if (envCellId !== null) {
		scene.upsertEnvCellScope({
			containmentPlanes: new Float32Array(),
			landblockBounds: AABB3.zero(),
			potentiallyVisibleEnvCellIds: new Set(),
			scope: envCellScope(landblockId, envCellId),
			structureToLandblock: Mat4.identity(),
			seenOutside: false,
			visibilityIslandId: `env-cell-island:${envCellId}`,
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

function createEnvCellGroupedRoot(
	scene: SceneGraph,
	scope: Extract<SceneScope, { kind: "env-cell" }>,
	cullingGroup: string,
	localBounds = new AABB3(new Vec3(-1, -1, -5), new Vec3(1, 1, -3)),
): SceneNodeId {
	scene.upsertEnvCellScope({
		containmentPlanes: new Float32Array(),
		landblockBounds: localBounds,
		potentiallyVisibleEnvCellIds: new Set(),
		scope,
		structureToLandblock: Mat4.identity(),
		seenOutside: false,
		visibilityIslandId: `env-cell-island:${scope.envCellId}`,
	});
	return scene.createNode({
		cullingGroup,
		envCellId: scope.envCellId,
		landblockId: scope.landblockId,
		localBounds,
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
	aperture = portalAperture(id),
): void {
	const crossing: ScenePortalCrossingInput = {
		acceptedSide: "positive",
		exactMatch: true,
		id: `portal-crossing:${id}`,
		maskDepthPolicy: "allow-equal-depth",
		reciprocalCrossingId: null,
		source,
		sourceAperture: aperture,
		spatialRelationship: {
			kind: "indoor-topology-boundary",
			reason: "test-boundary",
		},
		target,
		visibilityAperture: aperture,
	};
	scene.upsertPortalCrossing(crossing);
}

function portalAperture(
	id: string,
): ScenePortalCrossingInput["sourceAperture"] {
	return {
		id: `portal-aperture:${id}` as const,
		indices: new Uint32Array([0, 1, 2]),
		landblockId: "0x0001ffff" as const,
		landblockBounds: AABB3.zero(),
		plane: { d: 0, normal: new Vec3(1, 0, 0) },
		vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
	};
}

describe("SceneGraph attachment dry run", () => {
	// Phase 4 gate for the object attachment parity plan. These exercise the shape an attached
	// entity will hold once `attachToPart` exists, using `createNode` to stand it up directly, so
	// the culling and residency claims are proved against a real node rather than by reading.

	it("culls a node under a parent part node through inherited residency", () => {
		const scene = new SceneGraph();
		const wielderRoot = scene.createNode({
			...rootInput,
			cullingGroup: "dynamic",
			localTransform: createTranslationMat4(new Vec3(10, 0, 0)),
		});
		const handPart = scene.createNode({
			localBounds: null,
			localTransform: createTranslationMat4(new Vec3(0, 2, 0)),
			parentId: wielderRoot,
		});
		const heldItem = scene.createNode({
			cullingGroup: "dynamic",
			localBounds: AABB3.zero(),
			localTransform: createTranslationMat4(new Vec3(0, 0, 1)),
			parentId: handPart,
		});

		// The item is selected by a scope query it never declared residency for: it inherits the
		// wielder's landblock and env cell, and its bounds reach the culling group aggregate.
		expect(visiblePlacement(scene, heldItem)).toMatchObject({
			envCellId: null,
			landblockId: rootPlacement.landblockId,
			scope: { kind: "outdoor" },
		});
		expect(
			getMat4Translation(
				scene.getResolvedPlacement(heldItem)!.localToLandblock,
				Vec3.zero(),
			),
		).toEqual(new Vec3(10, 2, 1));
	});

	it("moves an attached node with its wielder without touching the node itself", () => {
		const scene = new SceneGraph();
		const wielderRoot = scene.createNode({
			...rootInput,
			cullingGroup: "dynamic",
		});
		const handPart = scene.createNode({
			localBounds: null,
			localTransform: Mat4.identity(),
			parentId: wielderRoot,
		});
		const heldItem = scene.createNode({
			cullingGroup: "dynamic",
			localBounds: AABB3.zero(),
			localTransform: Mat4.identity(),
			parentId: handPart,
		});

		scene.updateRootPlacement(wielderRoot, {
			...rootPlacement,
			localTransform: createTranslationMat4(new Vec3(4, 5, 6)),
		});

		expect(
			getMat4Translation(
				scene.getResolvedPlacement(heldItem)!.localToLandblock,
				Vec3.zero(),
			),
		).toEqual(new Vec3(4, 5, 6));
		expect(queryScopes(scene, { kind: "outdoor" }).entries).toContain(heldItem);
	});

	it("keeps an attached node in its own culling group rather than its wielder's", () => {
		const scene = new SceneGraph();
		const wielderRoot = scene.createNode({
			...rootInput,
			cullingGroup: "dynamic",
		});
		const handPart = scene.createNode({
			localBounds: null,
			localTransform: Mat4.identity(),
			parentId: wielderRoot,
		});
		const heldItem = scene.createNode({
			cullingGroup: "held-item",
			localBounds: AABB3.zero(),
			localTransform: Mat4.identity(),
			parentId: handPart,
		});

		expect(scene.getCullingGroup(heldItem)).toBe("held-item");
		expect(queryScopes(scene, { kind: "outdoor" }).entries).toContain(heldItem);
	});

	it("requires a leaf before a node can leave the graph, so attach must move rather than recreate", () => {
		const scene = new SceneGraph();
		const itemRoot = createBoundedRoot(scene, rootPlacement.landblockId, null);
		const itemPart = scene.createNode({
			...boundedChildFields,
			parentId: itemRoot,
		});

		expect(() => scene.destroyNode(itemRoot)).toThrow("still has children");
		scene.destroyNode(itemPart);
		scene.destroyNode(itemRoot);
	});
});

describe("SceneGraph attach and detach transitions", () => {
	it("moves a root under a part node and inherits its residency", () => {
		const scene = new SceneGraph();
		const wielderRoot = scene.createNode({
			...rootInput,
			localTransform: createTranslationMat4(new Vec3(10, 0, 0)),
		});
		const handPart = scene.createNode({
			localBounds: null,
			localTransform: createTranslationMat4(new Vec3(0, 2, 0)),
			parentId: wielderRoot,
		});
		const item = createBoundedRoot(scene, "0x0002ffff", null);

		scene.attachToPart(
			item,
			handPart,
			createTranslationMat4(new Vec3(0, 0, 1)),
		);

		expect(scene.getNode(item)).toMatchObject({ parentId: handPart });
		expect(scene.getResolvedPlacement(item)).toMatchObject({
			envCellId: null,
			landblockId: rootPlacement.landblockId,
		});
		expect(
			getMat4Translation(
				scene.getResolvedPlacement(item)!.localToLandblock,
				Vec3.zero(),
			),
		).toEqual(new Vec3(10, 2, 1));
		expect(queryScopes(scene, { kind: "outdoor" }).entries).toContain(item);
	});

	it("restores independent residency on detach", () => {
		const scene = new SceneGraph();
		const wielderRoot = scene.createNode(rootInput);
		const handPart = scene.createNode({
			localBounds: null,
			localTransform: Mat4.identity(),
			parentId: wielderRoot,
		});
		const item = createBoundedRoot(scene, rootPlacement.landblockId, null);
		scene.attachToPart(item, handPart, Mat4.identity());

		scene.detachToPlacement(item, {
			envCellId: null,
			landblockId: "0x0002ffff",
			localTransform: createTranslationMat4(new Vec3(7, 8, 9)),
		});

		expect(scene.getNode(item)).toMatchObject({
			envCellId: null,
			landblockId: "0x0002ffff",
			parentId: null,
		});
		expect(scene.getResolvedPlacement(item)).toMatchObject({
			landblockId: "0x0002ffff",
		});
		// The wielder no longer owns it, so its transform no longer answers to the wielder's.
		scene.updateRootPlacement(wielderRoot, {
			...rootPlacement,
			localTransform: createTranslationMat4(new Vec3(100, 0, 0)),
		});
		expect(
			getMat4Translation(
				scene.getResolvedPlacement(item)!.localToLandblock,
				Vec3.zero(),
			),
		).toEqual(new Vec3(7, 8, 9));
	});

	it("re-attaches to a different attach point without recreating the node", () => {
		const scene = new SceneGraph();
		const wielderRoot = scene.createNode(rootInput);
		const rightHand = scene.createNode({
			localBounds: null,
			localTransform: createTranslationMat4(new Vec3(1, 0, 0)),
			parentId: wielderRoot,
		});
		const leftHand = scene.createNode({
			localBounds: null,
			localTransform: createTranslationMat4(new Vec3(-1, 0, 0)),
			parentId: wielderRoot,
		});
		const item = createBoundedRoot(scene, rootPlacement.landblockId, null);

		scene.attachToPart(item, rightHand, Mat4.identity());
		scene.detachToPlacement(item, rootPlacement);
		scene.attachToPart(item, leftHand, Mat4.identity());

		expect(scene.getNode(item)).toMatchObject({ parentId: leftHand });
		expect(
			getMat4Translation(
				scene.getResolvedPlacement(item)!.localToLandblock,
				Vec3.zero(),
			),
		).toEqual(new Vec3(-1, 0, 0));
	});

	it("refuses transitions that would break the root and child arms", () => {
		const scene = new SceneGraph();
		const wielderRoot = scene.createNode(rootInput);
		const handPart = scene.createNode({
			localBounds: null,
			localTransform: Mat4.identity(),
			parentId: wielderRoot,
		});
		const item = createBoundedRoot(scene, rootPlacement.landblockId, null);

		expect(() => scene.detachToPlacement(item, rootPlacement)).toThrow(
			"is not attached",
		);
		scene.attachToPart(item, handPart, Mat4.identity());
		expect(() => scene.attachToPart(item, handPart, Mat4.identity())).toThrow(
			"is already attached",
		);
	});

	it("refuses to attach a node to its own descendant", () => {
		const scene = new SceneGraph();
		const root = createBoundedRoot(scene, rootPlacement.landblockId, null);
		const descendant = scene.createNode({
			...boundedChildFields,
			parentId: root,
		});

		expect(() => scene.attachToPart(root, descendant, Mat4.identity())).toThrow(
			"its own descendant",
		);
	});

	it("keeps an attached subtree indexed under its new residency", () => {
		const scene = new SceneGraph();
		const wielderRoot = scene.createNode(rootInput);
		const handPart = scene.createNode({
			localBounds: null,
			localTransform: Mat4.identity(),
			parentId: wielderRoot,
		});
		const item = createBoundedRoot(scene, "0x0002ffff", null);
		const itemPart = scene.createNode({
			...boundedChildFields,
			parentId: item,
		});

		scene.attachToPart(item, handPart, Mat4.identity());

		const entries = queryScopes(scene, { kind: "outdoor" }).entries;
		expect(entries).toContain(item);
		expect(entries).toContain(itemPart);
		expect(scene.getResolvedPlacement(itemPart)).toMatchObject({
			landblockId: rootPlacement.landblockId,
		});
	});
});
