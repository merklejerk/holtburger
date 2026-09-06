import { hexRgb } from "../../lib/frontend-color";
import type { UiTheme } from "../ui-theme-contract";

/** Warm charcoal glass, flat brass controls, and a narrow walnut accent. */
export const ESPRESSO_AERO = {
	id: "espresso-aero",
	name: "Espresso Aero",
	color: {
		text: hexRgb("#f4f0e5"),
		muted: hexRgb("#e5ddcb"),
		surface: hexRgb("#242522"),
		well: hexRgb("#191b19"),
		control: hexRgb("#645631"),
		frame: hexRgb("#60432d"),
		border: hexRgb("#c7ba91"),
		highlight: hexRgb("#f2dfa9"),
		shadow: hexRgb("#0d0806"),
		accent: hexRgb("#e6cd8b"),
		focus: hexRgb("#fff1cc"),
		danger: hexRgb("#ffac9c"),
		warning: hexRgb("#efc46f"),
		success: hexRgb("#bfd398"),
		chatTell: hexRgb("#f0b1e5"),
		chatGuild: hexRgb("#9bdddc"),
		chatSociety: hexRgb("#b1c3ff"),
		health: hexRgb("#dc796a"),
		stamina: hexRgb("#dfbd63"),
		mana: hexRgb("#87bddd"),
	},
	font: {
		body: "Arial, Helvetica, sans-serif",
		heading: 'Georgia, "Times New Roman", serif',
		mono: '"Courier New", monospace',
	},
	radius: { surface: 3, control: 2 },
	material: { opacity: 0.74, blur: 12, grain: 0.16, gloss: 0, shadow: 0.16 },
} satisfies UiTheme;
