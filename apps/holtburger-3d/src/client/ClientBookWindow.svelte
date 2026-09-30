<script lang="ts">
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import type { ClientBookReaderState } from "./client-book-reader";

	interface Props {
		readonly reader: Exclude<ClientBookReaderState, { readonly kind: "idle" }>;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly onClose: () => void;
		readonly onRetry: () => void;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
	}

	const {
		reader,
		placement,
		viewport,
		onClose,
		onRetry,
		onPlacementChange,
	}: Props = $props();
	const hasText = $derived(reader.book.pages.some((page) => page.text !== ""));
</script>

<ClientHudWindow
	icon="journal"
	title={reader.name}
	{placement}
	{viewport}
	{onClose}
	{onPlacementChange}
	minWidth={CLIENT_UI_DEFAULTS.book.minSize.width}
	minHeight={CLIENT_UI_DEFAULTS.book.minSize.height}
>
	<div class="book-scroll">
		{#if reader.kind === "loading"}
			<p role="status">Loading pages {reader.loaded} of {reader.total}…</p>
		{:else if reader.kind === "failed"}
			<p role="alert">{reader.error}</p>
			<button type="button" onclick={onRetry}>Retry</button>
		{:else}
			{#if !hasText}<p>This book has no text.</p>{/if}
			{#each reader.book.pages as page (page.index)}
				{#if page.text !== "" || page.authorName !== ""}
					<section class="book-page">
						<p class="book-text">{page.text}</p>
						{#if page.authorName !== ""}<p class="book-author">
								— {page.authorName}
							</p>{/if}
					</section>
				{/if}
			{/each}
			{#if reader.book.inscription}<blockquote>
					{reader.book.inscription}
				</blockquote>{/if}
			{#if reader.book.authorName}<p class="book-author">
					— {reader.book.authorName}
				</p>{/if}
		{/if}
	</div>
</ClientHudWindow>

<style>
	.book-scroll {
		height: 100%;
		overflow: auto;
		padding: 1rem;
	}
	.book-page + .book-page {
		margin-top: 1.4rem;
	}
	.book-text,
	blockquote {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.book-author {
		text-align: right;
		opacity: 0.8;
	}
	blockquote {
		margin: 1.5rem 0 0;
	}
</style>
