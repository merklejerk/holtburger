import type { ClientHudPlacement } from "./client-hud-layout";

/** Fixed address space shared by bar and cell digit shortcuts. */
export const ACTION_SLOT_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
/** Zero-based slot identity, preserved across gaps and shape changes. */
export type ActionSlotIndex = (typeof ACTION_SLOT_INDICES)[number];
/** Product limit, independent of adjustable visual tuning. */
export const MAX_ACTION_BARS = ACTION_SLOT_INDICES.length;
/** Equipment identity determines the equip action; no separate action selector exists. */
export type ActionContent = {
	readonly kind: "equipment";
	readonly item: number;
};
/** Exact sparse address space: empty cells remain present. */
type ActionSlots = readonly [
	ActionContent | null,
	ActionContent | null,
	ActionContent | null,
	ActionContent | null,
	ActionContent | null,
	ActionContent | null,
	ActionContent | null,
	ActionContent | null,
	ActionContent | null,
	ActionContent | null,
];
/** Cold app-local configuration; order in the collection determines sequence. */
export interface ClientActionBar {
	/** Stable identity for keyed rendering and pointer transfers. */
	readonly id: number;
	/** Direction of the primary numbered strip. */
	readonly orientation: "horizontal" | "vertical";
	/** One ten-cell strip or two adjacent five-cell strips. */
	readonly shape: "single" | "double";
	/** Canonical viewport anchors; extent is derived from shape by the layout owner. */
	readonly anchor: Pick<ClientHudPlacement, "horizontal" | "vertical">;
	/** Item references; authoritative item facts are resolved separately. */
	readonly slots: ActionSlots;
}
/** Stable destination captured by the pointer owner. */
export interface ActionCellAddress {
	readonly bar: number;
	readonly slot: ActionSlotIndex;
}

/** Create the mandatory first bar for one client session. */
export function initialActionBar(): ClientActionBar {
	return {
		id: 1,
		orientation: "horizontal",
		shape: "single",
		anchor: {
			horizontal: { alignment: "center", offset: 0 },
			vertical: { alignment: "end", offset: 0 },
		},
		slots: [null, null, null, null, null, null, null, null, null, null],
	};
}

/** Fail loudly for stale internal identities rather than changing an unrelated bar. */
export function requireActionBar(
	bars: readonly ClientActionBar[],
	id: number,
): ClientActionBar {
	const bar = bars.find((candidate) => candidate.id === id);
	if (bar === undefined) throw new Error(`Unknown action bar ${id}`);
	return bar;
}

/** Move a bar one sequence forward, wrapping the final bar to the front. */
export function cycleActionBar(
	bars: readonly ClientActionBar[],
	id: number,
): readonly ClientActionBar[] {
	const bar = requireActionBar(bars, id);
	const index = bars.indexOf(bar);
	const result = bars.filter((candidate) => candidate.id !== id);
	result.splice((index + 1) % bars.length, 0, bar);
	return result;
}

/** Insert a separately editable copy; the caller owns new identity and placement. */
export function cloneActionBar(
	bars: readonly ClientActionBar[],
	id: number,
	clone: Pick<ClientActionBar, "id" | "anchor">,
): readonly ClientActionBar[] {
	const source = requireActionBar(bars, id);
	if (bars.length >= MAX_ACTION_BARS) return bars;
	if (bars.some((bar) => bar.id === clone.id))
		throw new Error("Duplicate action bar identity");
	const result = [...bars];
	result.splice(bars.indexOf(source) + 1, 0, {
		...source,
		...clone,
		slots: [...source.slots],
	});
	return result;
}

/** Remove a bar while preserving the mandatory final surface. */
export function deleteActionBar(
	bars: readonly ClientActionBar[],
	id: number,
): readonly ClientActionBar[] {
	requireActionBar(bars, id);
	return bars.length === 1 ? bars : bars.filter((bar) => bar.id !== id);
}

/** Replace exactly one sparse slot. */
export function bindActionCell(
	bars: readonly ClientActionBar[],
	target: ActionCellAddress,
	content: ActionContent | null,
): readonly ClientActionBar[] {
	requireActionBar(bars, target.bar);
	return bars.map((bar) => {
		if (bar.id !== target.bar) return bar;
		const slots: [...ActionSlots] = [...bar.slots];
		slots[target.slot] = content;
		return { ...bar, slots };
	});
}

/** Read both contents before applying either edit, including same-bar transfers. */
export function swapActionCells(
	bars: readonly ClientActionBar[],
	source: ActionCellAddress,
	target: ActionCellAddress,
): readonly ClientActionBar[] {
	const incoming = requireActionBar(bars, source.bar).slots[source.slot];
	const outgoing = requireActionBar(bars, target.bar).slots[target.slot];
	if (source.bar === target.bar && source.slot === target.slot) return bars;
	return bindActionCell(
		bindActionCell(bars, source, outgoing),
		target,
		incoming,
	);
}

/** Parse stable bar/cell digit labels for DOM gesture addresses, independent of key bindings. */
export function actionDigitIndex(label: string): ActionSlotIndex | null {
	return (
		ACTION_SLOT_INDICES.find(
			(index) => String((index + 1) % MAX_ACTION_BARS) === label,
		) ?? null
	);
}
