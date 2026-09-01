import { describe, expect, it } from "vitest";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import { Mat4, AABB3, Vec3 } from "../math/types";
import type {
	ResolvedScenePlacement,
	SceneSpatialMembership,
	SceneTopologyView,
} from "../scene";
import {
	DEFAULT_ENTITY_SHADOW_SETTINGS,
	MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER,
} from "./entity-shadow-policy";
import {
	resolveEntityShadowCaster,
	createEntityGroundingSelection,
	createEntityGroundingSelectionScratch,
	createIndoorGroundingCell,
	createOutdoorDirectionalShadowCaster,
	createOutdoorDirectionalShadowSelection,
	createOutdoorDirectionalShadowSelectionScratch,
	createOutdoorDirectionalShadowTerrain,
	indexIndoorVisibilityIslands,
	selectIndoorGroundingCasters,
	selectOutdoorDirectionalShadowCasters,
} from "./entity-grounding";
import { resolveOutdoorShadowProjection } from "./outdoor-pssm";

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
const SETTINGS = DEFAULT_ENTITY_SHADOW_SETTINGS.indoorGrounding;
const OUTDOOR_SETTINGS =
	SHARED_FRONTEND_TUNING.rendering.entityShadows.outdoorDirectional;
const PROJECTION = resolveOutdoorShadowProjection(
	new Vec3(1, 1, 0),
	DEFAULT_ENTITY_SHADOW_SETTINGS.projection,
);

describe("entity grounding", () => {
	it("combines a transformed rigid footprint with authoritative root height", () => {
		const caster = resolveEntityShadowCaster(
			{
				entityClass: "mob",
				identity: "guid:1",
				rigidBounds: new AABB3(new Vec3(-1, -20, -2), new Vec3(1, 40, 2)),
				placement: placementAt(3, 5, 7),
				spatialMembership: membership(CELL_A, CELL_B),
			},
			ISLANDS,
			SETTINGS,
		);
		if (caster === null || caster.indoorGrounding === null) {
			throw new Error("Expected a resolved indoor shadow caster.");
		}
		expect(caster.shape.contactAnchor).toEqual(new Vec3(195, 7, -379));
		expect(caster.shape.radius).toBe(2);
		expect(caster.indoorGrounding.visibilityIslandIds).toEqual([ISLAND_A]);
		expect(caster.indoorGrounding.influenceBounds.min.y).toBe(
			7 - SETTINGS.maximumDrop,
		);
		expect(caster.indoorGrounding.influenceBounds.max.y).toBe(
			7 + SETTINGS.contactBias,
		);
	});

	it("keeps root contact stable while rigid-pose center and radius animate", () => {
		const common = {
			entityClass: "mob" as const,
			identity: "guid:animated",
			placement: placementAt(3, 5, 7),
			spatialMembership: membership(CELL_A),
		};
		const narrow = resolveEntityShadowCaster(
			{
				...common,
				rigidBounds: new AABB3(new Vec3(-1, -100, -1), new Vec3(1, 100, 1)),
			},
			ISLANDS,
			SETTINGS,
		);
		const wide = resolveEntityShadowCaster(
			{
				...common,
				rigidBounds: new AABB3(new Vec3(1, -200, -4), new Vec3(7, 300, 2)),
			},
			ISLANDS,
			SETTINGS,
		);
		expect(narrow?.shape.contactAnchor.y).toBe(7);
		expect(wide?.shape.contactAnchor.y).toBe(7);
		expect(wide?.shape.contactAnchor.x).not.toBe(narrow?.shape.contactAnchor.x);
		expect(narrow?.shape.radius).toBe(1);
		expect(wide?.shape.radius).toBe(3);
	});

	it("moves contact height exactly with authoritative root placement", () => {
		const rigidBounds = new AABB3(new Vec3(-1, -100, -1), new Vec3(1, 100, 1));
		const createAt = (y: number) =>
			resolveEntityShadowCaster(
				{
					entityClass: "npc",
					identity: "guid:moving",
					rigidBounds,
					placement: placementAt(0, 0, y),
					spatialMembership: membership(CELL_A),
				},
				ISLANDS,
				SETTINGS,
			);
		const lower = createAt(2);
		const upper = createAt(9);
		if (lower === null || upper === null) {
			throw new Error("Expected both moving shadow casters to resolve.");
		}
		expect(upper.shape.contactAnchor.y).toBe(lower.shape.contactAnchor.y + 7);
	});

	it("retains outdoor-only membership and rejects a zero horizontal radius", () => {
		const common = {
			entityClass: "mob" as const,
			identity: "guid:1",
			placement: placementAt(0, 0),
		};
		const outdoor = resolveEntityShadowCaster(
			{
				...common,
				rigidBounds: new AABB3(Vec3.zero(), new Vec3(1, 1, 1)),
				spatialMembership: membership({ kind: "outdoor" }),
			},
			ISLANDS,
			SETTINGS,
		);
		expect(outdoor?.reachesOutdoors).toBe(true);
		expect(outdoor?.indoorGrounding).toBeNull();
		expect(
			resolveEntityShadowCaster(
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
		const selection = createOutdoorDirectionalShadowSelection();
		const scratch = createOutdoorDirectionalShadowSelectionScratch();
		const landblock = createOutdoorDirectionalShadowTerrain("0x0000ffff");
		const capacity = MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER;
		const withinCapacity = Array.from({ length: capacity }, (_, index) =>
			outdoorCaster(`guid:${index}`, capacity - index),
		);
		selectOutdoorDirectionalShadowCasters(
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

		selectOutdoorDirectionalShadowCasters(
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
		const selection = createOutdoorDirectionalShadowSelection();
		const scratch = createOutdoorDirectionalShadowSelectionScratch();
		for (const landblockId of ["0x0000ffff", "0x0100ffff"]) {
			selectOutdoorDirectionalShadowCasters(
				createOutdoorDirectionalShadowTerrain(landblockId),
				[caster],
				Vec3.zero(),
				Vec3.zero(),
				selection,
				scratch,
			);
			expect(selection.count).toBe(1);
		}
	});

	it("rejects directional casters outside the terrain footprint", () => {
		const selection = createOutdoorDirectionalShadowSelection();
		selectOutdoorDirectionalShadowCasters(
			createOutdoorDirectionalShadowTerrain("0x0000ffff"),
			[outdoorCaster("guid:far", 1_000)],
			Vec3.zero(),
			Vec3.zero(),
			selection,
			createOutdoorDirectionalShadowSelectionScratch(),
		);
		expect(selection.count).toBe(0);
	});

	it("rejects categories outside the shared actor-caster policy", () => {
		expect(
			resolveEntityShadowCaster(
				{
					entityClass: "other",
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
		const capacity = MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER;
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
		const capacity = MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER;
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
	const caster = resolveEntityShadowCaster(
		{
			entityClass: "npc",
			identity,
			rigidBounds: new AABB3(new Vec3(-1, 0, -1), new Vec3(1, 2, 1)),
			placement: placementAt(x - 192, 384),
			spatialMembership,
		},
		ISLANDS,
		SETTINGS,
	);
	if (!caster?.indoorGrounding) throw new Error("Fixture caster was rejected.");
	return caster.indoorGrounding;
}

function outdoorCaster(identity: string, x: number) {
	const localToLandblock = Mat4.identity();
	localToLandblock.m41 = x;
	localToLandblock.m43 = -1;
	const caster = resolveEntityShadowCaster(
		{
			entityClass: "npc",
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
	return createOutdoorDirectionalShadowCaster(
		caster.shape,
		PROJECTION,
		OUTDOOR_SETTINGS,
	);
}

function boundsAround(x: number): AABB3 {
	return new AABB3(new Vec3(x - 1, -1, -1), new Vec3(x + 1, 1, 1));
}

function wideBounds(): AABB3 {
	return new AABB3(new Vec3(-20, -1, -20), new Vec3(20, 1, 20));
}

function recordXs(
	selection:
		| ReturnType<typeof createEntityGroundingSelection>
		| ReturnType<typeof createOutdoorDirectionalShadowSelection>,
): number[] {
	const records =
		"records" in selection ? selection.records : selection.anchorsAndRadii;
	const values: number[] = [];
	for (let index = 0; index < selection.count; index += 1) {
		const value = records[index * 4];
		if (value === undefined) throw new Error(`Missing caster record ${index}.`);
		values.push(value);
	}
	return values;
}
