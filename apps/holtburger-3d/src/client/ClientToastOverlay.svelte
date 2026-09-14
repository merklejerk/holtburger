<script lang="ts">
	import { fade } from "svelte/transition";
	import type { ClientToast } from "./client-toast-center";

	interface Props {
		readonly toast: ClientToast | null;
		/** State-owned guidance or editor preview shown while no ephemeral toast is active. */
		readonly persistentMessage: {
			readonly kind: "status" | "preview";
			readonly message: string;
		} | null;
	}

	const { toast, persistentMessage }: Props = $props();
	const presentation = $derived(
		toast !== null ? { kind: "toast" as const, toast } : persistentMessage,
	);
</script>

<div class="client-toast-overlay">
	{#if presentation !== null}
		{#key presentation.kind === "toast" ? presentation.toast.id : presentation.kind}
			<p
				class="client-toast ui-readout"
				class:client-toast-preview={presentation.kind === "preview"}
				class:client-toast-warning={presentation.kind === "toast" &&
					presentation.toast.tone === "warning"}
				role={presentation.kind === "toast"
					? presentation.toast.tone === "warning"
						? "alert"
						: "status"
					: presentation.kind === "status"
						? "status"
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
	@layer components {
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
			padding-block: 5px;
			text-align: center;
		}
		.client-toast-warning {
			color: var(--ui-color-warning);
		}
		.client-toast-preview {
			color: var(--ui-color-muted);
		}
	}
</style>
