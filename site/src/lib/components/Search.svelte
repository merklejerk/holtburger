<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	let loaded = $state(false);
	// Module scripts cannot infer their location through document.currentScript.
	const bundlePath = $derived(
		new URL(resolve('pagefind/'), page.url.href).pathname
	);
	onMount(() => {
		// Pagefind is generated after prerendering; the local production preview includes it.
		const stylesheet = document.createElement('link');
		stylesheet.rel = 'stylesheet';
		stylesheet.href = resolve('pagefind/pagefind-component-ui.css');
		const script = document.createElement('script');
		script.type = 'module';
		script.src = resolve('pagefind/pagefind-component-ui.js');
		script.addEventListener('load', () => {
			loaded = true;
		});
		document.head.append(stylesheet, script);
		return () => {
			stylesheet.remove();
			script.remove();
		};
	});
</script>

<div class="search-control" class:loaded>
	<pagefind-config bundle-path={bundlePath}></pagefind-config>
	<pagefind-modal-trigger>Search</pagefind-modal-trigger>
	<pagefind-modal></pagefind-modal>
</div>
