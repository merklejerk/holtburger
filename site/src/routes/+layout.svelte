<script lang="ts">
	import '../styles/site.css';
	import { asset, resolve } from '$app/paths';
	import { page } from '$app/state';
	import Search from '#lib/components/Search.svelte';
	import { mediaUrl } from '#lib/media/url.ts';
	import { illustrations } from '#lib/illustrations.ts';
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { refreshDownloads } from '#lib/downloads.svelte.ts';
	onMount(() => {
		const controller = new AbortController();
		const refresh = () => {
			void refreshDownloads(asset('updates/downloads.json'), controller.signal);
		};
		refresh();
		window.addEventListener('focus', refresh);
		return () => {
			controller.abort();
			window.removeEventListener('focus', refresh);
		};
	});
	let { children }: { children: Snippet } = $props();
	const links = [
		{ path: '3d', label: '3D client' },
		{ path: 'tui', label: 'TUI client' },
		{ path: 'gallery', label: 'Gallery' },
		{ path: 'start', label: 'Start playing' },
		{ path: 'support', label: 'Help' }
	];
</script>

<svelte:head
	><link rel="stylesheet" href={asset('fonts.css')} /><link
		rel="icon"
		href={asset('assets/branding/favicon.png')}
	/></svelte:head
>
<a class="skip-link" href="#main">Skip to content</a>
<div
	class="publication"
	style:--paint-wash={`url('${mediaUrl(illustrations.ochre.src)}')`}
>
	<header class="site-header">
		<div class="header-inner">
			<div class="masthead">
				<a class="brand" href={resolve('/')} aria-label="Holtburger home">
					<img
						class="brand-wordmark"
						src={asset('assets/branding/wordmark.webp')}
						width="1200"
						height="400"
						alt="Holtburger"
					/>
				</a>
				<img
					class="masthead-landscape"
					{...illustrations.engraving}
					src={mediaUrl(illustrations.engraving.src)}
					alt=""
					aria-hidden="true"
				/>
			</div>
			<div class="navigation-row">
				<nav aria-label="Main navigation">
					{#each links as link}<a
							href={resolve('/[...slug]', { slug: link.path })}
							aria-current={page.url.pathname.includes(`/${link.path}/`)
								? 'page'
								: undefined}>{link.label}</a
						>{/each}
				</nav>
				<Search />
			</div>
		</div>
	</header>
	{@render children()}
	<footer class="site-footer">
		<div>
			<a href="https://github.com/merklejerk/holtburger">Source on GitHub</a><a
				href="https://github.com/merklejerk/holtburger/issues"
				>Report an issue</a
			>
		</div>
	</footer>
</div>
