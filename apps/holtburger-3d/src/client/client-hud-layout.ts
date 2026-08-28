/** Horizontal content edge that owns a HUD surface's canonical offset. */
type ClientHudHorizontalEdge = "left" | "right";

/** Vertical content edge that owns a HUD surface's canonical offset. */
type ClientHudVerticalEdge = "top" | "bottom";

/** Canonical horizontal attachment, independent of the current content width. */
interface ClientHudHorizontalAnchor {
	readonly edge: ClientHudHorizontalEdge;
	readonly offset: number;
}

/** Canonical vertical attachment, independent of the current content height. */
interface ClientHudVerticalAnchor {
	readonly edge: ClientHudVerticalEdge;
	readonly offset: number;
}

/** Preferred HUD geometry; the rendered extent may temporarily relax in a smaller viewport. */
export interface ClientHudPlacement {
	readonly horizontal: ClientHudHorizontalAnchor;
	readonly vertical: ClientHudVerticalAnchor;
	readonly preferredWidth: number;
	readonly preferredHeight: number;
}

/** Current usable client content dimensions. */
export interface ClientHudViewport {
	readonly width: number;
	readonly height: number;
}

/** Concrete viewport-relative rectangle consumed by positioned Svelte components. */
export interface ResolvedClientHudPlacement {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/** Border ownership for one floating-panel resize gesture. */
export interface ClientPanelResizeEdges {
	readonly horizontal?: "left" | "right";
	readonly vertical?: "top" | "bottom";
}

export interface ClientHudLayout {
	readonly character: ClientHudPlacement;
	readonly chat: ClientHudPlacement;
	readonly fps: ClientHudPlacement;
	readonly shortcuts: ClientHudPlacement;
}

/** Width reserved for the capped/uncapped frame-rate pair and its unit label. */
export const CLIENT_FPS_PANEL_WIDTH = 120;

interface PreferredClientHudExtent {
	readonly width: number;
	readonly height: number;
}

/** Pointer displacement from the start of one drag gesture. */
interface ClientPointerDelta {
	readonly x: number;
	readonly y: number;
}

interface ResolvedAxis {
	readonly offset: number;
	readonly size: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function resolveAxis(
	offset: number,
	preferredSize: number,
	minimumSize: number,
	viewportSize: number,
): ResolvedAxis {
	const extent = Math.max(0, viewportSize);
	const reachableMinimum = Math.min(minimumSize, extent);
	const anchoredOffset = clamp(offset, 0, extent - reachableMinimum);
	return {
		offset: anchoredOffset,
		size: Math.min(
			Math.max(preferredSize, reachableMinimum),
			extent - anchoredOffset,
		),
	};
}

/** Resolve preferred geometry without allowing any part of the surface outside client content. */
export function resolveClientHudPlacement(
	placement: ClientHudPlacement,
	viewport: ClientHudViewport,
	minimum: PreferredClientHudExtent,
): ResolvedClientHudPlacement {
	const horizontal = resolveAxis(
		placement.horizontal.offset,
		placement.preferredWidth,
		minimum.width,
		viewport.width,
	);
	const vertical = resolveAxis(
		placement.vertical.offset,
		placement.preferredHeight,
		minimum.height,
		viewport.height,
	);
	return {
		left:
			placement.horizontal.edge === "left"
				? horizontal.offset
				: viewport.width - horizontal.offset - horizontal.size,
		top:
			placement.vertical.edge === "top"
				? vertical.offset
				: viewport.height - vertical.offset - vertical.size,
		width: horizontal.size,
		height: vertical.size,
	};
}

/** Resolve a square surface against the tighter available viewport axis. */
export function resolveClientHudSquarePlacement(
	placement: ClientHudPlacement,
	viewport: ClientHudViewport,
	minimumSize: number,
): ResolvedClientHudPlacement {
	const horizontal = resolveAxis(
		placement.horizontal.offset,
		placement.preferredWidth,
		minimumSize,
		viewport.width,
	);
	const vertical = resolveAxis(
		placement.vertical.offset,
		placement.preferredHeight,
		minimumSize,
		viewport.height,
	);
	const size = Math.min(horizontal.size, vertical.size);
	return {
		left:
			placement.horizontal.edge === "left"
				? horizontal.offset
				: viewport.width - horizontal.offset - size,
		top:
			placement.vertical.edge === "top"
				? vertical.offset
				: viewport.height - vertical.offset - size,
		width: size,
		height: size,
	};
}

/** Capture a rendered rectangle against whichever content edges are currently nearest. */
export function anchorClientHudPlacement(
	rectangle: ResolvedClientHudPlacement,
	viewport: ClientHudViewport,
	preferred: PreferredClientHudExtent,
): ClientHudPlacement {
	const width = Math.min(Math.max(0, rectangle.width), viewport.width);
	const height = Math.min(Math.max(0, rectangle.height), viewport.height);
	const left = clamp(rectangle.left, 0, viewport.width - width);
	const top = clamp(rectangle.top, 0, viewport.height - height);
	const right = viewport.width - left - width;
	const bottom = viewport.height - top - height;
	return {
		horizontal:
			left <= right
				? { edge: "left", offset: left }
				: { edge: "right", offset: right },
		vertical:
			top <= bottom
				? { edge: "top", offset: top }
				: { edge: "bottom", offset: bottom },
		preferredWidth: preferred.width,
		preferredHeight: preferred.height,
	};
}

/** Resize a floating rectangle from any border while keeping its opposite borders stationary. */
export function resizeClientPanelRectangle(
	start: ResolvedClientHudPlacement,
	viewport: ClientHudViewport,
	minimum: PreferredClientHudExtent,
	delta: ClientPointerDelta,
	edges: ClientPanelResizeEdges,
): ResolvedClientHudPlacement {
	let left = start.left;
	let top = start.top;
	let width = start.width;
	let height = start.height;

	if (edges.horizontal === "left") {
		const right = start.left + start.width;
		const reachableMinimum = Math.min(minimum.width, right);
		left = clamp(start.left + delta.x, 0, right - reachableMinimum);
		width = right - left;
	} else if (edges.horizontal === "right") {
		const available = Math.max(0, viewport.width - start.left);
		width = clamp(
			start.width + delta.x,
			Math.min(minimum.width, available),
			available,
		);
	}

	if (edges.vertical === "top") {
		const bottom = start.top + start.height;
		const reachableMinimum = Math.min(minimum.height, bottom);
		top = clamp(start.top + delta.y, 0, bottom - reachableMinimum);
		height = bottom - top;
	} else if (edges.vertical === "bottom") {
		const available = Math.max(0, viewport.height - start.top);
		height = clamp(
			start.height + delta.y,
			Math.min(minimum.height, available),
			available,
		);
	}

	return { left, top, width, height };
}

/** Build the first-cut HUD arrangement from the current viewport. */
export function createDefaultClientHudLayout(
	viewportWidth: number,
	viewportHeight: number,
	shortcutCount: number,
): ClientHudLayout {
	const margin = 16;
	const shortcutWidth = shortcutCount * 42;
	const chatHeight = Math.min(450, Math.max(260, viewportHeight - 188));
	return {
		character: {
			horizontal: { edge: "left", offset: margin },
			vertical: { edge: "top", offset: margin },
			preferredWidth: 340,
			preferredHeight: 132,
		},
		chat: {
			horizontal: { edge: "left", offset: margin },
			vertical: { edge: "bottom", offset: margin },
			preferredWidth: 400,
			preferredHeight: chatHeight,
		},
		fps: {
			horizontal: {
				edge: "left",
				offset: Math.max(0, (viewportWidth - CLIENT_FPS_PANEL_WIDTH) / 2),
			},
			vertical: { edge: "top", offset: 8 },
			preferredWidth: CLIENT_FPS_PANEL_WIDTH,
			preferredHeight: 26,
		},
		shortcuts: {
			horizontal: { edge: "right", offset: margin },
			vertical: { edge: "bottom", offset: margin },
			preferredWidth: shortcutWidth,
			preferredHeight: 42,
		},
	};
}
