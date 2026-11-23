import type { ResizeEdges } from "../ui/resize-edges.js";

/** Viewport reference point that owns one axis of a HUD surface's canonical offset. */
type HudAxisAlignment = "start" | "center" | "end";

/** Canonical attachment on one axis, independent of the current viewport extent. */
interface HudAxisAnchor {
	readonly alignment: HudAxisAlignment;
	/** Inward edge distance, or signed surface-center displacement for `center`. */
	readonly offset: number;
}

/** Preferred HUD geometry; the rendered extent may temporarily relax in a smaller viewport. */
export interface HudPlacement {
	readonly horizontal: HudAxisAnchor;
	readonly vertical: HudAxisAnchor;
	readonly preferredWidth: number;
	readonly preferredHeight: number;
}

/** Current usable content dimensions in logical UI units. */
export interface HudViewport {
	readonly width: number;
	readonly height: number;
}

/** Concrete viewport-relative rectangle in logical UI units, consumed by positioned Svelte components. */
export interface ResolvedHudPlacement {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export interface PreferredHudExtent {
	readonly width: number;
	readonly height: number;
}

/** Pointer displacement from the start of one drag gesture, already converted to logical UI units. */
export interface HudPointerDelta {
	readonly x: number;
	readonly y: number;
}

/** Convert unscaled browser content dimensions into the HUD's logical layout units. */
export function logicalHudViewport(
	viewport: HudViewport,
	scale: number,
): HudViewport {
	return { width: viewport.width / scale, height: viewport.height / scale };
}

interface ResolvedAxis {
	readonly alignment: HudAxisAlignment;
	readonly extent: number;
	readonly offset: number;
	readonly size: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function resolveAxis(
	anchor: HudAxisAnchor,
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

/** Resolve preferred geometry without allowing any part of the surface outside content bounds. */
export function resolveHudPlacement(
	placement: HudPlacement,
	viewport: HudViewport,
	minimum: PreferredHudExtent,
): ResolvedHudPlacement {
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

/** Keep a content-sized HUD's top fixed as its measured height changes. */
export function topAnchoredHudPlacement(
	placement: HudPlacement,
	viewport: HudViewport,
	minimum: PreferredHudExtent,
): HudPlacement {
	const reference = resolveHudPlacement(placement, viewport, minimum);
	return {
		...placement,
		vertical: { alignment: "start", offset: reference.top },
	};
}

/** Resolve a square surface against the tighter available viewport axis. */
export function resolveHudSquarePlacement(
	placement: HudPlacement,
	viewport: HudViewport,
	minimumSize: number,
): ResolvedHudPlacement {
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

/** Keep centered footer overhang within the same usable viewport as the minimap disc. */
export function resolveMinimapPlacement(
	placement: HudPlacement,
	viewport: HudViewport,
	minimumSize: number,
	footerWidth: number,
): ResolvedHudPlacement {
	const disc = resolveHudSquarePlacement(placement, viewport, minimumSize);
	const inset = Math.max(
		0,
		(Math.min(footerWidth, viewport.width) - disc.width) / 2,
	);
	return {
		...disc,
		left: clamp(disc.left, inset, viewport.width - disc.width - inset),
	};
}

/** Capture the closest viewport reference without changing the rendered axis geometry. */
function anchorAxis(
	start: number,
	size: number,
	viewportSize: number,
): HudAxisAnchor {
	const offsets: Readonly<Record<HudAxisAlignment, number>> = {
		start,
		center: start + size / 2 - viewportSize / 2,
		end: viewportSize - start - size,
	};
	const alignments: readonly HudAxisAlignment[] = ["start", "center", "end"];
	const alignment = alignments.reduce((closest, candidate) =>
		Math.abs(offsets[candidate]) < Math.abs(offsets[closest])
			? candidate
			: closest,
	);
	return { alignment, offset: offsets[alignment] };
}

/** Capture a rendered rectangle against whichever content edges are currently nearest. */
export function anchorHudPlacement(
	rectangle: ResolvedHudPlacement,
	viewport: HudViewport,
	preferred: PreferredHudExtent,
): HudPlacement {
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

/** Move with the reachable preferred extent so capturing anchors cannot enlarge the result. */
export function moveHudRectangle(
	start: ResolvedHudPlacement,
	viewport: HudViewport,
	minimum: PreferredHudExtent,
	preferred: PreferredHudExtent,
	delta: HudPointerDelta,
): ResolvedHudPlacement {
	const width = Math.min(
		Math.max(preferred.width, minimum.width),
		viewport.width,
	);
	const height = Math.min(
		Math.max(preferred.height, minimum.height),
		viewport.height,
	);
	return {
		left: clamp(start.left + delta.x, 0, viewport.width - width),
		top: clamp(start.top + delta.y, 0, viewport.height - height),
		width,
		height,
	};
}

/** Clamp a resize to reachable whole steps measured from its minimum extent. */
function clampResizeWidth(
	requested: number,
	minimum: number,
	maximum: number,
	step: number | undefined,
): number {
	if (step === undefined) return clamp(requested, minimum, maximum);
	return (
		minimum +
		clamp(
			Math.round((requested - minimum) / step),
			0,
			Math.floor((maximum - minimum) / step),
		) *
			step
	);
}

/** Resize a floating rectangle from any border while keeping its opposite borders stationary. */
export function resizePanelRectangle(
	start: ResolvedHudPlacement,
	viewport: HudViewport,
	minimum: PreferredHudExtent,
	delta: HudPointerDelta,
	edges: ResizeEdges,
	/** Optional logical-width increment; omit for continuous resizing. */
	widthStep?: number,
): ResolvedHudPlacement {
	if (
		widthStep !== undefined &&
		(!Number.isFinite(widthStep) || widthStep <= 0)
	)
		throw new Error("Resize width step must be finite and positive");
	let left = start.left;
	let top = start.top;
	let width = start.width;
	let height = start.height;

	if (edges.horizontal === "left") {
		const right = start.left + start.width;
		const reachableMinimum = Math.min(minimum.width, right);
		width = clampResizeWidth(
			start.width - delta.x,
			reachableMinimum,
			right,
			widthStep,
		);
		left = right - width;
	} else if (edges.horizontal === "right") {
		const available = Math.max(0, viewport.width - start.left);
		width = clampResizeWidth(
			start.width + delta.x,
			Math.min(minimum.width, available),
			available,
			widthStep,
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

/** Stable identity within one mounted HUD, independent of display order. */
export type HudSurfaceId = string;

/** Mounted snap participant; hidden surfaces expose no rectangle. */
interface HudSurface {
	/** Stable key for exclusion and mount-lifetime cleanup. */
	readonly id: HudSurfaceId;
	/** Pull resolved logical UI geometry; null explicitly marks a hidden surface. */
	readonly readBounds: () => ResolvedHudPlacement | null;
}

/** Imperative geometry readers owned by one HUD, not a reactive position cache. */
export class HudGeometryRegistry {
	private readonly surfaces = new Map<HudSurfaceId, HudSurface>();

	register(surface: HudSurface): () => void {
		if (this.surfaces.has(surface.id))
			throw new Error(`Duplicate HUD surface: ${surface.id}`);
		this.surfaces.set(surface.id, surface);
		let registered = true;
		return () => {
			if (!registered) return;
			registered = false;
			this.surfaces.delete(surface.id);
		};
	}

	/** Read a required participant; hidden geometry is explicitly unavailable. */
	readBounds(id: HudSurfaceId): ResolvedHudPlacement | null {
		const surface = this.surfaces.get(id);
		if (surface === undefined) throw new Error(`Missing HUD surface: ${id}`);
		return surface.readBounds();
	}

	/** Pull current visible peers, excluding the surface being moved. */
	readPeers(moving: HudSurfaceId): readonly ResolvedHudPlacement[] {
		const rectangles: ResolvedHudPlacement[] = [];
		for (const surface of this.surfaces.values()) {
			if (surface.id === moving) continue;
			const bounds = surface.readBounds();
			if (bounds !== null) rectangles.push(bounds);
		}
		return rectangles;
	}
}
