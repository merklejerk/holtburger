<script lang="ts">
	import { onMount } from "svelte";
	import { provideAppInputPolicy } from "../lib/input/app-input-policy-context";
	import ClientDisplaySettingsControls from "../client/ClientDisplaySettingsControls.svelte";
	import ClientDisplayConfirmation from "../client/ClientDisplayConfirmation.svelte";
	import "../app/themes/holtburger-pregame.css";
	const { keyboard } = provideAppInputPolicy();
	onMount(() => keyboard.mount(document));
</script>

<div
	class="ui-theme"
	use:keyboard.scope={{ nativeControls: true, keydown: () => {} }}
>
	<ClientDisplaySettingsControls />
	<ClientDisplayConfirmation />
</div>
