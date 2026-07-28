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
			scene.queryScopesFrustum(TEST_FRUSTUM, "0x0001ffff", [outdoorScope()])
				.entries,
		).toEqual([visible]);
		scene.updateBounds(
			hidden,
			new AABB3(new Vec3(-1, -1, -8), new Vec3(1, 1, -6)),
		);
		expect(
			scene.queryScopesFrustum(TEST_FRUSTUM, "0x0001ffff", [outdoorScope()])
				.entries,
		).toEqual([visible, hidden]);
		scene.destroyNode(hidden);
		expect(
			scene.queryScopesFrustum(TEST_FRUSTUM, "0x0001ffff", [outdoorScope()])
				.entries,
		).toEqual([visible]);
	});

	it("keeps culling groups independent within one landblock", () => {
		const scene = new SceneGraph();
		const terrain = createGroupedRoot(scene, "terrain");
		const staticNode = createGroupedRoot(scene, "static");

		expect(
			scene.queryScopesFrustum(TEST_FRUSTUM, "0x0001ffff", [outdoorScope()])
				.entries,
		).toEqual([terrain, staticNode]);
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

		const visible = scene.queryScopesFrustum(TEST_FRUSTUM, "0x0001ffff", [
			scope,
		]).entries;
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
			visibilityIslandId: "env-cell-island:0x01020001",
		});
		const point = createLandblockWorldOrigin("0x0102ffff").add(
			new Vec3(210, 5, -20),
		);

		expect(scene.queryEnvCellPointContainment("0x01020001", point)).toBe(true);
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

		const visible = scene.queryFlatFrustum(TOPOLOGY_FRUSTUM, "0x0001ffff");

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
			...scene.queryFlatFrustum(TOPOLOGY_FRUSTUM, "0x0001ffff").entries,
		];
		const selected = [
			...scene.queryScopesFrustum(TOPOLOGY_FRUSTUM, "0x0001ffff", scopes)
				.entries,
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
	return scene.queryScopesFrustum(TOPOLOGY_FRUSTUM, "0x0001ffff", scopes);
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
): void {
	const aperture = {
		id: `portal-aperture:${id}` as const,
		indices: new Uint32Array(),
		landblockId: "0x0001ffff" as const,
		landblockBounds: AABB3.zero(),
		plane: { d: 0, normal: new Vec3(1, 0, 0) },
		vertices: new Float32Array(),
	};
	const crossing: ScenePortalCrossingInput = {
		acceptedSide: "positive",
		exactMatch: true,
		id: `portal-crossing:${id}`,
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
