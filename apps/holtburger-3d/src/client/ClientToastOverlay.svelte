<script lang="ts">
	import { fade } from "svelte/transition";
	import type { ClientToast } from "./client-toast-center";

	interface Props {
		readonly toast: ClientToast | null;
	}

	const { toast }: Props = $props();
</script>

<div class="client-toast-overlay">
	{#if toast !== null}
		{#key toast.id}
			<p
				class="client-toast"
				class:client-toast-warning={toast.tone === "warning"}
				role={toast.tone === "warning" ? "alert" : "status"}
				transition:fade={{ duration: 120 }}
			>
				{toast.message}
			</p>
		{/key}
	{/if}
</div>

<style>
	.client-toast-overlay {
		position: fixed;
		bottom: 48px;
		left: 50%;
		z-index: 6;
		width: min(420px, calc(100vw - 48px));
		transform: translateX(-50%);
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
</style>
