import { createUiThemeLoader } from "../../app/ui-theme";
import {
	observeCombatEffectsAppearance,
	readCombatEffectsAppearance,
} from "../../client/client-combat-effects-appearance";
import type { CombatEffectsAppearance } from "../../lib/game/systems/combat-effects-system";
import themeUrl from "./themes/combat-indicators.css?url&no-inline";

/** Verify theme publication and scoped CSS changes reach the renderer's appearance contract. */
export async function probeCombatEffectsAppearance(): Promise<boolean> {
	const target = document.createElement("div");
	target.id = "combat-theme-probe";
	target.className = "ui-theme";
	target.style.setProperty("--ui-font-body", "monospace");
	document.body.append(target);
	let latest: CombatEffectsAppearance | null = null;
	const observer = observeCombatEffectsAppearance(
		target,
		(value) => {
			latest = value;
		},
		() => {},
	);
	const loader = createUiThemeLoader(document);
	const require = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};
	const settle = () =>
		new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	const published = () =>
		require(JSON.stringify(latest) ===
			JSON.stringify(
				readCombatEffectsAppearance(target),
			), "Theme observation did not publish the resolved combat appearance");
	try {
		await loader.replace(themeUrl, null);
		const themed = readCombatEffectsAppearance(target);
		require(themed.font === "monospace" &&
			themed.fontSize ===
				32, "Combat typography ignored the theme or body font role");
		require(JSON.stringify(themed.colors) ===
			JSON.stringify({
				damage: [18 / 255, 35 / 255, 52 / 255],
				critical: [171 / 255, 205 / 255, 239 / 255],
				avoidance: [101 / 255, 67 / 255, 33 / 255],
			}), "Combat colors ignored the theme");
		published();
		target.style.setProperty("--ui-combat-text-size", "40px");
		target.style.setProperty("--ui-combat-text-damage-color", "rgb(255, 0, 0)");
		target.style.setProperty("--ui-font-body", "serif");
		await settle();
		const changed = readCombatEffectsAppearance(target);
		require(changed.fontSize === 40 &&
			changed.font === "serif" &&
			changed.colors.damage[0] === 1 &&
			changed.colors.damage[1] === 0 &&
			changed.colors.damage[2] ===
				0, "Scoped combat appearance ignored live CSS changes");
		published();
		target.style.setProperty("--ui-combat-text-font", "cursive");
		await settle();
		require(readCombatEffectsAppearance(target).font ===
			"cursive", "Dedicated combat font did not override the body role");
		published();
		target.style.setProperty("--ui-text-scale", "2");
		await settle();
		require(readCombatEffectsAppearance(target).fontSize ===
			40, "UI text scaling changed the theme-owned combat text size");
		published();
		return true;
	} finally {
		observer.destroy();
		await loader.dispose();
		target.remove();
	}
}
