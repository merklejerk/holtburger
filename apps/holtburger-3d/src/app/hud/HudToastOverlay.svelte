<script lang="ts">
	import { fade } from "svelte/transition";
	import type { HudToast } from "./toast-center";

	interface Props {
		readonly toast: HudToast | null;
		/** State-owned guidance or editor preview shown while no ephemeral toast is active. */
		readonly persistentMessage: {
			readonly kind: "status" | "preview";
			readonly message: string;
		} | null;
	}

	const { toast, persistentMessage }: Props = $props();
	function toastFade(node: HTMLElement) {
		return fade(node, {
			duration:
				Number.parseFloat(getComputedStyle(node).transitionDuration) * 1000,
		});
	}
	const presentation = $derived(
		toast !== null ? { kind: "toast" as const, toast } : persistentMessage,
	);
</script>

<div class="hud-toast-overlay">
	{#if presentation !== null}
		{#key presentation.kind === "toast" ? presentation.toast.id : presentation.kind}
			<p
				class="hud-toast ui-readout"
				class:hud-toast-ephemeral={presentation.kind === "toast"}
				class:hud-toast-preview={presentation.kind === "preview"}
				class:hud-toast-warning={presentation.kind === "toast" &&
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
		.hud-toast-overlay {
			display: grid;
			grid-template: minmax(0, 1fr) / minmax(0, 1fr);
			width: 100%;
			height: 100%;
			padding-inline: min(24px, calc(var(--ui-viewport-width) * 0.05));
			place-items: center;
			pointer-events: none;
		}
		.hud-toast {
			grid-area: 1 / 1;
			width: fit-content;
			max-width: 100%;
			margin: 0 auto;
			padding-block: 5px;
			text-align: center;
			transition-property: none;
			transition-duration: var(--ui-toast-exit-duration);
		}
		.hud-toast-ephemeral {
			animation: var(--ui-toast-pop-animation) var(--ui-toast-pop-duration)
				var(--ui-toast-pop-easing);
		}
		.hud-toast-warning {
			color: var(--ui-color-warning);
		}
		.hud-toast-preview {
			color: var(--ui-color-muted);
		}
		@media (prefers-reduced-motion: reduce) {
			.hud-toast {
				animation: none;
				transition-duration: 0s;
			}
		}
	}
</style>
