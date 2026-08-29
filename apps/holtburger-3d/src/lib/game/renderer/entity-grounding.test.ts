import { describe, expect, it } from "vitest";
import { Mat4, AABB3, Vec3 } from "../math/types";
import type {
	ResolvedScenePlacement,
	SceneSpatialMembership,
	SceneTopologyView,
} from "../scene";
import {
	DEFAULT_ENTITY_SHADOW_SETTINGS,
	MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER,
} from "./entity-shadow-policy";
import {
	createEntityGroundingCaster,
	createEntityGroundingSelection,
	createEntityGroundingSelectionScratch,
	createIndoorGroundingCell,
	createOutdoorGroundingLandblock,
	indexIndoorVisibilityIslands,
	selectIndoorGroundingCasters,
	selectOutdoorGroundingCasters,
} from "./entity-grounding";

const CELL_A = {
	kind: "env-cell",
	landblockId: "0x0102ffff",
	envCellId: "0x01020100",
} as const;
const CELL_B = { ...CELL_A, envCellId: "0x01020101" } as const;
const CELL_STACKED = { ...CELL_A, envCellId: "0x01020102" } as const;
const ISLAND_A = "env-cell-island:a" as const;
const ISLAND_STACKED = "env-cell-island:stacked" as const;
const TOPOLOGY = {
	crossings: [],
	outgoing: () => [],
	revision: 1,
	scopes: [
		{
			potentiallyVisibleEnvCellIds: new Set(),
			scope: { kind: "outdoor" },
			visibilityIslandId: null,
		},
		{
			potentiallyVisibleEnvCellIds: new Set(),
			scope: CELL_A,
			visibilityIslandId: ISLAND_A,
		},
		{
			potentiallyVisibleEnvCellIds: new Set(),
			scope: CELL_B,
			visibilityIslandId: ISLAND_A,
		},
		{
			potentiallyVisibleEnvCellIds: new Set(),
			scope: CELL_STACKED,
			visibilityIslandId: ISLAND_STACKED,
		},
	],
} satisfies SceneTopologyView;
const ISLANDS = indexIndoorVisibilityIslands(TOPOLOGY);
const SETTINGS = DEFAULT_ENTITY_SHADOW_SETTINGS.grounding;

describe("entity grounding", () => {
	it("combines a transformed rigid footprint with authoritative root height", () => {
		const caster = createEntityGroundingCaster(
			{
				category: "mob",
				identity: "guid:1",
				rigidBounds: new AABB3(new Vec3(-1, -20, -2), new Vec3(1, 40, 2)),
				placement: placementAt(3, 5, 7),
				spatialMembership: membership(CELL_A, CELL_B),
			},
			ISLANDS,
			SETTINGS,
		);
		expect(caster).not.toBeNull();
		expect(caster!.contactAnchor).toEqual(new Vec3(195, 7, -379));
		expect(caster!.radius).toBe(2);
		expect(caster!.visibilityIslandIds).toEqual([ISLAND_A]);
		expect(caster!.influenceBounds.min.y).toBe(7 - SETTINGS.maximumDrop);
		expect(caster!.influenceBounds.max.y).toBe(7 + SETTINGS.contactBias);
	});

	it("keeps root contact stable while rigid-pose center and radius animate", () => {
		const common = {
			category: "mob" as const,
			identity: "guid:animated",
			placement: placementAt(3, 5, 7),
			spatialMembership: membership(CELL_A),
		};
		const narrow = createEntityGroundingCaster(
			{
				...common,
				rigidBounds: new AABB3(new Vec3(-1, -100, -1), new Vec3(1, 100, 1)),
			},
			ISLANDS,
			SETTINGS,
		);
		const wide = createEntityGroundingCaster(
			{
				...common,
				rigidBounds: new AABB3(new Vec3(1, -200, -4), new Vec3(7, 300, 2)),
			},
			ISLANDS,
			SETTINGS,
		);
		expect(narrow?.contactAnchor.y).toBe(7);
		expect(wide?.contactAnchor.y).toBe(7);
		expect(wide?.contactAnchor.x).not.toBe(narrow?.contactAnchor.x);
		expect(narrow?.radius).toBe(1);
		expect(wide?.radius).toBe(3);
	});

	it("moves contact height exactly with authoritative root placement", () => {
		const rigidBounds = new AABB3(new Vec3(-1, -100, -1), new Vec3(1, 100, 1));
		const createAt = (y: number) =>
			createEntityGroundingCaster(
				{
					category: "npc",
					identity: "guid:moving",
					rigidBounds,
					placement: placementAt(0, 0, y),
					spatialMembership: membership(CELL_A),
				},
				ISLANDS,
				SETTINGS,
			);
		expect(createAt(9)?.contactAnchor.y).toBe(
			(createAt(2)?.contactAnchor.y ?? Number.NaN) + 7,
		);
	});

	it("retains outdoor-only membership and rejects a zero horizontal radius", () => {
		const common = {
			category: "mob" as const,
			identity: "guid:1",
			placement: placementAt(0, 0),
		};
		const outdoor = createEntityGroundingCaster(
			{
				...common,
				rigidBounds: new AABB3(Vec3.zero(), new Vec3(1, 1, 1)),
				spatialMembership: membership({ kind: "outdoor" }),
			},
			ISLANDS,
			SETTINGS,
		);
		expect(outdoor?.reachesOutdoors).toBe(true);
		expect(outdoor?.visibilityIslandIds).toEqual([]);
		expect(
			createEntityGroundingCaster(
				{
					...common,
					rigidBounds: new AABB3(Vec3.zero(), new Vec3(0, 1, 0)),
					spatialMembership: membership(CELL_A),
				},
				ISLANDS,
				SETTINGS,
			),
		).toBeNull();
	});

	it("selects outdoor candidates per landblock and ranks only overflow", () => {
		const selection = createEntityGroundingSelection();
		const scratch = createEntityGroundingSelectionScratch();
		const landblock = createOutdoorGroundingLandblock("0x0000ffff");
		const capacity = MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER;
		const withinCapacity = Array.from({ length: capacity }, (_, index) =>
			outdoorCaster(`guid:${index}`, capacity - index),
		);
		selectOutdoorGroundingCasters(
			landblock,
			withinCapacity,
			Vec3.zero(),
			Vec3.zero(),
			selection,
			scratch,
		);
		expect(recordXs(selection)).toEqual(
			withinCapacity.map((caster) => caster.contactAnchor.x),
		);

		selectOutdoorGroundingCasters(
			landblock,
			[...withinCapacity, outdoorCaster("guid:near", 0.5)],
			Vec3.zero(),
			Vec3.zero(),
			selection,
			scratch,
		);
		expect(recordXs(selection)).toEqual([
			0.5,
			...Array.from({ length: capacity - 1 }, (_, index) => index + 1),
		]);
	});

	it("admits one border influence to both adjacent outdoor landblocks", () => {
		const caster = outdoorCaster("guid:border", 192);
		const selection = createEntityGroundingSelection();
		const scratch = createEntityGroundingSelectionScratch();
		for (const landblockId of ["0x0000ffff", "0x0100ffff"]) {
			selectOutdoorGroundingCasters(
				createOutdoorGroundingLandblock(landblockId),
				[caster],
				Vec3.zero(),
				Vec3.zero(),
				selection,
				scratch,
			);
			expect(selection.count).toBe(1);
		}
	});

	it("rejects indoor-only casters from outdoor terrain", () => {
		const selection = createEntityGroundingSelection();
		selectOutdoorGroundingCasters(
			createOutdoorGroundingLandblock("0x0000ffff"),
			[requiredCaster("guid:indoor", 4, membership(CELL_A))],
			Vec3.zero(),
			Vec3.zero(),
			selection,
			createEntityGroundingSelectionScratch(),
		);
		expect(selection.count).toBe(0);
	});

	it("rejects categories outside the shared actor-caster policy", () => {
		expect(
			createEntityGroundingCaster(
				{
					category: "other",
					identity: "ordinary-item",
					rigidBounds: new AABB3(Vec3.zero(), new Vec3(1, 1, 1)),
					placement: placementAt(0, 0),
					spatialMembership: membership(CELL_A),
				},
				ISLANDS,
				SETTINGS,
			),
		).toBeNull();
	});

	it("shares a seam caster across same-island cells but rejects a stacked island", () => {
		const caster = requiredCaster("guid:1", 4, membership(CELL_A, CELL_B));
		const selection = createEntityGroundingSelection();
		const scratch = createEntityGroundingSelectionScratch();
		for (const scope of [CELL_A, CELL_B]) {
			selectIndoorGroundingCasters(
				createIndoorGroundingCell(scope, boundsAround(4), ISLANDS),
				[caster],
				Vec3.zero(),
				Vec3.zero(),
				selection,
				scratch,
			);
			expect(selection.count).toBe(1);
		}
		selectIndoorGroundingCasters(
			createIndoorGroundingCell(CELL_STACKED, boundsAround(4), ISLANDS),
			[caster],
			Vec3.zero(),
			Vec3.zero(),
			selection,
			scratch,
		);
		expect(selection.count).toBe(0);
	});

	it("preserves candidate order through capacity and ranks only overflow", () => {
		const selection = createEntityGroundingSelection();
		const scratch = createEntityGroundingSelectionScratch();
		const cell = createIndoorGroundingCell(CELL_A, wideBounds(), ISLANDS);
		const capacity = MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER;
		const withinCapacity = Array.from({ length: capacity }, (_, index) =>
			requiredCaster(`guid:${index}`, capacity - index, membership(CELL_A)),
		);
		selectIndoorGroundingCasters(
			cell,
			withinCapacity,
			Vec3.zero(),
			Vec3.zero(),
			selection,
			scratch,
		);
		expect(recordXs(selection)).toEqual(
			withinCapacity.map((caster) => caster.contactAnchor.x),
		);

		const overflow = [
			...withinCapacity,
			requiredCaster("guid:z", 0.5, membership(CELL_A)),
		];
		selectIndoorGroundingCasters(
			cell,
			overflow,
			Vec3.zero(),
			Vec3.zero(),
			selection,
			scratch,
		);
		expect(recordXs(selection)).toEqual([
			0.5,
			...Array.from({ length: capacity - 1 }, (_, index) => index + 1),
		]);
	});

	it("uses identity as a deterministic equal-distance overflow tie", () => {
		const selection = createEntityGroundingSelection();
		const scratch = createEntityGroundingSelectionScratch();
		const cell = createIndoorGroundingCell(CELL_A, wideBounds(), ISLANDS);
		const capacity = MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER;
		const casters = Array.from({ length: capacity - 1 }, (_, index) =>
			requiredCaster(`guid:${index}`, index + 1, membership(CELL_A)),
		);
		casters.push(
			requiredCaster("guid:b", -capacity, membership(CELL_A)),
			requiredCaster("guid:a", capacity, membership(CELL_A)),
		);
		selectIndoorGroundingCasters(
			cell,
			casters,
			Vec3.zero(),
			Vec3.zero(),
			selection,
			scratch,
		);
		expect(recordXs(selection).at(-1)).toBe(capacity);
	});

	it("writes anchor-relative records and rejects nonintersecting influence", () => {
		const selection = createEntityGroundingSelection();
		selectIndoorGroundingCasters(
			createIndoorGroundingCell(CELL_A, boundsAround(2), ISLANDS),
			[
				requiredCaster("near", 2, membership(CELL_A)),
				requiredCaster("far", 100, membership(CELL_A)),
			],
			Vec3.zero(),
			new Vec3(1, 0, 0),
			selection,
			createEntityGroundingSelectionScratch(),
		);
		expect(selection.count).toBe(1);
		expect(Array.from(selection.records.slice(0, 4))).toEqual([1, 0, 0, 1]);
	});
});

function placementAt(x: number, z: number, y = 0): ResolvedScenePlacement {
	const localToLandblock = Mat4.identity();
	localToLandblock.m41 = x;
	localToLandblock.m42 = y;
	localToLandblock.m43 = z;
	return {
		envCellId: CELL_A.envCellId,
		landblockId: CELL_A.landblockId,
		localToLandblock,
		scope: CELL_A,
	};
}

function membership(
	...scopes: SceneSpatialMembership["scopes"]
): SceneSpatialMembership {
	return { scopes };
}

function requiredCaster(
	identity: string,
	x: number,
	spatialMembership: SceneSpatialMembership,
) {
	const caster = createEntityGroundingCaster(
		{
			category: "npc",
			identity,
			rigidBounds: new AABB3(new Vec3(-1, 0, -1), new Vec3(1, 2, 1)),
			placement: placementAt(x - 192, 384),
			spatialMembership,
		},
		ISLANDS,
		SETTINGS,
	);
	if (!caster) throw new Error("Fixture caster was rejected.");
	return caster;
}

function outdoorCaster(identity: string, x: number) {
	const localToLandblock = Mat4.identity();
	localToLandblock.m41 = x;
	localToLandblock.m43 = -1;
	const caster = createEntityGroundingCaster(
		{
			category: "npc",
			identity,
			rigidBounds: new AABB3(new Vec3(-1, 0, -1), new Vec3(1, 2, 1)),
			placement: {
				envCellId: null,
				landblockId: "0x0000ffff",
				localToLandblock,
				scope: { kind: "outdoor" },
			},
			spatialMembership: membership({ kind: "outdoor" }),
		},
		ISLANDS,
		SETTINGS,
	);
	if (!caster) throw new Error("Outdoor fixture caster was rejected.");
	return caster;
}

function boundsAround(x: number): AABB3 {
	return new AABB3(new Vec3(x - 1, -1, -1), new Vec3(x + 1, 1, 1));
}

function wideBounds(): AABB3 {
	return new AABB3(new Vec3(-20, -1, -20), new Vec3(20, 1, 20));
}

function recordXs(
	selection: ReturnType<typeof createEntityGroundingSelection>,
): number[] {
	return Array.from(
		{ length: selection.count },
		(_, index) => selection.records[index * 4]!,
	);
}
