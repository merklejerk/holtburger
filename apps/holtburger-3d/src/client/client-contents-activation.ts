import type { ClientItemInteractions } from "./client-item-interactions";

/** Mounted cell activation: target acquisition wins over selection and double-click actions. */
export function bindContentsActivation(
	panel: HTMLElement,
	selector: string,
	interactions: ClientItemInteractions,
	selectedGuid: () => number | null,
	onSelect: (guid: number) => void,
	activate: (guid: number) => void,
): () => void {
	const abort = new AbortController();
	let consumedTargetSequence = false;
	const itemGuid = (event: MouseEvent): number | null => {
		const cell =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(selector)
				: null;
		return cell === null ? null : Number(cell.dataset.itemGuid);
	};
	panel.addEventListener(
		"click",
		(event) => {
			const guid = itemGuid(event);
			if (guid === null) return;
			if (event.detail <= 1) consumedTargetSequence = false;
			const state = interactions.snapshot();
			if (event.detail > 1 || state.kind === "acquiring") {
				event.preventDefault();
				event.stopImmediatePropagation();
				if (event.detail <= 1 && state.kind === "acquiring") {
					consumedTargetSequence = true;
					interactions.target(guid, state.generation);
				}
			}
		},
		{ capture: true, signal: abort.signal },
	);
	panel.addEventListener(
		"dblclick",
		(event) => {
			const guid = itemGuid(event);
			if (guid === null) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (!consumedTargetSequence) {
				if (selectedGuid() !== guid) onSelect(guid);
				activate(guid);
			}
		},
		{ capture: true, signal: abort.signal },
	);
	return () => abort.abort();
}
