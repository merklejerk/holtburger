import { CLIENT_UI_LAYERS } from "./client-ui-layers";

/** Floating window surface identities managed by the viewport stack. */
export type ClientFloatingWindowId =
	"worldContainer" | "inspection" | "inventory" | "spells" | "debug";

/**
 * Returns a new stack order where the specified window is moved to the top.
 * If the window is already at the top, the existing array reference is returned unchanged.
 */
export function bringWindowToFront<Id extends string>(
	order: readonly Id[],
	id: Id,
): readonly Id[] {
	if (order.length > 0 && order[order.length - 1] === id) {
		return order;
	}
	return [...order.filter((existing) => existing !== id), id];
}

/**
 * Computes the z-index for a window based on its depth in the stack order.
 * If the window is not yet recorded in the stack, it is assigned the top position
 * (`baseZIndex + order.length`).
 */
export function windowZIndex<Id extends string>(
	order: readonly Id[],
	id: Id,
	baseZIndex: number = CLIENT_UI_LAYERS.windowBase,
): number {
	const index = order.indexOf(id);
	if (index === -1) {
		return baseZIndex + order.length;
	}
	return baseZIndex + index;
}
