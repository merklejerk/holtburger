<script lang="ts">
	import { mediaUrl } from '#lib/media/url.ts';
	import { illustrations, type IllustrationName } from '#lib/illustrations.ts';

	let {
		name,
		class: className,
		loading = 'lazy'
	}: {
		/** Published concept-art subject. */
		name: IllustrationName;
		/** Placement controls sizing; all studies retain their original aspect ratio. */
		class?: string;
		/** Above-the-fold placements load immediately. */
		loading?: 'eager' | 'lazy';
	} = $props();
	const illustration = $derived(illustrations[name]);
	const src = $derived(mediaUrl(illustration.src));
</script>

<img
	class={className}
	class:landscape-study={illustration.kind === 'landscape'}
	style:--art-silhouette={`url("${src}")`}
	width={illustration.width}
	height={illustration.height}
	{src}
	alt=""
	aria-hidden="true"
	{loading}
	decoding="async"
/>
