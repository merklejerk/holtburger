import { observeUiTheme } from "../app/ui-theme";
import { createUiThemeColorReader } from "../app/ui-theme-color";
import type { CombatEffectsAppearance } from "../lib/game/systems/combat-effects-system";

/** Resolve theme-owned combat typography and colors at the client's appearance scope. */
export function readCombatEffectsAppearance(
	element: HTMLElement,
): CombatEffectsAppearance {
	const style = getComputedStyle(element);
	const readColor = createUiThemeColorReader(element);
	const color = (
		profile: keyof CombatEffectsAppearance["colors"],
	): readonly [number, number, number] => {
		const property = `--ui-combat-text-${profile}-color`;
		const { red, green, blue, alpha } = readColor(property);
		if (alpha !== 1)
			throw new Error(`Combat theme color ${property} must be opaque.`);
		return [red, green, blue];
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
		fontSize: Number.parseFloat(size),
		colors: {
			damage: color("damage"),
			critical: color("critical"),
			avoidance: color("avoidance"),
		},
	};
}

/** Cold theme/font notifications update appearance without owning presentation lifetime or frame reads. */
export function observeCombatEffectsAppearance(
	element: HTMLElement,
	publish: (appearance: CombatEffectsAppearance) => void,
	fontsChanged: () => void,
	reportFontFailure: (error: Error) => void,
) {
	const document = element.ownerDocument;
	let retired = false;
	let lastFontFailure: string | null = null;
	const refresh = () => {
		const appearance = readCombatEffectsAppearance(element);
		publish(appearance);
		// Canvas text is not a DOM font consumer; explicitly request theme font faces.
		// loadingdone invalidates any glyphs rasterized before that request completed.
		void document.fonts
			.load(`bold ${appearance.fontSize}px ${appearance.font}`)
			.then(
				() => {
					if (!retired) lastFontFailure = null;
				},
				(cause: unknown) => {
					const message = `Could not load combat font ${appearance.font}: ${String(cause)}`;
					// A missing theme font must preserve browser fallback, not become a startup failure.
					if (!retired && message !== lastFontFailure) {
						lastFontFailure = message;
						reportFontFailure(new Error(message, { cause }));
					}
				},
			);
	};
	const refreshFonts = () => {
		refresh();
		fontsChanged();
	};
	const stopTheme = observeUiTheme(element, refresh);
	document.fonts.addEventListener("loadingdone", refreshFonts);
	return {
		destroy() {
			retired = true;
			stopTheme();
			document.fonts.removeEventListener("loadingdone", refreshFonts);
		},
	};
}
