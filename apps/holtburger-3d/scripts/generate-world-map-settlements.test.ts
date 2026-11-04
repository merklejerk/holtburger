import { describe, expect, it } from "vitest";
import { generateWorldMapSettlements } from "./generate-world-map-settlements";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../src/lib/game/landblocks";
import { WORLD_MAP_EXTENT } from "../src/lib/game/world-map/types";

const row = (
	name = "Holtburg",
	portal = "42820",
	cell = "A9B40019",
	x = "84",
	y = "7.1",
	z = "94",
	count = "1",
	sourceKind = "portal",
) => [name, portal, cell, x, y, z, count, sourceKind].join("\t");

describe("settlement generation recipe", () => {
	it("accepts a tagged vendor's outdoor root placement and retains source provenance", async () => {
		const result = await generateWorldMapSettlements(
			row(
				"Crater Lake Village",
				"2498",
				"90D00000",
				"59.0085",
				"107.151",
				"297.207",
				"1",
				"vendor",
			),
		);
		expect(result).toContain("ACE vendor 2498, placement cell 0x90D00000");
		expect(result).toContain(
			`sceneVector3([${0x90 * OUTDOOR_LANDBLOCK_WORLD_SIZE + 59.0085}, 297.207, ${-(0xd0 * OUTDOOR_LANDBLOCK_WORLD_SIZE + 107.151)}])`,
		);
	});

	it("preserves source precision and emits stable canonical scene coordinates", async () => {
		const result = await generateWorldMapSettlements(row());
		expect(result).toContain(
			`sceneVector3([${0xa9 * OUTDOOR_LANDBLOCK_WORLD_SIZE + 84}, 94, ${-(0xb4 * OUTDOOR_LANDBLOCK_WORLD_SIZE + 7.1)}])`,
		);
		expect(result).toContain("ACE portal 42820, destination cell 0xA9B40019");
		const first = row("A", "1", "00000001", "0", "0", "0", "2");
		const second = row("B", "2", "FEFE0040", "192", "192", "0", "2");
		expect(await generateWorldMapSettlements(`${first}\n${second}\n`)).toBe(
			await generateWorldMapSettlements(`${second}\n${first}`),
		);
		expect(
			await generateWorldMapSettlements(
				second.replace(/\t2\tportal$/, "\t1\tportal"),
			),
		).toContain(`sceneVector3([${WORLD_MAP_EXTENT}, 0, -${WORLD_MAP_EXTENT}])`);
	});
	it.each([
		["", "empty"],
		[
			row("Town", "2498", "90D00100", "0", "0", "0", "1", "vendor"),
			"not an outdoor",
		],
		[
			row("Town", "2498", "90D00000", "0", "0", "0", "1", "unknown"),
			"unknown anchor source",
		],
		["name\t1", "eight TSV"],
		[row(" "), "invalid settlement name"],
		[row("Town", "0"), "invalid source WCID"],
		[row("Town", "1", "NULL"), "no anchor record"],
		[row("Town", "1", "invalid"), "invalid anchor cell"],
		[row("Town", "1", "00000100"), "not an outdoor"],
		[row("Town", "1", "00000000"), "not an outdoor"],
		[row("Town", "1", "FF000001"), "unauthored landblock"],
		[row("Town", "1", "00000001", "NaN"), "invalid anchor coordinate"],
		[row("Town", "1", "00000001", "-1"), "outside the outdoor world"],
		[
			row("Town", "1", "00000001", "0", "0", "0", "2"),
			"incomplete or ambiguous",
		],
	])("rejects invalid source data: %s", async (input, diagnostic) => {
		await expect(generateWorldMapSettlements(input)).rejects.toThrow(
			diagnostic,
		);
	});
	it("rejects duplicate names and ambiguous reuse of a source portal", async () => {
		await expect(
			generateWorldMapSettlements(
				`${row("A", "1", "00000001", "0", "0", "0", "2")}\n${row("A", "2", "00000001", "0", "0", "0", "2")}`,
			),
		).rejects.toThrow("Duplicate settlement name");
		await expect(
			generateWorldMapSettlements(
				`${row("A", "1", "00000001", "0", "0", "0", "2")}\n${row("B", "1", "00000001", "0", "0", "0", "2")}`,
			),
		).rejects.toThrow("duplicate anchor source");
	});
});
