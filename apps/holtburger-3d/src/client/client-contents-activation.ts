import type { ClientItemInteractions } from "./client-item-interactions";

/** Mounted cell activation: target acquisition wins over selection and double-click actions. */
export function bindContentsActivation(
	panel: HTMLElement,
	selector: string,
	interactions: ClientItemInteractions,
	selectedGuid: () => number | null,
	onSelect: (guid: number) => void,
	activate: (guid: number) => void,
	/** Panel-owned modified clicks can consume the sequence before ordinary activation. */
	consumeClick?: (
		event: MouseEvent,
		guid: number,
		cell: HTMLElement,
	) => boolean,
): () => void {
	const abort = new AbortController();
	let consumedClickSequence = false;
	const itemCell = (event: MouseEvent): HTMLElement | null => {
		const cell =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(selector)
				: null;
		return cell !== null && panel.contains(cell) ? cell : null;
	};
	panel.addEventListener(
		"click",
		(event) => {
			const cell = itemCell(event);
			if (cell === null) return;
			const guid = Number(cell.dataset.itemGuid);
			if (event.detail <= 1) consumedClickSequence = false;
			if (consumeClick?.(event, guid, cell) === true) {
				consumedClickSequence = true;
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
			const state = interactions.snapshot();
			if (event.detail > 1 || state.kind === "acquiring") {
				event.preventDefault();
				event.stopImmediatePropagation();
				if (event.detail <= 1 && state.kind === "acquiring") {
					consumedClickSequence = true;
					interactions.target(guid, state.generation);
				}
			}
		},
		{ capture: true, signal: abort.signal },
	);
	panel.addEventListener(
		"dblclick",
		(event) => {
			const cell = itemCell(event);
			if (cell === null) return;
			const guid = Number(cell.dataset.itemGuid);
			event.preventDefault();
			event.stopImmediatePropagation();
			if (!consumedClickSequence) {
				if (selectedGuid() !== guid) onSelect(guid);
				activate(guid);
			}
		},
		{ capture: true, signal: abort.signal },
	);
	return () => abort.abort();
}
