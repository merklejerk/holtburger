/**
 * Copy displayed artwork into a ghost hosted by the unscaled canvas/HUD interaction root.
 * Source bounds and ghost positioning both use browser pixels, even when the source UI is scaled.
 */
export function showUiDragGhost(
	ghost: HTMLElement,
	source: HTMLElement,
	fallback: string,
): void {
	const preview = source.querySelector("[data-drag-preview]");
	const artwork = (preview ?? source).querySelector("[data-drag-artwork], svg");
	const visual = preview ?? artwork ?? source;
	const bounds = visual.getBoundingClientRect();
	ghost.style.width = `${bounds.width}px`;
	ghost.style.height = `${bounds.height}px`;
	ghost.replaceChildren(artwork?.cloneNode(true) ?? fallback);
	ghost.hidden = false;
	ghost.showPopover();
}

/** Pointer coordinates stay imperative; the shared CSS rule adds the theme's cursor gap. */
export function positionUiDragGhost(
	ghost: HTMLElement,
	pointer: Pick<PointerEvent, "clientX" | "clientY">,
): void {
	ghost.style.transform = `translate(${pointer.clientX}px, ${pointer.clientY}px)`;
}
