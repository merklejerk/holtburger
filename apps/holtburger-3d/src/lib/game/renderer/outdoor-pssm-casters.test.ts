import { describe, expect, it, vi } from "vitest";
import type { DynamicEntityPresentationClass } from "../dynamic-entity-presentation-class";
import type { Frustum } from "../math/frustum";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type { PreparedDynamicDepth } from "./dynamic-depth-preparation";
import type { RenderContribution } from "./render-world";
import type { EntityShadowCasterShape } from "./entity-grounding";
import { createDynamicDepthTestFixture } from "./dynamic-depth-test-fixture";
import {
	planOutdoorShadowCastersForView,
	createOutdoorPssmCasterBatch,
	createOutdoorPssmCasterSelectionScratch,
	type OutdoorPssmCasterWorld,
} from "./outdoor-pssm-casters";

const ANCHOR = "0x0001ffff";
const FRUSTUM: Frustum = { cameraPosition: Vec3.zero(), planes: [] };
const BUDGET = { maximumMappedRoots: 512, maximumSelectedRoots: 512 };
const node = (id: number) => `scene-node:${id}` as SceneNodeId;
const depth = (id: SceneNodeId) => createDynamicDepthTestFixture(id, ANCHOR, 3);

function metrics() {
	return {
		analyticRootCount: 0,
		candidateRootCount: 0,
		cascadeCandidateMembershipCount: 0,
		cascadeQueryCount: 0,
		selectedDepthDrawCount: 0,
		emptyMappedViewCount: 0,
		mappedRootCount: 0,
		rejectedRootCount: 0,
		selectedRootCount: 0,
		selectedPartCascadeCount: 0,
	};
}

describe("outdoor PSSM caster selection", () => {
	it("retains eligible outdoor whole roots, preserving the visual-scope and empty-geometry checks", () => {
		const [player, npc, other, indoor, empty] = [1, 2, 3, 4, 5].map(node);
		if (!player || !npc || !other || !indoor || !empty)
			throw new Error("Fixture requires five roots.");
		const presentations = new Map<SceneNodeId, PreparedDynamicDepth | null>([
			[player, depth(player)],
			[npc, depth(npc)],
			[other, depth(other)],
			[
				indoor,
				{
					...depth(indoor),
					renderScopes: [
						{ kind: "env-cell", envCellId: "0x00010100", landblockId: ANCHOR },
					],
				},
			],
			[empty, null],
		]);
		const getDynamicDepth = vi.fn((id: SceneNodeId) => {
			const found = presentations.get(id);
			if (found === undefined) throw new Error("Unknown fixture root.");
			return found;
		});
		const world: OutdoorPssmCasterWorld = {
			getDynamicDepth,
			getEntityShadowDynamicFacts: dynamicFacts,
			getRenderContributionDescriptor: (id) =>
				dynamicDescriptor(
					id === other
						? "other"
						: id === player
							? "player"
							: id === npc
								? "npc"
								: "mob",
				),
			queryScopesScene: (_frustum, anchor, scopes, filter) => {
				expect(anchor).toBe(ANCHOR);
				expect(scopes).toEqual([{ kind: "outdoor" }]);
				expect(filter("dynamic")).toBe(true);
				expect(filter("buildings")).toBe(false);
				return { entries: [player, npc, other, indoor, empty] };
			},
		};
		const selected = new Set<SceneNodeId>();
		const batch = createOutdoorPssmCasterBatch();
		const result = metrics();
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
			result,
		);
		expect(batch.casters).toEqual([
			presentations.get(player),
			presentations.get(npc),
		]);
		expect(selected).toEqual(new Set([player, npc]));
		expect(getDynamicDepth.mock.calls.map(([id]) => id)).toEqual([
			player,
			npc,
			indoor,
			empty,
		]);
		expect(result).toMatchObject({
			candidateRootCount: 4,
			mappedRootCount: 4,
			selectedPartCascadeCount: 2,
			selectedDepthDrawCount: 2,
		});
	});

	it("consumes reused scene storage and shares a root's prepared depth across overlapping cascades", () => {
		const first = node(10),
			shared = node(11),
			last = node(12);
		const entries = [first, shared];
		let queries = 0;
		const getDynamicDepth = vi.fn(depth);
		const world: OutdoorPssmCasterWorld = {
			getDynamicDepth,
			getEntityShadowDynamicFacts: dynamicFacts,
			getRenderContributionDescriptor: () => dynamicDescriptor("mob"),
			queryScopesScene: () => {
				if (queries++ === 1) entries.splice(0, 2, shared, last);
				return { entries };
			},
		};
		const batches = [
			createOutdoorPssmCasterBatch(),
			createOutdoorPssmCasterBatch(),
		];
		const result = metrics();
		planOutdoorShadowCastersForView(
			world,
			[FRUSTUM, FRUSTUM],
			FRUSTUM,
			ANCHOR,
			BUDGET,
			new Set(),
			[],
			true,
			batches,
			createOutdoorPssmCasterSelectionScratch(),
			result,
		);
		expect(getDynamicDepth.mock.calls.map(([id]) => id)).toEqual([
			first,
			shared,
			last,
		]);
		expect(batches[0]?.casters.map(({ nodeId }) => nodeId)).toEqual([
			first,
			shared,
		]);
		expect(batches[1]?.casters.map(({ nodeId }) => nodeId)).toEqual([
			shared,
			last,
		]);
		expect(batches[0]?.casters[1]).toBe(batches[1]?.casters[0]);
		entries.length = 0;
		expect(batches[0]?.casters).toHaveLength(2);
		expect(result).toMatchObject({
			candidateRootCount: 3,
			cascadeCandidateMembershipCount: 4,
			selectedPartCascadeCount: 4,
		});
	});

	it("tiers complete roots by camera membership, bounds distance, and stable identity", () => {
		const roots = [
			{ nodeId: node(30), identity: "d", x: -2 },
			{ nodeId: node(31), identity: "b", x: 5 },
			{ nodeId: node(32), identity: "a", x: 5 },
			{ nodeId: node(33), identity: "c", x: 10 },
		];
		const find = (id: SceneNodeId) => {
			const root = roots.find(({ nodeId }) => nodeId === id);
			if (root === undefined) throw new Error("Unknown root.");
			return root;
		};
		const getDynamicDepth = vi.fn(depth);
		const world: OutdoorPssmCasterWorld = {
			getDynamicDepth,
			getEntityShadowDynamicFacts: (id) => ({
				...dynamicFacts(id),
				identity: find(id).identity,
			}),
			getRenderContributionDescriptor: (id) => dynamicDescriptorAt(find(id).x),
			queryScopesScene: () => ({ entries: roots.map(({ nodeId }) => nodeId) }),
		};
		const analytic: EntityShadowCasterShape[] = [];
		const result = metrics();
		const selected = new Set<SceneNodeId>();
		planOutdoorShadowCastersForView(
			world,
			[FRUSTUM],
			{
				cameraPosition: Vec3.zero(),
				planes: [{ constant: 0, x: 1, y: 0, z: 0 }],
			},
			ANCHOR,
			{ maximumMappedRoots: 1, maximumSelectedRoots: 3 },
			selected,
			analytic,
			false,
			[createOutdoorPssmCasterBatch()],
			createOutdoorPssmCasterSelectionScratch(),
			result,
		);
		expect(getDynamicDepth.mock.calls.map(([id]) => id)).toEqual([node(32)]);
		expect(analytic.map(({ identity }) => identity)).toEqual(["b", "c"]);
		expect(selected).toEqual(new Set([node(31), node(32), node(33)]));
		expect(result).toMatchObject({
			analyticRootCount: 2,
			candidateRootCount: 4,
			mappedRootCount: 1,
			rejectedRootCount: 1,
			selectedRootCount: 3,
		});
	});
});

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
