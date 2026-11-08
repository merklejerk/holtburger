<script lang="ts">
	import type { UpdateSnapshot } from "./app-update-contract";
	import { renderReleaseNotes } from "./release-notes-markdown";
	import UiDialog from "./UiDialog.svelte";

	interface Props {
		/** Native-owned selection and refresh state, shared with the footer. */
		readonly snapshot: UpdateSnapshot;
		/** Explicit action failures belong to this modal's owner. */
		readonly actionFailure: string | null;
		/** Prevent duplicate browser actions while one is pending. */
		readonly busy: boolean;
		/** All network and browser actions are delegated to native code. */
		readonly onRefresh: () => void;
		/** Open the latest confirmed release in the system browser. */
		readonly onDownload: () => void;
		/** Open this repository’s complete release history. */
		readonly onHistory: () => void;
		/** Shared cancellation path for Close, Escape, and backdrop clicks. */
		readonly onCancel: () => void;
	}
	const {
		snapshot,
		actionFailure,
		busy,
		onRefresh,
		onDownload,
		onHistory,
		onCancel,
	}: Props = $props();
	const availability = $derived(snapshot.availability);
	/** Explicit action failures take precedence over the retained background request error. */
	const failure = $derived(
		actionFailure !== null
			? actionFailure
			: snapshot.check.kind === "failed"
				? `Could not refresh release changes: ${snapshot.check.message}`
				: null,
	);
	const notes = $derived(
		availability.kind === "unknown"
			? []
			: availability.releases.map((release) => ({
					version: release.version,
					html: renderReleaseNotes(release.notes),
				})),
	);
</script>

<UiDialog
	title="Release changes"
	className="app-update-dialog"
	--ui-dialog-width="44rem"
	{onCancel}
>
	<div class="release-changes-content">
		{#if snapshot.check.kind === "disabled"}
			<p>Update checking is unavailable for this build.</p>
		{:else if snapshot.check.kind === "idle" || snapshot.check.kind === "loading"}
			<p role="status">Checking for updates…</p>
		{/if}
		{#if availability.kind === "current"}
			<p>You’re up to date.</p>
		{/if}
		<div class="release-notes">
			{#each notes as release (release.version)}
				<section aria-label={`Release v${release.version}`}>
					<h3 class="ui-section-heading">v{release.version}</h3>
					<div class="release-markdown">{@html release.html}</div>
				</section>
			{/each}
		</div>
		{#if failure}<p role="alert" class="ui-error">{failure}</p>{/if}
	</div>
	<div class="ui-dialog-actions">
		{#if snapshot.check.kind === "failed"}
			<button
				class="ui-button"
				type="button"
				onclick={onRefresh}
				disabled={busy}>Retry</button
			>
		{/if}
		{#if availability.kind === "available" && availability.historyIncomplete}
			<button
				class="ui-button"
				type="button"
				onclick={onHistory}
				disabled={busy}>Full release history</button
			>
		{/if}
		{#if availability.kind !== "unknown"}
			<button
				class="ui-button"
				type="button"
				onclick={onDownload}
				disabled={busy || snapshot.check.kind === "loading"}
				>Download latest release</button
			>
		{/if}
		<button class="ui-button" type="button" onclick={onCancel}>Close</button>
	</div>
</UiDialog>

<style>
	@layer components {
		.release-changes-content {
			display: grid;
			gap: var(--ui-overlay-gap);
			max-height: min(60dvh, 36rem);
			overflow-y: auto;
			scrollbar-gutter: stable;
			padding-right: 0.5em;
		}
		.release-notes {
			display: grid;
			gap: 1.75em;
			overflow-wrap: anywhere;
			line-height: 1.6;
		}
		.release-markdown :global(p),
		.release-markdown :global(ul),
		.release-markdown :global(ol),
		.release-markdown :global(pre),
		.release-markdown :global(blockquote),
		.release-markdown :global(table) {
			margin: 0.75em 0;
		}
		.release-markdown :global(h4),
		.release-markdown :global(h5),
		.release-markdown :global(h6) {
			margin: 1.25em 0 0.5em;
			font: inherit;
			font-weight: 700;
		}
		.release-markdown :global(ul),
		.release-markdown :global(ol) {
			padding-left: 1.5em;
		}
		.release-markdown :global(ul) {
			list-style: disc;
		}
		.release-markdown :global(ol) {
			list-style: decimal;
		}
		.release-markdown :global(li + li) {
			margin-top: 0.35em;
		}
		.release-markdown :global(code) {
			font-family: var(--ui-font-mono);
			font-size: 0.92em;
			background: var(--ui-color-control);
			padding: 0.1em 0.3em;
		}
		.release-markdown :global(pre) {
			padding: 0.75em;
			background: var(--ui-color-control);
			white-space: pre-wrap;
		}
		.release-markdown :global(pre code) {
			padding: 0;
		}
		.release-markdown :global(blockquote) {
			padding-left: 1em;
			border-left: 2px solid var(--ui-color-border);
			color: var(--ui-color-muted);
		}
		.release-markdown :global(table) {
			display: block;
			max-width: 100%;
			overflow-x: auto;
			border-collapse: collapse;
		}
		.release-markdown :global(th),
		.release-markdown :global(td) {
			padding: 0.35em 0.5em;
			border-bottom: 1px solid var(--ui-color-border);
			text-align: left;
		}
		.release-markdown > :global(:first-child) {
			margin-top: 0;
		}
		.release-markdown > :global(:last-child) {
			margin-bottom: 0;
		}
	}
</style>
