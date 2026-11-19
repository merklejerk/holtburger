<script lang="ts">
	import { onMount, untrack } from "svelte";
	import type { UiThemeSettings } from "./ui-theme-selection";
	const {
		theme,
		preferredId,
	}: { theme: UiThemeSettings; preferredId: string | null } = $props();
	// The owner is transferred once from bootstrap; subsequent cold changes arrive via subscription.
	let themeState = $state.raw(untrack(() => theme.owner.read()));
	let folderIssue = $state<string | null>(null);
	onMount(() =>
		theme.owner.subscribe((next) => {
			themeState = next;
		}),
	);
	const busy = $derived(
		themeState.selection.kind === "loading" ||
			themeState.catalog.kind === "loading",
	);
	const unavailable = $derived(
		preferredId !== null && !themeState.catalog.ids.includes(preferredId),
	);
	async function openDirectory() {
		folderIssue = null;
		try {
			await theme.owner.openDirectory();
		} catch (error) {
			folderIssue = String(error);
		}
	}
</script>

<details class="ui-disclosure ui-disclosure-section" open>
	<summary>Theme</summary>
	<div class="settings-section ui-disclosure-body">
		<label
			>Theme
			<select
				aria-label="UI theme"
				value={themeState.selection.kind === "loading"
					? (themeState.selection.requestedId ?? "")
					: (preferredId ?? "")}
				disabled={busy}
				onchange={(event) =>
					void theme.select(event.currentTarget.value || null)}
			>
				<option value="">Base</option>
				{#if unavailable}<option value={preferredId}
						>{preferredId} (unavailable)</option
					>{/if}
				{#each themeState.catalog.ids as id}<option value={id}>{id}</option
					>{/each}
			</select>
		</label>
		<div class="ui-action-row">
			<button
				class="ui-button"
				disabled={busy}
				onclick={() => void theme.select(preferredId)}>Reload theme</button
			>
			<button
				class="ui-button"
				disabled={busy}
				onclick={() => void theme.owner.refresh()}>Refresh list</button
			>
			<button class="ui-button" onclick={() => void openDirectory()}
				>Open themes folder</button
			>
		</div>
		{#if themeState.selection.kind === "loading"}<p
				class="ui-muted"
				role="status"
			>
				Loading {themeState.selection.requestedId ?? "Base"}…
			</p>{/if}
		{#if themeState.selection.kind === "failed"}<p
				class="ui-error"
				role="alert"
			>
				Could not apply {themeState.selection.requestedId ?? "Base"}: {themeState
					.selection.message}
			</p>{/if}
		{#if themeState.catalog.kind === "failed"}<p class="ui-error" role="alert">
				{themeState.catalog.message}
			</p>{/if}
		{#if folderIssue !== null}<p class="ui-error" role="alert">
				{folderIssue}
			</p>{/if}
		{#if themeState.selection.activeId !== preferredId}<p class="ui-muted">
				Active theme: {themeState.selection.activeId ?? "Base"}. Your preferred
				theme is retained for retry.
			</p>{/if}
	</div>
</details>
