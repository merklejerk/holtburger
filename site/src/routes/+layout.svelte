<script lang="ts">
	import '../styles/site.css';
	import { asset, resolve } from '$app/paths';
	import { page } from '$app/state';
	import Search from '#lib/components/Search.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
	const links = [
		{ path: '3d', label: '3D client' },
		{ path: 'tui', label: 'TUI client' },
		{ path: 'gallery', label: 'Gallery' },
		{ path: 'start', label: 'Start playing' },
		{ path: 'reference', label: 'Reference' },
		{ path: 'support', label: 'Help' }
	];
</script>

<svelte:head
	><link
		rel="icon"
		href={asset('assets/branding/portal-static.svg')}
	/></svelte:head
>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
	<div class="header-inner">
		<a class="brand" href={resolve('/')} aria-label="Holtburger home"
			><picture>
				<source
					media="(prefers-reduced-motion: reduce)"
					srcset={asset('assets/branding/portal-static.svg')}
				/>
				<img
					src={asset('assets/branding/portal.svg')}
					alt=""
					width="48"
					height="48"
				/>
			</picture><span>Holtburger</span></a
		>
		<nav aria-label="Main navigation">
			{#each links as link}<a
					href={resolve('/[...slug]', { slug: link.path })}
					aria-current={page.url.pathname.includes(`/${link.path}/`)
						? 'page'
						: undefined}>{link.label}</a
				>{/each}
		</nav>
		<Search />
		<ThemeToggle />
	</div>
</header>
{@render children()}
<footer class="site-footer">
	<div>
		<a href={resolve('/[...slug]', { slug: 'about/design' })}
			>Design philosophy</a
		><a href="https://github.com/merklejerk/holtburger">Source on GitHub</a><a
			href="https://github.com/merklejerk/holtburger/issues">Report an issue</a
		>
	</div>
</footer>
