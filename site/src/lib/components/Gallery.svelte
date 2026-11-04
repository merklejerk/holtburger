<script lang="ts">
	import Media from './Media.svelte';
	import type { MediaId } from '#lib/media/catalog.ts';
	let { items }: { items: MediaId[] } = $props();
</script>

<div class="gallery-grid">
	{#each items as id}<Media {id} />{/each}
</div>
