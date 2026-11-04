<script lang="ts">
	import { onMount } from 'svelte';
	let theme = $state('dark');
	onMount(() => {
		theme = document.documentElement.dataset.theme ?? 'dark';
	});
	function toggle() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem('holtburger-site-theme', theme);
		} catch {
			/* Theme changes still work for this visit without persistent storage. */
		}
	}
</script>

<button
	class="theme-toggle"
	onclick={toggle}
	aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
>
	<span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span><span
		class="theme-label">{theme === 'dark' ? 'Light' : 'Dark'}</span
	>
</button>
