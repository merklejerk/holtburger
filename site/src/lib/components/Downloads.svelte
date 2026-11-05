<script lang="ts">
	import { resolve } from '$app/paths';
	import { downloads } from '#lib/downloads.svelte.ts';
	import { releasesUrl } from '#lib/downloads.ts';
	let {
		product,
		platform
	}: { product: '3d' | 'cli'; platform?: 'windows' | 'macos' | 'linux' } =
		$props();
	const release = $derived(downloads.release);
	const groups = $derived(
		release === null
			? []
			: release.products[product].filter(
					(group) => platform === undefined || group.platform === platform
				)
	);
</script>

{#if release !== null}
	<p>
		Latest release: <strong>Holtburger {release.version}</strong> ·
		<a href={release.url}>Release notes</a>
	</p>
	<div class="download-options">
		{#each groups as group}
			<section aria-label={`${group.title} downloads`}>
				<h3>{group.title}</h3>
				<p class="hardware">{group.hardware}</p>
				{#each group.files as file, index}
					<p><a class:button={index === 0} href={file.url}>{file.label}</a></p>
				{/each}
				{#if platform === undefined}<a
						href={resolve('/[...slug]', {
							slug: `${product === '3d' ? 'start/3d' : 'tui/install'}/${group.platform}`
						})}>Installation guide →</a
					>{/if}
			</section>
		{/each}
	</div>
{:else}
	<p>
		Visit <a href={releasesUrl}>Holtburger releases on GitHub</a> for available downloads.
	</p>
{/if}
{#if downloads.refreshFailed}
	<p class="download-status" role="status">
		We couldn’t check for a newer version. <a href={releasesUrl}
			>Check all releases</a
		>.
	</p>
{/if}

<style>
	.download-options {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
		gap: 1rem;
		margin: 1rem 0 2rem;
	}
	section {
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 4px;
	}
	h3 {
		margin-top: 0;
	}
	.hardware {
		font-size: 0.85rem;
	}
	.download-status {
		font-size: 0.9rem;
	}
</style>
