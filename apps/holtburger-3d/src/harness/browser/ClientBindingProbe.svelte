<script lang="ts">
	import { createFixtureThemeSettings } from "./ui-showcase-themes";
	import { untrack } from "svelte";
	import ClientJumpPowerBar from "../../client/ClientJumpPowerBar.svelte";
	import { compactInputHint } from "../../lib/input/input-presentation";
	import ClientSettingsPanel from "../../client/ClientSettingsPanel.svelte";
	import ClientSelectedEntityHud from "../../client/ClientSelectedEntityHud.svelte";
	import type { ClientInputConfiguration } from "../../lib/input/input-contract";
	import { createDefaultClientUserSettings } from "../../client/client-settings-defaults";
	import { EMPTY_CLIENT_SELECTED_DISPLAY } from "../../client/client-selected-entity-tracking";
	const fixtureTheme = createFixtureThemeSettings(() => {});
	const {
		initial,
		accept,
		interact,
	}: {
		initial: ClientInputConfiguration;
		accept: (input: ClientInputConfiguration) => ClientInputConfiguration;
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
	<ClientJumpPowerBar
		active={true}
		previewExtent={0.5}
		precise={true}
		readExtent={() => 0.5}
		powerKeys={[
			compactInputHint(input.preciseJump.increasePower, "windows") ?? "—",
			compactInputHint(input.preciseJump.decreasePower, "windows") ?? "—",
		]}
		powerControl={null}
	/>
	<ClientSettingsPanel
		lockInteractions={defaults.lockInteractions}
		onLockInteractionsChange={() => {}}
		chatSuppression={defaults.chatSuppression}
		onChatSuppressionChange={() => {}}
		gameplayPreferences={null}
		gameplayEnabled={false}
		onGameplayOptionChange={async () => {
			throw new Error("No character is active in this fixture.");
		}}
		theme={fixtureTheme}
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
			readCanSalvage={() => false}
			onSalvage={() => {}}
			readCanSplit={() => menu}
			readCanInvite={() => false}
			readCanCorpsePermission={() => false}
			onCorpsePermission={() => {}}
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
