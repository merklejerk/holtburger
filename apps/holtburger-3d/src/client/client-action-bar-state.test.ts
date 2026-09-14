import { expect, it } from "vitest";
import {
	ACTION_SLOT_INDICES,
	MAX_ACTION_BARS,
	actionDigitIndex,
	bindActionCell,
	cloneActionBar,
	cycleActionBar,
	deleteActionBar,
	initialActionBar,
	swapActionCells,
} from "./client-action-bar-state";
import {
	actionCellPosition,
	navigateActionCell,
} from "./client-action-bar-layout";

it("cycles with wrapping and closes deleted sequence gaps", () => {
	const bars = [1, 2, 3].map((id) => ({ ...initialActionBar(), id }));
	expect(cycleActionBar(bars, 2).map((bar) => bar.id)).toEqual([1, 3, 2]);
	expect(cycleActionBar(bars, 3).map((bar) => bar.id)).toEqual([3, 1, 2]);
	expect(deleteActionBar(bars, 2).map((bar) => bar.id)).toEqual([1, 3]);
});
it("preserves limits and independently editable clone bindings", () => {
	let bars = bindActionCell(
		[initialActionBar()],
		{ bar: 1, slot: 4 },
		{ kind: "equipment", item: 42, replacement: null },
	);
	expect(deleteActionBar(bars, 1)).toBe(bars);
	for (let id = 2; id <= MAX_ACTION_BARS; id++)
		bars = cloneActionBar(bars, 1, { id, anchor: initialActionBar().anchor });
	expect(
		cloneActionBar(bars, 1, {
			id: MAX_ACTION_BARS + 1,
			anchor: initialActionBar().anchor,
		}),
	).toBe(bars);
	const changed = bindActionCell(bars, { bar: 1, slot: 4 }, null);
	expect(changed.find((bar) => bar.id === 2)?.slots[4]).toEqual({
		kind: "equipment",
		item: 42,
		replacement: null,
	});
	expect(
		changed.every((bar) => bar.slots.length === ACTION_SLOT_INDICES.length),
	).toBe(true);
});
it("swaps sparse contents atomically across bars", () => {
	const source = { bar: 1, slot: 2 } as const;
	const target = { bar: 2, slot: 8 } as const;
	const bound = bindActionCell(
		[initialActionBar(), { ...initialActionBar(), id: 2 }],
		source,
		{ kind: "equipment", item: 42, replacement: null },
	);
	const moved = swapActionCells(bound, source, target);
	expect(moved[0]?.slots[2]).toBeNull();
	expect(moved[1]?.slots[8]).toEqual({
		kind: "equipment",
		item: 42,
		replacement: null,
	});
	expect(swapActionCells(moved, target, target)).toBe(moved);
	expect(swapActionCells(moved, target, source)).toEqual(bound);
});
it("maps digit labels and rejects non-digit commands", () => {
	for (const slot of ACTION_SLOT_INDICES)
		expect(actionDigitIndex(String((slot + 1) % MAX_ACTION_BARS))).toBe(slot);
	expect(actionDigitIndex("10")).toBeNull();
	expect(actionDigitIndex("Enter")).toBeNull();
});
it.each(["horizontal", "vertical"] as const)(
	"maps all %s shapes without losing slots",
	(orientation) => {
		for (const shape of ["single", "double"] as const) {
			const bar = { orientation, shape };
			const positions = ACTION_SLOT_INDICES.map((slot) =>
				actionCellPosition(bar, slot),
			);
			expect(
				new Set(positions.map(({ row, column }) => `${row}:${column}`)).size,
			).toBe(ACTION_SLOT_INDICES.length);
			for (const slot of ACTION_SLOT_INDICES) {
				expect(
					navigateActionCell(
						bar,
						navigateActionCell(bar, slot, "right"),
						"left",
					),
				).toBe(slot);
				expect(
					navigateActionCell(bar, navigateActionCell(bar, slot, "down"), "up"),
				).toBe(slot);
			}
		}
	},
);
it("numbers second strips and wraps visually", () => {
	expect(
		actionCellPosition({ orientation: "horizontal", shape: "double" }, 5),
	).toEqual({ row: 1, column: 0 });
	expect(
		actionCellPosition({ orientation: "vertical", shape: "double" }, 5),
	).toEqual({ row: 0, column: 1 });
	expect(
		navigateActionCell(
			{ orientation: "horizontal", shape: "double" },
			0,
			"left",
		),
	).toBe(4);
	expect(
		navigateActionCell({ orientation: "horizontal", shape: "double" }, 0, "up"),
	).toBe(5);
});
