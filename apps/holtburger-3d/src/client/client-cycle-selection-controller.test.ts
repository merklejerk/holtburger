import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";
import { describe, expect, it, vi } from "vitest";
import { AppInput } from "../lib/input/app-input";
import { INPUT_DEFAULTS } from "../lib/input/input-defaults";
import { ClientEntityMirror } from "./client-entity-mirror";
import { entityFacts } from "./client-entity-mirror.test-support";
import { ClientEntitySelection } from "./client-entity-selection";
import {
	approximateTargetView,
	ClientCycleSelectionController,
	sampleCycleCandidates,
	type CycleCandidate,
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
import { Vec3 } from "../lib/game/math/types";
import { ClientSelectionInput } from "./client-selection-input";

const POLICY = { radiusMeters: 20, idleResetMs: 100, viewMarginMeters: 2 };
function fixture() {
	const entities = new ClientEntityMirror();
	entities.commit(
		entities.prepareSnapshot(
			{
				projectileSupply: { kind: "not-applicable" },
				worldContainer: { kind: "closed" },
				entities: [entityFacts(1)],
			},
			1,
		),
	);
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
		set: (ids: number[]) => {
			candidates = ids.map((guid, index) => ({ guid, distanceSquared: index }));
		},
	};
}

describe("stable cycle acquisition", () => {
	it("keeps survivor order despite distance crossings, admits newcomers, and wraps", () => {
		const f = fixture();
		f.set([2, 3, 4]);
		f.cycle.cycle("creature", 1, 0);
		expect(f.selection.selectedGuid()).toBe(2);
		f.set([3, 5, 2, 4]);
		f.cycle.cycle("creature", 1, 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("creature", 1, 2);
		expect(f.selection.selectedGuid()).toBe(4);
		f.cycle.cycle("creature", 1, 3);
		expect(f.selection.selectedGuid()).toBe(5);
		f.cycle.cycle("creature", 1, 4);
		expect(f.selection.selectedGuid()).toBe(2);
		f.cycle.cycle("creature", -1, 5);
		expect(f.selection.selectedGuid()).toBe(5);
		expect(f.sample).toHaveBeenCalledTimes(6);
	});
	it.each([1, -1] as const)(
		"preserves a removed cursor's gap in direction %s",
		(direction) => {
			const f = fixture();
			f.set([2, 3, 4, 5]);
			f.selection.select(direction === 1 ? 2 : 4);
			f.cycle.cycle("creature", direction, 0);
			expect(f.selection.selectedGuid()).toBe(3);
			f.set([5, 4, 2, 6]);
			f.cycle.cycle("creature", direction, 1);
			expect(f.selection.selectedGuid()).toBe(direction === 1 ? 4 : 2);
		},
	);
	it("rebuilds at the idle boundary and on category/external intent changes", () => {
		const f = fixture();
		f.set([2, 3, 4]);
		f.cycle.cycle("creature", 1, 0);
		f.set([2, 4, 3]);
		f.cycle.cycle("creature", 1, POLICY.idleResetMs);
		expect(f.selection.selectedGuid()).toBe(4);
		f.cycle.cycle("non-creature", 1, POLICY.idleResetMs + 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.selection.select(3);
		f.set([3, 4, 2]);
		f.cycle.cycle("non-creature", 1, POLICY.idleResetMs + 2);
		expect(f.selection.selectedGuid()).toBe(4);
	});
	it("treats re-entrants as newcomers instead of restoring an obsolete position", () => {
		const f = fixture();
		f.set([2, 3, 4]);
		f.cycle.cycle("creature", 1, 0);
		f.set([2, 4]);
		f.cycle.cycle("creature", 1, 1);
		expect(f.selection.selectedGuid()).toBe(4);
		f.set([3, 2, 4]);
		f.cycle.cycle("creature", 1, 2);
		expect(f.selection.selectedGuid()).toBe(3);
		f.cycle.cycle("creature", 1, 3);
		expect(f.selection.selectedGuid()).toBe(2);
	});

	it("filters unopened corpses without leaving the non-creature ring", () => {
		const f = fixture();
		const candidates: CycleCandidate[] = [
			{ guid: 2, distanceSquared: 1 },
			{ guid: 3, distanceSquared: 2, unopenedCorpse: true },
			{ guid: 4, distanceSquared: 3 },
			{ guid: 5, distanceSquared: 4, unopenedCorpse: true },
		];
		const cycle = new ClientCycleSelectionController({
			selection: f.selection,
			policy: POLICY,
			sample: () => candidates,
		});
		cycle.cycle("non-creature", 1, 0);
		expect(f.selection.selectedGuid()).toBe(2);
		cycle.cycle("non-creature", 1, 1, "unopened-corpse");
		expect(f.selection.selectedGuid()).toBe(3);
		cycle.cycle("non-creature", 1, 2);
		expect(f.selection.selectedGuid()).toBe(4);
		cycle.cycle("non-creature", -1, 3, "unopened-corpse");
		expect(f.selection.selectedGuid()).toBe(3);
		candidates[1] = { guid: 3, distanceSquared: 2 };
		cycle.cycle("non-creature", 1, 4, "unopened-corpse");
		expect(f.selection.selectedGuid()).toBe(5);
		cycle.destroy();
		f.cycle.destroy();
		f.selection.destroy();
	});

	it("breaks distance ties by GUID rather than source iteration order", () => {
		const f = fixture();
		const cycle = new ClientCycleSelectionController({
			selection: f.selection,
			policy: POLICY,
			sample: () => [
				{ guid: 9, distanceSquared: 4 },
				{ guid: 2, distanceSquared: 4 },
			],
		});
		cycle.cycle("creature", 1, 0);
		expect(f.selection.selectedGuid()).toBe(2);
		cycle.cycle("creature", 1, 1);
		expect(f.selection.selectedGuid()).toBe(9);
		cycle.destroy();
		f.cycle.destroy();
		f.selection.destroy();
	});

	it("starts reverse at farthest, preserves selection on empty, and rebuilds when all old members leave", () => {
		const f = fixture();
		f.set([2, 3]);
		f.cycle.cycle("creature", -1, 0);
		expect(f.selection.selectedGuid()).toBe(3);
		f.set([]);
		f.cycle.cycle("creature", 1, 1);
		expect(f.selection.selectedGuid()).toBe(3);
		f.set([7]);
		f.cycle.cycle("creature", -1, 2);
		expect(f.selection.selectedGuid()).toBe(7);
		f.cycle.cycle("creature", 1, 3);
		expect(f.selection.selectedGuid()).toBe(7);
		f.set([8, 9]);
		f.cycle.cycle("creature", 1, 4);
		expect(f.selection.selectedGuid()).toBe(8);
	});
	it("retires old acquisition even without a winner and stops sampling after teardown", () => {
		const f = fixture();
		const intent = f.selection.beginAcquisition("external");
		f.cycle.cycle("creature", 1, 0);
		f.selection.commitAcquisition(intent, 8);
		expect(f.selection.selectedGuid()).toBeNull();
		f.cycle.destroy();
		f.cycle.cycle("creature", 1, 1);
		expect(f.sample).toHaveBeenCalledTimes(1);
	});
	it("routes exact modifiers, self, Escape, repeat and already consumed events", () => {
		const f = fixture();
		const input = new ClientSelectionInput({
			input: new AppInput(INPUT_DEFAULTS),
			selection: f.selection,
			cycle: f.cycle,
			holdDelayMs: 1000,
		});
		f.set([2, 3]);
		const press = (options: Partial<KeyboardEvent>) => {
			const event = Object.assign(
				new Event("keydown", { cancelable: true }),
				{
					key: "Tab",
					shiftKey: false,
					ctrlKey: false,
					altKey: false,
					metaKey: false,
					repeat: false,
					isComposing: false,
				},
				options,
			) as KeyboardEvent;
			input.keydown(event, 0);
			input.keyup(event, 0);
			return event;
		};
		press({ key: "x" });
		expect(f.selection.selectedGuid()).toBe(1);
		press({});
		expect(f.selection.selectedGuid()).toBe(2);
		press({ repeat: true });
		expect(f.selection.selectedGuid()).toBe(2);
		press({ altKey: true });
		expect(f.selection.selectedGuid()).toBe(2);
		press({ shiftKey: true });
		expect(f.selection.selectedGuid()).toBe(3);
		press({ ctrlKey: true });
		expect(f.selection.selectedGuid()).toBe(2);
		f.set([2, 3, 4]);
		press({ ctrlKey: true, shiftKey: true });
		expect(f.selection.selectedGuid()).toBe(4);
		press({ isComposing: true });
		expect(f.selection.selectedGuid()).toBe(4);
		press({ key: "X", shiftKey: true });
		expect(f.selection.selectedGuid()).toBe(1);
		press({ key: "Escape" });
		expect(f.selection.selectedGuid()).toBeNull();
		input.destroy();
	});
});

describe("on-demand accepted candidate geometry", () => {
	it("admits other cells without rendering, reads updates, rejects stale state and excludes self", () => {
		const entities = new ClientEntityMirror();
		entities.commit(
			entities.prepareSnapshot(
				{
					projectileSupply: { kind: "not-applicable" },
					worldContainer: { kind: "closed" },
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
		const sample = (category: "creature" | "non-creature") =>
			sampleCycleCandidates(
				entities,
				motion,
				TARGETING_TEST_VIEW,
				category,
				POLICY,
			);
		expect(sample("creature")).toEqual([{ guid: 2, distanceSquared: 100 }]);
		expect(sample("non-creature")).toEqual([{ guid: 3, distanceSquared: 25 }]);
		const moved = targetingEntity(2, 1);
		moved.placement.pose.coords.y = -1;
		motion.apply({ kind: "upserted", entity: moved });
		expect(sample("creature")).toEqual([]);
		motion.awaitSnapshot();
		expect(sample("creature")).toBeNull();
	});
	it("uses player range rather than camera range, including vertical distance", () => {
		const entities = new ClientEntityMirror();
		entities.commit(
			entities.prepareSnapshot(
				{
					projectileSupply: { kind: "not-applicable" },
					worldContainer: { kind: "closed" },
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
		expect(
			sampleCycleCandidates(entities, motion, null, "non-creature", POLICY),
		).toEqual([{ guid: 2, distanceSquared: POLICY.radiusMeters ** 2 }]);
		const moved = targetingEntity(2, 1);
		moved.placement.pose.coords.x = 100;
		moved.placement.pose.coords.z = POLICY.radiusMeters + 1;
		motion.apply({ kind: "upserted", entity: moved });
		expect(
			sampleCycleCandidates(entities, motion, null, "non-creature", POLICY),
		).toEqual([]);
	});
	it("compares origins across landblock boundaries without comparing cell identities", () => {
		const entities = new ClientEntityMirror();
		entities.commit(
			entities.prepareSnapshot(
				{
					projectileSupply: { kind: "not-applicable" },
					worldContainer: { kind: "closed" },
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
		expect(
			sampleCycleCandidates(entities, motion, null, "non-creature", POLICY),
		).toEqual([{ guid: 2, distanceSquared: 4 }]);
		entities.awaitSnapshot();
		expect(
			sampleCycleCandidates(entities, motion, null, "non-creature", POLICY),
		).toBeNull();
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
