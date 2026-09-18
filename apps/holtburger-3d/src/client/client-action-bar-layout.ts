import type { ActionBarDirection } from "../lib/input/input-contract";
import type {
	ClientHudViewport,
	ResolvedClientHudPlacement,
} from "./client-hud-layout";

import {
	ACTION_SLOT_INDICES,
	type ActionSlotIndex,
} from "./client-action-bar-contract";
import type { ClientActionBar } from "./client-action-bar-state";

/** One canonical grid shared by rendering and keyboard navigation. */
export function actionBarGrid(
	bar: Pick<ClientActionBar, "orientation" | "shape">,
) {
	const strips = bar.shape === "single" ? 1 : 2;
	const length = ACTION_SLOT_INDICES.length / strips;
	return bar.orientation === "horizontal"
		? { rows: strips, columns: length }
		: { rows: length, columns: strips };
}

/** Zero-based visible position of a stable numbered slot. */
export function actionCellPosition(
	bar: Pick<ClientActionBar, "orientation" | "shape">,
	slot: ActionSlotIndex,
) {
	const { rows, columns } = actionBarGrid(bar);
	return bar.orientation === "horizontal"
		? { row: Math.floor(slot / columns), column: slot % columns }
		: { row: slot % rows, column: Math.floor(slot / rows) };
}

/** Wrap inside the visible row or column, including empty slots. */
export function navigateActionCell(
	bar: Pick<ClientActionBar, "orientation" | "shape">,
	slot: ActionSlotIndex,
	direction: ActionBarDirection,
): ActionSlotIndex {
	const { rows, columns } = actionBarGrid(bar);
	const position = actionCellPosition(bar, slot);
	const row =
		(position.row +
			(direction === "down" ? 1 : direction === "up" ? -1 : 0) +
			rows) %
		rows;
	const column =
		(position.column +
			(direction === "right" ? 1 : direction === "left" ? -1 : 0) +
			columns) %
		columns;
	const index =
		bar.orientation === "horizontal"
			? row * columns + column
			: column * rows + row;
	const result = ACTION_SLOT_INDICES.find((candidate) => candidate === index);
	if (result === undefined)
		throw new Error("Action grid produced an invalid slot");
	return result;
}

/** A mounted bar supplies current geometry on demand, including resolved theme lengths. */
export interface ActionBarGeometry {
	/** Actual viewport-relative bounds used to avoid existing bars. */
	readonly bounds: ResolvedClientHudPlacement;
	/** Natural grid and strip extent; a clone does not inherit temporary edge compression. */
	readonly preferred: Pick<ResolvedClientHudPlacement, "width" | "height">;
}

/** Find nearby free space without moving existing bars or shrinking a clone to fit a hole. */
export function findActionBarClonePlacement(
	source: ActionBarGeometry,
	orientation: ClientActionBar["orientation"],
	occupied: readonly ResolvedClientHudPlacement[],
	viewport: ClientHudViewport,
	gap: number,
): ResolvedClientHudPlacement | null {
	const width = Math.min(source.preferred.width, viewport.width);
	const height = Math.min(source.preferred.height, viewport.height);
	if (width <= 0 || height <= 0) return null;
	const maxLeft = viewport.width - width;
	const maxTop = viewport.height - height;
	const left = Math.min(source.bounds.left, maxLeft);
	const top = Math.min(source.bounds.top, maxTop);
	const above = { left, top: source.bounds.top - height - gap };
	const below = { left, top: source.bounds.top + source.bounds.height + gap };
	const before = { left: source.bounds.left - width - gap, top };
	const after = { left: source.bounds.left + source.bounds.width + gap, top };
	const sides =
		source.bounds.left + source.bounds.width / 2 <= viewport.width / 2
			? [after, before]
			: [before, after];
	const adjacent =
		orientation === "horizontal"
			? [above, below, ...sides]
			: [...sides, above, below];
	// Any free axis-aligned rectangle can slide until it meets a viewport or obstacle edge.
	// Cross those edge coordinates rather than scanning pixels or retaining a packing index.
	const xs = new Set([left, 0, maxLeft]);
	const ys = new Set([top, 0, maxTop]);
	for (const bar of occupied) {
		xs.add(bar.left - width - gap);
		xs.add(bar.left + bar.width + gap);
		ys.add(bar.top - height - gap);
		ys.add(bar.top + bar.height + gap);
	}
	const nearby = [...xs].flatMap((x) =>
		[...ys].map((y) => ({ left: x, top: y })),
	);
	const distance = (point: { left: number; top: number }) =>
		(point.left - source.bounds.left) ** 2 +
		(point.top - source.bounds.top) ** 2;
	nearby.sort((a, b) => distance(a) - distance(b));
	for (const point of [...adjacent, ...nearby]) {
		if (
			point.left < 0 ||
			point.top < 0 ||
			point.left > maxLeft ||
			point.top > maxTop
		)
			continue;
		const clear = occupied.every(
			(bar) =>
				point.left + width + gap <= bar.left ||
				bar.left + bar.width + gap <= point.left ||
				point.top + height + gap <= bar.top ||
				bar.top + bar.height + gap <= point.top,
		);
		if (clear) return { ...point, width, height };
	}
	return null;
}
