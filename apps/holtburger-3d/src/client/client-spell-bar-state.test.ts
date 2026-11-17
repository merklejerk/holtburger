import { expect, it } from "vitest";
import {
	bindSpellCell,
	cycleSpellTab,
	visibleSpellTabs,
	type ClientSpellBarState,
	initialSpellBar,
	SPELL_BAR_INDICES,
	swapSpellCells,
	swapSpellTabs,
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

it("keeps one trailing destination without shifting interior holes", () => {
	let state = initialSpellBar();
	for (const slot of SPELL_BAR_INDICES.slice(0, 9))
		state = bindSpellCell(state, { tab: 0, slot }, slot + 1);
	expect(state.tabs[0]).toHaveLength(SPELL_BAR_INDICES.length);
	state = bindSpellCell(state, { tab: 0, slot: 9 }, 10);
	expect(state.tabs[0]).toHaveLength(11);
	expect(state.tabs[0][10]).toBeNull();
	state = bindSpellCell(state, { tab: 0, slot: 10 }, 11);
	expect(state.tabs[0]).toHaveLength(12);
	state = bindSpellCell(state, { tab: 0, slot: 4 }, null);
	expect(state.tabs[0][10]).toBe(11);
	state = bindSpellCell(state, { tab: 0, slot: 10 }, null);
	expect(state.tabs[0]).toHaveLength(11);
	state = bindSpellCell(state, { tab: 0, slot: 9 }, null);
	expect(state.tabs[0]).toHaveLength(10);
	expect(state.tabs[0][4]).toBeNull();
});

it("swaps overflow cells across tabs before normalizing both tabs", () => {
	const overflow = SPELL_BAR_INDICES.length;
	let state = initialSpellBar();
	state = bindSpellCell(state, { tab: 0, slot: overflow - 1 }, 73);
	state = bindSpellCell(state, { tab: 0, slot: overflow }, 42);
	state = bindSpellCell(state, { tab: 0, slot: overflow - 1 }, null);
	state = swapSpellCells(
		state,
		{ tab: 0, slot: overflow },
		{ tab: 1, slot: 0 },
	);
	expect(state.tabs[0]).toEqual(SPELL_BAR_INDICES.map(() => null));
	expect(state.tabs[1][0]).toBe(42);
});

it("moves the last occupied cell into its trailing destination before trimming", () => {
	const lastNumbered = SPELL_BAR_INDICES.length - 1;
	const destination = lastNumbered + 1;
	const state = bindSpellCell(
		initialSpellBar(),
		{ tab: 0, slot: lastNumbered },
		42,
	);
	const moved = swapSpellCells(
		state,
		{ tab: 0, slot: lastNumbered },
		{ tab: 0, slot: destination },
	);
	expect(moved.tabs[0][lastNumbered]).toBeNull();
	expect(moved.tabs[0][destination]).toBe(42);
	expect(moved.tabs[0][destination + 1]).toBeNull();
	expect(moved.tabs[0]).toHaveLength(destination + 2);
});

it("exchanges whole tabs without losing overflow, holes, or selected identity", () => {
	const overflow = SPELL_BAR_INDICES.length;
	let state = bindSpellCell(
		initialSpellBar(),
		{ tab: 0, slot: overflow - 1 },
		42,
	);
	state = bindSpellCell(state, { tab: 0, slot: overflow }, 73);
	state = bindSpellCell(state, { tab: 1, slot: 2 }, 99);
	const swapped = swapSpellTabs(state, 0, 1);
	expect(swapped.selected).toBe(state.selected);
	expect(swapped.tabs[0]).toBe(state.tabs[1]);
	expect(swapped.tabs[1]).toBe(state.tabs[0]);
	for (const tab of SPELL_BAR_INDICES.slice(2))
		expect(swapped.tabs[tab]).toBe(state.tabs[tab]);
	expect(swapSpellTabs(swapped, 0, 1)).toEqual(state);
	expect(swapSpellTabs(state, 0, 0)).toBe(state);
	const moved = swapSpellTabs(state, 0, 9);
	expect(moved.tabs[0]).toBe(state.tabs[9]);
	expect(moved.tabs[9]).toBe(state.tabs[0]);
});

it("cycles populated tabs in either direction, wrapping and including overflow", () => {
	const empty = initialSpellBar();
	expect(cycleSpellTab(empty, "next")).toBe(empty.selected);
	expect(cycleSpellTab(empty, "previous")).toBe(empty.selected);
	const single = bindSpellCell(empty, { tab: 7, slot: 0 }, 42);
	expect(cycleSpellTab(single, "next")).toBe(7);
	expect(cycleSpellTab({ ...single, selected: 7 }, "next")).toBe(7);
	const filled = bindSpellCell(
		single,
		{ tab: 7, slot: SPELL_BAR_INDICES.length - 1 },
		42,
	);
	const extended = bindSpellCell(
		filled,
		{ tab: 7, slot: SPELL_BAR_INDICES.length },
		73,
	);
	const overflowOnly = bindSpellCell(
		bindSpellCell(extended, { tab: 7, slot: 0 }, null),
		{ tab: 7, slot: SPELL_BAR_INDICES.length - 1 },
		null,
	);
	const populated = bindSpellCell(overflowOnly, { tab: 2, slot: 0 }, 42);
	expect(cycleSpellTab({ ...populated, selected: 2 }, "next")).toBe(7);
	expect(cycleSpellTab({ ...populated, selected: 7 }, "next")).toBe(2);
	expect(cycleSpellTab({ ...populated, selected: 2 }, "previous")).toBe(7);
	expect(cycleSpellTab({ ...populated, selected: 7 }, "previous")).toBe(2);
	expect(cycleSpellTab({ ...populated, selected: 5 }, "next")).toBe(7);
	expect(cycleSpellTab({ ...populated, selected: 5 }, "previous")).toBe(2);
});

it("reveals tabs through the last binding and one empty destination without hiding direct selection", () => {
	const indices = (state: ClientSpellBarState) =>
		visibleSpellTabs(state).map((tab) => tab.index);
	const empty = initialSpellBar();
	expect(visibleSpellTabs(empty)).toEqual([{ index: 0, empty: true }]);
	expect(indices(empty)).toEqual([0]);
	const first = bindSpellCell(empty, { tab: 0, slot: 0 }, 42);
	expect(indices(first)).toEqual([0, 1]);
	const distant = bindSpellCell(first, { tab: 4, slot: 0 }, 73);
	expect(indices(distant)).toEqual([0, 1, 2, 3, 4, 5]);
	expect(indices(bindSpellCell(distant, { tab: 4, slot: 0 }, null))).toEqual([
		0, 1,
	]);
	expect(indices({ ...empty, selected: 7 })).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
	const last = SPELL_BAR_INDICES[SPELL_BAR_INDICES.length - 1];
	expect(indices(bindSpellCell(empty, { tab: last, slot: 0 }, 42))).toEqual(
		SPELL_BAR_INDICES,
	);
	const extended = bindSpellCell(
		distant,
		{ tab: 4, slot: SPELL_BAR_INDICES.length - 1 },
		42,
	);
	const overflow = bindSpellCell(
		extended,
		{ tab: 4, slot: SPELL_BAR_INDICES.length },
		42,
	);
	const overflowOnly = bindSpellCell(
		bindSpellCell(overflow, { tab: 4, slot: 0 }, null),
		{ tab: 4, slot: SPELL_BAR_INDICES.length - 1 },
		null,
	);
	expect(visibleSpellTabs(overflowOnly)).toEqual([
		{ index: 0, empty: false },
		{ index: 1, empty: true },
		{ index: 2, empty: true },
		{ index: 3, empty: true },
		{ index: 4, empty: false },
		{ index: 5, empty: true },
	]);
});
