<script lang="ts">
	import type { CombatEffectsAppearance } from "../lib/game/systems/combat-effects-system";
	import {
		observeCombatEffectsAppearance,
		combatEffectColorHex,
	} from "./client-combat-effects-appearance";
	import {
		CLIENT_COMBAT_INDICATOR_DEFAULTS,
		COMBAT_INDICATOR_SIZE_RANGE,
		type ClientCombatIndicatorSettings,
	} from "./client-combat-indicator-settings";
	const {
		settings,
		onChange,
	}: {
		settings: ClientCombatIndicatorSettings;
		onChange: (settings: ClientCombatIndicatorSettings) => void;
	} = $props();
	// Cold UI controls consume this snapshot only on theme/preference/font changes.
	let appearance = $state.raw<CombatEffectsAppearance | null>(null);
	function observe(element: HTMLElement, value: ClientCombatIndicatorSettings) {
		return observeCombatEffectsAppearance(
			element,
			value,
			(next) => {
				appearance = next;
			},
			() => {},
		);
	}
	const colors = [
		{ key: "damage", label: "Damage" },
		{ key: "critical", label: "Critical hits" },
		{ key: "avoidance", label: "Misses and resists" },
	] as const;
</script>

<details class="ui-disclosure ui-disclosure-section" open>
	<summary>Combat indicators</summary>
	<div class="settings-section ui-disclosure-body" use:observe={settings}>
		{#each appearance === null ? [] : [appearance] as resolved}
			<label
				>Text size: {Math.round(resolved.fontSize)} px
				<input
					type="range"
					min={COMBAT_INDICATOR_SIZE_RANGE.minimum}
					max={COMBAT_INDICATOR_SIZE_RANGE.maximum}
					step="1"
					value={resolved.fontSize}
					disabled={settings.fontSize === null}
					oninput={(event) =>
						onChange({
							...settings,
							fontSize: event.currentTarget.valueAsNumber,
						})}
				/>
			</label>
			<label class="checkbox"
				><input
					type="checkbox"
					checked={settings.fontSize === null}
					onchange={(event) =>
						onChange({
							...settings,
							fontSize: event.currentTarget.checked
								? null
								: Math.min(
										COMBAT_INDICATOR_SIZE_RANGE.maximum,
										Math.max(
											COMBAT_INDICATOR_SIZE_RANGE.minimum,
											Math.round(resolved.fontSize),
										),
									),
						})}
				/> Use theme text size</label
			>
			{#each colors as color}
				<label
					>{color.label} color
					<input
						type="color"
						aria-label={`${color.label} indicator color`}
						value={combatEffectColorHex(resolved.colors[color.key])}
						disabled={settings.colors[color.key] === null}
						oninput={(event) =>
							onChange({
								...settings,
								colors: {
									...settings.colors,
									[color.key]: event.currentTarget.value,
								},
							})}
					/>
				</label>
				<label class="checkbox"
					><input
						type="checkbox"
						checked={settings.colors[color.key] === null}
						onchange={(event) =>
							onChange({
								...settings,
								colors: {
									...settings.colors,
									[color.key]: event.currentTarget.checked
										? null
										: combatEffectColorHex(resolved.colors[color.key]),
								},
							})}
					/>
					Use theme {color.label.toLowerCase()} color</label
				>
			{/each}
			<button
				type="button"
				class="ui-button"
				onclick={() => onChange(CLIENT_COMBAT_INDICATOR_DEFAULTS)}
				>Reset combat indicators</button
			>
		{/each}
	</div>
</details>

<style>
	@layer components {
		.settings-section {
			display: grid;
			gap: 12px;
		}
		label:not(.checkbox) {
			display: grid;
			gap: 4px;
		}
		input[type="range"] {
			width: 100%;
			margin-inline: 0;
		}
	}
</style>
