import { describe, expect, it } from "vitest";
import {
	itemCellPresentation,
	type ItemCellFacts,
} from "./item-cell-presentation";

const item: ItemCellFacts = {
	label: "Tool",
	count: null,
	structure: null,
	capacity: null,
	equipped: false,
};

describe("item cell presentation", () => {
	it("combines exact quantity, remaining uses, and equipment status", () => {
		expect(
			itemCellPresentation({
				...item,
				count: 20100,
				structure: { current: 10, max: 50 },
				equipped: true,
			}),
		).toEqual({
			label: "Tool (quantity: 20,100) [10/50] (Equipped)",
			count: 20100,
			meter: { fraction: 0.2, hue: 24 },
			equipped: true,
		});
	});
	it("keeps empty container occupancy in the tooltip without drawing a bar", () => {
		expect(
			itemCellPresentation({
				...item,
				capacity: { used: 0, max: 24 },
				structure: { current: 10, max: 50 },
			}),
		).toMatchObject({ label: "Tool [0 / 24]", meter: null });
	});
	it.each([
		[6, 24, 0.25, 90],
		[24, 24, 1, 0],
		[25, 24, 1, 0],
		[1, 0, 1, 0],
	])(
		"fills container occupancy %s/%s toward red",
		(used, max, fraction, hue) => {
			expect(
				itemCellPresentation({ ...item, capacity: { used, max } }),
			).toMatchObject({
				label: `Tool [${used} / ${max}]`,
				meter: { fraction, hue },
			});
		},
	);
	it("retains an empty red track for exhausted structure", () => {
		expect(
			itemCellPresentation({ ...item, structure: { current: 0, max: 50 } }),
		).toMatchObject({ label: "Tool [0/50]", meter: { fraction: 0, hue: 0 } });
	});
});
