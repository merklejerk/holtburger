<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { IllustrationName } from '#lib/illustrations.ts';
	import DecorativeArt from './DecorativeArt.svelte';

	let {
		name,
		children
	}: {
		/** One decorative subject beneath this passage. */
		name: IllustrationName;
		/** Prose retains its normal width and determines the passage height. */
		children: Snippet;
	} = $props();
</script>

<div class="illustrated-prose">
	<DecorativeArt {name} class="prose-vignette" />
	{@render children()}
</div>

<style>
	/* Isolation keeps the underlay on this passage's paper, outside text layout. */
	.illustrated-prose {
		position: relative;
		isolation: isolate;
		display: flow-root;
	}
	.illustrated-prose :global(.prose-vignette) {
		position: absolute;
		z-index: -1;
		right: -1rem;
		bottom: -0.5rem;
		width: 75%;
		max-height: calc(100% + 2rem);
		object-fit: contain;
		object-position: right bottom;
		opacity: 0.16;
		mix-blend-mode: multiply;
		pointer-events: none;
	}
	.illustrated-prose :global(.prose-vignette.landscape-study) {
		left: 50%;
		right: auto;
		transform: translateX(-50%);
		object-position: center bottom;
	}
	@media (max-width: 760px) {
		.illustrated-prose :global(.prose-vignette) {
			right: 0;
			width: 100%;
			opacity: 0.12;
		}
	}
</style>
