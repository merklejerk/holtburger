import { mount, tick, unmount } from "svelte";
import { createUiThemeLoader } from "../../app/ui-theme";
import {
	CLIENT_COMBAT_INDICATOR_DEFAULTS,
	type ClientCombatIndicatorSettings,
} from "../../client/client-combat-indicator-settings";
import {
	observeCombatEffectsAppearance,
	readCombatEffectsAppearance,
	combatEffectColorHex,
} from "../../client/client-combat-effects-appearance";
import type { CombatEffectsAppearance } from "../../lib/game/systems/combat-effects-system";
import SettingsProbe from "./CombatIndicatorSettingsProbe.svelte";
import themeUrl from "./themes/combat-indicators.css?url&no-inline";

/** Real CSS, font-scope observation, stylesheet publication and production Settings controls. */
export async function probeCombatEffectsAppearance(): Promise<boolean> {
	const target = document.createElement("div");
	target.id = "combat-theme-probe";
	target.className = "ui-theme";
	target.style.setProperty("--ui-font-body", "monospace");
	document.body.append(target);
	let settings: ClientCombatIndicatorSettings =
		CLIENT_COMBAT_INDICATOR_DEFAULTS;
	let latest: CombatEffectsAppearance | null = null;
	const observer = observeCombatEffectsAppearance(
		target,
		settings,
		(value) => {
			latest = value;
		},
		() => {},
	);
	const loader = createUiThemeLoader(document);
	const require = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};
	const checkbox = (label: string) => {
		const row = [...target.querySelectorAll("label.checkbox")].find((row) =>
			row.textContent?.includes(label),
		);
		const input = row?.querySelector("input");
		if (!(input instanceof HTMLInputElement))
			throw new Error(`Missing combat preference ${label}`);
		return input;
	};
	const custom = (label: string) => {
		const input = checkbox(label);
		input.checked = false;
		input.dispatchEvent(new Event("change", { bubbles: true }));
	};
	const component = mount(SettingsProbe, {
		target,
		props: {
			initial: settings,
			accept(next) {
				settings = next;
				observer.update(next);
			},
		},
	});
	try {
		await tick();
		await loader.replace(themeUrl, null);
		await tick();
		const themed = readCombatEffectsAppearance(target, settings);
		require(themed.font === "monospace" &&
			themed.fontSize === 32 &&
			combatEffectColorHex(themed.colors.damage) ===
				"#122334", "Combat appearance ignored theme or body font");
		require(latest !== null &&
			JSON.stringify(latest) ===
				JSON.stringify(
					themed,
				), "Theme replacement did not publish combat appearance");
		const color = target.querySelector<HTMLInputElement>(
			'input[aria-label="Damage indicator color"]',
		);
		if (!color) throw new Error("Damage color control missing");
		require(color.disabled &&
			color.value === "#122334", "Color control did not show inherited theme");
		custom("Use theme damage color");
		await tick();
		color.value = "#ff0000";
		color.dispatchEvent(new Event("input", { bubbles: true }));
		await tick();
		require(settings.colors.damage === "#ff0000" &&
			combatEffectColorHex(
				readCombatEffectsAppearance(target, settings).colors.damage,
			) === "#ff0000", "Player color did not override theme");
		custom("Use theme text size");
		await tick();
		const size = target.querySelector<HTMLInputElement>('input[type="range"]');
		if (!size) throw new Error("Combat size control missing");
		size.value = "40";
		size.dispatchEvent(new Event("input", { bubbles: true }));
		await tick();
		require(settings.fontSize === 40, "Player size did not update");
		target.style.setProperty("--ui-font-body", "serif");
		await tick();
		await Promise.resolve();
		require(readCombatEffectsAppearance(target, settings).font ===
			"serif", "Combat font ignored player body role");
		target.style.setProperty("--ui-combat-text-font", "cursive");
		await tick();
		await Promise.resolve();
		require(readCombatEffectsAppearance(target, settings).font ===
			"cursive", "Dedicated combat font did not override body role");
		const reset = [...target.querySelectorAll("button")].find(
			(button) => button.textContent === "Reset combat indicators",
		);
		if (!reset) throw new Error("Combat reset control missing");
		reset.click();
		await tick();
		require(JSON.stringify(settings) ===
			JSON.stringify(
				CLIENT_COMBAT_INDICATOR_DEFAULTS,
			), "Combat reset did not restore theme inheritance");
		require(readCombatEffectsAppearance(target, settings).fontSize === 32 &&
			color.disabled &&
			color.value === "#122334", "Reset did not apply current theme");
		return true;
	} finally {
		await unmount(component);
		observer.destroy();
		await loader.dispose();
		target.remove();
	}
}
