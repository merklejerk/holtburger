<script lang="ts">
	import { onMount } from "svelte";
	import {
		UiThemeSelection,
		type UiThemeSettings,
	} from "../app/ui-theme-selection";
	import { createElectronUiThemeTransport } from "../app/ui-theme-transport";
	import { withBundledUiThemes } from "../app/ui-bundled-themes";
	import { uiThemes } from "../app/mount";
	import { createElectronClientSettingsTransport } from "../client/client-settings-transport";
	import { createDefaultClientUserSettings } from "../client/client-settings-defaults";
	import { createClientShortcuts } from "../client/ClientShortcutDock.svelte";
	import { ClientSettingsPersistence } from "../client/client-settings-persistence";
	import type { ClientUserSettingsPatch } from "../client/client-settings-sections";
	import ClientPregameSettings from "../client/ClientPregameSettings.svelte";
	import ClientSettingsPanel from "../client/ClientSettingsPanel.svelte";
	import { provideAppInputPolicy } from "../lib/input/app-input-policy-context";
	import "../app/themes/holtburger-pregame.css";

	const defaults = createDefaultClientUserSettings(
		{ width: innerWidth, height: innerHeight },
		createClientShortcuts(false).length,
	);
	const transport = createElectronClientSettingsTransport();
	const owner = new UiThemeSelection(
		withBundledUiThemes(createElectronUiThemeTransport()),
		uiThemes,
	);
	const { keyboard } = provideAppInputPolicy();
	let settings = $state.raw(defaults);
	let ready = $state(false);
	let gameplay = $state(false);
	let issue = $state<string | null>(null);
	const persistence = new ClientSettingsPersistence<ClientUserSettingsPatch>({
		delayMs: 1,
		save: (patch) => transport.saveUserPatch(patch),
		report: (error) => {
			issue = String(error);
		},
	});
	const theme: UiThemeSettings = {
		owner,
		async select(id) {
			if (await owner.select(id)) {
				settings = { ...settings, ui: { ...settings.ui, themeId: id } };
				persistence.publish({ sections: { ui: settings.ui } });
			}
		},
	};
	async function restore() {
		const loaded = await transport.loadUser(defaults);
		settings = { ...defaults, ...loaded.sections };
		await owner.refresh();
		await owner.select(settings.ui.themeId);
		ready = true;
	}
	onMount(() => {
		const retireKeyboard = keyboard.mount(document);
		Object.assign(window, {
			__UI_THEME_SETTINGS_PROBE__: {
				read: () => ({ ready, ui: settings.ui, state: owner.read(), issue }),
				restore,
				flush: () => persistence.flush(),
				gameplay: () => {
					gameplay = true;
				},
			},
		});
		void restore().catch((error: unknown) => {
			issue = String(error);
		});
		return () => {
			retireKeyboard();
			void owner.retire();
			Reflect.deleteProperty(window, "__UI_THEME_SETTINGS_PROBE__");
		};
	});
</script>

{#if issue}<p role="alert">{issue}</p>{/if}
{#if ready}
	{#if gameplay}
		<ClientSettingsPanel
			gameplayPreferences={null}
			gameplayEnabled={false}
			onGameplayOptionChange={async () => {
				throw new Error("No character is active in this fixture.");
			}}
			{theme}
			audio={settings.audio}
			graphics={settings.graphics}
			ui={settings.ui}
			input={settings.input}
			clockFormat={settings.clockFormat}
			environmentOverrides={settings.environmentOverrides}
			weatherPresets={[]}
			environmentIssue={null}
			displayPlatform="windows"
			textureFilteringCapabilities={null}
			selectedTab="ui"
			onSelectTab={() => {}}
			onClockFormatChange={() => {}}
			onEnvironmentOverridesChange={() => {}}
			onAudioChange={() => {}}
			onGraphicsChange={() => {}}
			onInputChange={() => {}}
			onUiChange={(ui) => {
				settings = { ...settings, ui };
			}}
			canResetHudPlacements={false}
			onResetHudPlacements={() => {}}
		/>
	{:else}
		<div class="client-pregame-screen">
			<ClientPregameSettings
				{theme}
				audio={settings.audio}
				graphics={settings.graphics}
				ui={settings.ui}
				textureFilteringCapabilities={null}
				onAudioChange={() => {}}
				onGraphicsChange={() => {}}
				onUiChange={(ui) => {
					settings = { ...settings, ui };
				}}
			/>
		</div>
	{/if}
{/if}
