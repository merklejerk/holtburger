import type { ResizeEdges } from "../app/resize-edges";

/** Viewport attachment; offsets point inward at edges and right/down at the center. */
type ClientUiAnchor =
	| "top-left"
	| "top-center"
	| "top-right"
	| "center-left"
	| "center"
	| "center-right"
	| "bottom-left"
	| "bottom-center"
	| "bottom-right";

/** Initial height that reserves viewport space without exceeding its preferred bounds. */
interface ViewportHeight {
	/** Space reserved outside this surface, in logical UI units. */
	readonly viewportMinus: number;
	/** Lower preferred height before viewport fitting. */
	readonly min: number;
	/** Upper preferred height. */
	readonly max: number;
}

/** Authored placement shared by rectangular panels and the circular minimap. */
interface ClientUiPlacement {
	/** Viewport reference used for the initial placement. */
	readonly anchor: ClientUiAnchor;
	/** logical UI displacement from the anchor. */
	readonly offset: { readonly x: number; readonly y: number };
}

/** Rectangular HUD geometry and its user-editing policy. */
interface ClientUiPanel extends ClientUiPlacement {
	/** Preferred logical UI size; shortcut widths may scale with the visible button count. */
	readonly size: {
		readonly width: number | { readonly perShortcut: number };
		readonly height: number | ViewportHeight;
	};
	/** Smallest editable size, relaxed when the viewport cannot contain it. */
	readonly minSize: { readonly width: number; readonly height: number };
	/** Whether layout editing exposes resize handles. */
	readonly resizable: boolean;
}

/** Client-owned HUD defaults, independent of Svelte composition and live layout state. */
export interface ClientUiDefaults {
	/** Retained app-local portal Snake easter egg. */
	readonly logopolis: Omit<ClientUiPanel, "resizable">;
	/** Player identity and vitals. */
	readonly character: ClientUiPanel;
	/** Combat-focused roster; its minimum extent follows resolved CSS theme dimensions. */
	readonly partyHud: Omit<ClientUiPanel, "minSize">;
	/** Persistent condition and connection indicators, independently positioned. */
	readonly statusTray: ClientUiPanel;
	/** Tabbed combat spell shortcuts; a custom button toggles the strip arrangement. */
	readonly spellBar: Omit<ClientUiPanel, "resizable">;
	/** Targeted melee/missile controls; defaults overlap the stance-exclusive spell bar. */
	readonly combatBar: Omit<ClientUiPanel, "resizable">;
	/** Chat history and command input. */
	readonly chat: ClientUiPanel;
	/** Retained nearby catalog and entity alert manager. */
	readonly nearby: Omit<ClientUiPanel, "resizable">;
	/** Character social management window. */
	readonly social: Omit<ClientUiPanel, "resizable">;
	/** Retained contracts journal with independently expandable rows. */
	readonly journal: Omit<ClientUiPanel, "resizable">;
	/** Independent active-enchantments floating window. */
	readonly enchantments: Omit<ClientUiPanel, "resizable">;
	/** Character window with progression, defenses, and spellbook tabs. */
	readonly characterSheet: Omit<ClientUiPanel, "resizable">;
	/** Inventory window with independently retained geometry; borders always resize. */
	readonly inventory: Omit<ClientUiPanel, "resizable">;
	/** Independent, server-confirmed external storage window. */
	readonly worldContainer: Omit<ClientUiPanel, "resizable">;
	/** Server-granted appearance editor. */
	readonly barber: Omit<ClientUiPanel, "resizable">;
	/** Vendor catalog, currencies, and combined trade draft. */
	readonly vendor: Omit<ClientUiPanel, "resizable">;
	/** Target-bound lock tools and sequential key attempts. */
	readonly locks: Omit<ClientUiPanel, "resizable">;
	/** Local salvage queue, estimated output, and explicit destruction action. */
	readonly salvage: Omit<ClientUiPanel, "resizable">;
	/** Crystal ownership, requirements, and physical payment draft. */
	readonly houseCrystal: Omit<ClientUiPanel, "resizable">;
	/** Server-confirmed player-to-player offers and acceptance. */
	readonly trade: Omit<ClientUiPanel, "resizable">;
	/** Independent server-confirmed object inspection window. */
	readonly inspection: Omit<ClientUiPanel, "resizable">;
	/** One retained reader window for the most recently opened book. */
	readonly book: Omit<ClientUiPanel, "resizable">;
	/** Diagnostics window with independently retained geometry; borders always resize. */
	readonly debug: Omit<ClientUiPanel, "resizable">;
	/** Retained World window with World and Housing tabs. */
	readonly world: Omit<ClientUiPanel, "resizable">;
	/** Floating client preferences window. */
	readonly settings: Omit<ClientUiPanel, "resizable">;
	/** Frame-rate readout. */
	readonly frameRate: ClientUiPanel;
	/** Conditional jump-charge control. */
	readonly jumpPower: ClientUiPanel;
	/** Circular radar; diameter keeps both axes coupled. */
	readonly minimap: ClientUiPlacement & {
		/** Preferred diameter in logical UI units. */
		readonly size: number;
		/** Minimum editable diameter. */
		readonly minSize: number;
		/** Whether layout editing exposes the resize handle. */
		readonly resizable: boolean;
	};
	/** Current selection's identity and actions. */
	readonly selectedEntity: ClientUiPanel;
	/** Game-window shortcut buttons. */
	readonly shortcuts: ClientUiPanel;
	/** Conditional notification lane. */
	readonly toast: ClientUiPanel;
}

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

/** Current usable client content dimensions in logical UI units. */
export interface ClientHudViewport {
	readonly width: number;
	readonly height: number;
}

/** Convert unscaled browser content dimensions into the HUD's logical layout units. */
export function logicalClientHudViewport(
	viewport: ClientHudViewport,
	scale: number,
): ClientHudViewport {
	return { width: viewport.width / scale, height: viewport.height / scale };
}

/** Concrete viewport-relative rectangle in logical UI units, consumed by positioned Svelte components. */
export interface ResolvedClientHudPlacement {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/** Live geometry for exactly the surfaces declared by the UI contract. */
export type ClientHudLayout = {
	readonly [Surface in keyof ClientUiDefaults]: ClientHudPlacement;
};

interface PreferredClientHudExtent {
	readonly width: number;
	readonly height: number;
}

/** Pointer displacement from the start of one drag gesture, already converted to logical UI units. */
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

/** Keep a content-sized HUD's top fixed as its measured height changes.
 * The retained rectangle supplies the viewport attachment; callers then replace its extent.
 */
export function topAnchoredClientHudPlacement(
	placement: ClientHudPlacement,
	viewport: ClientHudViewport,
	minimum: PreferredClientHudExtent,
): ClientHudPlacement {
	const reference = resolveClientHudPlacement(placement, viewport, minimum);
	return {
		...placement,
		vertical: { alignment: "start", offset: reference.top },
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

/** Keep centered footer overhang within the same usable viewport as the minimap disc. */
export function resolveClientMinimapPlacement(
	placement: ClientHudPlacement,
	viewport: ClientHudViewport,
	minimumSize: number,
	footerWidth: number,
): ResolvedClientHudPlacement {
	const disc = resolveClientHudSquarePlacement(
		placement,
		viewport,
		minimumSize,
	);
	// If the footer alone exceeds the viewport, centering is the most reachable constrained layout.
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

/** Move with the reachable preferred extent so capturing anchors cannot enlarge the result. */
export function moveClientHudRectangle(
	start: ResolvedClientHudPlacement,
	viewport: ClientHudViewport,
	minimum: PreferredClientHudExtent,
	preferred: PreferredClientHudExtent,
	delta: ClientPointerDelta,
): ResolvedClientHudPlacement {
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
export function resizeClientPanelRectangle(
	start: ResolvedClientHudPlacement,
	viewport: ClientHudViewport,
	minimum: PreferredClientHudExtent,
	delta: ClientPointerDelta,
	edges: ResizeEdges,
	/** Optional logical-width increment; omit for continuous resizing. */
	widthStep?: number,
): ResolvedClientHudPlacement {
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

/** Resolve declarative startup geometry; subsequent edits retain canonical axis anchors. */
export function createClientHudLayout(
	defaults: ClientUiDefaults,
	viewport: ClientHudViewport,
	shortcutCount: number,
): ClientHudLayout {
	const place = (panel: Pick<ClientUiPanel, "anchor" | "offset" | "size">) =>
		createClientHudPanelPlacement(panel, viewport, shortcutCount);
	return {
		logopolis: place(defaults.logopolis),
		character: place(defaults.character),
		partyHud: place(defaults.partyHud),
		statusTray: place(defaults.statusTray),
		spellBar: place(defaults.spellBar),
		combatBar: place(defaults.combatBar),
		chat: place(defaults.chat),
		inventory: place(defaults.inventory),
		worldContainer: place(defaults.worldContainer),
		locks: place(defaults.locks),
		salvage: place(defaults.salvage),
		barber: place(defaults.barber),
		vendor: place(defaults.vendor),
		houseCrystal: place(defaults.houseCrystal),
		trade: place(defaults.trade),
		inspection: place(defaults.inspection),
		book: place(defaults.book),
		nearby: place(defaults.nearby),
		social: place(defaults.social),
		journal: place(defaults.journal),
		enchantments: place(defaults.enchantments),
		characterSheet: place(defaults.characterSheet),
		debug: place(defaults.debug),
		world: place(defaults.world),
		settings: place(defaults.settings),
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
