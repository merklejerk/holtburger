<script lang="ts">
	import BrowserDisplay from "./pages/BrowserDisplay.svelte";
	import BrowserPipelineHarness from "./pages/BrowserPipelineHarness.svelte";

	const currentRoute =
		typeof window === "undefined" ? "/browser" : window.location.pathname;
	const isBrowserRoute = currentRoute === "/" || currentRoute === "/browser";
	const isBrowserPipelineHarnessRoute =
		currentRoute === "/harness/browser-pipeline";
</script>

<svelte:head>
	<title>Holtburger 3D World Viewer</title>
	<meta
		name="description"
		content="Tauri-backed browser scene viewer for Holtburger 3D with frontend-owned navigation and demand-driven asset loading."
	/>
</svelte:head>

<main class="viewer-shell">
	{#if isBrowserPipelineHarnessRoute}
		<BrowserPipelineHarness />
	{:else if !isBrowserRoute}
		<section class="viewer-unavailable">
			<p class="kicker">Route Reserved</p>
			<h1>Client mode is not implemented yet.</h1>
			<p class="lede">Open /browser for the scene browser.</p>
		</section>
	{:else}
		<BrowserDisplay />
	{/if}
</main>
