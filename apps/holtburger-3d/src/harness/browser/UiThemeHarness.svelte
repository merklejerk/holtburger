<script lang="ts">
	import BrowserHarnessApp from "./BrowserHarnessApp.svelte";
	import UiThemeSpecimen from "./UiThemeSpecimen.svelte";

	// Standalone manual preview needs no assets; the automated harness supplies a live world.
	const hasWorld = new URLSearchParams(window.location.search).has(
		"contentHost",
	);
</script>

{#if hasWorld}<BrowserHarnessApp />{/if}
<UiThemeSpecimen />
