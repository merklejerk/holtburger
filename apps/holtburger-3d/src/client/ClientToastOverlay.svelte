<script lang="ts">
	import { fade } from "svelte/transition";
	import type { ClientToast } from "./client-toast-center";

	interface Props {
		readonly toast: ClientToast | null;
		/** Inert editor-only copy shown when no live toast exists. */
		readonly previewMessage: string | null;
	}

	const { toast, previewMessage }: Props = $props();
	const presentation = $derived(
		toast !== null
			? { kind: "toast" as const, toast }
			: previewMessage !== null
				? { kind: "preview" as const, message: previewMessage }
				: null,
	);
</script>

<div class="client-toast-overlay">
	{#if presentation !== null}
		{#key presentation.kind === "toast" ? presentation.toast.id : "preview"}
			<p
				class="client-toast"
				class:client-toast-preview={presentation.kind === "preview"}
				class:client-toast-warning={presentation.kind === "toast" &&
					presentation.toast.tone === "warning"}
				role={presentation.kind === "toast"
					? presentation.toast.tone === "warning"
						? "alert"
						: "status"
					: undefined}
				transition:fade={{ duration: 120 }}
			>
				{presentation.kind === "toast"
					? presentation.toast.message
					: presentation.message}
			</p>
		{/key}
	{/if}
</div>

<style>
	.client-toast-overlay {
		display: grid;
		width: 100%;
		height: 100%;
		padding-inline: min(24px, 5vw);
		place-items: center;
		pointer-events: none;
	}

	.client-toast {
		width: fit-content;
		max-width: 100%;
		margin: 0 auto;
		padding: 5px 10px;
		border: 1px solid rgb(201 183 132 / 0.72);
		background: rgb(12 9 6 / 0.86);
		color: var(--ac-ink);
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.55);
		font: var(--ac-panel-font-size) var(--ac-font-ui);
		text-align: center;
		text-shadow: 1px 1px #000;
	}

	.client-toast-warning {
		border-color: rgb(184 86 62 / 0.88);
		color: rgb(255 210 183);
	}

	.client-toast-preview {
		border-style: dashed;
		color: rgb(235 232 219 / 0.76);
	}
</style>
