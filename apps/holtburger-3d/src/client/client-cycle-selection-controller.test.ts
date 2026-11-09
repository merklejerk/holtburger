import type { PrimaryCameraView } from "../lib/game/runtime/types";
import { sceneVec3 } from "../lib/assets/ac-frame";
import { datAssetId } from "../lib/game/runtime/dynamic-entity-presentation";
import type { LandblockOwnerId } from "../lib/game/game-types";
import { describe, expect, it, vi } from "vitest";
import {
	ClientEntityMirror,
	type ClientEntityFacts,
} from "./client-entity-mirror";
import {
	entityFacts,
	playerEntitySnapshot,
} from "./client-entity-mirror.test-support";
import { ClientEntitySelection } from "./client-entity-selection";
import {
	ClientCycleSelectionController,
	sampleCycleCandidates,
	type CycleCandidate,
	type CycleFilter,
	type CycleSelectionContext,
	type CycleSelectionPresentationFrame,
} from "./client-cycle-selection-controller";
import {
	DynamicEntityMirror,
	cellId,
	type DynamicEntityView,
} from "../lib/game/runtime/dynamic-entity-feed";
import {
	realizedSelectionFrame,
	targetingEntity,
	TARGETING_TEST_VIEW,
} from "./client-targeting.test-support";
import { AABB3, Mat4, Quat, Vec3 } from "../lib/game/math/types";

const PEACE_CONTEXT: CycleSelectionContext = {
	combatMode: "peace",
	partyMembers: new Set(),
};
const POLICY = {
	radiusMeters: 20,
	viewMarginMeters: 2,
	forwardHalfSpaceRearOffsetMeters: 0.5,
	initialDistanceBandMeters: 5,
	immediateMaxAngleDegrees: 15,
};
function candidate(
	guid: number,
	distance: number,
	forwardAlignment = 1,
	filter: CycleFilter = "smart-combat",
): CycleCandidate {
	return {
		guid,
		distanceSquared: distance ** 2,
		distanceBand: Math.floor(
			Math.log2(1 + distance / POLICY.initialDistanceBandMeters),
		),
		forwardAlignment,
		smartImmediate:
			filter === "smart-combat" &&
			distance < POLICY.initialDistanceBandMeters &&
			forwardAlignment >=
				Math.cos((POLICY.immediateMaxAngleDegrees * Math.PI) / 180)
				? { distanceSquared: distance ** 2 }
				: null,
		filters: { [filter]: "cycle" },
	};
}
function worldObject(
	guid: number,
	distance: number,
	alignment = 1,
): CycleCandidate {
	return candidate(guid, distance, alignment, "non-creature");
}
function fixture() {
	const entities = new ClientEntityMirror();
	entities.commit(entities.prepareSnapshot(playerEntitySnapshot(1), 1));
	const selection = new ClientEntitySelection({
		lifecycle: { entities, subscribe: () => () => {} },
		presentation: () => null,
	});
	let candidates: readonly CycleCandidate[] | null = [];
	const sample = vi.fn(() => candidates);
	const cycle = new ClientCycleSelectionController({ selection, sample });
	return {
		selection,
		cycle,
		sample,
		set: (next: readonly CycleCandidate[] | null) => {
			candidates = next;
		},
	};
}

describe("immediate target traversal", () => {
	it.each(
		(["smart-combat", "non-creature", "unopened-corpse"] as const).flatMap(
			(filter) =>
				(["tap", "hold"] as const).map((action) => ({ filter, action })),
		),
	)(
		"$filter $action acquires the immediate, then traverses the remaining targets in ranked order",
		({ filter, action }) => {
			const f = fixture();
			const aligned = candidate(
				2,
				POLICY.initialDistanceBandMeters * 0.9,
				1,
				filter,
			);
			const immediate = candidate(
				3,
				POLICY.initialDistanceBandMeters * 0.7,
				0.98,
				filter,
			);
			const farther = candidate(
				4,
				POLICY.initialDistanceBandMeters * 1.5,
				1,
				filter,
			);
			f.set([farther, immediate, aligned]);
			if (action === "tap") f.cycle.cycle(filter, 1);
			else f.cycle.selectImmediate(filter);
			expect(f.selection.selectedGuid()).toBe(immediate.guid);
			for (const target of [aligned, farther, immediate]) {
				f.cycle.cycle(filter, 1);
				expect(f.selection.selectedGuid()).toBe(target.guid);
			}
			// Reverse traversal follows the same ring back through every target.
			for (const target of [farther, aligned, immediate]) {
				f.cycle.cycle(filter, -1);
				expect(f.selection.selectedGuid()).toBe(target.guid);
			}
		},
	);
	it.each([1, 1.4, 3.2])(
		"skips an immediate-only door at %s band widths even when the innermost band is empty",
		(distanceInBandWidths) => {
			const f = fixture();
			const distance = POLICY.initialDistanceBandMeters * distanceInBandWidths;
			f.set([
				{
					...candidate(2, distance),
					filters: { "smart-combat": "immediate-only" },
				},
				candidate(3, distance * 2),
			]);
			f.cycle.selectImmediate("smart-combat");
			expect(f.selection.selectedGuid()).toBeNull();
			f.cycle.cycle("smart-combat", 1);
			expect(f.selection.selectedGuid()).toBe(3);
			f.cycle.cycle("smart-combat", -1);
			expect(f.selection.selectedGuid()).toBe(3);
		},
	);
	it.each([0.4, 1.4])(
		"starts traversal in the nearest occupied band at %s band widths when only a farther band has a cone target",
		(distanceInBandWidths) => {
			const f = fixture();
			const nearby = candidate(
				2,
				POLICY.initialDistanceBandMeters * distanceInBandWidths,
				0.5,
			);
			const farther = candidate(3, POLICY.initialDistanceBandMeters * 3.2);
			f.set([farther, nearby]);
			f.cycle.cycle("smart-combat", 1);
			expect(f.selection.selectedGuid()).toBe(nearby.guid);
			// A hold has no immediate to acquire and must retain the current selection.
			f.cycle.selectImmediate("smart-combat");
			expect(f.selection.selectedGuid()).toBe(nearby.guid);
			f.cycle.cycle("smart-combat", 1);
			expect(f.selection.selectedGuid()).toBe(farther.guid);
		},
	);
	it.each(["non-creature", "unopened-corpse"] as const)(
		"%s acquires the nearest target behind, beside, or coincident with the player",
		(filter) => {
			for (const [distance, alignment] of [
				[POLICY.initialDistanceBandMeters * 0.1, -1],
				[POLICY.initialDistanceBandMeters * 0.1, 0],
				[0, 0],
			] as const) {
				for (const action of ["forward", "reverse", "hold"] as const) {
					const f = fixture();
					f.set([
						candidate(2, POLICY.initialDistanceBandMeters * 0.2, 1, filter),
						candidate(3, distance, alignment, filter),
					]);
					if (action === "hold") f.cycle.selectImmediate(filter);
					else f.cycle.cycle(filter, action === "forward" ? 1 : -1);
					expect(f.selection.selectedGuid()).toBe(3);
					f.cycle.cycle(filter, 1);
					expect(f.selection.selectedGuid()).toBe(2);
				}
			}
		},
	);
	it.each(["tap", "hold"] as const)(
		"%s acquires an immediate-only door ahead of a better-aligned creature in the innermost band",
		(action) => {
			const f = fixture();
			const door = candidate(2, POLICY.initialDistanceBandMeters * 0.7, 0.98);
			const creature = candidate(3, POLICY.initialDistanceBandMeters * 0.9);
			f.set([
				creature,
				{
					...door,
					filters: {
						"smart-combat": "immediate-only",
						"non-creature": "cycle",
					},
				},
			]);
			if (action === "tap") f.cycle.cycle("smart-combat", 1);
			else f.cycle.selectImmediate("smart-combat");
			expect(f.selection.selectedGuid()).toBe(door.guid);
			f.cycle.cycle("smart-combat", 1);
			expect(f.selection.selectedGuid()).toBe(creature.guid);
		},
	);
	it("breaks equal acquisition distances by alignment, then GUID", () => {
		const f = fixture();
		const distance = POLICY.initialDistanceBandMeters * 0.5;
		f.set([
			candidate(2, distance, 0.98),
			candidate(4, distance),
			candidate(3, distance),
		]);
		f.cycle.selectImmediate("smart-combat");
		expect(f.selection.selectedGuid()).toBe(3);
	});
	it("acquires a changed immediate after traversing beyond the previous winner", () => {
		const f = fixture();
		const distance = POLICY.initialDistanceBandMeters * 0.5;
		f.set([
			candidate(2, distance),
			candidate(3, distance * 1.2),
			candidate(4, distance * 1.4),
		]);
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		f.set([
			candidate(2, distance * 0.8),
			candidate(3, distance * 1.2),
			candidate(4, distance * 0.6),
		]);
		f.cycle.cycle("smart-combat", -1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.cycle.selectImmediate("smart-combat");
		expect(f.selection.selectedGuid()).toBe(4);
	});
	it.each([1, -1] as const)(
		"cycles outside the cone without an immediate in direction %s",
		(direction) => {
			const f = fixture();
			f.set([candidate(2, 6, 0.5), candidate(3, 8, 0.4)]);
			f.selection.select(9);
			f.cycle.selectImmediate("smart-combat");
			expect(f.selection.selectedGuid()).toBe(9);
			f.cycle.cycle("smart-combat", direction);
			expect(f.selection.selectedGuid()).toBe(direction === 1 ? 2 : 3);
			f.cycle.cycle("smart-combat", direction);
			expect(f.selection.selectedGuid()).toBe(direction === 1 ? 3 : 2);
			f.set([candidate(2, 6, 0.5), candidate(3, 8, 0.4), candidate(4, 10)]);
			f.cycle.cycle("smart-combat", direction);
			expect(f.selection.selectedGuid()).toBe(4);
		},
	);
	it("excludes immediate-only candidates outside the cone from holds and traversal", () => {
		const f = fixture();
		f.set([
			{ ...candidate(2, 1, 0), filters: { "smart-combat": "immediate-only" } },
			candidate(3, 8, 0.5),
		]);
		f.cycle.selectImmediate("smart-combat");
		expect(f.selection.selectedGuid()).toBeNull();
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(3);
	});
	it("continues from the cursor when the immediate leaves the cone", () => {
		const f = fixture();
		const others = [
			candidate(2, 3, 0.5),
			candidate(3, 6, 0.5),
			candidate(5, 18, 0.5),
		];
		f.set([...others, candidate(4, 4)]);
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(2);
		f.set([...others, candidate(4, 4, 0.5)]);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(4);
	});
	it.each(["smart-combat", "non-creature", "unopened-corpse"] as const)(
		"orders %s by band, alignment, distance, and GUID, wrapping in either direction",
		(filter) => {
			const f = fixture();
			f.set([
				candidate(5, 8, 0.9, filter),
				candidate(4, 7, 0.9, filter),
				candidate(3, 7, 0.9, filter),
				candidate(2, 6, 0.5, filter),
				candidate(6, 16, 1, filter),
				candidate(7, 4, -1, filter),
			]);
			const expected = [7, 3, 4, 5, 2, 6, 7];
			for (const guid of expected) {
				f.cycle.cycle(filter, 1);
				expect(f.selection.selectedGuid()).toBe(guid);
			}
			f.cycle.cycle(filter, -1);
			expect(f.selection.selectedGuid()).toBe(6);
		},
	);
	it.each([1, -1] as const)(
		"acquires a new immediate after movement reorders the ring in direction %s",
		(direction) => {
			const f = fixture();
			f.set([
				candidate(2, POLICY.initialDistanceBandMeters * 0.6),
				candidate(3, POLICY.initialDistanceBandMeters * 0.8),
				candidate(4, POLICY.initialDistanceBandMeters * 0.9),
			]);
			f.cycle.cycle("smart-combat", direction);
			expect(f.selection.selectedGuid()).toBe(2);
			f.set([
				candidate(2, POLICY.initialDistanceBandMeters * 0.8),
				candidate(3, POLICY.initialDistanceBandMeters * 0.6),
				candidate(4, POLICY.initialDistanceBandMeters * 0.9),
			]);
			f.cycle.cycle("smart-combat", direction);
			expect(f.selection.selectedGuid()).toBe(3);
			f.cycle.cycle("smart-combat", direction);
			expect(f.selection.selectedGuid()).toBe(direction === 1 ? 2 : 4);
			f.selection.select(4);
			f.set([
				candidate(2, POLICY.initialDistanceBandMeters * 0.6, 0.5),
				candidate(3, POLICY.initialDistanceBandMeters * 0.8, 0.5),
				candidate(4, POLICY.initialDistanceBandMeters * 0.9),
			]);
			f.cycle.cycle("smart-combat", direction);
			expect(f.selection.selectedGuid()).toBe(direction === 1 ? 2 : 3);
		},
	);
	it.each([1, -1] as const)(
		"advances when the changed immediate is already selected, direction %s",
		(direction) => {
			const f = fixture();
			f.set([
				candidate(2, POLICY.initialDistanceBandMeters * 0.6),
				candidate(3, POLICY.initialDistanceBandMeters * 0.8),
				candidate(4, POLICY.initialDistanceBandMeters * 0.9),
			]);
			f.cycle.cycle("smart-combat", 1);
			f.cycle.cycle("smart-combat", 1);
			f.set([
				candidate(2, POLICY.initialDistanceBandMeters * 0.6, 0.5),
				candidate(3, POLICY.initialDistanceBandMeters * 0.8),
				candidate(4, POLICY.initialDistanceBandMeters * 0.9),
			]);
			f.cycle.cycle("smart-combat", direction);
			expect(f.selection.selectedGuid()).toBe(direction === 1 ? 4 : 2);
		},
	);
	it("rebuilds non-immediate ordering without resetting for movement", () => {
		const f = fixture();
		f.set([candidate(2, 6), candidate(3, 8, 0.8), candidate(4, 10, 0.6)]);
		f.cycle.cycle("smart-combat", 1);
		f.set([candidate(2, 6), candidate(3, 8, 0.6), candidate(4, 10, 0.8)]);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.set([candidate(2, 16), candidate(3, 18, 0.6), candidate(4, 20, 0.8)]);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(3);
	});
	it("shares the cursor across filters and reacquires when it is absent from a filter", () => {
		const f = fixture();
		const objects: CycleCandidate[] = [
			{
				...worldObject(2, 6),
				filters: { "non-creature": "cycle", "smart-combat": "cycle" },
			},
			{
				...worldObject(3, 8),
				filters: { "non-creature": "cycle", "smart-combat": "cycle" },
			},
			worldObject(4, 10),
		];
		f.set(objects);
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("non-creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("non-creature", 1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.set([...objects, candidate(5, 4)]);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(5);
		f.cycle.cycle("non-creature", 1);
		expect(f.selection.selectedGuid()).toBe(2);
		f.cycle.cycle("non-creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
	});
	it("reacquires immediate when the cursor disappears", () => {
		const f = fixture();
		f.set([
			candidate(2, POLICY.initialDistanceBandMeters * 0.6),
			candidate(3, POLICY.initialDistanceBandMeters * 0.8),
			candidate(4, POLICY.initialDistanceBandMeters * 0.9),
		]);
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		f.set([
			candidate(2, POLICY.initialDistanceBandMeters * 0.6),
			candidate(4, POLICY.initialDistanceBandMeters * 0.9),
		]);
		f.cycle.cycle("smart-combat", -1);
		expect(f.selection.selectedGuid()).toBe(2);
	});
	it("retains selection for empty or unavailable samples and reacquires a returning immediate", () => {
		const f = fixture();
		f.set([
			candidate(2, POLICY.initialDistanceBandMeters * 0.6),
			candidate(3, POLICY.initialDistanceBandMeters * 0.8),
		]);
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		for (const empty of [[], null] as const) {
			f.set(empty);
			f.cycle.cycle("smart-combat", 1);
			expect(f.selection.selectedGuid()).toBe(3);
		}
		f.set([
			candidate(2, POLICY.initialDistanceBandMeters * 0.6),
			candidate(3, POLICY.initialDistanceBandMeters * 0.8),
		]);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(2);
	});
	it("retains a sole target and advances after an alternative arrives", () => {
		const f = fixture();
		f.set([candidate(2, 6)]);
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", -1);
		expect(f.selection.selectedGuid()).toBe(2);
		f.set([candidate(2, 6), candidate(3, 8)]);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(3);
	});
	it("external intent restarts acquisition without changing selection", () => {
		const f = fixture();
		f.set([candidate(2, 6), candidate(3, 8), candidate(4, 10)]);
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		f.selection.select(3);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(2);
	});
	it("hold selects nearest inside the cone and seeds the next tap", () => {
		const f = fixture();
		f.set([
			candidate(2, POLICY.initialDistanceBandMeters * 0.6, 0.5),
			candidate(3, POLICY.initialDistanceBandMeters * 0.8),
			candidate(4, POLICY.initialDistanceBandMeters * 0.9),
		]);
		f.cycle.selectImmediate("smart-combat");
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.cycle.destroy();
		f.cycle.selectImmediate("smart-combat");
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(4);
		expect(f.sample).toHaveBeenCalledTimes(2);
	});
});

describe("smart combat stance policy", () => {
	const records = [
		{ guid: 2, category: "other", use: "unsupported", distance: 1 },
		{ guid: 3, category: "player", use: "direct", distance: 2 },
		{ guid: 4, category: "mob", use: "direct", distance: 3 },
		{ guid: 5, category: "npc", use: "direct", distance: 4 },
		{ guid: 6, category: "player", use: "direct", distance: 6 },
		{ guid: 7, category: "player", use: "direct", distance: 7 },
		{ guid: 8, category: "other", use: "direct", distance: 8 },
		{ guid: 9, category: "other", use: "direct", distance: 9 },
	] as const;
	function scenario(
		combatMode: CycleSelectionContext["combatMode"],
		smartTabHostileOnly = false,
	) {
		const f = fixture();
		const entities = new ClientEntityMirror();
		entities.commit(
			entities.prepareSnapshot(
				{
					...playerEntitySnapshot(1),
					entities: [
						entityFacts(1),
						...records.map((record) => {
							const facts = entityFacts(record.guid, {
								playerThreat: record.guid === 7,
								targeting:
									record.category === "other" ? "non-creature" : "creature",
								corpse: record.guid === 9 ? "unopened" : null,
							});
							if (facts.description.kind !== "known")
								throw new Error("Fixture needs known facts.");
							return {
								...facts,
								description: {
									...facts.description,
									mapCategory: record.category,
									useCapability: record.use,
								},
							};
						}),
					],
				},
				1,
			),
		);
		const motion = new DynamicEntityMirror();
		motion.prepareSnapshot({
			entities: [
				targetingEntity(1, 1),
				...records.map((record) => {
					const entity = targetingEntity(record.guid, 1);
					entity.placement.pose.coords.y = record.distance;
					return entity;
				}),
			],
			hostTime: { seconds: 0 },
		})();
		const context: CycleSelectionContext = {
			combatMode,
			partyMembers: new Set([6]),
		};
		const refresh = (next = context) =>
			f.set(
				sampleCycleCandidates(
					entities,
					motion,
					realizedSelectionFrame(
						TARGETING_TEST_VIEW,
						[...motion.currentEntities()].map((entity) => ({
							entity,
							bounds: new AABB3(
								new Vec3(-0.25, -0.25, -0.25),
								new Vec3(0.25, 0.25, 0.25),
							),
						})),
					),
					POLICY,
					{ targetOnlyInView: true, smartTabHostileOnly },
					next,
				),
			);
		refresh();
		return { ...f, context, refresh, motion };
	}
	it.each(["peace", "melee", "missile", "magic", "unknown"] as const)(
		"hostile-only targeting excludes friendly players, NPCs, and objects in %s stance",
		(mode) => {
			const f = scenario(mode, true);
			f.cycle.selectImmediate("smart-combat");
			expect(f.selection.selectedGuid()).toBe(4);
			for (const guid of [7, 4, 7]) {
				f.cycle.cycle("smart-combat", 1);
				expect(f.selection.selectedGuid()).toBe(guid);
			}
			f.cycle.cycle("non-creature", 1);
			expect(f.selection.selectedGuid()).toBe(2);
			f.cycle.cycle("unopened-corpse", 1);
			expect(f.selection.selectedGuid()).toBe(9);
		},
	);

	it.each([
		["peace", [2, 3, 4, 5, 6, 7, 8, 2]],
		["unknown", [2, 3, 4, 5, 6, 7, 8, 2]],
		["melee", [2, 4, 5, 7, 8, 2]],
		["missile", [2, 4, 5, 7, 8, 2]],
		["magic", [2, 4, 5, 6, 7, 8, 2]],
	] as const)(
		"%s preserves NPCs, usable objects and threats while restricting other players",
		(mode, expected) => {
			const f = scenario(mode);
			for (const guid of expected) {
				f.cycle.cycle("smart-combat", 1);
				expect(f.selection.selectedGuid()).toBe(guid);
			}
		},
	);
	it("acquires a newly immediate-only player before resuming traversal", () => {
		const f = scenario("melee");
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(4);
		const moved = targetingEntity(2, 1);
		moved.placement.pose.coords.y = 10;
		f.motion.apply({ kind: "upserted", entity: moved });
		f.refresh();
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(4);
	});
	it("stance changes alter traversal on the next operation", () => {
		const f = scenario("melee");
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		f.refresh();
		const magic: CycleSelectionContext = {
			combatMode: "magic",
			partyMembers: new Set([6]),
		};
		f.refresh(magic);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(6);
		// Re-sampling melee drops the party exception again without changing immediate.
		f.refresh();
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(2);
	});
	it("party membership changes alter magic traversal without resetting the immediate", () => {
		const f = scenario("magic");
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(5);
		f.refresh({ combatMode: "magic", partyMembers: new Set() });
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(7);
		f.refresh({ combatMode: "magic", partyMembers: new Set([6]) });
		f.cycle.cycle("smart-combat", -1);
		expect(f.selection.selectedGuid()).toBe(6);
	});
});

/** Semantic sampling fixture with an explicit realized box population, independent of accepted facts. */
function volumeScene(
	facts: readonly ClientEntityFacts[],
	realized: readonly {
		readonly entity: DynamicEntityView;
		readonly bounds: AABB3;
	}[],
) {
	const entities = new ClientEntityMirror();
	entities.commit(
		entities.prepareSnapshot(
			{ ...playerEntitySnapshot(1), entities: [entityFacts(1), ...facts] },
			1,
		),
	);
	const motion = new DynamicEntityMirror();
	motion.prepareSnapshot({
		entities: [targetingEntity(1, 1), ...realized.map(({ entity }) => entity)],
		hostTime: { seconds: 0 },
	})();
	return {
		entities,
		motion,
		sample: (
			preferences = { targetOnlyInView: true, smartTabHostileOnly: false },
			policy = POLICY,
			view: PrimaryCameraView | null = TARGETING_TEST_VIEW,
			frame: CycleSelectionPresentationFrame = realizedSelectionFrame(
				view,
				realized,
			),
		) =>
			sampleCycleCandidates(
				entities,
				motion,
				frame,
				policy,
				preferences,
				PEACE_CONTEXT,
			),
	};
}

/** Render-axis offset for a realized synthetic part; part bounds are intentionally explicit. */
function boxEntity(
	guid: number,
	x: number,
	y: number,
	z: number,
	bounds: AABB3,
) {
	const entity = targetingEntity(guid, 1);
	entity.placement.pose.coords = { x, y: -z, z: y };
	return { entity, bounds };
}

const BODY_BOX = new AABB3(new Vec3(-0.25, 0, -0.25), new Vec3(0.25, 1, 0.25));
function doorFacts(
	guid: number,
	mapCategory: "door" | "door-no-direct-use" = "door",
): ClientEntityFacts {
	const facts = entityFacts(guid);
	if (facts.description.kind !== "known")
		throw new Error("Door fixture needs known facts.");
	return { ...facts, description: { ...facts.description, mapCategory } };
}

describe("realized volume candidate sampling", () => {
	it("selects a close door whose surface reaches the cone even when its origin does not", () => {
		const width = POLICY.initialDistanceBandMeters;
		const door = boxEntity(
			2,
			width * 0.2,
			0,
			-width * 0.2,
			new AABB3(
				new Vec3(-width * 0.3, 0, -width * 0.01),
				new Vec3(width * 0.3, 2, width * 0.01),
			),
		);
		const npc = boxEntity(3, 0, 0, -width * 0.7, BODY_BOX);
		const f = volumeScene(
			[doorFacts(2), entityFacts(3, { targeting: "creature" })],
			[door, npc],
		);
		const sampled = f.sample();
		expect(
			sampled?.find((c) => c.guid === 2)?.smartImmediate?.distanceSquared,
		).toBeCloseTo((width * 0.19) ** 2);

		const selection = fixture();
		selection.set(sampled);
		selection.cycle.cycle("smart-combat", 1);
		expect(selection.selection.selectedGuid()).toBe(2);
		selection.cycle.cycle("smart-combat", 1);
		expect(selection.selection.selectedGuid()).toBe(3);
	});
	it.each(["door", "door-no-direct-use"] as const)(
		"keeps %s immediate-only while preserving ordinary object cycling",
		(category) => {
			const width = POLICY.initialDistanceBandMeters;
			const door = boxEntity(
				2,
				0,
				0,
				-width,
				new AABB3(new Vec3(-1, 0, 0), new Vec3(1, 2, 0)),
			);
			const f = volumeScene(
				[doorFacts(2, category), entityFacts(3, { targeting: "creature" })],
				[door, boxEntity(3, 0, 0, -width * 2, BODY_BOX)],
			);
			const candidates = f.sample();
			const fcycle = fixture();
			fcycle.set(candidates);
			expect(candidates?.find((c) => c.guid === 2)?.smartImmediate).toBeNull();
			fcycle.cycle.selectImmediate("smart-combat");
			expect(fcycle.selection.selectedGuid()).toBeNull();
			fcycle.cycle.cycle("smart-combat", 1);
			expect(fcycle.selection.selectedGuid()).toBe(3);
			fcycle.cycle.cycle("smart-combat", -1);
			expect(fcycle.selection.selectedGuid()).toBe(3);
			fcycle.cycle.cycle("non-creature", 1);
			expect(fcycle.selection.selectedGuid()).toBe(2);
		},
	);
	it("does not join proximity from one part with cone admission from another", () => {
		const width = POLICY.initialDistanceBandMeters;
		const entity = targetingEntity(2, 1);
		const near = Mat4.identity();
		near.m41 = width * 0.2;
		near.m43 = -width * 0.05;
		const far = Mat4.identity();
		far.m43 = -width * 1.5;
		const small = new AABB3(
			new Vec3(-width * 0.01, 0, -width * 0.01),
			new Vec3(width * 0.01, 1, width * 0.01),
		);
		const f = volumeScene([doorFacts(2)], []);
		const candidates = f.sample(
			{ targetOnlyInView: false, smartTabHostileOnly: false },
			POLICY,
			TARGETING_TEST_VIEW,
			{
				view: TARGETING_TEST_VIEW,
				visitRealizedEntitySelectionBounds: (visit) =>
					visit(entity, {
						landblockId: datAssetId(0x0000ffff) as LandblockOwnerId,
						sourceToLandblock: near,
						parts: [
							{ localBounds: small, sourceToLandblock: near },
							{ localBounds: small, sourceToLandblock: far },
						],
					}),
			},
		);
		expect(candidates?.[0]?.distanceBand).toBe(0);
		expect(candidates?.[0]?.smartImmediate).toBeNull();
	});
	it("requires the immediate point itself to pass the view restriction", () => {
		const front = Mat4.identity();
		front.m43 = -POLICY.initialDistanceBandMeters * 0.5;
		const back = Mat4.identity();
		back.m43 = POLICY.initialDistanceBandMeters * 0.5;
		const view = {
			...TARGETING_TEST_VIEW,
			camera: {
				...TARGETING_TEST_VIEW.camera,
				placement: {
					...TARGETING_TEST_VIEW.camera.placement,
					rotation: new Quat(0, 0, 1, 0),
				},
			},
		};
		const f = volumeScene([doorFacts(2)], []);
		const frame: CycleSelectionPresentationFrame = {
			view,
			visitRealizedEntitySelectionBounds: (visit) =>
				visit(targetingEntity(2, 1), {
					landblockId: datAssetId(0x0000ffff) as LandblockOwnerId,
					sourceToLandblock: front,
					parts: [
						{ localBounds: BODY_BOX, sourceToLandblock: front },
						{ localBounds: BODY_BOX, sourceToLandblock: back },
					],
				}),
		};
		// A rear offset admitting the visible back part isolates view admission from cone admission.
		const sampled = f.sample(
			{ targetOnlyInView: true, smartTabHostileOnly: false },
			{
				...POLICY,
				forwardHalfSpaceRearOffsetMeters: POLICY.initialDistanceBandMeters,
			},
			view,
			frame,
		);
		expect(sampled?.[0]?.filters["smart-combat"]).toBe("immediate-only");
		expect(sampled?.[0]?.smartImmediate).toBeNull();
		expect(
			f.sample(
				{ targetOnlyInView: false, smartTabHostileOnly: false },
				POLICY,
				view,
				frame,
			)?.[0]?.smartImmediate,
		).not.toBeNull();
	});
	it("samples only explicitly realized entities and retains selection across empty acquisition", () => {
		const realized: ReturnType<typeof boxEntity>[] = [];
		const f = volumeScene([entityFacts(2), entityFacts(3)], realized);
		f.motion.apply({ kind: "upserted", entity: targetingEntity(2, 1) });
		expect(f.sample()).toEqual([]);
		const selected = fixture();
		selected.selection.select(2);
		selected.set(f.sample());
		selected.cycle.cycle("non-creature", 1);
		expect(selected.selection.selectedGuid()).toBe(2);
		realized.push(boxEntity(3, 0, 0, -1, BODY_BOX));
		selected.set(f.sample());
		expect(selected.selection.selectedGuid()).toBe(2);
		selected.cycle.cycle("non-creature", 1);
		expect(selected.selection.selectedGuid()).toBe(3);
		f.motion.awaitSnapshot();
		expect(f.sample()).toBeNull();
	});
	it("uses the actual volume for radius, band boundaries and vertical distance", () => {
		const width = POLICY.initialDistanceBandMeters;
		const flat = new AABB3(new Vec3(-0.5, 0, 0), new Vec3(0.5, 1, 0));
		const f = volumeScene(
			[entityFacts(2), entityFacts(3), entityFacts(4)],
			[
				boxEntity(2, 0, 0, -width, flat),
				boxEntity(3, 0, 0, -POLICY.radiusMeters, flat),
				boxEntity(4, 0, POLICY.radiusMeters + 1, 0, flat),
			],
		);
		const sampled = f.sample({
			targetOnlyInView: false,
			smartTabHostileOnly: false,
		});
		expect(sampled?.map((c) => c.guid)).toEqual([2, 3]);
		expect(sampled?.[0]?.distanceBand).toBe(1);
		expect(sampled?.[0]?.smartImmediate).toBeNull();
		expect(sampled?.[1]?.distanceSquared).toBe(POLICY.radiusMeters ** 2);
	});
	it("admits a large object by its nearby surface even when its origin exceeds acquisition radius", () => {
		const object = boxEntity(
			2,
			0,
			0,
			-(POLICY.radiusMeters + 2),
			new AABB3(new Vec3(-1, 0, 0), new Vec3(1, 2, 4)),
		);
		const sampled = volumeScene([entityFacts(2)], [object]).sample();
		expect(sampled?.[0]?.distanceSquared).toBe((POLICY.radiusMeters - 2) ** 2);
		expect(sampled?.[0]?.forwardAlignment).toBe(1);
	});
	it("tests padded view planes against the volume rather than the origin", () => {
		const flat = new AABB3(new Vec3(-1, 0, 0), new Vec3(1, 1, 0));
		const f = volumeScene([entityFacts(2)], [boxEntity(2, 5, 0, -2, flat)]);
		expect(f.sample()?.[0]?.filters["smart-combat"]).toBe("cycle");
		const outside = volumeScene(
			[entityFacts(2)],
			[boxEntity(2, 5.01, 0, -2, flat)],
		);
		expect(outside.sample()?.[0]?.filters).toEqual({ "non-creature": "cycle" });
		expect(
			outside.sample({
				targetOnlyInView: false,
				smartTabHostileOnly: false,
			})?.[0]?.filters["smart-combat"],
		).toBe("cycle");
	});
	it("keeps non-creature and corpse admission independent of the camera and excludes corpses from smart cycling", () => {
		const f = volumeScene(
			[
				entityFacts(2, { corpse: "unopened" }),
				entityFacts(3, { corpse: "opened" }),
			],
			[boxEntity(2, 0, 0, 2, BODY_BOX), boxEntity(3, 0, 0, 3, BODY_BOX)],
		);
		expect(f.sample()?.map((c) => c.filters)).toEqual([
			{ "non-creature": "cycle", "unopened-corpse": "cycle" },
			{ "non-creature": "cycle" },
		]);
		expect(
			f
				.sample(
					{ targetOnlyInView: true, smartTabHostileOnly: false },
					POLICY,
					null,
				)
				?.map((c) => c.filters),
		).toEqual([
			{ "non-creature": "cycle", "unopened-corpse": "cycle" },
			{ "non-creature": "cycle" },
		]);
	});
	it("does not produce Smart immediate admission for excluded semantics or a missing required camera", () => {
		const f = volumeScene(
			[
				entityFacts(2, { corpse: "unopened" }),
				entityFacts(3, { targeting: "projectile" }),
				entityFacts(4),
			],
			[
				boxEntity(2, 0, 0, -1, BODY_BOX),
				boxEntity(3, 0, 0, -1, BODY_BOX),
				boxEntity(4, 0, 0, -1, BODY_BOX),
			],
		);
		expect(f.sample()?.map((candidate) => candidate.smartImmediate)).toEqual([
			null,
			null,
			{ distanceSquared: 0.75 ** 2 },
		]);
		expect(
			f
				.sample(
					{ targetOnlyInView: true, smartTabHostileOnly: false },
					POLICY,
					null,
				)
				?.every((candidate) => candidate.smartImmediate === null),
		).toBe(true);
		expect(
			f
				.sample({ targetOnlyInView: false, smartTabHostileOnly: true })
				?.every((candidate) => candidate.smartImmediate === null),
		).toBe(true);
	});

	it("applies the rear-offset plane independently of the camera's forward region", () => {
		const view = {
			...TARGETING_TEST_VIEW,
			camera: {
				...TARGETING_TEST_VIEW.camera,
				placement: {
					...TARGETING_TEST_VIEW.camera.placement,
					position: sceneVec3(new Vec3(0, 0, 5)),
				},
			},
		};
		const flat = new AABB3(new Vec3(-0.1, 0, 0), new Vec3(0.1, 1, 0));
		const f = volumeScene(
			[entityFacts(2), entityFacts(3)],
			[
				boxEntity(2, 0, 0, POLICY.forwardHalfSpaceRearOffsetMeters, flat),
				boxEntity(
					3,
					0,
					0,
					POLICY.forwardHalfSpaceRearOffsetMeters + 0.01,
					flat,
				),
			],
		);
		const result = f.sample(
			{ targetOnlyInView: true, smartTabHostileOnly: false },
			POLICY,
			view,
		);
		expect(result?.[0]?.filters["smart-combat"]).toBe("cycle");
		expect(result?.[0]?.smartImmediate).toBeNull();
		expect(result?.[1]?.filters).toEqual({ "non-creature": "cycle" });
	});
	it.each([
		"direct",
		"targeted",
		"salvage-tool",
		"unsupported",
		"unavailable",
	] as const)(
		"classifies %s object use and always excludes projectiles from Smart Tab",
		(useCapability) => {
			const base = entityFacts(2);
			if (base.description.kind !== "known")
				throw new Error("Known fixture required.");
			const facts = {
				...base,
				description: { ...base.description, useCapability },
			};
			const f = volumeScene(
				[facts, { ...facts, guid: 3, targeting: "projectile" }],
				[boxEntity(2, 0, 0, -1, BODY_BOX), boxEntity(3, 1, 0, -1, BODY_BOX)],
			);
			const sampled = f.sample();
			expect(sampled?.[0]?.filters["smart-combat"]).toBe(
				useCapability === "unsupported" || useCapability === "unavailable"
					? "immediate-only"
					: "cycle",
			);
			expect(sampled?.[1]?.filters).toEqual({ "non-creature": "cycle" });
		},
	);
	it("validates the convex cone domain and handles zero and ninety degree half-angles", () => {
		const f = volumeScene([entityFacts(2)], [boxEntity(2, 1, 0, -1, BODY_BOX)]);
		expect(
			f.sample(
				{ targetOnlyInView: false, smartTabHostileOnly: false },
				{ ...POLICY, immediateMaxAngleDegrees: 0 },
			)?.[0]?.smartImmediate,
		).toBeNull();
		expect(
			f.sample(
				{ targetOnlyInView: false, smartTabHostileOnly: false },
				{ ...POLICY, immediateMaxAngleDegrees: 90 },
			)?.[0]?.smartImmediate,
		).not.toBeNull();
		expect(() =>
			f.sample(
				{ targetOnlyInView: false, smartTabHostileOnly: false },
				{ ...POLICY, immediateMaxAngleDegrees: 91 },
			),
		).toThrow("half-angle");
	});
	it("compares player and part volumes in their shared frame across landblock boundaries", () => {
		const object = boxEntity(2, 1, 0, -1, BODY_BOX);
		object.entity.placement.pose.landblockId = cellId(0x01000100);
		const f = volumeScene([entityFacts(2)], [object]);
		const player = targetingEntity(1, 1);
		player.placement.pose.coords.x = 191;
		f.motion.apply({ kind: "upserted", entity: player });
		expect(
			f.sample({ targetOnlyInView: false, smartTabHostileOnly: false })?.[0]
				?.distanceSquared,
		).toBeCloseTo(1.75 ** 2 + 0.75 ** 2);
	});
	it("ranks immediate winners by constrained distance instead of unconstrained surface distance", () => {
		const f = fixture();
		f.set([
			{ ...candidate(2, 1), smartImmediate: { distanceSquared: 9 } },
			{ ...candidate(3, 2), smartImmediate: { distanceSquared: 4 } },
		]);
		f.cycle.cycle("smart-combat", 1);
		expect(f.selection.selectedGuid()).toBe(3);
	});
});
