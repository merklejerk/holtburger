import { expect, it } from "vitest";
import {
	bindSpellCell,
	initialSpellBar,
	SPELL_BAR_INDICES,
	swapSpellCells,
} from "./client-spell-bar-state";

it("retains exact addresses, duplicate spell bindings and unrelated tabs through transfers", () => {
	const first = { tab: 0, slot: 0 } as const;
	const last = { tab: 9, slot: 9 } as const;
	const other = { tab: 3, slot: 4 } as const;
	const initial = initialSpellBar();
	expect(initial.tabs).toHaveLength(SPELL_BAR_INDICES.length);
	for (const tab of initial.tabs)
		expect(tab).toEqual(SPELL_BAR_INDICES.map(() => null));
	const bound = bindSpellCell(
		bindSpellCell(bindSpellCell(initial, first, 42), last, 73),
		other,
		42,
	);
	const swapped = swapSpellCells(bound, first, last);
	expect(swapped.tabs[first.tab][first.slot]).toBe(73);
	expect(swapped.tabs[last.tab][last.slot]).toBe(42);
	expect(swapped.tabs[other.tab]).toBe(bound.tabs[other.tab]);
	expect(initial.tabs[first.tab][first.slot]).toBeNull();
	expect(
		bindSpellCell(swapped, first, null).tabs[first.tab][first.slot],
	).toBeNull();
	expect(swapSpellCells(bound, first, first)).toEqual(bound);
	const empty = { tab: 2, slot: 5 } as const;
	const moved = swapSpellCells(bound, first, empty);
	expect(moved.tabs[first.tab][first.slot]).toBeNull();
	expect(moved.tabs[empty.tab][empty.slot]).toBe(42);
});
