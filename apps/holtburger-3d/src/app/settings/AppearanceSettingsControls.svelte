<script lang="ts" generics="UiSettings extends SharedAppearanceSettings">
	import UiThemeControls from "../theme/UiThemeControls.svelte";
	import type { UiThemeSettings } from "../theme/ui-theme-selection";
	import UiRange from "../ui/UiRange.svelte";
	import {
		SHARED_FONT_FAMILY_OPTIONS,
		SHARED_HUD_WINDOW_OPACITY,
		SHARED_TEXT_SCALE,
		SHARED_UI_SCALE,
		type SharedAppearanceSettings,
		type SharedFontFamily,
	} from "./shared-settings-contract";
	import "./settings-controls.css";

	interface Props {
		readonly theme: UiThemeSettings;
		readonly ui: UiSettings;
		readonly onUiChange: (ui: UiSettings) => void;
	}
	let { theme, ui, onUiChange }: Props = $props();
	const fontRoles = [
		{ id: "body", label: "Body text" },
		{ id: "heading", label: "Headings" },
		{ id: "mono", label: "Monospace" },
	] as const;
	const fontFamilyLabels: Readonly<Record<SharedFontFamily, string>> = {
		theme: "Theme default",
		sans: "Arimo (sans-serif)",
		serif: "Gelasio (serif)",
		mono: "Cousine (monospace)",
	};
</script>

<div class="settings-section">
	<UiThemeControls {theme} preferredId={ui.themeId} />
	<details class="ui-disclosure ui-disclosure-section" open>
		<summary>Fonts</summary>
		<div class="settings-section ui-disclosure-body">
			{#each fontRoles as role}
				<label
					>{role.label} font
					<select
						value={ui.fonts[role.id]}
						onchange={(event) =>
							onUiChange({
								...ui,
								fonts: {
									...ui.fonts,
									[role.id]: event.currentTarget.value as SharedFontFamily,
								},
							})}
					>
						{#each SHARED_FONT_FAMILY_OPTIONS as family}
							<option value={family}>{fontFamilyLabels[family]}</option>
						{/each}
					</select>
				</label>
			{/each}
		</div>
	</details>
	<details class="ui-disclosure ui-disclosure-section" open>
		<summary>Scaling</summary>
		<div class="settings-section ui-disclosure-body">
			<label
				>UI scaling: {Math.round(ui.uiScale * 100)}%
				<UiRange
					aria-label="UI scaling"
					min={SHARED_UI_SCALE.minimum}
					max={SHARED_UI_SCALE.maximum}
					step={SHARED_UI_SCALE.step}
					value={ui.uiScale}
					oninput={(event) =>
						onUiChange({
							...ui,
							uiScale: event.currentTarget.valueAsNumber,
						})}
				/>
			</label>
			<label
				>Text scaling: {Math.round(ui.textScale * 100)}%
				<UiRange
					aria-label="Text scaling"
					min={SHARED_TEXT_SCALE.minimum}
					max={SHARED_TEXT_SCALE.maximum}
					step={SHARED_TEXT_SCALE.step}
					value={ui.textScale}
					oninput={(event) =>
						onUiChange({
							...ui,
							textScale: event.currentTarget.valueAsNumber,
						})}
				/>
			</label>
		</div>
	</details>
	<details class="ui-disclosure ui-disclosure-section" open>
		<summary>HUD windows</summary>
		<div class="settings-section ui-disclosure-body">
			<label
				>Window background opacity: {Math.round(ui.hudWindowOpacity * 100)}%
				<UiRange
					aria-label="Window background opacity"
					min={SHARED_HUD_WINDOW_OPACITY.minimum}
					max={SHARED_HUD_WINDOW_OPACITY.maximum}
					step={SHARED_HUD_WINDOW_OPACITY.step}
					value={ui.hudWindowOpacity}
					oninput={(event) =>
						onUiChange({
							...ui,
							hudWindowOpacity: event.currentTarget.valueAsNumber,
						})}
				/>
			</label>
		</div>
	</details>
</div>
