<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { navigation } from '#lib/content/navigation.ts';
	let { slug }: { slug: string } = $props();
	// The server renders ordinary navigation; mobile gets a modal after hydration.
	let mobile = $state(false);
	// The dialog exists only while the mobile branch is mounted.
	let menu = $state<HTMLDialogElement>();
	onMount(() => {
		const narrow = matchMedia('(max-width: 760px)');
		const update = () => {
			if (!narrow.matches) menu?.close();
			mobile = narrow.matches;
		};
		update();
		narrow.addEventListener('change', update);
		return () => narrow.removeEventListener('change', update);
	});

	function dismissBackdrop(
		event: PointerEvent & { currentTarget: HTMLDialogElement }
	) {
		// Backdrop events target the dialog too; bounds distinguish outside presses.
		const bounds = event.currentTarget.getBoundingClientRect();
		if (
			event.clientX < bounds.left ||
			event.clientX > bounds.right ||
			event.clientY < bounds.top ||
			event.clientY > bounds.bottom
		)
			event.currentTarget.close();
	}
</script>

{#snippet guideLinks()}
	<aside class="guide-sidebar" aria-label="Guide navigation">
		<a class="back-link" href={resolve('/')}>← Holtburger</a>
		{#each navigation as section}
			{#if section.links.length === 1}
				{#each section.links as link}
					<a
						class="guide-direct-link"
						href={resolve('/[...slug]', { slug: link.slug })}
						aria-current={slug === link.slug ? 'page' : undefined}
						>{link.label}</a
					>
				{/each}
			{:else}
				<details open={section.links.some((link) => link.slug === slug)}>
					<summary><h2>{section.title}</h2></summary>
					{#each section.links as link}
						<a
							href={resolve('/[...slug]', { slug: link.slug })}
							aria-current={slug === link.slug ? 'page' : undefined}
							>{link.label}</a
						>
					{/each}
				</details>
			{/if}
		{/each}
	</aside>
{/snippet}

{#if mobile}
	<button
		class="guide-menu-toggle"
		type="button"
		aria-label="Open guide navigation"
		aria-haspopup="dialog"
		aria-controls="mobile-guide-navigation"
		onclick={() => menu?.showModal()}
	>
		<svg width="25" height="22" viewBox="0 0 25 22" aria-hidden="true"
			><path
				d="M2 4h21M2 11h21M2 18h21"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/></svg
		>
		<span>Guides</span>
	</button>
	<dialog
		id="mobile-guide-navigation"
		class="guide-menu-dialog"
		bind:this={menu}
		aria-labelledby="guide-menu-title"
		onpointerdown={dismissBackdrop}
	>
		<header class="guide-menu-header">
			<h2 id="guide-menu-title">Browse the guides</h2>
			<form method="dialog">
				<button type="submit" aria-label="Close guide navigation">×</button>
			</form>
		</header>
		{@render guideLinks()}
	</dialog>
{:else}
	<div class="chapter-navigation">{@render guideLinks()}</div>
{/if}
