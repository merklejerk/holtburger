<script lang="ts">
	import { asset } from '$app/paths';
	import { getMedia, type MediaId } from '#lib/media/catalog.ts';
	let {
		id,
		detail = false
	}: {
		id: MediaId;
		/** Keep a component crop compact instead of filling the reading column. */
		detail?: boolean;
	} = $props();
	const entry = $derived(getMedia(id));
	let playing = $state(false);
</script>

<figure class="media-figure" class:media-figure--detail={detail}>
	{#if entry.kind === 'image'}
		{@const src =
			entry.source.kind === 'local'
				? asset(entry.source.path)
				: entry.source.url}
		<a
			class="media-mount"
			href={src}
			aria-label={`View ${entry.title} at full size`}
		>
			<img
				{src}
				alt={entry.alt}
				width={entry.width}
				height={entry.height}
				loading="lazy"
			/>
		</a>
	{:else if entry.kind === 'video'}
		<div class="media-mount">
			<video
				class="media-video"
				controls
				muted
				playsinline
				loop={entry.captions === null}
				preload="none"
				poster={entry.poster}
				width={entry.width}
				height={entry.height}
				style:aspect-ratio={`${entry.width} / ${entry.height}`}
				crossorigin="anonymous"
				aria-label={entry.title}
			>
				<source src={entry.src} type="video/mp4" />
				{#if entry.captions !== null}<track
						kind="captions"
						src={entry.captions.src}
						srclang={entry.captions.language}
						label={entry.captions.label}
						default
					/>{/if}
				<a href={entry.src}>Download clip</a>
			</video>
		</div>
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
					: 'Image to come'}</span
			>
			<strong>{entry.title}</strong>
			<p>{entry.brief}</p>
		</div>
	{/if}
	{#if entry.kind === 'image' || entry.kind === 'video' || entry.kind === 'youtube'}<figcaption
		>
			{entry.title}{#if entry.kind === 'youtube'}
				· <a
					href={`https://www.youtube.com/watch?v=${encodeURIComponent(entry.videoId)}`}
					>Watch on YouTube</a
				>{/if}
		</figcaption>{/if}
</figure>
