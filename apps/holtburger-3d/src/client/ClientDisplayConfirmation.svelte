<script lang="ts">
	import { onMount } from "svelte";
	import UiDialog from "../app/UiDialog.svelte";
	import {
		observeWindowDisplay,
		windowDisplayBridge,
	} from "../app/window-display-transport";
	import type { WindowDisplaySnapshot } from "../app/window-display-contract";
	import { formatError } from "../lib/format-error";

	const bridge = windowDisplayBridge();
	/** Cold native events and a bounded countdown drive this shell-level prompt. */
	let snapshot = $state<WindowDisplaySnapshot | null>(null);
	let now = $state(Date.now());
	let error = $state<string | null>(null);
	let pending = $state(false);
	const confirmation = $derived(snapshot?.confirmation ?? null);
	const seconds = $derived(
		confirmation?.kind !== "preview"
			? 0
			: Math.max(0, Math.ceil((confirmation.expiresAt - now) / 1000)),
	);

	onMount(() => {
		if (bridge === undefined) return;
		return observeWindowDisplay(
			bridge,
			(value) => {
				snapshot = value;
			},
			(failure) => {
				error = formatError(failure);
			},
		);
	});
	$effect(() => {
		if (confirmation?.kind !== "preview") return;
		now = Date.now();
		const timer = setInterval(() => {
			now = Date.now();
		}, 250);
		return () => clearInterval(timer);
	});
	async function decide(keep: boolean): Promise<void> {
		if (bridge === undefined || confirmation === null || pending) return;
		const id = confirmation.id;
		pending = true;
		error = null;
		try {
			await bridge.change({ kind: "confirm", id, keep });
		} catch (failure) {
			error = formatError(failure);
		} finally {
			pending = false;
		}
	}
</script>

{#if confirmation !== null && snapshot !== null}
	<UiDialog
		title={confirmation.kind === "preview"
			? "Keep these display settings?"
			: "Restore previous display settings"}
		className="client-display-confirmation"
		initialFocus="[data-display-revert]"
		onCancel={() => void decide(false)}
		dismissOnBackdrop={!pending}
	>
		<p>
			{snapshot.fullscreen ? "Fullscreen" : "Windowed"} — {snapshot.contentSize
				.width} × {snapshot.contentSize.height}
		</p>
		{#if confirmation.kind === "preview"}
			<p>Reverting in {seconds} seconds.</p>
		{:else}
			<p>The previous display settings could not be restored. Try again.</p>
		{/if}
		{#if error !== null}<p role="alert">{error}</p>{/if}
		<div class="ui-dialog-actions">
			<button
				class="ui-button"
				data-display-revert
				disabled={pending}
				onclick={() => void decide(false)}>Revert</button
			>
			{#if confirmation.kind === "preview"}<button
					class="ui-button"
					disabled={pending || seconds === 0}
					onclick={() => void decide(true)}>Keep</button
				>{/if}
		</div>
	</UiDialog>
{:else if error !== null}<p role="alert">{error}</p>{/if}
