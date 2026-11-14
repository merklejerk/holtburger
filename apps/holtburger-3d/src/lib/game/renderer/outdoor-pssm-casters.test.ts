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

describe("outdoor PSSM caster selection", () => {
	it("retains queried outdoor whole roots, preserving the visual-scope and empty-geometry checks", () => {
		const [player, npc, indoor, empty] = [1, 2, 4, 5].map(node);
		if (!player || !npc || !indoor || !empty)
			throw new Error("Fixture requires four roots.");
		const presentations = new Map<SceneNodeId, PreparedDynamicDepth | null>([
			[player, depth(player)],
			[npc, depth(npc)],
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
			hasOutdoorDynamicShadowGeometry: (id) => {
				const presentation = presentations.get(id);
				return (
					presentation?.renderScopes.some(
						(scope) => scope.kind === "outdoor",
					) ?? false
				);
			},
			getEntityShadowDynamicFacts: dynamicFacts,
			readRenderContribution: (id) =>
				dynamicDescriptor(
					id === player ? "player" : id === npc ? "npc" : "mob",
				),
			queryOutdoorShadowCasterMasks: (_frusta, anchor, out) => {
				expect(anchor).toBe(ANCHOR);
				for (const id of [player, npc, indoor, empty]) out.set(id, 1);
			},
		};
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
	});

	it("consumes reused scene storage and shares a root's prepared depth across overlapping cascades", () => {
		const first = node(10),
			shared = node(11),
			last = node(12);
		const getDynamicDepth = vi.fn(depth);
		const world: OutdoorPssmCasterWorld = {
			getDynamicDepth,
			hasOutdoorDynamicShadowGeometry: () => true,
			getEntityShadowDynamicFacts: dynamicFacts,
			readRenderContribution: () => dynamicDescriptor("mob"),
			queryOutdoorShadowCasterMasks: (_frusta, _anchor, out) => {
				out.set(first, 1);
				out.set(shared, 3);
				out.set(last, 2);
			},
		};
		const batches = [
			createOutdoorPssmCasterBatch(),
			createOutdoorPssmCasterBatch(),
		];

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
		expect(batches[0]?.casters).toHaveLength(2);
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
			hasOutdoorDynamicShadowGeometry: () => true,
			getEntityShadowDynamicFacts: (id) => ({
				...dynamicFacts(id),
				identity: find(id).identity,
			}),
			readRenderContribution: (id) => dynamicDescriptorAt(find(id).x),
			queryOutdoorShadowCasterMasks: (_frusta, _anchor, out) => {
				for (const root of roots) out.set(root.nodeId, 1);
			},
		};
		const analytic: EntityShadowCasterShape[] = [];

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
		);
		expect(getDynamicDepth.mock.calls.map(([id]) => id)).toEqual([node(32)]);
		expect(analytic.map(({ identity }) => identity)).toEqual(["b", "c"]);
		expect(selected).toEqual(new Set([node(31), node(32), node(33)]));
	});

	it("excludes non-opaque and non-outdoor roots from the analytic tier", () => {
		const roots = [
			{ nodeId: node(40), identity: "opaque-mapped", x: 2 },
			{ nodeId: node(41), identity: "non-opaque-analytic", x: 5 },
			{ nodeId: node(42), identity: "indoor-analytic", x: 6 },
			{ nodeId: node(43), identity: "opaque-analytic", x: 8 },
		];
		const presentations = new Map<SceneNodeId, PreparedDynamicDepth | null>([
			[node(40), depth(node(40))],
			[node(41), null],
			[
				node(42),
				{
					...depth(node(42)),
					renderScopes: [
						{ kind: "env-cell", envCellId: "0x00010100", landblockId: ANCHOR },
					],
				},
			],
			[node(43), depth(node(43))],
		]);
		const getDynamicDepth = vi.fn((id: SceneNodeId) => {
			const found = presentations.get(id);
			if (found === undefined) throw new Error("Unknown fixture root.");
			return found;
		});
		const find = (id: SceneNodeId) => {
			const root = roots.find(({ nodeId }) => nodeId === id);
			if (root === undefined) throw new Error("Unknown root.");
			return root;
		};
		const world: OutdoorPssmCasterWorld = {
			getDynamicDepth,
			hasOutdoorDynamicShadowGeometry: (id) => {
				const presentation = presentations.get(id);
				return (
					presentation?.renderScopes.some(
						(scope) => scope.kind === "outdoor",
					) ?? false
				);
			},
			getEntityShadowDynamicFacts: (id) => ({
				...dynamicFacts(id),
				identity: find(id).identity,
			}),
			readRenderContribution: (id) => dynamicDescriptorAt(find(id).x),
			queryOutdoorShadowCasterMasks: (_frusta, _anchor, out) => {
				for (const root of roots) out.set(root.nodeId, 1);
			},
		};
		const analytic: EntityShadowCasterShape[] = [];
		const selected = new Set<SceneNodeId>();
		planOutdoorShadowCastersForView(
			world,
			[FRUSTUM],
			FRUSTUM,
			ANCHOR,
			{ maximumMappedRoots: 1, maximumSelectedRoots: 4 },
			selected,
			analytic,
			false,
			[createOutdoorPssmCasterBatch()],
			createOutdoorPssmCasterSelectionScratch(),
		);
		expect(selected).toEqual(new Set([node(40), node(43)]));
		expect(analytic.map(({ identity }) => identity)).toEqual([
			"opaque-analytic",
		]);
	});

	it("does not keep an off-camera analytic caster alive for animation", () => {
		const visible = node(50);
		const offCamera = node(51);
		const selected = new Set<SceneNodeId>();
		const analytic: EntityShadowCasterShape[] = [];
		planOutdoorShadowCastersForView(
			{
				getDynamicDepth: depth,
				hasOutdoorDynamicShadowGeometry: () => true,
				getEntityShadowDynamicFacts: dynamicFacts,
				readRenderContribution: (id) =>
					dynamicDescriptorAt(id === visible ? 2 : -4),
				queryOutdoorShadowCasterMasks: (_frusta, _anchor, out) => {
					out.set(visible, 1);
					out.set(offCamera, 1);
				},
			},
			[FRUSTUM],
			{
				cameraPosition: Vec3.zero(),
				planes: [{ constant: 0, x: 1, y: 0, z: 0 }],
			},
			ANCHOR,
			{ maximumMappedRoots: 0, maximumSelectedRoots: 2 },
			selected,
			analytic,
			false,
			[createOutdoorPssmCasterBatch()],
			createOutdoorPssmCasterSelectionScratch(),
		);
		expect(analytic).toHaveLength(2);
		expect(selected).toEqual(new Set([visible]));
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
				transformRevision: 0,
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
