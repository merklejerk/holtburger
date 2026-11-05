<script lang="ts">
	import GuideNavigation from '#lib/components/GuideNavigation.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head
	><title>{data.title} · Holtburger</title><meta
		name="description"
		content={data.description}
	/></svelte:head
>
<div class="guide-shell">
	<GuideNavigation slug={data.slug} />
	<main
		id="main"
		class="guide-main"
		class:guide-reference={data.presentation === 'reference'}
		data-pagefind-body
	>
		<div class="eyebrow">{data.section}</div>
		<h1>{data.title}</h1>
		<p class="guide-intro">{data.description}</p>
		<article class="prose"><data.Content /></article>
	</main>
</div>
