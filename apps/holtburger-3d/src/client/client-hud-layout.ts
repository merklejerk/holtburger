import type { ClientUiDefaults, ClientUiPanel } from "./client-ui-contract";

/** Viewport reference point that owns one axis of a HUD surface's canonical offset. */
type ClientHudAxisAlignment = "start" | "center" | "end";

/** Canonical attachment on one axis, independent of the current viewport extent. */
interface ClientHudAxisAnchor {
	readonly alignment: ClientHudAxisAlignment;
	/** Inward edge distance, or signed surface-center displacement for `center`. */
	readonly offset: number;
}

/** Preferred HUD geometry; the rendered extent may temporarily relax in a smaller viewport. */
export interface ClientHudPlacement {
	readonly horizontal: ClientHudAxisAnchor;
	readonly vertical: ClientHudAxisAnchor;
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

/** Border ownership for one HUD-window resize gesture. */
export interface ClientPanelResizeEdges {
	readonly horizontal?: "left" | "right";
	readonly vertical?: "top" | "bottom";
}

/** Live geometry for exactly the surfaces declared by the UI contract. */
export type ClientHudLayout = {
	readonly [Surface in keyof ClientUiDefaults]: ClientHudPlacement;
};

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
	readonly alignment: ClientHudAxisAlignment;
	readonly extent: number;
	readonly offset: number;
	readonly size: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function resolveAxis(
	anchor: ClientHudAxisAnchor,
	preferredSize: number,
	minimumSize: number,
	viewportSize: number,
): ResolvedAxis {
	const extent = Math.max(0, viewportSize);
	const reachableMinimum = Math.min(minimumSize, extent);
	const maximumOffset =
		anchor.alignment === "center"
			? (extent - reachableMinimum) / 2
			: extent - reachableMinimum;
	const anchoredOffset = clamp(
		anchor.offset,
		anchor.alignment === "center" ? -maximumOffset : 0,
		maximumOffset,
	);
	const availableSize =
		anchor.alignment === "center"
			? extent - 2 * Math.abs(anchoredOffset)
			: extent - anchoredOffset;
	return {
		alignment: anchor.alignment,
		extent,
		offset: anchoredOffset,
		size: Math.min(Math.max(preferredSize, reachableMinimum), availableSize),
	};
}

/** Place a resolved size against its canonical axis reference. */
function positionAxis(axis: ResolvedAxis, size: number): number {
	switch (axis.alignment) {
		case "start":
			return axis.offset;
		case "center":
			return axis.extent / 2 + axis.offset - size / 2;
		case "end":
			return axis.extent - axis.offset - size;
	}
}

/** Resolve preferred geometry without allowing any part of the surface outside client content. */
export function resolveClientHudPlacement(
	placement: ClientHudPlacement,
	viewport: ClientHudViewport,
	minimum: PreferredClientHudExtent,
): ResolvedClientHudPlacement {
	const horizontal = resolveAxis(
		placement.horizontal,
		placement.preferredWidth,
		minimum.width,
		viewport.width,
	);
	const vertical = resolveAxis(
		placement.vertical,
		placement.preferredHeight,
		minimum.height,
		viewport.height,
	);
	return {
		left: positionAxis(horizontal, horizontal.size),
		top: positionAxis(vertical, vertical.size),
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
		placement.horizontal,
		placement.preferredWidth,
		minimumSize,
		viewport.width,
	);
	const vertical = resolveAxis(
		placement.vertical,
		placement.preferredHeight,
		minimumSize,
		viewport.height,
	);
	const size = Math.min(horizontal.size, vertical.size);
	return {
		left: positionAxis(horizontal, size),
		top: positionAxis(vertical, size),
		width: size,
		height: size,
	};
}

/** Capture the closest viewport reference without changing the rendered axis geometry. */
function anchorAxis(
	start: number,
	size: number,
	viewportSize: number,
): ClientHudAxisAnchor {
	const offsets: Readonly<Record<ClientHudAxisAlignment, number>> = {
		start,
		center: start + size / 2 - viewportSize / 2,
		end: viewportSize - start - size,
	};
	const alignments: readonly ClientHudAxisAlignment[] = [
		"start",
		"center",
		"end",
	];
	const alignment = alignments.reduce((closest, candidate) =>
		Math.abs(offsets[candidate]) < Math.abs(offsets[closest])
			? candidate
			: closest,
	);
	return { alignment, offset: offsets[alignment] };
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
	return {
		horizontal: anchorAxis(left, width, viewport.width),
		vertical: anchorAxis(top, height, viewport.height),
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

/** Resolve declarative startup geometry; subsequent edits retain canonical axis anchors. */
export function createClientHudLayout(
	defaults: ClientUiDefaults,
	viewport: ClientHudViewport,
	shortcutCount: number,
): ClientHudLayout {
	const place = (panel: Pick<ClientUiPanel, "anchor" | "offset" | "size">) =>
		createClientHudPanelPlacement(panel, viewport, shortcutCount);
	return {
		character: place(defaults.character),
		chat: place(defaults.chat),
		diagnostics: place(defaults.diagnostics),
		frameRate: place(defaults.frameRate),
		jumpPower: place(defaults.jumpPower),
		minimap: place({
			...defaults.minimap,
			size: { width: defaults.minimap.size, height: defaults.minimap.size },
		}),
		selectedEntity: place(defaults.selectedEntity),
		shortcuts: place(defaults.shortcuts),
		toast: place(defaults.toast),
	};
}

/** Translate authored placement and the two supported contextual sizes into runtime geometry. */
export function createClientHudPanelPlacement(
	panel: Pick<ClientUiPanel, "anchor" | "offset" | "size">,
	viewport: ClientHudViewport,
	shortcutCount: number,
): ClientHudPlacement {
	const [vertical, horizontal] = ANCHOR_AXES[panel.anchor];
	const { width, height } = panel.size;
	return {
		horizontal: { alignment: horizontal, offset: panel.offset.x },
		vertical: { alignment: vertical, offset: panel.offset.y },
		preferredWidth:
			typeof width === "number" ? width : width.perShortcut * shortcutCount,
		preferredHeight:
			typeof height === "number"
				? height
				: clamp(viewport.height - height.viewportMinus, height.min, height.max),
	};
}

/** Named authoring anchors map to the existing vertical/horizontal drag representation. */
const ANCHOR_AXES = {
	"top-left": ["start", "start"],
	"top-center": ["start", "center"],
	"top-right": ["start", "end"],
	"center-left": ["center", "start"],
	center: ["center", "center"],
	"center-right": ["center", "end"],
	"bottom-left": ["end", "start"],
	"bottom-center": ["end", "center"],
	"bottom-right": ["end", "end"],
} as const;
