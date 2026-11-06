import { uiLocalSize, uiScale } from "../app/ui-scale";
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
	const grid = element(root, ".contents-grid");
	const cell = uiLocalSize(element(root, ".container-cell-measure")).width;
	const gap = Number.parseFloat(getComputedStyle(grid).columnGap);
	// Include padding and the stable scrollbar gutter without clientWidth's integer rounding.
	const chrome = uiLocalSize(window).width - uiLocalSize(grid).width;
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
	const chrome = uiLocalSize(window).height - uiLocalSize(scroll).height;
	const rowChrome =
		chrome +
		Number.parseFloat(style.paddingTop) +
		Number.parseFloat(style.paddingBottom) +
		uiLocalSize(header).height +
		Number.parseFloat(getComputedStyle(header).marginBottom) +
		Number.parseFloat(getComputedStyle(grid).marginBottom);
	const minimum = rowChrome + cell;
	const maxRows = CLIENT_TUNING.worldContainer.openingGrid.maxRows;
	const maximum = rowChrome + maxRows * cell + (maxRows - 1) * gap;
	// The final section stretches for background drops; measure its contents, not that stretch.
	// Viewport coordinates include zoom; CSS lengths and placement use logical UI units.
	const natural =
		chrome +
		(lastChild.getBoundingClientRect().bottom -
			scroll.getBoundingClientRect().top) /
			uiScale(scroll) +
		Number.parseFloat(getComputedStyle(lastChild).marginBottom) +
		Number.parseFloat(style.paddingBottom);
	return {
		minimum: Math.ceil(minimum),
		preferred: Math.ceil(Math.min(maximum, Math.max(minimum, natural))),
	};
}
