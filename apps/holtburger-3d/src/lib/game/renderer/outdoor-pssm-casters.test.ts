import { describe, expect, it } from "vitest";
import type { DynamicEntityPresentationClass } from "../dynamic-entity-presentation-class";
import type { ObjectGeometryKey } from "../geometry/types";
import type { Frustum } from "../math/frustum";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type {
	VisibleDynamicContributions,
	VisibleRigidDepthContribution,
} from "../systems/components";
import type { ObjectInstanceData } from "../systems/static-resources";
import type { RenderContribution } from "./render-world";
import type { EntityShadowCasterShape } from "./entity-grounding";
import {
	planOutdoorShadowCastersForView,
	createOutdoorPssmCasterBatch,
	createOutdoorPssmCasterSelectionScratch,
	formOutdoorPssmCasterRuns,
	OutdoorPssmDepthDrawCatalog,
	type OutdoorPssmCasterPart,
	type OutdoorPssmCasterWorld,
} from "./outdoor-pssm-casters";

const ANCHOR = "0x0001ffff";
const FRUSTUM: Frustum = { cameraPosition: Vec3.zero(), planes: [] };
const BUDGET = { maximumMappedRoots: 512, maximumSelectedRoots: 512 };

describe("outdoor PSSM caster selection", () => {
	it("consumes an outdoor dynamic query and retains only eligible visible outdoor parts", () => {
		const player = "scene-node:1" as SceneNodeId;
		const npc = "scene-node:2" as SceneNodeId;
		const other = "scene-node:3" as SceneNodeId;
		const indoorOnly = "scene-node:4" as SceneNodeId;
		const emptyMob = "scene-node:5" as SceneNodeId;
		const queryEntries = [player, npc, other, indoorOnly, emptyMob];
		const descriptors = new Map<SceneNodeId, RenderContribution>([
			[player, dynamicDescriptor("player")],
			[npc, dynamicDescriptor("npc")],
			[other, dynamicDescriptor("other")],
			[indoorOnly, dynamicDescriptor("mob")],
			[emptyMob, dynamicDescriptor("mob")],
		]);
		const contributions = new Map<SceneNodeId, VisibleDynamicContributions>([
			[player, visible([part(0)], "outdoor")],
			[npc, visible([part(1)], "outdoor")],
			[other, visible([part(2)], "outdoor")],
			[indoorOnly, visible([part(3)], "env-cell")],
			[emptyMob, visible([], "outdoor")],
		]);
		const observed: string[] = [];
		const world = createWorld(
			queryEntries,
			descriptors,
			contributions,
			observed,
		);
		const selected = new Set<SceneNodeId>();
		const batch = createOutdoorPssmCasterBatch();
		const scratch = createOutdoorPssmCasterSelectionScratch();
		const depthDraws = new OutdoorPssmDepthDrawCatalog();

		const metrics = collectionMetrics();
		planOutdoorShadowCastersForView(
			world,
			[FRUSTUM],
			FRUSTUM,
			ANCHOR,
			BUDGET,
			selected,
			[],
			false,
			[batch],
			scratch,
			depthDraws,
			metrics,
		);

		expect(observed).toEqual([
			"query:outdoor:true:false",
			"descriptor:scene-node:1",
			"descriptor:scene-node:2",
			"descriptor:scene-node:3",
			"descriptor:scene-node:4",
			"descriptor:scene-node:5",
			"expand:scene-node:1",
			"resolve:scene-node:1",
			"expand:scene-node:2",
			"resolve:scene-node:2",
			"expand:scene-node:4",
			"expand:scene-node:5",
		]);
		expect(batch.parts).toHaveLength(2);
		expect(batch.instances).toEqual([
			contributions.get(player)?.depth[0]?.instance,
			contributions.get(npc)?.depth[0]?.instance,
		]);
		expect(selected).toEqual(new Set([player, npc]));
		expect(metrics).toEqual({
			analyticRootCount: 0,
			candidateRootCount: 4,
			cascadeCandidateMembershipCount: 4,
			cascadeQueryCount: 1,
			compatibleDepthRunCount: 2,
			emptyMappedViewCount: 0,
			mappedRootCount: 4,
			rejectedRootCount: 0,
			selectedRootCount: 4,
			selectedCasterPartCount: 2,
		});
		const retainedPart = batch.parts[0];
		planOutdoorShadowCastersForView(
			world,
			[FRUSTUM],
			FRUSTUM,
			ANCHOR,
			BUDGET,
			selected,
			[],
			false,
			[batch],
			scratch,
			depthDraws,
			null,
		);
		expect(batch.parts[0]).toBe(retainedPart);
	});

	it("owns compact results before the next reused scene query", () => {
		const first = "scene-node:10" as SceneNodeId;
		const second = "scene-node:11" as SceneNodeId;
		const reusedEntries = [first];
		const descriptors = new Map<SceneNodeId, RenderContribution>([
			[first, dynamicDescriptor("mob")],
			[second, dynamicDescriptor("mob")],
		]);
		const contributions = new Map<SceneNodeId, VisibleDynamicContributions>([
			[first, visible([part(0)], "outdoor")],
			[second, visible([part(1)], "outdoor")],
		]);
		const world = createWorld(reusedEntries, descriptors, contributions, []);
		const selected = new Set<SceneNodeId>();
		const batch = createOutdoorPssmCasterBatch();

		planOutdoorShadowCastersForView(
			world,
			[FRUSTUM],
			FRUSTUM,
			ANCHOR,
			BUDGET,
			selected,
			[],
			false,
			[batch],
			createOutdoorPssmCasterSelectionScratch(),
			new OutdoorPssmDepthDrawCatalog(),
			null,
		);
		const firstInstance = batch.instances[0];
		reusedEntries[0] = second;

		expect(batch.instances).toEqual([firstInstance]);
		expect(selected).toEqual(new Set([first]));
	});

	it("consumes reused query storage and expands an overlapping root once", () => {
		const first = "scene-node:20" as SceneNodeId;
		const shared = "scene-node:21" as SceneNodeId;
		const second = "scene-node:22" as SceneNodeId;
		const firstFrustum = FRUSTUM;
		const secondFrustum: Frustum = {
			cameraPosition: new Vec3(1, 0, 0),
			planes: [],
		};
		const reusedEntries = [first, shared];
		const expansionCounts = new Map<SceneNodeId, number>();
		let queryIndex = 0;
		const world: OutdoorPssmCasterWorld = {
			expandDynamicContributions(nodeId) {
				expansionCounts.set(nodeId, (expansionCounts.get(nodeId) ?? 0) + 1);
				return {
					depth: [part(Number(nodeId.slice("scene-node:".length)))],
					kind: "visible",
					landblockId: ANCHOR,
					material: [],
					renderScopes: [{ kind: "outdoor" }],
				};
			},
			getRenderContributionDescriptor: () => dynamicDescriptor("mob"),
			getEntityShadowDynamicFacts: (nodeId) => dynamicFacts(nodeId),
			queryScopesScene() {
				if (queryIndex === 1) reusedEntries.splice(0, 2, shared, second);
				queryIndex += 1;
				return { entries: reusedEntries };
			},
			resolveGeometry: (key) =>
				`geometry-resource:${Number(key.slice("object-geometry:".length)) + 1}`,
		};
		const batches = [
			createOutdoorPssmCasterBatch(),
			createOutdoorPssmCasterBatch(),
		];

		const metrics = collectionMetrics();
		planOutdoorShadowCastersForView(
			world,
			[firstFrustum, secondFrustum],
			FRUSTUM,
			ANCHOR,
			BUDGET,
			new Set(),
			[],
			false,
			batches,
			createOutdoorPssmCasterSelectionScratch(),
			new OutdoorPssmDepthDrawCatalog(),
			metrics,
		);

		expect(expansionCounts).toEqual(
			new Map([
				[first, 1],
				[shared, 1],
				[second, 1],
			]),
		);
		expect(batches[0]?.parts).toHaveLength(2);
		expect(batches[1]?.parts).toHaveLength(2);
		expect(batches[0]?.parts[1]).toBe(batches[1]?.parts[0]);
		expect(metrics).toMatchObject({
			candidateRootCount: 3,
			cascadeCandidateMembershipCount: 4,
			mappedRootCount: 3,
			selectedCasterPartCount: 4,
		});
	});

	it("tiers complete roots by camera membership, bounds distance, and stable identity", () => {
		const roots = [
			{ identity: "d", nodeId: "scene-node:30" as SceneNodeId, x: -2 },
			{ identity: "b", nodeId: "scene-node:31" as SceneNodeId, x: 5 },
			{ identity: "a", nodeId: "scene-node:32" as SceneNodeId, x: 5 },
			{ identity: "c", nodeId: "scene-node:33" as SceneNodeId, x: 10 },
		];
		const rootFor = (nodeId: SceneNodeId) => {
			const root = roots.find((candidate) => candidate.nodeId === nodeId);
			if (root === undefined)
				throw new Error(`Unknown fixture root ${nodeId}.`);
			return root;
		};
		const expansions: SceneNodeId[] = [];
		const cameraFrustum: Frustum = {
			cameraPosition: Vec3.zero(),
			planes: [{ constant: 0, x: 1, y: 0, z: 0 }],
		};
		const world: OutdoorPssmCasterWorld = {
			expandDynamicContributions(nodeId) {
				expansions.push(nodeId);
				return visible(
					[part(Number(nodeId.slice("scene-node:".length)))],
					"outdoor",
				);
			},
			getEntityShadowDynamicFacts(nodeId) {
				const root = rootFor(nodeId);
				return {
					...dynamicFacts(nodeId),
					identity: root.identity,
				};
			},
			getRenderContributionDescriptor(nodeId) {
				const root = rootFor(nodeId);
				return dynamicDescriptorAt(root.x);
			},
			queryScopesScene: () => ({ entries: roots.map(({ nodeId }) => nodeId) }),
			resolveGeometry: (key) =>
				`geometry-resource:${Number(key.slice("object-geometry:".length)) + 1}`,
		};
		const analytic: EntityShadowCasterShape[] = [];
		const mapped = createOutdoorPssmCasterBatch();
		const metrics = collectionMetrics();

		planOutdoorShadowCastersForView(
			world,
			[FRUSTUM],
			cameraFrustum,
			ANCHOR,
			{ maximumMappedRoots: 1, maximumSelectedRoots: 3 },
			new Set(),
			analytic,
			false,
			[mapped],
			createOutdoorPssmCasterSelectionScratch(),
			new OutdoorPssmDepthDrawCatalog(),
			metrics,
		);

		expect(expansions).toEqual([rootFor("scene-node:32").nodeId]);
		expect(analytic.map(({ identity }) => identity)).toEqual(["b", "c"]);
		expect(metrics).toMatchObject({
			analyticRootCount: 2,
			candidateRootCount: 4,
			mappedRootCount: 1,
			rejectedRootCount: 1,
			selectedRootCount: 3,
		});
	});
});

describe("outdoor PSSM caster run formation", () => {
	it("groups separated compatible parts and splits consumed raster state", () => {
		const batch = createOutdoorPssmCasterBatch();
		const instances = batch.instances;
		const runs = batch.runs;
		batch.parts.push(
			casterPart(0, "geometry-resource:1", "back"),
			casterPart(1, "geometry-resource:2", "back"),
			casterPart(2, "geometry-resource:1", "back"),
			casterPart(3, "geometry-resource:1", "front"),
		);

		formOutdoorPssmCasterRuns(batch);
		const firstRun = batch.runs[0];

		expect(batch.instances).toBe(instances);
		expect(batch.runs).toBe(runs);
		expect(batch.instances).toEqual([
			batch.parts[0]?.instance,
			batch.parts[2]?.instance,
			batch.parts[1]?.instance,
			batch.parts[3]?.instance,
		]);
		expect(batch.runs).toMatchObject([
			{ firstInstance: 0, instanceCount: 2, geometry: "geometry-resource:1" },
			{ firstInstance: 2, instanceCount: 1, geometry: "geometry-resource:2" },
			{
				firstInstance: 3,
				instanceCount: 1,
				geometry: "geometry-resource:1",
				cullFace: "front",
			},
		]);
		formOutdoorPssmCasterRuns(batch);
		expect(batch.runs[0]).toBe(firstRun);
	});
});

function createWorld(
	queryEntries: SceneNodeId[],
	descriptors: ReadonlyMap<SceneNodeId, RenderContribution>,
	contributions: ReadonlyMap<SceneNodeId, VisibleDynamicContributions>,
	observed: string[],
): OutdoorPssmCasterWorld {
	let resolvingNode: SceneNodeId | null = null;
	return {
		expandDynamicContributions(nodeId) {
			observed.push(`expand:${nodeId}`);
			resolvingNode = nodeId;
			return contributions.get(nodeId) ?? visible([], "outdoor");
		},
		getRenderContributionDescriptor(nodeId) {
			observed.push(`descriptor:${nodeId}`);
			return descriptors.get(nodeId) ?? null;
		},
		getEntityShadowDynamicFacts(nodeId) {
			return dynamicFacts(nodeId);
		},
		queryScopesScene(frustum, anchor, scopes, filter) {
			expect(frustum).toBe(FRUSTUM);
			expect(anchor).toBe(ANCHOR);
			observed.push(
				`query:${scopes[0]?.kind}:${filter("dynamic")}:${filter("buildings")}`,
			);
			return { entries: queryEntries };
		},
		resolveGeometry(key) {
			if (resolvingNode === null)
				throw new Error("Resolve called before expansion.");
			observed.push(`resolve:${resolvingNode}`);
			return `geometry-resource:${Number(key.slice("object-geometry:".length)) + 1}`;
		},
	};
}

function dynamicFacts(nodeId: SceneNodeId) {
	return {
		identity: nodeId,
		rigidBounds: new AABB3(Vec3.zero(), new Vec3(1, 2, 1)),
		spatialMembership: { scopes: [{ kind: "outdoor" as const }] },
	};
}

function dynamicDescriptor(
	entityClass: DynamicEntityPresentationClass,
): RenderContribution {
	return {
		entityClass,
		footprint: {
			kind: "eligible",
			localBounds: AABB3.zero(),
			objectClass: "authored-dynamic",
			placement: {
				envCellId: null,
				landblockId: ANCHOR,
				localToLandblock: Mat4.identity(),
				scope: { kind: "outdoor" },
			},
		},
		kind: "dynamic",
	};
}

function dynamicDescriptorAt(x: number): RenderContribution {
	const descriptor = dynamicDescriptor("mob");
	if (descriptor.kind !== "dynamic")
		throw new Error("Expected dynamic fixture.");
	const localToLandblock = Mat4.identity();
	localToLandblock.m41 = x;
	return {
		...descriptor,
		footprint: {
			...descriptor.footprint,
			placement: { ...descriptor.footprint.placement, localToLandblock },
		},
	};
}

function part(partIndex: number): VisibleRigidDepthContribution {
	return {
		drawUnit: {
			cullFace: "back",
			geometry: `object-geometry:${partIndex}` as ObjectGeometryKey,
			indexCount: 3,
			indexStart: 0,
			retailVisibility: "normally-visible",
		},
		instance: instance(partIndex),
	};
}

function visible(
	depth: readonly VisibleRigidDepthContribution[],
	scope: "outdoor" | "env-cell",
): VisibleDynamicContributions {
	return {
		depth,
		kind: "visible",
		landblockId: ANCHOR,
		material: [],
		renderScopes:
			scope === "outdoor"
				? [{ kind: "outdoor" }]
				: [{ envCellId: "0x0100", kind: "env-cell", landblockId: ANCHOR }],
	};
}

function casterPart(
	translation: number,
	geometry: OutdoorPssmCasterPart["geometry"],
	cullFace: OutdoorPssmCasterPart["cullFace"],
): OutdoorPssmCasterPart {
	return {
		cullFace,
		depthBatchKey: `${geometry}/${cullFace}`,
		geometry,
		indexCount: 3,
		indexStart: 0,
		instance: instance(translation),
		landblockId: ANCHOR,
	};
}

function instance(translation: number): ObjectInstanceData {
	const sourceToLandblock = Mat4.identity();
	sourceToLandblock.m41 = translation;
	return {
		color: { a: 1, b: 1, g: 1, r: 1 },
		sourceToLandblock,
	};
}

function collectionMetrics() {
	return {
		analyticRootCount: 0,
		candidateRootCount: 0,
		cascadeCandidateMembershipCount: 0,
		cascadeQueryCount: 0,
		compatibleDepthRunCount: 0,
		emptyMappedViewCount: 0,
		mappedRootCount: 0,
		rejectedRootCount: 0,
		selectedRootCount: 0,
		selectedCasterPartCount: 0,
	};
}
