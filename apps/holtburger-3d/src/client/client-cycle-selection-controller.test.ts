import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";
import { describe, expect, it, vi } from "vitest";
import { ClientEntityMirror } from "./client-entity-mirror";
import {
	entityFacts,
	playerEntitySnapshot,
} from "./client-entity-mirror.test-support";
import { ClientEntitySelection } from "./client-entity-selection";
import {
	approximateTargetView,
	ClientCycleSelectionController,
	sampleCycleCandidates,
	type CycleCandidate,
	type CycleFilter,
} from "./client-cycle-selection-controller";
import {
	DynamicEntityMirror,
	cellId,
} from "../lib/game/runtime/dynamic-entity-feed";
import {
	targetingEntity,
	TARGETING_TEST_VIEW,
} from "./client-targeting.test-support";
import { sceneVec3 } from "../lib/assets/ac-frame";
import { Quat, Vec3 } from "../lib/game/math/types";

const POLICY = {
	radiusMeters: 20,
	viewMarginMeters: 2,
	distanceBandMeters: 5,
	angularSectorCount: 8,
	resetDivergence: 0.5,
	adjacentRegionWeight: 0.25,
};
function candidate(
	guid: number,
	distance: number,
	angularSector = 0,
	targeting: CycleFilter = "creature",
): CycleCandidate {
	return {
		guid,
		targeting,
		distanceSquared: distance ** 2,
		distanceBand: Math.floor(distance / POLICY.distanceBandMeters),
		angularSector,
	};
}
function worldObject(
	guid: number,
	distance: number,
	sector = 0,
): CycleCandidate {
	return candidate(guid, distance, sector, "non-creature");
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
	const cycle = new ClientCycleSelectionController({
		selection,
		policy: POLICY,
		sample,
	});
	return {
		selection,
		cycle,
		sample,
		set: (next: readonly CycleCandidate[] | null) => {
			candidates = next;
		},
	};
}

describe("spatial cycle acquisition", () => {
	it("shares the cursor between all-creature and hostile-only filters in both directions", () => {
		const f = fixture();
		f.set([
			candidate(2, 1),
			candidate(3, 6, 0, "hostile"),
			worldObject(4, 11),
			candidate(5, 16, 0, "hostile"),
		]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(2);
		f.cycle.cycle("hostile", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("hostile", 1);
		expect(f.selection.selectedGuid()).toBe(5);
		f.cycle.cycle("hostile", -1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("non-creature", 1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(5);
	});
	it("keeps hostile resets independent of friendly creature churn and preserves selection without hostiles", () => {
		const f = fixture();
		const hostiles = [
			candidate(2, 1, 0, "hostile"),
			candidate(3, 6, 0, "hostile"),
			candidate(4, 11, 0, "hostile"),
		];
		f.set([...hostiles, candidate(5, 2)]);
		f.cycle.cycle("hostile", 1);
		f.cycle.cycle("hostile", 1);
		f.set([...hostiles, candidate(6, 3), candidate(7, 4), candidate(8, 5)]);
		f.cycle.cycle("hostile", 1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.set([candidate(6, 3)]);
		f.cycle.cycle("hostile", 1);
		expect(f.selection.selectedGuid()).toBe(4);
	});

	it.each([1, -1] as const)(
		"skips the selected endpoint after spatial resets in direction %s",
		(direction) => {
			const f = fixture();
			f.set([candidate(2, 1), candidate(3, 6), candidate(4, 11)]);
			f.cycle.cycle("creature", direction);
			expect(f.selection.selectedGuid()).toBe(direction === 1 ? 2 : 4);
			f.set([candidate(2, 1, 2), candidate(3, 6, 2), candidate(4, 11, 2)]);
			f.cycle.cycle("creature", direction);
			expect(f.selection.selectedGuid()).toBe(3);
		},
	);
	it("retains a sole target on reset and then advances when an alternative arrives", () => {
		const f = fixture();
		f.set([candidate(2, 1)]);
		f.cycle.cycle("creature", 1);
		f.set([candidate(2, 1, 2)]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(2);
		f.set([candidate(2, 1, 2), candidate(3, 6, 2)]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
	});
	it("skips the selected corpse on reset but keeps it when it is the only unopened corpse", () => {
		const f = fixture();
		f.set([
			{ ...worldObject(2, 1), targeting: "unopened-corpse" },
			{ ...worldObject(3, 6), targeting: "unopened-corpse" },
			worldObject(4, 11),
		]);
		f.cycle.cycle("unopened-corpse", 1);
		f.set([
			{ ...worldObject(2, 1, 2), targeting: "unopened-corpse" },
			{ ...worldObject(3, 6, 2), targeting: "unopened-corpse" },
			worldObject(4, 11, 2),
		]);
		f.cycle.cycle("unopened-corpse", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.set([
			worldObject(2, 1, 4),
			{ ...worldObject(3, 6, 4), targeting: "unopened-corpse" },
			worldObject(4, 11, 4),
		]);
		f.cycle.cycle("unopened-corpse", 1);
		expect(f.selection.selectedGuid()).toBe(3);
	});

	it("preserves crowd order within bands despite nearest changes", () => {
		const f = fixture();
		f.set([candidate(2, 1), candidate(3, 2), candidate(4, 3)]);
		f.cycle.cycle("creature", 1);
		f.set([candidate(4, 1), candidate(3, 2), candidate(2, 3)]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(2);
	});
	it("orders survivors and newcomers by current band", () => {
		const f = fixture();
		f.set([candidate(2, 1), candidate(3, 6), candidate(4, 11)]);
		f.cycle.cycle("creature", 1);
		f.set([
			candidate(2, 1),
			candidate(3, 6),
			candidate(4, 11),
			candidate(5, 7),
		]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(5);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(4);
	});
	it("moves targets between bands without resetting for one moving crowd member", () => {
		const f = fixture();
		f.set([candidate(2, 1), candidate(3, 6), candidate(4, 11)]);
		f.cycle.cycle("creature", 1);
		f.set([candidate(2, 1), candidate(3, 16), candidate(4, 11)]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(4);
	});
	it("resets to nearest when half the original group shifts substantially", () => {
		const f = fixture();
		f.set([candidate(2, 1), candidate(3, 6)]);
		f.cycle.cycle("creature", 1);
		f.set([candidate(2, 12), candidate(3, 6)]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
	});
	it("tolerates adjacent boundaries and compares cumulative rotation with the acquisition snapshot", () => {
		const f = fixture();
		f.set([candidate(2, 1), candidate(3, 2)]);
		f.cycle.cycle("creature", 1);
		f.set([candidate(2, 1, 7), candidate(3, 2, 7)]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.set([candidate(2, 2, 6), candidate(3, 1, 6)]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(2);
		// A fresh baseline was captured at sector six.
		f.set([candidate(2, 2, 5), candidate(3, 1, 5)]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
	});
	it("tolerates one replacement in a crowd but resets for a new group", () => {
		const f = fixture();
		f.set([candidate(2, 1), candidate(3, 2), candidate(4, 3), candidate(5, 4)]);
		f.cycle.cycle("creature", 1);
		f.set([
			candidate(6, 0.5),
			candidate(3, 2),
			candidate(4, 3),
			candidate(5, 4),
		]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.set([candidate(8, 1), candidate(9, 2)]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(8);
	});
	it.each([1, -1] as const)(
		"preserves a removed cursor's gap in direction %s",
		(direction) => {
			const f = fixture();
			f.set([
				candidate(2, 1),
				candidate(3, 2),
				candidate(4, 3),
				candidate(5, 4),
			]);
			f.selection.select(direction === 1 ? 2 : 4);
			f.cycle.cycle("creature", direction);
			expect(f.selection.selectedGuid()).toBe(3);
			f.set([candidate(2, 1), candidate(4, 3), candidate(5, 4)]);
			f.cycle.cycle("creature", direction);
			expect(f.selection.selectedGuid()).toBe(direction === 1 ? 4 : 2);
		},
	);
	it("shares corpse traversal with the non-creature ring", () => {
		const f = fixture();
		f.set([
			worldObject(2, 1),
			{ ...worldObject(3, 2), targeting: "unopened-corpse" },
			worldObject(4, 3),
		]);
		f.cycle.cycle("non-creature", 1);
		f.cycle.cycle("unopened-corpse", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("non-creature", 1);
		expect(f.selection.selectedGuid()).toBe(4);
	});
	it("starts reverse at farthest and preserves selection for empty or unavailable samples", () => {
		const f = fixture();
		f.set([candidate(2, 1), candidate(3, 6)]);
		f.cycle.cycle("creature", -1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.set([]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.set(null);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.destroy();
		f.cycle.cycle("creature", 1);
		expect(f.sample).toHaveBeenCalledTimes(3);
	});
	it("continues across creature, object, and corpse filters from the shared cursor", () => {
		const f = fixture();
		f.set([
			worldObject(2, 1),
			candidate(3, 6),
			{ ...worldObject(4, 11), targeting: "unopened-corpse" },
			candidate(5, 16),
		]);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("non-creature", 1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(5);
		f.cycle.cycle("non-creature", -1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.cycle.cycle("unopened-corpse", 1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.selection.select(3);
		f.cycle.cycle("non-creature", 1);
		expect(f.selection.selectedGuid()).toBe(4);
	});
	it("keeps creature reset detection independent of object churn", () => {
		const f = fixture();
		f.set([candidate(2, 1), candidate(3, 6), worldObject(4, 11)]);
		f.cycle.cycle("creature", 1);
		f.set([
			candidate(2, 1),
			candidate(3, 6),
			worldObject(5, 2),
			worldObject(6, 3),
			worldObject(7, 4),
		]);
		f.cycle.cycle("non-creature", 1);
		expect(f.selection.selectedGuid()).toBe(5);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
	});
	it("compares each filter with its own last acquisition even after another filter resets", () => {
		const f = fixture();
		f.set([
			worldObject(2, 1),
			candidate(3, 6),
			worldObject(4, 11),
			candidate(5, 16),
		]);
		f.cycle.cycle("creature", 1); // 3
		f.cycle.cycle("non-creature", 1); // 4; capture object baseline
		f.set([
			worldObject(2, 1),
			candidate(3, 6, 2),
			worldObject(4, 11),
			candidate(5, 16, 2),
		]);
		f.cycle.cycle("creature", 1); // creature reset: 3
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("non-creature", 1); // no object reset: continue to 4, not 2
		expect(f.selection.selectedGuid()).toBe(4);
		f.set([
			worldObject(2, 1, 2),
			candidate(3, 6, 2),
			worldObject(4, 11, 2),
			candidate(5, 16, 2),
		]);
		f.cycle.cycle("non-creature", 1); // object reset: nearest other is 2
		expect(f.selection.selectedGuid()).toBe(2);
	});
	it("does not let non-corpse object churn reset corpse traversal", () => {
		const f = fixture();
		const corpses: CycleCandidate[] = [2, 3, 4].map((guid, index) => ({
			...worldObject(guid, index * 5 + 1),
			targeting: "unopened-corpse",
		}));
		f.set([...corpses, worldObject(5, 2)]);
		f.cycle.cycle("unopened-corpse", 1); // 2
		f.cycle.cycle("unopened-corpse", 1); // 3
		f.set([
			...corpses,
			worldObject(6, 3),
			worldObject(7, 4),
			worldObject(8, 5),
		]);
		f.cycle.cycle("unopened-corpse", 1);
		expect(f.selection.selectedGuid()).toBe(4);
	});
	it("preserves the shared cursor when a filter has no matching candidates", () => {
		const f = fixture();
		f.set([candidate(2, 1), candidate(3, 6)]);
		f.cycle.cycle("creature", 1);
		f.cycle.cycle("non-creature", 1);
		expect(f.selection.selectedGuid()).toBe(2);
		f.cycle.cycle("creature", 1);
		expect(f.selection.selectedGuid()).toBe(3);
	});
});

describe("on-demand accepted candidate geometry", () => {
	it.each(["mob", "player", "npc", "other"] as const)(
		"uses world-owned %s classification for hostile eligibility",
		(mapCategory) => {
			const entities = new ClientEntityMirror();
			const facts = entityFacts(2, { targeting: "creature" });
			if (facts.description.kind !== "known")
				throw new Error("Fixture must have a known description.");
			entities.commit(
				entities.prepareSnapshot(
					{
						...playerEntitySnapshot(1),
						entities: [
							entityFacts(1),
							{ ...facts, description: { ...facts.description, mapCategory } },
						],
					},
					1,
				),
			);
			const player = targetingEntity(1, 1);
			const creature = targetingEntity(2, 1);
			creature.placement.pose.coords.y = 10;
			const motion = new DynamicEntityMirror();
			motion.prepareSnapshot({
				entities: [player, creature],
				hostTime: { seconds: 0 },
			})();
			expect(
				sampleCycleCandidates(entities, motion, TARGETING_TEST_VIEW, POLICY),
			).toEqual([
				candidate(2, 10, 0, mapCategory === "mob" ? "hostile" : "creature"),
			]);
			creature.placement.pose.coords.y = -10;
			motion.apply({ kind: "upserted", entity: creature });
			expect(
				sampleCycleCandidates(entities, motion, TARGETING_TEST_VIEW, POLICY),
			).toEqual([]);
		},
	);

	it("admits other cells without rendering, reads updates, rejects stale state and excludes self", () => {
		const entities = new ClientEntityMirror();
		entities.commit(
			entities.prepareSnapshot(
				{
					...playerEntitySnapshot(1),
					entities: [
						entityFacts(1, { targeting: "creature" }),
						entityFacts(2, { targeting: "creature" }),
						entityFacts(3, { targeting: "non-creature" }),
					],
				},
				1,
			),
		);
		const player = targetingEntity(1, 1),
			creature = targetingEntity(2, 1),
			object = targetingEntity(3, 1);
		creature.placement.pose.landblockId = cellId(0x00000123);
		creature.placement.pose.coords.y = 10;
		creature.placement.spatialMembership = {
			reachesOutdoors: false,
			reachedEnvCellIds: [cellId(0x00000123)],
		};
		object.placement.pose.coords.y = -5;
		const motion = new DynamicEntityMirror();
		motion.prepareSnapshot({
			entities: [player, creature, object],
			hostTime: { seconds: 0 },
		})();
		const sample = () =>
			sampleCycleCandidates(entities, motion, TARGETING_TEST_VIEW, POLICY);
		expect(sample()).toEqual([candidate(2, 10), worldObject(3, 5, 4)]);
		const reversedView = {
			...TARGETING_TEST_VIEW,
			camera: {
				...TARGETING_TEST_VIEW.camera,
				placement: {
					...TARGETING_TEST_VIEW.camera.placement,
					rotation: new Quat(0, 0, 1, 0),
				},
			},
		};
		expect(
			sampleCycleCandidates(entities, motion, reversedView, POLICY),
		).toEqual([worldObject(3, 5)]);
		const moved = targetingEntity(2, 1);
		moved.placement.pose.coords.y = -1;
		motion.apply({ kind: "upserted", entity: moved });
		expect(sample()).toEqual([worldObject(3, 5, 4)]);
		motion.awaitSnapshot();
		expect(sample()).toBeNull();
	});
	it("uses player range rather than camera range, including vertical distance", () => {
		const entities = new ClientEntityMirror();
		entities.commit(
			entities.prepareSnapshot(
				{
					...playerEntitySnapshot(1),
					entities: [entityFacts(1), entityFacts(2)],
				},
				1,
			),
		);
		const player = targetingEntity(1, 1),
			object = targetingEntity(2, 1);
		player.placement.pose.coords.x = 100;
		object.placement.pose.coords.x = 100;
		object.placement.pose.coords.z = POLICY.radiusMeters;
		const motion = new DynamicEntityMirror();
		motion.prepareSnapshot({
			entities: [player, object],
			hostTime: { seconds: 0 },
		})();
		expect(sampleCycleCandidates(entities, motion, null, POLICY)).toEqual([
			worldObject(2, POLICY.radiusMeters),
		]);
		const moved = targetingEntity(2, 1);
		moved.placement.pose.coords.x = 100;
		moved.placement.pose.coords.z = POLICY.radiusMeters + 1;
		motion.apply({ kind: "upserted", entity: moved });
		expect(sampleCycleCandidates(entities, motion, null, POLICY)).toEqual([]);
	});
	it("compares origins across landblock boundaries without comparing cell identities", () => {
		const entities = new ClientEntityMirror();
		entities.commit(
			entities.prepareSnapshot(
				{
					...playerEntitySnapshot(1),
					entities: [entityFacts(1), entityFacts(2)],
				},
				1,
			),
		);
		const player = targetingEntity(1, 1),
			object = targetingEntity(2, 1);
		player.placement.pose.coords.x = OUTDOOR_LANDBLOCK_WORLD_SIZE - 1;
		object.placement.pose.landblockId = cellId(0x01000125);
		object.placement.pose.coords.x = 1;
		const motion = new DynamicEntityMirror();
		motion.prepareSnapshot({
			entities: [player, object],
			hostTime: { seconds: 0 },
		})();
		expect(sampleCycleCandidates(entities, motion, null, POLICY)).toEqual([
			worldObject(2, 2, 2),
		]);
		entities.awaitSnapshot();
		expect(sampleCycleCandidates(entities, motion, null, POLICY)).toBeNull();
	});

	it("expands side planes without admitting behind-camera positions", () => {
		const test = approximateTargetView(TARGETING_TEST_VIEW, 2);
		expect(test(sceneVec3(new Vec3(11, 0, -10)))).toBe(true);
		expect(test(sceneVec3(new Vec3(13, 0, -10)))).toBe(false);
		expect(test(sceneVec3(new Vec3(0, 11, -10)))).toBe(true);
		expect(test(sceneVec3(new Vec3(0, 0, 0)))).toBe(true);
		expect(test(sceneVec3(new Vec3(0, 0, 0.01)))).toBe(false);
	});
});
