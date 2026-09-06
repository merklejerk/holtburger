import type { HexRgbColor } from "../lib/frontend-color";

/** Complete app-owned appearance; layout and game visualization are deliberately absent. */
export interface UiTheme {
	/** Stable theme identity used by the specimen and future settings. */
	readonly id: string;
	/** Human-readable theme name. */
	readonly name: string;
	/** Opaque role colors; recipes own their layering and transparency. */
	readonly color: {
		/** Main informational text. */
		readonly text: HexRgbColor;
		/** Secondary and disabled information. */
		readonly muted: HexRgbColor;
		/** Glass body and opaque fallback. */
		readonly surface: HexRgbColor;
		/** Opaque reading and editing areas. */
		readonly well: HexRgbColor;
		/** Flat window controls. */
		readonly control: HexRgbColor;
		/** Window-frame substrate. */
		readonly frame: HexRgbColor;
		/** Essential control boundaries. */
		readonly border: HexRgbColor;
		/** Hover lightening and optional surface reflection. */
		readonly highlight: HexRgbColor;
		/** Ambient shadow and dark grain. */
		readonly shadow: HexRgbColor;
		/** Selected state and primary action trim. */
		readonly accent: HexRgbColor;
		/** Keyboard focus, independent of selection. */
		readonly focus: HexRgbColor;
		/** Destructive/error feedback. */
		readonly danger: HexRgbColor;
		/** Caution and interrupted progress. */
		readonly warning: HexRgbColor;
		/** Positive completion feedback. */
		readonly success: HexRgbColor;
		/** Private-message chat text. */
		readonly chatTell: HexRgbColor;
		/** Allegiance chat text. */
		readonly chatGuild: HexRgbColor;
		/** Society chat text. */
		readonly chatSociety: HexRgbColor;
		/** Health fill. */
		readonly health: HexRgbColor;
		/** Stamina fill. */
		readonly stamina: HexRgbColor;
		/** Mana fill. */
		readonly mana: HexRgbColor;
	};
	/** Existing system font stacks; no remote font loading. */
	readonly font: {
		/** Controls and reading text. */
		readonly body: string;
		/** Restrained display headings. */
		readonly heading: string;
		/** Dense diagnostic values. */
		readonly mono: string;
	};
	/** CSS-pixel corner radii, independent of panel placement. */
	readonly radius: {
		/** Window surfaces; HUD overlays remain borderless. */
		readonly surface: number;
		/** Inputs and buttons. */
		readonly control: number;
	};
	/** Bounded material strengths; shared recipes own the shape of each effect. */
	readonly material: {
		/** Glass opacity in [0, 1]; reduced transparency always uses opaque bodies. */
		readonly opacity: number;
		/** CSS-pixel backdrop blur; never animated or nested by recipes. */
		readonly blur: number;
		/** Frame grain strength in [0, 1]; zero produces a texture-free frame. */
		readonly grain: number;
		/** Broad surface reflection strength in [0, 1]. */
		readonly gloss: number;
		/** Ambient shadow opacity in [0, 1]. */
		readonly shadow: number;
	};
}

/** Cold presentation preference, not a separate theme or renderer setting. */
export interface UiThemePreferences {
	/** Replace transparent bodies with opaque surfaces and turn backdrop filtering off. */
	readonly reducedTransparency: boolean;
}
