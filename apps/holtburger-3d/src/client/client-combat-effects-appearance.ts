import { observeUiTheme } from "../app/ui-theme";
import { hexRgb, normalizedRgbColor } from "../lib/frontend-color";
import type { CombatEffectsAppearance } from "../lib/game/systems/combat-effects-system";
import type { ClientCombatIndicatorSettings } from "./client-combat-indicator-settings";

/** Resolve theme CSS at the font scope; renderer and Settings share this one appearance contract. */
export function readCombatEffectsAppearance(
	element: HTMLElement,
	settings: ClientCombatIndicatorSettings,
): CombatEffectsAppearance {
	const style = getComputedStyle(element);
	const canvas = element.ownerDocument.createElement("canvas");
	canvas.width = canvas.height = 1;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context)
		throw new Error("Canvas2D unavailable for combat theme colors.");
	const color = (
		profile: keyof ClientCombatIndicatorSettings["colors"],
	): readonly [number, number, number] => {
		const override = settings.colors[profile];
		if (override !== null) {
			const { red, green, blue } = normalizedRgbColor(hexRgb(override));
			return [red, green, blue];
		}
		const property = `--ui-combat-text-${profile}-color`;
		const value = style.getPropertyValue(property).trim();
		if (!CSS.supports("color", value))
			throw new Error(`Invalid combat theme color ${property}: ${value}`);
		context.clearRect(0, 0, 1, 1);
		const swatch = element.ownerDocument.createElement("span");
		swatch.style.display = "none";
		swatch.style.color = value;
		element.append(swatch);
		const resolved = getComputedStyle(swatch).color;
		swatch.remove();
		context.fillStyle = resolved;
		context.fillRect(0, 0, 1, 1);
		const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
		if (alpha !== 255)
			throw new Error(`Combat theme color ${property} must be opaque.`);
		return [red / 255, green / 255, blue / 255];
	};
	const size = style.getPropertyValue("--ui-combat-text-size").trim();
	if (!/^\d+(?:\.\d+)?px$/.test(size) || Number.parseFloat(size) <= 0)
		throw new Error(`Combat theme size must be positive CSS pixels: ${size}`);
	// An absent dedicated font intentionally follows the resolved UI body override, not :root's font.
	const font =
		style.getPropertyValue("--ui-combat-text-font").trim() ||
		style.getPropertyValue("--ui-font-body").trim();
	if (!font || !CSS.supports("font-family", font))
		throw new Error("Combat theme requires a valid font family.");
	return {
		font,
		fontSize: settings.fontSize ?? Number.parseFloat(size),
		colors: {
			damage: color("damage"),
			critical: color("critical"),
			avoidance: color("avoidance"),
		},
	};
}

/** Cold theme/preferences/font notifications never drive presentation-owner lifetime or frame reads. */
export function observeCombatEffectsAppearance(
	element: HTMLElement,
	initial: ClientCombatIndicatorSettings,
	publish: (appearance: CombatEffectsAppearance) => void,
	fontsChanged: () => void,
) {
	let settings = initial;
	const document = element.ownerDocument;
	const refresh = () => {
		const appearance = readCombatEffectsAppearance(element, settings);
		publish(appearance);
		// Canvas text is not a DOM font consumer; explicitly request theme font faces.
		// loadingdone invalidates any glyphs rasterized before that request completed.
		void document.fonts.load(
			`bold ${appearance.fontSize}px ${appearance.font}`,
		);
	};
	const refreshFonts = () => {
		refresh();
		fontsChanged();
	};
	const stopTheme = observeUiTheme(element, refresh);
	document.fonts.addEventListener("loadingdone", refreshFonts);
	return {
		update(next: ClientCombatIndicatorSettings) {
			settings = next;
			refresh();
		},
		destroy() {
			stopTheme();
			document.fonts.removeEventListener("loadingdone", refreshFonts);
		},
	};
}

/** The color picker consumes the same resolved opaque RGB values used by WebGL. */
export function combatEffectColorHex(
	color: readonly [number, number, number],
): string {
	return `#${color
		.map((channel) =>
			Math.round(channel * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}
