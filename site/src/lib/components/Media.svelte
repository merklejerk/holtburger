<script lang="ts">
	import { getMedia, type MediaId } from '#lib/media/catalog.ts';
	let { id }: { id: MediaId } = $props();
	const entry = $derived(getMedia(id));
	let playing = $state(false);
</script>

<figure class="media-figure">
	{#if entry.kind === 'image'}
		<a
			class="media-mount"
			href={entry.src}
			aria-label={`View ${entry.title} at full size`}
		>
			<img
				src={entry.src}
				alt={entry.alt}
				width={entry.width}
				height={entry.height}
				loading="lazy"
			/>
		</a>
	{:else if entry.kind === 'youtube'}
		<div class="media-mount">
			{#if playing}
				<iframe
					class="media-video"
					title={entry.title}
					src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(entry.videoId)}?autoplay=1`}
					allow="autoplay; encrypted-media; picture-in-picture"
					allowfullscreen
				></iframe>
			{:else}
				<div class="media-video media-video-cover">
					<button class="button" onclick={() => (playing = true)}
						>Play: {entry.title}</button
					>
				</div>
			{/if}
		</div>
	{:else}
		<div class="media-mount media-placeholder">
			<span class="media-status"
				>{entry.kind === 'planned-video'
					? 'Clip to come'
					: 'Screenshot to come'}</span
			>
			<strong>{entry.title}</strong>
			<p>{entry.brief}</p>
		</div>
	{/if}
	{#if entry.kind === 'image' || entry.kind === 'youtube'}<figcaption>
			{entry.title}{#if entry.kind === 'youtube'}
				· <a
					href={`https://www.youtube.com/watch?v=${encodeURIComponent(entry.videoId)}`}
					>Watch on YouTube</a
				>{/if}
		</figcaption>{/if}
</figure>
