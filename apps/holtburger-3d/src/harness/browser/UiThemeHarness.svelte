<script lang="ts">
	import UiThemeSpecimen from "./UiThemeSpecimen.svelte";

	// Standalone manual preview needs no assets; the automated harness supplies a live world.
	const hasWorld = new URLSearchParams(window.location.search).has(
		"contentHost",
	);
</script>

{#if hasWorld}{#await import("./BrowserHarnessApp.svelte") then module}<module.default
		/>{/await}{/if}
<UiThemeSpecimen />
