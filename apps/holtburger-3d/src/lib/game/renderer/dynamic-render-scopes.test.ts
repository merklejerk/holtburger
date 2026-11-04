import { describe, expect, it } from "vitest";

import type { SceneScope } from "../scene";
import { selectedDynamicRenderScopeKeys } from "./dynamic-render-scopes";

const OUTDOOR: SceneScope = { kind: "outdoor" };
const CELL_A: SceneScope = {
	envCellId: "0x00010100",
	kind: "env-cell",
	landblockId: "0x0001ffff",
};
const CELL_B: SceneScope = {
	envCellId: "0x00010101",
	kind: "env-cell",
	landblockId: "0x0001ffff",
};

describe("dynamic render scope selection", () => {
	it("rejects missing spatial membership", () => {
		expect(() => selectedDynamicRenderScopeKeys([], null)).toThrow(
			"has no spatial membership",
		);
	});

	it("draws a plural member once in flat mode", () => {
		expect(selectedDynamicRenderScopeKeys([OUTDOOR, CELL_A], null)).toEqual([
			"outdoor",
		]);
	});

	it("draws once in every selected distinct portal domain", () => {
		const ordinals = new Map<string, number>([
			["outdoor", 0],
			["0x00010100", 1],
		]);
		expect(
			selectedDynamicRenderScopeKeys([OUTDOOR, CELL_A, CELL_B], {
				selectedRenderDomainOrdinal: (key) => ordinals.get(key) ?? null,
			}),
		).toEqual(["outdoor", "0x00010100"]);
	});

	it("collapses sibling cells that share one visibility island", () => {
		expect(
			selectedDynamicRenderScopeKeys([CELL_A, CELL_B], {
				selectedRenderDomainOrdinal: () => 3,
			}),
		).toEqual(["0x00010100"]);
	});

	it("rejects a selected entity with no selected membership domain", () => {
		expect(() =>
			selectedDynamicRenderScopeKeys([CELL_A], {
				selectedRenderDomainOrdinal: () => null,
			}),
		).toThrow("no selected portal render domain");
	});
});
