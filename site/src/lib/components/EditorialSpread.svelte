<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		children,
		illustration
	}: {
		/** Related explanation, first in reading order at every viewport size. */
		children: Snippet;
		/** Related media forms a centered row, beside the copy when its intrinsic size fits. */
		illustration: Snippet;
	} = $props();
</script>

<div class="editorial-spread">
	<div class="editorial-copy">{@render children()}</div>
	<div class="editorial-media">{@render illustration()}</div>
</div>
