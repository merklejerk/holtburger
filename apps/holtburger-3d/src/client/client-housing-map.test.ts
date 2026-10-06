import { describe, expect, it } from "vitest";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";
import {
	emptyHousing,
	housingSnapshotSchema,
	type HousingSnapshot,
} from "./client-housing-contract";
import {
	housingMapPosition,
	housingSearchAreaPosition,
} from "./client-housing-map";

function owned(houseType: number, cell: number): HousingSnapshot {
	return {
		...emptyHousing(),
		home: {
			kind: "owned",
			home: {
				houseType,
				boughtAt: null,
				maintenanceFree: true,
				buy: [],
				rent: [],
				maintenancePaid: true,
				period: null,
				position: {
					landblockId: cell,
					coords: { x: 12, y: 24, z: 3 },
					rotation: { w: 1, x: 0, y: 0, z: 0 },
				},
			},
		},
	};
}

describe("housing map placement", () => {
	it("describes search areas using the block center rather than a house position", () => {
		const position = housingSearchAreaPosition(0x01020001);
		expect(position).toEqual({
			x: 1.5 * OUTDOOR_LANDBLOCK_WORLD_SIZE,
			z: -2.5 * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		});
		expect(housingSearchAreaPosition(0x01020040)).toEqual(position);
	});

	it.each([1, 2, 3])(
		"places landscape type %i in canonical world axes",
		(type) => {
			const current = housingMapPosition(owned(type, 0x0101_0040));
			const east = housingMapPosition(owned(type, 0x0201_0040));
			const north = housingMapPosition(owned(type, 0x0102_0040));
			if (current === null || east === null || north === null)
				throw new Error("Expected landscape positions");
			expect(east.x).toBe(current.x + OUTDOOR_LANDBLOCK_WORLD_SIZE);
			expect(north.z).toBe(current.z - OUTDOOR_LANDBLOCK_WORLD_SIZE);
			expect(east.z).toBe(current.z);
		},
	);

	it("removes placement when replacement home is an apartment, unknown, or absent", () => {
		for (const type of [0, 4, 5, 0xffff_ffff]) {
			expect(housingMapPosition(owned(type, 0x0101_0040))).toBeNull();
		}
		expect(housingMapPosition(emptyHousing())).toBeNull();
		expect(
			housingMapPosition({ ...emptyHousing(), home: { kind: "none" } }),
		).toBeNull();
	});
});

describe("housing replacement contract", () => {
	it("retains a loaded home while refresh is pending", () => {
		const state = { ...owned(1, 0x0101_0040), refreshing: true };
		expect(housingSnapshotSchema.parse(state)).toEqual(state);
	});

	it("rejects missing facts, unknown keys, and non-finite positions", () => {
		expect(
			housingSnapshotSchema.safeParse({ home: { kind: "none" } }).success,
		).toBe(false);
		expect(
			housingSnapshotSchema.safeParse({ ...emptyHousing(), owner: 1 }).success,
		).toBe(false);
		const state = owned(1, 0x0101_0040);
		if (state.home.kind !== "owned") throw new Error("Expected fixture home");
		state.home.home.position.coords.x = Infinity;
		expect(housingSnapshotSchema.safeParse(state).success).toBe(false);
	});
});
