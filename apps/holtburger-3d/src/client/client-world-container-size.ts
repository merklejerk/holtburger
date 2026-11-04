import { CLIENT_TUNING } from "./client-tuning";

/** Measured preferred/minimum extent on one axis, consumed by the opening window. */
interface OpeningExtent {
	/** Initial placement extent before the first visible frame. */
	readonly preferred: number;
	/** Smallest manual resize extent, relaxed by the existing viewport clamp. */
	readonly minimum: number;
}

function element(root: HTMLElement, selector: string): HTMLElement {
	const found = root.querySelector<HTMLElement>(selector);
	if (found === null) throw new Error(`Container sizing requires ${selector}`);
	return found;
}

/** Resolve theme lengths through layout; custom properties may contain rem or calc(). */
export function measureContainerOpeningWidth(
	root: HTMLElement,
	itemCount: number,
): OpeningExtent {
	const { minColumns, maxColumns, maxRows } =
		CLIENT_TUNING.worldContainer.openingGrid;
	const columns = Math.min(
		maxColumns,
		Math.max(minColumns, Math.ceil(itemCount / maxRows)),
	);
	const window = element(root, ".hud-window");
	const scroll = element(root, ".contents-scroll");
	const grid = element(root, ".contents-grid");
	const cell = element(root, ".container-cell-measure").getBoundingClientRect()
		.width;
	const gap = Number.parseFloat(getComputedStyle(grid).columnGap);
	const style = getComputedStyle(scroll);
	// Stable scrollbar space keeps the same column count for empty and overflowing contents.
	const chrome =
		window.getBoundingClientRect().width -
		scroll.clientWidth +
		Number.parseFloat(style.paddingLeft) +
		Number.parseFloat(style.paddingRight);
	const width = (count: number) =>
		Math.ceil(chrome + cell * count + gap * (count - 1));
	return { preferred: width(columns), minimum: width(minColumns) };
}

/** Measure at the chosen width so wrapped headers contribute their actual height. */
export function measureContainerOpeningHeight(
	root: HTMLElement,
): OpeningExtent {
	const window = element(root, ".hud-window");
	const scroll = element(root, ".contents-scroll");
	const first = element(scroll, "[data-container-guid]");
	const last = element(scroll, "[data-container-guid]:last-child");
	const lastChild = last.lastElementChild;
	if (!(lastChild instanceof HTMLElement))
		throw new Error("Container section has no contents");
	const header = element(first, "h3");
	const grid = element(first, ".contents-grid");
	// Width rounding and viewport clamping can stretch tracks beyond the themed minimum.
	const cell = Number.parseFloat(getComputedStyle(grid).gridTemplateColumns);
	const gap = Number.parseFloat(getComputedStyle(grid).rowGap);
	const style = getComputedStyle(scroll);
	const chrome =
		window.getBoundingClientRect().height -
		scroll.getBoundingClientRect().height;
	const rowChrome =
		chrome +
		Number.parseFloat(style.paddingTop) +
		Number.parseFloat(style.paddingBottom) +
		header.getBoundingClientRect().height +
		Number.parseFloat(getComputedStyle(header).marginBottom) +
		Number.parseFloat(getComputedStyle(grid).marginBottom);
	const minimum = rowChrome + cell;
	const maxRows = CLIENT_TUNING.worldContainer.openingGrid.maxRows;
	const maximum = rowChrome + maxRows * cell + (maxRows - 1) * gap;
	// The final section stretches for background drops; measure its contents, not that stretch.
	const natural =
		chrome +
		lastChild.getBoundingClientRect().bottom +
		Number.parseFloat(getComputedStyle(lastChild).marginBottom) -
		scroll.getBoundingClientRect().top +
		Number.parseFloat(style.paddingBottom);
	return {
		minimum: Math.ceil(minimum),
		preferred: Math.ceil(Math.min(maximum, Math.max(minimum, natural))),
	};
}
