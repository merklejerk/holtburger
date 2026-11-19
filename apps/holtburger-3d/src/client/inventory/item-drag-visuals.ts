import {
	showUiDragGhost,
	positionUiDragGhost,
} from "../../app/ui/ui-drag-ghost";
import { filterDraggedEquipment } from "./equipment-strip-filter";

/** Show the top-layer drag ghost for a grid cell, header, binding, or draft element. */
export function showDragGhost(
	root: HTMLElement,
	ghost: HTMLElement,
	source: HTMLElement,
): void {
	let visual = source;
	if (source.matches(".contents-header[data-item-guid]")) {
		// Headers share the displayed icon and its size with their navigation/grid cell.
		const cell = source
			.closest("[data-contents-root]")
			?.querySelector<HTMLElement>(
				`.item-grid-cell[data-item-guid="${source.dataset.itemGuid}"]`,
			);
		if (cell == null) {
			throw new Error("Contents header has no corresponding item cell");
		}
		visual = cell;
	}
	showUiDragGhost(
		ghost,
		visual,
		visual.getAttribute("aria-label") ?? visual.textContent?.trim() ?? "",
	);
	root.dataset.itemDragging = "true";
}

export function positionDragGhost(
	ghost: HTMLElement,
	event: PointerEvent,
): void {
	positionUiDragGhost(ghost, event);
}

export function hideDragGhost(ghost: HTMLElement): void {
	ghost.hidden = true;
	ghost.hidePopover();
}

export function clearDimming(
	root: HTMLElement,
	mergeHints?: Map<number, HTMLElement>,
): void {
	mergeHints?.clear();
	for (const row of root.querySelectorAll<HTMLElement>(
		"[data-inventory-dimmed]",
	)) {
		delete row.dataset.inventoryDimmed;
	}
}

export function clearDropHighlights(root: HTMLElement): void {
	for (const element of root.querySelectorAll<HTMLElement>(
		"[data-inventory-drop], [data-inventory-displaced]",
	)) {
		delete element.dataset.inventoryDrop;
		delete element.dataset.inventoryDisplaced;
	}
}

/**
 * Retire active pointer-drag DOM visuals symmetrically whenever leaving an active drag phase.
 *
 * `clearHighlights` stays false only when transitioning into `awaiting-release` so the target cell
 * keeps its `"pending"` highlight until the async preview or world pick settles.
 */
export function retireActiveDragVisuals(
	root: HTMLElement,
	ghost: HTMLElement,
	options: {
		readonly scrollFrame: number | null;
		readonly mergeHints?: Map<number, HTMLElement>;
		readonly clearHighlights: boolean;
	},
): void {
	if (options.scrollFrame !== null) cancelAnimationFrame(options.scrollFrame);
	hideDragGhost(ghost);
	filterDraggedEquipment(root, null);
	clearDimming(root, options.mergeHints);
	delete root.dataset.itemDragging;
	if (options.clearHighlights) clearDropHighlights(root);
}
