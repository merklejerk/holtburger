<script lang="ts">
	import { untrack } from "svelte";
	import Settings from "../../client/ClientCombatIndicatorSettings.svelte";
	import type { ClientCombatIndicatorSettings } from "../../client/client-combat-indicator-settings";
	const {
		initial,
		accept,
	}: {
		initial: ClientCombatIndicatorSettings;
		accept: (settings: ClientCombatIndicatorSettings) => void;
	} = $props();
	let settings = $state.raw(untrack(() => initial));
</script>

<Settings
	{settings}
	onChange={(next) => {
		settings = next;
		accept(next);
	}}
/>
