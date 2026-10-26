<script lang="ts">
	import UiTabs from "../app/UiTabs.svelte";
	import UiTabPanel from "../app/UiTabPanel.svelte";
	import ClientGraphicsSettingsControls from "./ClientGraphicsSettingsControls.svelte";
	import ClientAudioSettingsControls from "./ClientAudioSettingsControls.svelte";
	import ClientAppearanceSettingsControls from "./ClientAppearanceSettingsControls.svelte";
	import type {
		ClientGraphicsSettings,
		ClientAudioSettings,
		ClientUiSettings,
	} from "./client-settings-contract";
	import type { TextureFilteringCapabilities } from "../lib/game/renderer/texture-filtering-policy";

	interface Props {
		/** The same gameplay preferences and mutation owners used by the HUD settings. */
		readonly graphics: ClientGraphicsSettings;
		readonly audio: ClientAudioSettings;
		readonly ui: ClientUiSettings;
		readonly textureFilteringCapabilities: TextureFilteringCapabilities | null;
		readonly onGraphicsChange: (graphics: ClientGraphicsSettings) => void;
		readonly onAudioChange: (audio: ClientAudioSettings) => void;
		readonly onUiChange: (ui: ClientUiSettings) => void;
	}
	let {
		graphics,
		audio,
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
				<ClientGraphicsSettingsControls
					{graphics}
					{textureFilteringCapabilities}
					{onGraphicsChange}
				/>
			{:else if tab.value === "audio"}
				<ClientAudioSettingsControls {audio} {onAudioChange} />
			{:else}
				<ClientAppearanceSettingsControls {ui} {onUiChange} />
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
