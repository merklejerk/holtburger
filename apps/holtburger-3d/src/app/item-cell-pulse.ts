/** Active copies remain imperative and live only for the CSS animation's lifetime. */
const active = new WeakMap<HTMLElement, () => void>();

/** Pulse a visual copy above scroll clipping while preserving the real cell's layout and focus. */
export function pulseItemCell(
	cell: HTMLElement,
	trigger: "interaction" | "arrival",
): void {
	if (trigger === "arrival" && active.has(cell)) return;
	active.get(cell)?.();
	if (
		!cell.isConnected ||
		cell.closest("[hidden], [inert]") !== null ||
		!cell.checkVisibility({ checkVisibilityCSS: true }) ||
		matchMedia("(prefers-reduced-motion: reduce)").matches
	)
		return;
	const bounds = cell.getBoundingClientRect();
	if (bounds.width === 0 || bounds.height === 0) return;
	// Do not reveal artwork outside a scroller's visible region in the top layer.
	for (
		let parent = cell.parentElement;
		parent !== null;
		parent = parent.parentElement
	) {
		const style = getComputedStyle(parent);
		const clip = parent.getBoundingClientRect();
		if (
			(style.overflowX !== "visible" &&
				(bounds.left < clip.left || bounds.right > clip.right)) ||
			(style.overflowY !== "visible" &&
				(bounds.top < clip.top || bounds.bottom > clip.bottom))
		)
			return;
	}
	const copy = cell.ownerDocument.importNode(cell, true);
	// Copies carry appearance, never DOM identity, targeting addresses, or nested popovers.
	for (const element of [copy, ...copy.querySelectorAll("*")]) {
		for (const name of [
			"id",
			"data-item-guid",
			"data-action-cell",
			"data-action-bar",
			"data-action-item",
			"data-template-wcid",
			"autofocus",
		])
			element.removeAttribute(name);
	}
	for (const popover of copy.querySelectorAll("[popover]")) popover.remove();
	// Component-specific classes also identify real cells to gesture owners and diagnostics.
	// Preserve resolved color (including hover) and layout without giving a copy those identities.
	const appearance = getComputedStyle(cell);
	for (const property of [
		"color",
		"user-select",
		"aspect-ratio",
		"min-width",
		"min-height",
		"padding",
		"overflow",
	]) {
		copy.style.setProperty(property, appearance.getPropertyValue(property));
	}
	copy.classList.remove("item-grid-cell", "action-cell");
	copy.classList.add("ui-item-cell-pulse");
	copy.popover = "manual";
	copy.inert = true;
	copy.setAttribute("aria-hidden", "true");
	Object.assign(copy.style, {
		position: "fixed",
		inset: "auto",
		margin: "0",
		anchorName: "none",
		left: `${bounds.left}px`,
		top: `${bounds.top}px`,
		width: `${bounds.width}px`,
		height: `${bounds.height}px`,
	});
	cell.after(copy);
	copy.showPopover();
	cell.dataset.uiCellPulsing = "true";
	let frame = 0;
	let finished = false;
	const cleanup = () => {
		// Cancelled CSS animation events may arrive after a replacement pulse starts.
		if (finished) return;
		finished = true;
		cancelAnimationFrame(frame);
		copy.remove();
		delete cell.dataset.uiCellPulsing;
		active.delete(cell);
	};
	active.set(cell, cleanup);
	copy.addEventListener("animationend", (event) => {
		if (event.target === copy) cleanup();
	});
	copy.addEventListener("animationcancel", (event) => {
		if (event.target === copy) cleanup();
	});
	const monitor = () => {
		const next = cell.getBoundingClientRect();
		if (
			!cell.isConnected ||
			cell.closest("[hidden], [inert]") !== null ||
			next.x !== bounds.x ||
			next.y !== bounds.y ||
			next.width !== bounds.width ||
			next.height !== bounds.height ||
			copy.getAnimations().length === 0
		)
			cleanup();
		else frame = requestAnimationFrame(monitor);
	};
	frame = requestAnimationFrame(monitor);
}
