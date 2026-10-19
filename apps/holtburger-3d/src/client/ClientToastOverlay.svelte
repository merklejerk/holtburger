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
	function toastFade(node: HTMLElement) {
		// Computed transition durations resolve theme CSS times (including calc) to seconds.
		return fade(node, {
			duration:
				Number.parseFloat(getComputedStyle(node).transitionDuration) * 1000,
		});
	}
	const presentation = $derived(
		toast !== null ? { kind: "toast" as const, toast } : persistentMessage,
	);
</script>

<div class="client-toast-overlay">
	{#if presentation !== null}
		{#key presentation.kind === "toast" ? presentation.toast.id : presentation.kind}
			<p
				class="client-toast ui-readout"
				class:client-toast-ephemeral={presentation.kind === "toast"}
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
				out:toastFade
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
			/* Wrapped content may overflow, but cannot grow the cell and move its center. */
			grid-template: minmax(0, 1fr) / minmax(0, 1fr);
			width: 100%;
			height: 100%;
			padding-inline: min(24px, 5vw);
			place-items: center;
			pointer-events: none;
		}
		.client-toast {
			/* Outgoing keyed messages coexist during fade-out; share one cell to avoid reflow. */
			grid-area: 1 / 1;
			width: fit-content;
			max-width: 100%;
			margin: 0 auto;
			padding-block: 5px;
			text-align: center;
			/* Duration is also the Svelte outro clock; CSS does not interpolate opacity twice. */
			transition-property: none;
			transition-duration: var(--ui-toast-exit-duration);
		}
		.client-toast-ephemeral {
			animation: var(--ui-toast-pop-animation) var(--ui-toast-pop-duration)
				var(--ui-toast-pop-easing);
		}
		.client-toast-warning {
			color: var(--ui-color-warning);
		}
		.client-toast-preview {
			color: var(--ui-color-muted);
		}
		@media (prefers-reduced-motion: reduce) {
			.client-toast {
				animation: none;
				transition-duration: 0s;
			}
		}
	}
</style>
