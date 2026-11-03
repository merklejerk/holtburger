/** Show an already-attached decoration above clipping ancestors without input or focus ownership. */
export function showVisualPopover(element: HTMLElement, bounds: DOMRect): void {
	element.popover = "manual";
	element.inert = true;
	element.setAttribute("aria-hidden", "true");
	Object.assign(element.style, {
		position: "fixed",
		inset: "auto",
		margin: "0",
		anchorName: "none",
	});
	element.showPopover();
	// Top-layer surfaces retain inherited zoom. Read it after showing the popover,
	// then convert viewport bounds back to its local CSS units exactly once.
	const scale = element.currentCSSZoom;
	Object.assign(element.style, {
		left: `${bounds.left / scale}px`,
		top: `${bounds.top / scale}px`,
		width: `${bounds.width / scale}px`,
		height: `${bounds.height / scale}px`,
	});
}
