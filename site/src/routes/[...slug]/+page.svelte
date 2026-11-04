<script lang="ts">
	import { resolve } from '$app/paths';
	import { navigation } from '#lib/content/navigation.ts';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head
	><title>{data.title} · Holtburger</title><meta
		name="description"
		content={data.description}
	/></svelte:head
>
<div class="guide-shell" class:gallery-shell={data.slug === 'gallery'}>
	{#if data.slug !== 'gallery'}<aside
			class="guide-sidebar"
			aria-label="Guide navigation"
		>
			<a class="back-link" href={resolve('/')}>← Holtburger</a>
			{#each navigation as section}<details
					open={section.links.some((link) => link.slug === data.slug)}
				>
					<summary><h2>{section.title}</h2></summary>
					{#each section.links as link}<a
							href={resolve('/[...slug]', { slug: link.slug })}
							aria-current={data.slug === link.slug ? 'page' : undefined}
							>{link.label}</a
						>{/each}
				</details>{/each}
		</aside>{/if}
	<main id="main" class="guide-main" data-pagefind-body>
		<div class="eyebrow">{data.section}</div>
		<h1>{data.title}</h1>
		<p class="guide-intro">{data.description}</p>
		<div class="ornament" aria-hidden="true">◆</div>
		<article class="prose"><data.Content /></article>
	</main>
	{#if data.headings.length && data.slug !== 'gallery'}<aside
			class="on-this-page"
		>
			<h2>On this page</h2>
			<nav aria-label="On this page">
				{#each data.headings as heading}<a href={`#${heading.id}`}
						>{heading.text}</a
					>{/each}
			</nav>
		</aside>{/if}
</div>
