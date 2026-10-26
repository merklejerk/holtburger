<script lang="ts">
	import UiThemeControls from "../app/UiThemeControls.svelte";
	import type { UiThemeSettings } from "../app/ui-theme-selection";
	import type { ClientUiSettings } from "./client-settings-contract";
	import {
		CLIENT_FONT_FAMILY_OPTIONS,
		CLIENT_TEXT_SCALE,
		CLIENT_ICON_SCALE,
		type ClientFontFamily,
	} from "./client-settings-values";
	import "./client-settings-controls.css";
	interface Props {
		/** Shared selection owner and settings commit used by both appearance surfaces. */
		readonly theme: UiThemeSettings;
		/** User-owned fonts and scale; unrelated UI preferences are preserved on edits. */
		readonly ui: ClientUiSettings;
		readonly onUiChange: (ui: ClientUiSettings) => void;
	}
	let { theme, ui, onUiChange }: Props = $props();
	const fontRoles = [
		{ id: "body", label: "Body text" },
		{ id: "heading", label: "Headings" },
		{ id: "mono", label: "Monospace" },
	] as const;
	const fontFamilyLabels: Readonly<Record<ClientFontFamily, string>> = {
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
									[role.id]: event.currentTarget.value as ClientFontFamily,
								},
							})}
					>
						{#each CLIENT_FONT_FAMILY_OPTIONS as family}
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
				>Text scaling: {Math.round(ui.textScale * 100)}%
				<input
					type="range"
					aria-label="Text scaling"
					min={CLIENT_TEXT_SCALE.minimum}
					max={CLIENT_TEXT_SCALE.maximum}
					step={CLIENT_TEXT_SCALE.step}
					value={ui.textScale}
					oninput={(event) =>
						onUiChange({
							...ui,
							textScale: event.currentTarget.valueAsNumber,
						})}
				/>
			</label>
			<p class="ui-muted">
				Scales client text. Icon labels, map labels, nameplates, and combat text
				keep their own sizes.
			</p>
			<label
				>Icon scaling: {Math.round(ui.iconScale * 100)}%
				<input
					type="range"
					aria-label="Icon scaling"
					min={CLIENT_ICON_SCALE.minimum}
					max={CLIENT_ICON_SCALE.maximum}
					step={CLIENT_ICON_SCALE.step}
					value={ui.iconScale}
					oninput={(event) =>
						onUiChange({
							...ui,
							iconScale: event.currentTarget.valueAsNumber,
						})}
				/>
			</label>
			<p class="ui-muted">
				Scales UI artwork, cells, and their badges. Inline symbols follow text;
				world markers keep their own sizes.
			</p>
		</div>
	</details>
</div>
