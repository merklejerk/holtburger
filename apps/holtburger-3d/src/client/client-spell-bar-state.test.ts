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
