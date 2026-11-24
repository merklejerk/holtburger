<script lang="ts">
	import { useAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import type { ClientApiState } from "../session/host-contract";
	import { CLIENT_CONNECTION_BADGE_TUNING } from "../settings/tuning";

	interface Props {
		/** Active Live API status from the client host sidecar. */
		readonly state: ClientApiState;
		/** Prevents double-toggling while a pause/resume request is in flight. */
		readonly pausePending: boolean;
		readonly onTogglePaused: () => void;
	}

	const { state, pausePending, onTogglePaused }: Props = $props();
	const { keyboard } = useAppInputPolicy();

	function keydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			keyboard.returnToGame();
		}
	}

	const label = $derived.by(() => {
		const status = state.paused ? "Paused" : "Active";
		const endpointLine =
			state.endpoint === null ? "" : `\nEndpoint: ${state.endpoint}`;
		const actionLine = state.paused
			? "\nClick to resume automation"
			: "\nClick to pause automation";
		return `Live API: ${status}${endpointLine}${actionLine}`;
	});
</script>

<button
	type="button"
	class="live-api-badge"
	data-state={state.paused ? "paused" : "active"}
	aria-label={label}
	aria-pressed={state.paused}
	title={label}
	disabled={pausePending}
	onclick={onTogglePaused}
	use:keyboard.scope={{ nativeControls: true, keydown }}
	style:--badge-width={`${CLIENT_CONNECTION_BADGE_TUNING.widthEm}em`}
	style:--badge-height={`${CLIENT_CONNECTION_BADGE_TUNING.heightEm}em`}
>
	{#if state.paused}
		<svg viewBox="0 0 14 14" aria-hidden="true">
			<rect x="2.5" y="2.5" width="3.2" height="9" rx="0.9" fill="currentColor" />
			<rect x="8.3" y="2.5" width="3.2" height="9" rx="0.9" fill="currentColor" />
		</svg>
	{:else}
		<svg viewBox="0 0 14 14" aria-hidden="true">
			<path
				d="M2.2 3.4 6.2 7 2.2 10.6"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<line
				x1="7.4"
				y1="10.4"
				x2="12"
				y2="10.4"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
			/>
		</svg>
	{/if}
</button>

<style>
	@layer components {
		.live-api-badge {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			flex: 0 0 auto;
			box-sizing: border-box;
			width: var(--badge-width);
			height: var(--badge-height);
			padding: 0;
			font: inherit;
			border: 0;
			background: transparent;
			color: var(--ui-connection-good-color);
			cursor: pointer;
			pointer-events: auto;
		}
		.live-api-badge[data-state="paused"] {
			color: var(--ui-connection-fair-color);
		}
		.live-api-badge:disabled {
			opacity: 0.5;
			cursor: default;
		}
		.live-api-badge svg {
			width: 1em;
			height: 1em;
			display: block;
		}
	}
</style>
