<script lang="ts">
	import { onMount } from 'svelte';
	import Media from './Media.svelte';
	import { media, type MediaId } from '#lib/media/catalog.ts';

	/** A carousel advances screenshots; playable media keeps its own controls. */
	type ImageId = {
		[Id in MediaId]: (typeof media)[Id]['kind'] extends 'image' ? Id : never;
	}[MediaId];
	let {
		images,
		label
	}: {
		/** At least one screenshot is required to establish the first slide. */
		images: readonly [ImageId, ...ImageId[]];
		/** Accessible name for this set of screenshots. */
		label: string;
	} = $props();
	let viewport = $state<HTMLDivElement>();
	let active = $state(0);
	let reducedMotion = $state(true);
	const autoplayDelayMs = 6000;

	function show(index: number) {
		if (!viewport) return;
		const next = (index + images.length) % images.length;
		viewport.scrollTo({
			left: next * viewport.clientWidth,
			behavior: reducedMotion ? 'instant' : 'smooth'
		});
	}

	function readPosition() {
		if (!viewport || viewport.clientWidth === 0) return;
		// Safari can report scroll positions beyond either end during a swipe.
		active = Math.max(
			0,
			Math.min(
				images.length - 1,
				Math.round(viewport.scrollLeft / viewport.clientWidth)
			)
		);
	}

	onMount(() => {
		const preference = matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => {
			reducedMotion = preference.matches;
		};
		update();
		preference.addEventListener('change', update);
		return () => preference.removeEventListener('change', update);
	});

	$effect(() => {
		if (images.length < 2) return;
		const timer = setInterval(() => show(active + 1), autoplayDelayMs);
		return () => clearInterval(timer);
	});
</script>

<section
	class="media-carousel"
	aria-label={label}
	aria-roledescription="carousel"
>
	<div
		class="media-carousel-viewport"
		bind:this={viewport}
		onscroll={readPosition}
	>
		{#each images as id, index}
			<div
				class="media-carousel-slide"
				role="group"
				aria-roledescription="slide"
				aria-label={`${index + 1} of ${images.length}: ${media[id].title}`}
				inert={index !== active}
			>
				<Media {id} />
			</div>
		{/each}
	</div>
	<button
		class="media-carousel-arrow media-carousel-previous"
		aria-label="Previous screenshot"
		onclick={() => show(active - 1)}>‹</button
	>
	<button
		class="media-carousel-arrow media-carousel-next"
		aria-label="Next screenshot"
		onclick={() => show(active + 1)}>›</button
	>
</section>
