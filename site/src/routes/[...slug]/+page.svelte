<script lang="ts">
	import { resolve } from '$app/paths';
	import { pages } from '#lib/content/registry.ts';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	const sections = [
		{
			title: 'Begin your journey',
			links: [
				{ slug: 'coming-from-retail', label: 'Coming from retail & Decal' },
				{ slug: 'start', label: 'Start playing' }
			]
		},
		{
			title: 'The 3D client',
			links: [
				{ slug: '3d', label: 'A new way to play' },
				{ slug: '3d/selection-interaction', label: 'Selection & interaction' }
			]
		},
		{
			title: 'Other paths',
			links: [
				{ slug: 'tui', label: 'Terminal client' },
				{ slug: 'gallery', label: 'Gallery' },
				{ slug: 'reference', label: 'Controls & reference' },
				{ slug: 'support', label: 'Help' },
				{ slug: 'about/design', label: 'Design philosophy' }
			]
		}
	];
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
			{#each sections as section}<section>
					<h2>{section.title}</h2>
					{#each section.links.filter( (link) => pages.some((page) => page.slug === link.slug) ) as link}<a
							href={resolve('/[...slug]', { slug: link.slug })}
							aria-current={data.slug === link.slug ? 'page' : undefined}
							>{link.label}</a
						>{/each}
				</section>{/each}
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
