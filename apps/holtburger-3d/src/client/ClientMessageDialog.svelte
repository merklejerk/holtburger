<script lang="ts">
	import UiDialog from "../app/UiDialog.svelte";
	import type { ClientDialogPresentation } from "./client-dialogs";

	interface Props {
		/** Current app-owned dialog; confirmation identity is supplied back unchanged. */
		readonly presentation: ClientDialogPresentation;
		readonly onDismiss: (id: number) => void;
		readonly onRespond: (requestId: string, accepted: boolean) => void;
	}
	const { presentation, onDismiss, onRespond }: Props = $props();
	const submitting = $derived(
		presentation.kind !== "popup" &&
			presentation.submission.kind === "submitting",
	);

	const typedConfirmation = $derived(
		presentation.kind === "local-confirmation"
			? presentation.request.typedConfirmation
			: undefined,
	);
	/** Scope typed input to its question so replacing a modal cannot inherit acceptance. */
	let typedAnswer = $state({ requestId: "", value: "" });
	const answer = $derived(
		presentation.kind !== "popup" &&
			typedAnswer.requestId === presentation.request.requestId
			? typedAnswer.value
			: "",
	);
	const canAccept = $derived(
		!submitting &&
			(typedConfirmation === undefined ||
				answer === typedConfirmation.requiredText),
	);

	function accept(): void {
		if (presentation.kind !== "popup" && canAccept)
			onRespond(presentation.request.requestId, true);
	}

	function cancel(): void {
		if (presentation.kind === "popup") onDismiss(presentation.id);
		else if (!submitting) onRespond(presentation.request.requestId, false);
	}
</script>

<UiDialog
	title={presentation.kind === "popup" ? "Message" : "Confirmation"}
	className="client-message-dialog"
	describedBy="client-message-text"
	onCancel={cancel}
	dismissOnBackdrop={!submitting}
>
	<p id="client-message-text">
		{presentation.kind === "popup"
			? presentation.text
			: presentation.request.text}
	</p>
	{#if presentation.kind !== "popup" && presentation.submission.kind === "ready" && presentation.submission.error !== null}
		<p role="alert">{presentation.submission.error}</p>
	{/if}
	{#if typedConfirmation !== undefined && presentation.kind === "local-confirmation"}
		<label class="client-message-input">
			Type “{typedConfirmation.requiredText}” to confirm
			<input
				class="ui-input"
				value={answer}
				autocomplete="off"
				spellcheck="false"
				oninput={(event) => {
					if (presentation.kind === "local-confirmation")
						typedAnswer = {
							requestId: presentation.request.requestId,
							value: event.currentTarget.value,
						};
				}}
			/>
		</label>
	{/if}
	<div class="client-message-actions ui-dialog-actions">
		{#if presentation.kind === "popup"}
			<button class="ui-button" onclick={() => onDismiss(presentation.id)}
				>Close</button
			>
		{:else}
			<button
				class="ui-button"
				disabled={submitting}
				onclick={() => onRespond(presentation.request.requestId, false)}
				>{typedConfirmation === undefined ? "Decline" : "Cancel"}</button
			>
			<button class="ui-button" disabled={!canAccept} onclick={accept}
				>{typedConfirmation === undefined ? "Accept" : "Abandon home"}</button
			>
		{/if}
	</div>
</UiDialog>

<style>
	@layer components {
		#client-message-text {
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}
		.client-message-input {
			display: grid;
			gap: 0.5rem;
			margin-bottom: 1rem;
		}
	}
</style>
