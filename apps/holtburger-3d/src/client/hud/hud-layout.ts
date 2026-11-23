import {
	anchorHudPlacement,
	logicalHudViewport,
	moveHudRectangle,
	resizePanelRectangle,
	resolveHudPlacement,
	resolveHudSquarePlacement,
	resolveMinimapPlacement,
	topAnchoredHudPlacement,
	type HudPlacement,
	type HudViewport,
	type ResolvedHudPlacement,
} from "../../app/hud/hud-geometry.js";

export type {
	HudPlacement as ClientHudPlacement,
	HudViewport as ClientHudViewport,
	ResolvedHudPlacement as ResolvedClientHudPlacement,
};
export {
	anchorHudPlacement as anchorClientHudPlacement,
	logicalHudViewport as logicalClientHudViewport,
	moveHudRectangle as moveClientHudRectangle,
	resizePanelRectangle as resizeClientPanelRectangle,
	resolveHudPlacement as resolveClientHudPlacement,
	resolveHudSquarePlacement as resolveClientHudSquarePlacement,
	resolveMinimapPlacement as resolveClientMinimapPlacement,
	topAnchoredHudPlacement as topAnchoredClientHudPlacement,
};

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

/** Live geometry for exactly the surfaces declared by the UI contract. */
export type ClientHudLayout = {
	readonly [Surface in keyof ClientUiDefaults]: HudPlacement;
};

/** Resolve declarative startup geometry; subsequent edits retain canonical axis anchors. */
export function createClientHudLayout(
	defaults: ClientUiDefaults,
	viewport: HudViewport,
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
	viewport: HudViewport,
	shortcutCount: number,
): HudPlacement {
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
				: Math.min(
						height.max,
						Math.max(height.min, viewport.height - height.viewportMinus),
					),
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
