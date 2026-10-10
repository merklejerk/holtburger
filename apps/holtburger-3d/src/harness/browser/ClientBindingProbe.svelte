<script lang="ts">
	import { untrack } from "svelte";
	import ClientSettingsPanel from "../../client/ClientSettingsPanel.svelte";
	import ClientSelectedEntityHud from "../../client/ClientSelectedEntityHud.svelte";
	import type { ClientKeyboardConfiguration } from "../../lib/input/input-contract";
	import { createDefaultClientUserSettings } from "../../client/client-settings-defaults";
	import { EMPTY_CLIENT_SELECTED_DISPLAY } from "../../client/client-selected-entity-tracking";
	const {
		initial,
		accept,
		interact,
	}: {
		initial: ClientKeyboardConfiguration;
		accept: (input: ClientKeyboardConfiguration) => ClientKeyboardConfiguration;
		interact: () => void;
	} = $props();
	const defaults = createDefaultClientUserSettings(
		{ width: window.innerWidth, height: window.innerHeight },
		9,
	);
	// This fixture starts from one accepted snapshot; later changes flow through Settings.
	let input = $state.raw(untrack(() => initial));
	let menu = $state(false);
</script>

<div data-binding-probe>
	<ClientSettingsPanel
		audio={defaults.audio}
		graphics={defaults.graphics}
		ui={defaults.ui}
		clockFormat={defaults.clockFormat}
		environmentOverrides={defaults.environmentOverrides}
		weatherPresets={[]}
		environmentIssue={null}
		onClockFormatChange={() => undefined}
		onEnvironmentOverridesChange={() => undefined}
		{input}
		displayPlatform="windows"
		textureFilteringCapabilities={null}
		selectedTab="input"
		onSelectTab={() => {}}
		onAudioChange={() => {}}
		onGraphicsChange={() => {}}
		onUiChange={() => {}}
		onInputChange={(proposal) => {
			input = accept(proposal);
		}}
		canResetHudPlacements={false}
		onResetHudPlacements={() => {}}
	/>
	<button
		onclick={() => {
			menu = !menu;
		}}>Toggle extra action</button
	>
	{#key menu}
		<ClientSelectedEntityHud
			{input}
			displayPlatform="windows"
			selectedGuid={91}
			readSelectedDisplay={() => ({
				...EMPTY_CLIENT_SELECTED_DISPLAY,
				name: "Binding fixture",
				canInteract: true,
				interactionLabel: "Trade",
			})}
			readCanSplit={() => menu}
			readCanInvite={() => false}
			readCanSwear={() => false}
			readCanAddFriend={() => false}
			readCanIgnoreAccount={() => false}
			onAddFriend={() => {}}
			onIgnoreAccount={() => {}}
			onInvite={() => {}}
			onSwear={() => {}}
			onSplit={() => {}}
			onInteract={interact}
			onExamine={() => {}}
			examinePending={false}
		/>
	{/key}
</div>
