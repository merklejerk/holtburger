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
		left: `${bounds.left}px`,
		top: `${bounds.top}px`,
		width: `${bounds.width}px`,
		height: `${bounds.height}px`,
	});
	element.showPopover();
}
