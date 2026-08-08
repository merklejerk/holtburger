import { describe, expect, it } from "vitest";
import {
	ambientSoundTableIds,
	createAmbientTableResolver,
	type AmbientRegionFacts,
} from "./ambient-region";

function sound(
	overrides: Partial<
		AmbientRegionFacts["tables"][number]["sounds"][number]
	> = {},
) {
	return {
		baseChance: 0.5,
		isContinuous: false,
		maxRate: 12,
		minRate: 3,
		soundType: 70,
		volume: 1,
		...overrides,
	};
}

/**
 * Two terrain types selecting different scene types, which in turn name different tables. The
 * indirection is the point: a cell's scene-type field is a *local* index into its terrain type's
 * list, not a direct index into the region's scene types.
 */
const FACTS: AmbientRegionFacts = {
	sceneTypes: [
		{ soundTableIndex: 1 },
		{ soundTableIndex: 0 },
		{ soundTableIndex: 9 },
	],
	tables: [
		{ soundTableId: "0x20000017", sounds: [sound({ soundType: 70 })] },
		{ soundTableId: "0x2000001A", sounds: [sound({ soundType: 74 })] },
	],
	terrainTypes: [
		{ sceneTypes: [1, 0] },
		{ sceneTypes: [0] },
		{ sceneTypes: [2] },
	],
};

describe("createAmbientTableResolver", () => {
	it("chains a cell's terrain and scene type through to its table's descriptors", () => {
		const resolve = createAmbientTableResolver(FACTS);

		// Terrain 0, local scene 0 -> region scene type 1 -> table 0.
		expect(resolve(0, 0)?.[0]).toMatchObject({
			soundTableId: "0x20000017",
			soundType: 70,
			tableIndex: 0,
		});
		// Terrain 0, local scene 1 -> region scene type 0 -> table 1.
		expect(resolve(0, 1)?.[0]).toMatchObject({
			soundTableId: "0x2000001A",
			soundType: 74,
			tableIndex: 1,
		});
	});

	it("treats the scene-type field as a local index, not a region-wide one", () => {
		const resolve = createAmbientTableResolver(FACTS);

		// Terrain 1 lists only one scene type, so local index 0 resolves and 1 does not exist.
		expect(resolve(1, 0)).not.toBeNull();
		expect(resolve(1, 1)).toBeNull();
	});

	it("yields null for a classification whose table is missing", () => {
		// Terrain 2's scene type names table 9, which the region does not author.
		expect(createAmbientTableResolver(FACTS)(2, 0)).toBeNull();
	});

	it("yields null for a terrain type the region does not author", () => {
		expect(createAmbientTableResolver(FACTS)(31, 0)).toBeNull();
	});

	it("shares one descriptor list between every classification reaching the same table", () => {
		const resolve = createAmbientTableResolver(FACTS);
		// Terrain 0 local 1 and terrain 1 local 0 both reach region scene type 0, hence table 1.
		expect(resolve(0, 1)).toBe(resolve(1, 0));
	});
});

describe("ambientSoundTableIds", () => {
	it("lists each table once, so staging does not load a shared table twice", () => {
		const facts: AmbientRegionFacts = {
			...FACTS,
			tables: [
				{ soundTableId: "0x20000017", sounds: [] },
				{ soundTableId: "0x20000017", sounds: [] },
				{ soundTableId: "0x2000001A", sounds: [] },
			],
		};

		expect(ambientSoundTableIds(facts)).toEqual(["0x20000017", "0x2000001A"]);
	});
});
