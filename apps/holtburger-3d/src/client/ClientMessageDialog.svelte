<script lang="ts">
	import { onMount } from "svelte";
	import { useViewportInputGate } from "../lib/input/viewport-input-context";
	import type { ClientDialogPresentation } from "./client-dialogs";

	interface Props {
		/** Current app-owned dialog; confirmation identity is supplied back unchanged. */
		readonly presentation: ClientDialogPresentation;
		readonly onDismiss: (id: number) => void;
		readonly onRespond: (requestId: string, accepted: boolean) => void;
	}
	const { presentation, onDismiss, onRespond }: Props = $props();
	const inputGate = useViewportInputGate();
	let dialog: HTMLDialogElement;
	const submitting = $derived(
		presentation.kind === "confirmation" &&
			presentation.submission.kind === "submitting",
	);

	onMount(() => {
		const previousFocus = document.activeElement;
		const release = inputGate.block();
		dialog.showModal();
		// Focus the text surface, so showing a question does not preselect acceptance.
		dialog.focus();
		return () => {
			dialog.close();
			release();
			// Svelte may detach the dialog before cleanup; native close then cannot restore focus.
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
				previousFocus.focus({ preventScroll: true });
		};
	});

	function cancel(event: Event): void {
		event.preventDefault();
		if (presentation.kind === "popup") onDismiss(presentation.id);
		else if (!submitting) onRespond(presentation.request.requestId, false);
	}
</script>

<dialog
	bind:this={dialog}
	class="client-message-dialog ui-panel"
	tabindex="-1"
	aria-labelledby="client-message-title"
	aria-describedby="client-message-text"
	oncancel={cancel}
>
	<h2 id="client-message-title">
		{presentation.kind === "popup" ? "Message" : "Confirmation"}
	</h2>
	<p id="client-message-text">
		{presentation.kind === "popup"
			? presentation.text
			: presentation.request.text}
	</p>
	{#if presentation.kind === "confirmation" && presentation.submission.kind === "ready" && presentation.submission.error !== null}
		<p role="alert">{presentation.submission.error}</p>
	{/if}
	<div class="client-message-actions">
		{#if presentation.kind === "popup"}
			<button class="ui-button" onclick={() => onDismiss(presentation.id)}
				>Close</button
			>
		{:else}
			<button
				class="ui-button"
				disabled={submitting}
				onclick={() => onRespond(presentation.request.requestId, false)}
				>Decline</button
			>
			<button
				class="ui-button"
				disabled={submitting}
				onclick={() => onRespond(presentation.request.requestId, true)}
				>Accept</button
			>
		{/if}
	</div>
</dialog>

<style>
	@layer components {
		.client-message-dialog {
			width: min(34rem, calc(100vw - 2rem));
			max-height: calc(100vh - 2rem);
			box-sizing: border-box;
			overflow: auto;
			padding: 1.25rem;
			color: var(--ui-color-text);
		}
		.client-message-dialog::backdrop {
			background: rgb(0 0 0 / 55%);
		}
		h2 {
			margin-top: 0;
			font-size: 1.1rem;
		}
		#client-message-text {
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}
		.client-message-actions {
			display: flex;
			justify-content: flex-end;
			gap: 0.75rem;
		}
	}
</style>
