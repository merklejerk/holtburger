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
	type CycleSelectionContext,
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

const PEACE_CONTEXT: CycleSelectionContext = {
	combatMode: "peace",
	partyMembers: new Set(),
};
const POLICY = {
	radiusMeters: 20,
	viewMarginMeters: 2,
	initialDistanceBandMeters: 5,
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
			for (const guid of [7, 3, 4, 5, 2, 6, 7]) {
				f.cycle.cycle(filter, 1);
				expect(f.selection.selectedGuid()).toBe(guid);
			}
			f.cycle.cycle(filter, -1);
			expect(f.selection.selectedGuid()).toBe(6);
		},
	);
	it.each([1, -1] as const)(
		"new immediate wins in direction %s unless already selected",
		(direction) => {
			const f = fixture();
			f.set([candidate(2, 6), candidate(3, 8), candidate(4, 10)]);
			f.cycle.cycle("smart-combat", direction);
			expect(f.selection.selectedGuid()).toBe(2);
			f.set([candidate(2, 6, 0.5), candidate(3, 8), candidate(4, 10)]);
			f.cycle.cycle("smart-combat", direction);
			expect(f.selection.selectedGuid()).toBe(3);
			f.selection.select(4);
			f.set([candidate(2, 6, 0.5), candidate(3, 8, 0.5), candidate(4, 10)]);
			f.cycle.cycle("smart-combat", direction);
			expect(f.selection.selectedGuid()).toBe(direction === 1 ? 2 : 3);
		},
	);
	it.each([1, -1] as const)(
		"advances when the changed immediate is already selected, direction %s",
		(direction) => {
			const f = fixture();
			f.set([candidate(2, 6), candidate(3, 8), candidate(4, 10)]);
			f.cycle.cycle("smart-combat", 1);
			f.cycle.cycle("smart-combat", 1);
			f.set([candidate(2, 6, 0.5), candidate(3, 8), candidate(4, 10)]);
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
	it("remembers immediates per filter and shares the cursor for overlapping memberships", () => {
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
		f.set([candidate(2, 6), candidate(3, 8), candidate(4, 10)]);
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		f.set([candidate(2, 6), candidate(4, 10)]);
		f.cycle.cycle("smart-combat", -1);
		expect(f.selection.selectedGuid()).toBe(2);
	});
	it("retains selection for empty or unavailable samples and reacquires a returning immediate", () => {
		const f = fixture();
		f.set([candidate(2, 6), candidate(3, 8)]);
		f.cycle.cycle("smart-combat", 1);
		f.cycle.cycle("smart-combat", 1);
		for (const empty of [[], null] as const) {
			f.set(empty);
			f.cycle.cycle("smart-combat", 1);
			expect(f.selection.selectedGuid()).toBe(3);
		}
		f.set([candidate(2, 6), candidate(3, 8)]);
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
	it("hold selects immediate rather than nearest and seeds the next tap", () => {
		const f = fixture();
		f.set([candidate(2, 6, 0.5), candidate(3, 8), candidate(4, 10)]);
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
	function scenario(combatMode: CycleSelectionContext["combatMode"]) {
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
					TARGETING_TEST_VIEW,
					POLICY,
					true,
					next,
				),
			);
		refresh();
		return { ...f, context, refresh, motion };
	}
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
	it("a non-threatening player becomes immediate before traversal restrictions apply", () => {
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
		f.cycle.selectImmediate("smart-combat");
		expect(f.selection.selectedGuid()).toBe(3);
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

describe("on-demand accepted candidate geometry", () => {
	it("samples exponential boundaries and 3D alignment independently of the camera", () => {
		const entities = new ClientEntityMirror();
		const positions = [
			{ x: 0, y: 0, z: 0 },
			{ x: 0, y: 4.99, z: 0 },
			{ x: 0, y: 5, z: 0 },
			{ x: 0, y: 14.99, z: 0 },
			{ x: 0, y: 15, z: 0 },
			{ x: 2, y: 8, z: 0 },
			{ x: 0, y: 8, z: 6 },
			{ x: 0, y: 0, z: -8 },
		];
		entities.commit(
			entities.prepareSnapshot(
				{
					...playerEntitySnapshot(1),
					entities: [
						entityFacts(1),
						...positions.map((_, index) => entityFacts(index + 2)),
					],
				},
				1,
			),
		);
		const player = targetingEntity(1, 1);
		const motion = new DynamicEntityMirror();
		motion.prepareSnapshot({
			entities: [
				player,
				...positions.map((coords, index) => {
					const entity = targetingEntity(index + 2, 1);
					entity.placement.pose.coords = coords;
					return entity;
				}),
			],
			hostTime: { seconds: 0 },
		})();
		const sample = (view: typeof TARGETING_TEST_VIEW | null) =>
			sampleCycleCandidates(
				entities,
				motion,
				view,
				POLICY,
				false,
				PEACE_CONTEXT,
			);
		const candidates = sample(null);
		expect(candidates?.map((candidate) => candidate.distanceBand)).toEqual([
			0, 0, 1, 1, 2, 1, 1, 1,
		]);
		expect(candidates?.map((candidate) => candidate.forwardAlignment)).toEqual([
			0,
			1,
			1,
			1,
			1,
			8 / Math.hypot(2, 8),
			0.8,
			0,
		]);
		expect(sample(TARGETING_TEST_VIEW)).toEqual(candidates);
		const turned = targetingEntity(1, 1);
		// AC +90 degrees turns local north toward west, i.e. scene -X.
		turned.placement.pose.rotation = {
			w: Math.SQRT1_2,
			x: 0,
			y: 0,
			z: Math.SQRT1_2,
		};
		motion.apply({ kind: "upserted", entity: turned });
		const angled = sample(null)?.find((candidate) => candidate.guid === 7);
		expect(angled?.forwardAlignment).toBeCloseTo(-2 / Math.hypot(2, 8));
	});
	it("intersects the camera view with player forward while preserving unrestricted filters", () => {
		const entities = new ClientEntityMirror();
		const facts = entityFacts(2, { targeting: "creature" });
		if (facts.description.kind !== "known")
			throw new Error("Fixture requires known description.");
		entities.commit(
			entities.prepareSnapshot(
				{
					...playerEntitySnapshot(1),
					entities: [
						entityFacts(1),
						{
							...facts,
							description: { ...facts.description, mapCategory: "mob" },
						},
						entityFacts(3, { corpse: "unopened" }),
					],
				},
				1,
			),
		);
		const rear = targetingEntity(2, 1),
			corpse = targetingEntity(3, 1);
		rear.placement.pose.coords.y = -5;
		corpse.placement.pose.coords.y = -6;
		const motion = new DynamicEntityMirror();
		motion.prepareSnapshot({
			entities: [targetingEntity(1, 1), rear, corpse],
			hostTime: { seconds: 0 },
		})();
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
		expect(
			sampleCycleCandidates(
				entities,
				motion,
				view,
				POLICY,
				true,
				PEACE_CONTEXT,
			),
		).toEqual([
			{
				...worldObject(3, 6, -1),
				filters: { "non-creature": "cycle", "unopened-corpse": "cycle" },
			},
		]);
		expect(
			sampleCycleCandidates(
				entities,
				motion,
				view,
				POLICY,
				false,
				PEACE_CONTEXT,
			),
		).toEqual([
			candidate(2, 5, -1),
			{
				...worldObject(3, 6, -1),
				filters: { "non-creature": "cycle", "unopened-corpse": "cycle" },
			},
		]);
	});

	it("can acquire smart combat targets behind the camera without broadening corpse eligibility", () => {
		const entities = new ClientEntityMirror();
		const source = entityFacts(2);
		if (source.description.kind !== "known")
			throw new Error("Fixture requires a known description.");
		const description = source.description;
		entities.commit(
			entities.prepareSnapshot(
				{
					...playerEntitySnapshot(1),
					entities: [
						entityFacts(1),
						...[2, 3, 6].map((guid) =>
							entityFacts(guid, {
								targeting: "creature",
								description: {
									...description,
									mapCategory: guid === 3 ? "npc" : "mob",
								},
							}),
						),
						entityFacts(4),
						entityFacts(5, { corpse: "unopened" }),
					],
				},
				1,
			),
		);
		const motion = new DynamicEntityMirror();
		motion.prepareSnapshot({
			entities: [
				targetingEntity(1, 1),
				...[
					[2, -5],
					[3, -10],
					[4, -15],
					[5, -1],
					[6, 8],
				].map(([guid, distance]) => {
					const entity = targetingEntity(guid, 1);
					entity.placement.pose.coords.y = distance;
					return entity;
				}),
			],
			hostTime: { seconds: 0 },
		})();
		expect(
			sampleCycleCandidates(
				entities,
				motion,
				TARGETING_TEST_VIEW,
				POLICY,
				false,
				PEACE_CONTEXT,
			),
		).toEqual([
			candidate(2, 5, -1),
			candidate(3, 10, -1),
			{
				...worldObject(4, 15, -1),
				filters: { "non-creature": "cycle", "smart-combat": "cycle" },
			},
			{
				...worldObject(5, 1, -1),
				filters: { "non-creature": "cycle", "unopened-corpse": "cycle" },
			},
			candidate(6, 8, 1),
		]);
		const selection = new ClientEntitySelection({
			lifecycle: { entities, subscribe: () => () => {} },
			presentation: () => null,
		});
		let targetOnlyInView = true;
		const cycle = new ClientCycleSelectionController({
			selection,
			sample: () =>
				sampleCycleCandidates(
					entities,
					motion,
					TARGETING_TEST_VIEW,
					POLICY,
					targetOnlyInView,
					PEACE_CONTEXT,
				),
		});
		cycle.cycle("smart-combat", 1);
		expect(selection.selectedGuid()).toBe(6);
		targetOnlyInView = false;
		cycle.cycle("smart-combat", 1);
		expect(selection.selectedGuid()).toBe(2);
		cycle.destroy();
		selection.destroy();
	});

	it.each([
		"direct",
		"targeted",
		"salvage-tool",
		"unsupported",
		"unavailable",
	] as const)(
		"admits %s use capability to smart combat cycling only in view",
		(useCapability) => {
			const entities = new ClientEntityMirror();
			const facts = entityFacts(2);
			if (facts.description.kind !== "known")
				throw new Error("Fixture must have a known description.");
			entities.commit(
				entities.prepareSnapshot(
					{
						...playerEntitySnapshot(1),
						entities: [
							entityFacts(1),
							{
								...facts,
								description: { ...facts.description, useCapability },
							},
						],
					},
					1,
				),
			);
			const player = targetingEntity(1, 1);
			const object = targetingEntity(2, 1);
			object.placement.pose.coords.y = 10;
			const motion = new DynamicEntityMirror();
			motion.prepareSnapshot({
				entities: [player, object],
				hostTime: { seconds: 0 },
			})();
			const filters: CycleCandidate["filters"] =
				useCapability === "unsupported" || useCapability === "unavailable"
					? { "non-creature": "cycle", "smart-combat": "immediate-only" }
					: { "non-creature": "cycle", "smart-combat": "cycle" };
			expect(
				sampleCycleCandidates(
					entities,
					motion,
					TARGETING_TEST_VIEW,
					POLICY,
					true,
					PEACE_CONTEXT,
				),
			).toEqual([{ ...worldObject(2, 10), filters }]);
			const rear = targetingEntity(2, 1);
			rear.placement.pose.coords.y = -10;
			motion.apply({ kind: "upserted", entity: rear });
			expect(
				sampleCycleCandidates(
					entities,
					motion,
					TARGETING_TEST_VIEW,
					POLICY,
					true,
					PEACE_CONTEXT,
				),
			).toEqual([worldObject(2, 10, -1)]);
		},
	);
	it.each(["unopened", "opened"] as const)(
		"excludes %s corpses from smart combat and admits pending objects only as immediate",
		(corpseState) => {
			const entities = new ClientEntityMirror();
			entities.commit(
				entities.prepareSnapshot(
					{
						...playerEntitySnapshot(1),
						entities: [
							entityFacts(1),
							entityFacts(2, { corpse: corpseState }),
							entityFacts(3, { description: { kind: "pending" } }),
						],
					},
					1,
				),
			);
			const player = targetingEntity(1, 1);
			const corpse = targetingEntity(2, 1);
			const pending = targetingEntity(3, 1);
			corpse.placement.pose.coords.y = 5;
			pending.placement.pose.coords.y = 10;
			const motion = new DynamicEntityMirror();
			motion.prepareSnapshot({
				entities: [player, corpse, pending],
				hostTime: { seconds: 0 },
			})();
			expect(
				sampleCycleCandidates(
					entities,
					motion,
					TARGETING_TEST_VIEW,
					POLICY,
					true,
					PEACE_CONTEXT,
				),
			).toEqual([
				{
					...worldObject(2, 5),
					filters:
						corpseState === "unopened"
							? { "non-creature": "cycle", "unopened-corpse": "cycle" }
							: { "non-creature": "cycle" },
				},
				{
					...worldObject(3, 10),
					filters: {
						"non-creature": "cycle",
						"smart-combat": "immediate-only",
					},
				},
			]);
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
			sampleCycleCandidates(
				entities,
				motion,
				TARGETING_TEST_VIEW,
				POLICY,
				true,
				PEACE_CONTEXT,
			);
		expect(sample()).toEqual([candidate(2, 10), worldObject(3, 5, -1)]);
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
			sampleCycleCandidates(
				entities,
				motion,
				reversedView,
				POLICY,
				true,
				PEACE_CONTEXT,
			),
		).toEqual([worldObject(3, 5, -1)]);
		const moved = targetingEntity(2, 1);
		moved.placement.pose.coords.y = -1;
		motion.apply({ kind: "upserted", entity: moved });
		expect(sample()).toEqual([worldObject(3, 5, -1)]);
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
		expect(
			sampleCycleCandidates(
				entities,
				motion,
				null,
				POLICY,
				true,
				PEACE_CONTEXT,
			),
		).toEqual([worldObject(2, POLICY.radiusMeters, 0)]);
		const moved = targetingEntity(2, 1);
		moved.placement.pose.coords.x = 100;
		moved.placement.pose.coords.z = POLICY.radiusMeters + 1;
		motion.apply({ kind: "upserted", entity: moved });
		expect(
			sampleCycleCandidates(
				entities,
				motion,
				null,
				POLICY,
				true,
				PEACE_CONTEXT,
			),
		).toEqual([]);
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
		expect(
			sampleCycleCandidates(
				entities,
				motion,
				null,
				POLICY,
				true,
				PEACE_CONTEXT,
			),
		).toEqual([worldObject(2, 2, 0)]);
		entities.awaitSnapshot();
		expect(
			sampleCycleCandidates(
				entities,
				motion,
				null,
				POLICY,
				true,
				PEACE_CONTEXT,
			),
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
