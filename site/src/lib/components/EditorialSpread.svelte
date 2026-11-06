<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		children,
		illustration,
		illustrationSide = 'right'
	}: {
		/** Related explanation, first in reading order at every viewport size. */
		children: Snippet;
		/** Related media forms a centered row, beside the copy when its intrinsic size fits. */
		illustration: Snippet;
		/** Place the illustration beside the copy on wide screens; mobile keeps copy first. */
		illustrationSide?: 'left' | 'right';
	} = $props();
</script>

<div
	class="editorial-spread"
	class:editorial-spread--illustration-left={illustrationSide === 'left'}
>
	<div class="editorial-copy">{@render children()}</div>
	<div class="editorial-media">{@render illustration()}</div>
</div>
