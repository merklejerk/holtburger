<script lang="ts">
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type { ClientDialogPresentation } from "./client-dialogs";

	interface Props {
		/** Current app-owned dialog; confirmation identity is supplied back unchanged. */
		readonly presentation: ClientDialogPresentation;
		readonly onDismiss: (id: number) => void;
		readonly onRespond: (requestId: string, accepted: boolean) => void;
	}
	const { presentation, onDismiss, onRespond }: Props = $props();
	const { keyboard } = useAppInputPolicy();
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
	let backdropPointer = false;

	function outside(event: PointerEvent | MouseEvent): boolean {
		if (!(event.currentTarget instanceof HTMLDialogElement)) return false;
		const bounds = event.currentTarget.getBoundingClientRect();
		return (
			event.clientX < bounds.left ||
			event.clientX > bounds.right ||
			event.clientY < bounds.top ||
			event.clientY > bounds.bottom
		);
	}

	function accept(): void {
		if (presentation.kind !== "popup" && canAccept)
			onRespond(presentation.request.requestId, true);
	}

	function cancel(event: Event): void {
		event.preventDefault();
		if (presentation.kind === "popup") onDismiss(presentation.id);
		else if (!submitting) onRespond(presentation.request.requestId, false);
	}
</script>

<dialog
	use:keyboard.modal
	class="client-message-dialog ui-panel"
	tabindex="-1"
	aria-labelledby="client-message-title"
	aria-describedby="client-message-text"
	oncancel={cancel}
	onpointerdown={(event) => {
		backdropPointer = outside(event);
	}}
	onclick={(event) => {
		if (backdropPointer && outside(event) && typedConfirmation !== undefined)
			cancel(event);
		backdropPointer = false;
	}}
>
	<h2 id="client-message-title">
		{presentation.kind === "popup" ? "Message" : "Confirmation"}
	</h2>
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
				>{typedConfirmation === undefined ? "Decline" : "Cancel"}</button
			>
			<button class="ui-button" disabled={!canAccept} onclick={accept}
				>{typedConfirmation === undefined ? "Accept" : "Abandon home"}</button
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
		.client-message-input {
			display: grid;
			gap: 0.5rem;
			margin-bottom: 1rem;
		}
		.client-message-actions {
			display: flex;
			justify-content: flex-end;
			gap: 0.75rem;
		}
	}
</style>
