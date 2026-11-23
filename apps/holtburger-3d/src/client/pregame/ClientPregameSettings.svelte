<script lang="ts">
	import type { UiThemeSettings } from "../../app/theme/ui-theme-selection";
	import UiTabs from "../../app/ui/UiTabs.svelte";
	import UiTabPanel from "../../app/ui/UiTabPanel.svelte";
	import GraphicsSettingsControls from "../../app/settings/GraphicsSettingsControls.svelte";
	import AudioSettingsControls from "../../app/settings/AudioSettingsControls.svelte";
	import AppearanceSettingsControls from "../../app/settings/AppearanceSettingsControls.svelte";
	import type {
		ClientGraphicsSettings,
		ClientAudioSettings,
		ClientUiSettings,
	} from "../settings/settings-contract";
	import type { TextureFilteringCapabilities } from "../../lib/game/renderer/webgl2/texture-filtering-policy";

	interface Props {
		/** The same gameplay preferences and mutation owners used by the HUD settings. */
		readonly graphics: ClientGraphicsSettings;
		readonly audio: ClientAudioSettings;
		/** Shared selection owner and settings commit used by both appearance surfaces. */
		readonly theme: UiThemeSettings;
		readonly ui: ClientUiSettings;
		readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
		readonly onGraphicsChange: (graphics: ClientGraphicsSettings) => void;
		readonly onAudioChange: (audio: ClientAudioSettings) => void;
		readonly onUiChange: (ui: ClientUiSettings) => void;
	}
	let {
		graphics,
		audio,
		theme,
		ui,
		textureFilteringCapabilities,
		onGraphicsChange,
		onAudioChange,
		onUiChange,
	}: Props = $props();
	const id = $props.id();
	const tabs = (
		[
			{ value: "graphics", label: "Graphics" },
			{ value: "audio", label: "Audio" },
			{ value: "ui", label: "UI" },
		] as const
	).map((tab) => ({
		...tab,
		id: `${id}-${tab.value}-tab`,
		panelId: `${id}-${tab.value}-panel`,
	}));
	let selected = $state<"graphics" | "audio" | "ui">("graphics");
</script>

<div class="pregame-settings ui-tabbed-panel ui-body">
	<UiTabs
		label="Settings sections"
		{tabs}
		{selected}
		onSelect={(tab) => (selected = tab)}
	/>
	{#each tabs as tab}
		<UiTabPanel
			id={tab.panelId}
			labelledBy={tab.id}
			active={selected === tab.value}
		>
			{#if tab.value === "graphics"}
				<GraphicsSettingsControls
					{graphics}
					{textureFilteringCapabilities}
					{onGraphicsChange}
				/>
			{:else if tab.value === "audio"}
				<AudioSettingsControls {audio} {onAudioChange} />
			{:else}
				<AppearanceSettingsControls {theme} {ui} {onUiChange} />
			{/if}
		</UiTabPanel>
	{/each}
</div>

<style>
	@layer components {
		.pregame-settings {
			min-height: 0;
		}
	}
</style>
