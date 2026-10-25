<script lang="ts">
	import type { Snippet } from "svelte";
	import PortalLogo from "../../../../assets/branding/portal.svg?component";
	import { APP_BUILD_LABEL } from "../app/app-build";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import "./client-pregame.css";
	import "../app/themes/holtburger-pregame.css";

	interface Props {
		/** Loading foregrounds the wordmark; character selection keeps corner branding. */
		readonly branding: "hero" | "corner";
		/** Prepend the portal unless the page already features it in its content. */
		readonly showPortalLogo: boolean;
		/** Ready world scenery remains visible beneath the foreground composition. */
		readonly backdrop: boolean;
		/** The active page owns its controls, status, and recovery actions. */
		readonly children: Snippet;
		/** Page-owned peripheral actions or metadata, kept outside the foreground content. */
		readonly footer: Snippet;
	}
	const { branding, showPortalLogo, backdrop, children, footer }: Props =
		$props();
	const { keyboard } = useAppInputPolicy();
</script>

<main
	class="client-pregame-screen ui-theme"
	class:with-backdrop={backdrop}
	class:hero-brand={branding === "hero"}
	aria-label="Holtburger client"
	use:keyboard.scope={{ nativeControls: true, keydown: () => {} }}
>
	<header class="pregame-brand">
		{#if showPortalLogo}
			<span class="pregame-logo" aria-hidden="true"><PortalLogo /></span>
		{/if}
		<span>Holtburger</span>
	</header>
	<div class="pregame-content">{@render children()}</div>
	<footer class="pregame-footer">
		{@render footer()}
		<span class="pregame-build" aria-label="Build information"
			>{APP_BUILD_LABEL}</span
		>
	</footer>
</main>

<style>
	@layer components {
		.client-pregame-screen {
			position: relative;
			display: grid;
			grid-template-rows: auto minmax(0, 1fr) auto;
			gap: clamp(16px, 3vh, 32px);
			/* A definite height bounds percentage-sized previews and reserves the footer row. */
			height: 100dvh;
			min-height: 0;
			overflow: clip;
			padding: clamp(20px, 4vw, 64px);
			padding-bottom: 12px;
		}
		.client-pregame-screen.hero-brand {
			grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr) auto;
			gap: 24px;
		}
		.hero-brand .pregame-footer {
			grid-row: 4;
		}
		.hero-brand .pregame-brand {
			align-self: end;
			justify-self: center;
			text-align: center;
		}
		.hero-brand .pregame-content {
			align-self: start;
		}
		.pregame-brand {
			position: relative;
			z-index: 1;
			display: flex;
			align-items: center;
			gap: 0.3em;
			width: fit-content;
			padding-bottom: 16px;
		}
		.pregame-logo {
			flex: none;
			width: 1.12em;
			height: 1.4em;
		}
		.pregame-logo > :global(svg) {
			display: block;
			width: 100%;
			height: 100%;
		}
		.pregame-content {
			display: grid;
			grid-template-rows: minmax(0, 1fr);
			min-width: 0;
			min-height: 0;
			/* Pages own scrolling; their decorative fades may paint beyond this grid. */
		}
		.pregame-footer {
			/* Page fades extend beyond the content grid; keep footer controls above them. */
			z-index: 1;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 24px;
			min-width: 0;
			padding-top: 12px;
		}
		.pregame-build {
			margin-left: auto;
			text-align: right;
			overflow-wrap: anywhere;
		}
		@media (max-width: 850px) {
			/* Stacked pages scroll as one area, with the footer remaining in place. */
			.pregame-content {
				grid-template-rows: auto;
				overflow: hidden auto;
			}
		}
	}
</style>
