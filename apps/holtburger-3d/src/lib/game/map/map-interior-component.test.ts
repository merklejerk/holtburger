import { describe, expect, it } from "vitest";
import type { EnvCellId, LandblockId } from "../game-types";
import type { ResolvedPortalCrossing } from "../resolution/landblock-layer";
import {
	floodInteriorComponent,
	interiorComponentContains,
} from "./map-interior-component";

const LANDBLOCK = "0xda55ffff" as LandblockId;

function cell(ordinal: number): EnvCellId {
	return (0xda550100 + ordinal) as unknown as EnvCellId;
}

/** Only the endpoints matter to connectivity, so the rest of the crossing stays minimal. */
function crossing(
	source: EnvCellId | "outdoor",
	target: EnvCellId | "outdoor",
): ResolvedPortalCrossing {
	const scope = (value: EnvCellId | "outdoor") =>
		value === "outdoor"
			? ({ kind: "outdoor" } as const)
			: ({
					kind: "env-cell",
					landblockId: LANDBLOCK,
					envCellId: value,
				} as const);
	return {
		source: scope(source),
		target: scope(target),
	} as ResolvedPortalCrossing;
}

describe("floodInteriorComponent", () => {
	it("walks the connected rooms and stops at the component boundary", () => {
		const component = floodInteriorComponent(
			[
				crossing(cell(0), cell(1)),
				crossing(cell(1), cell(2)),
				// A second interior stacked in the same landblock, connected to nothing above.
				crossing(cell(7), cell(8)),
			],
			cell(0),
		);

		expect([...component]).toEqual([cell(0), cell(1), cell(2)]);
		expect(component.has(cell(7))).toBe(false);
	});

	it("crosses a one-way portal in both directions", () => {
		// The authored edge points only from 0 to 1; the map still shows both rooms, and flooding
		// from the far side finds its way back.
		const forward = floodInteriorComponent(
			[crossing(cell(0), cell(1))],
			cell(0),
		);
		const backward = floodInteriorComponent(
			[crossing(cell(0), cell(1))],
			cell(1),
		);

		expect(forward).toEqual(backward);
		expect(backward.has(cell(0))).toBe(true);
	});

	it("treats exterior transitions as leaving the interior, not as adjacency", () => {
		const component = floodInteriorComponent(
			[crossing(cell(0), "outdoor"), crossing("outdoor", cell(5))],
			cell(0),
		);

		expect([...component]).toEqual([cell(0)]);
	});

	it("returns the anchor's own cell when it has no portals at all", () => {
		expect([...floodInteriorComponent([], cell(3))]).toEqual([cell(3)]);
	});

	it("returns the same set from every member, so membership can revalidate it", () => {
		const crossings = [
			crossing(cell(0), cell(1)),
			crossing(cell(1), cell(2)),
			crossing(cell(2), cell(0)),
		];
		const fromFirst = floodInteriorComponent(crossings, cell(0));

		for (const ordinal of [1, 2]) {
			expect(floodInteriorComponent(crossings, cell(ordinal))).toEqual(
				fromFirst,
			);
		}
		expect(interiorComponentContains(fromFirst, cell(2))).toBe(true);
		expect(interiorComponentContains(fromFirst, cell(9))).toBe(false);
		expect(interiorComponentContains(fromFirst, null)).toBe(false);
	});
});
