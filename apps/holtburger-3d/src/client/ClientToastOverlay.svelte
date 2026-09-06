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
				class="client-toast ui-readout"
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
		text-align: center;
	}
	.client-toast-warning {
		color: var(--ui-color-warning);
	}
	.client-toast-preview {
		color: var(--ui-color-muted);
	}
</style>
