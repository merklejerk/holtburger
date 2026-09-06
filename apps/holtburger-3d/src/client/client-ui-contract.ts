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
	/** Space reserved outside this surface, in CSS pixels. */
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
	/** CSS-pixel displacement from the anchor. */
	readonly offset: { readonly x: number; readonly y: number };
}

/** Rectangular HUD geometry and its user-editing policy. */
export interface ClientUiPanel extends ClientUiPlacement {
	/** Preferred CSS-pixel size; shortcut widths may scale with the visible button count. */
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
	/** Player identity and vitals. */
	readonly character: ClientUiPanel;
	/** Chat history and command input. */
	readonly chat: ClientUiPanel;
	/** Optional developer window; window borders always support resizing. */
	readonly diagnostics: Omit<ClientUiPanel, "resizable">;
	/** Frame-rate readout. */
	readonly frameRate: ClientUiPanel;
	/** Conditional jump-charge control. */
	readonly jumpPower: ClientUiPanel;
	/** Circular radar; diameter keeps both axes coupled. */
	readonly minimap: ClientUiPlacement & {
		/** Preferred diameter in CSS pixels. */
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
