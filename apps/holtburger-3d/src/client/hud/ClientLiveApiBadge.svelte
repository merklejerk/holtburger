<script lang="ts">
	import PopupMenu, { type PopupMenuItem } from "../../app/ui/PopupMenu.svelte";
	import { useAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import type { ClientApiState } from "../session/host-contract";
	import { CLIENT_CONNECTION_BADGE_TUNING } from "../settings/tuning";

	type LiveApiMenuAction = "toggle-pause" | "clear-overlays" | "toggle-mute";

	interface Props {
		/** Active Live API status from the client host sidecar. */
		readonly state: ClientApiState;
		/** Prevents double-toggling while a pause/resume request is in flight. */
		readonly pausePending: boolean;
		/** Session-local mute state for Live API audio cues. */
		readonly audioMuted: boolean;
		readonly onTogglePaused: () => void;
		readonly onToggleAudioMuted: () => void;
		readonly onClearOverlays: () => void;
	}

	const {
		state: apiState,
		pausePending,
		audioMuted,
		onTogglePaused,
		onToggleAudioMuted,
		onClearOverlays,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	let trigger = $state<HTMLButtonElement | null>(null);
	let menuOpen = $state(false);

	function keydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			if (menuOpen) menuOpen = false;
			else keyboard.returnToGame();
		}
	}

	const label = $derived.by(() => {
		const status = apiState.paused ? "Paused" : "Active";
		const audioLine = audioMuted ? "\nAudio cues: Muted" : "";
		const endpointLine =
			apiState.endpoint === null ? "" : `\nEndpoint: ${apiState.endpoint}`;
		return `Live API: ${status}${audioLine}${endpointLine}\nClick for Live API controls`;
	});

	const menuItems = $derived<readonly PopupMenuItem<LiveApiMenuAction>[]>([
		{
			action: "toggle-pause",
			label: apiState.paused ? "Resume Automation" : "Pause Automation",
			disabled: pausePending,
		},
		{
			action: "clear-overlays",
			label: "Clear Overlays",
			disabled: false,
		},
		{
			action: "toggle-mute",
			label: "Mute API Audio",
			disabled: false,
			selection: { kind: "checkbox", checked: audioMuted },
		},
	]);

	function handleSelect(action: LiveApiMenuAction): void {
		switch (action) {
			case "toggle-pause":
				onTogglePaused();
				return;
			case "clear-overlays":
				onClearOverlays();
				return;
			case "toggle-mute":
				onToggleAudioMuted();
				return;
		}
	}
</script>

<button
	bind:this={trigger}
	type="button"
	class="live-api-badge"
	data-state={apiState.paused ? "paused" : "active"}
	data-audio-muted={audioMuted ? "true" : "false"}
	aria-label={label}
	aria-haspopup="menu"
	aria-expanded={menuOpen}
	title={label}
	onclick={() => {
		menuOpen = !menuOpen;
	}}
	use:keyboard.scope={{ nativeControls: true, keydown }}
	style:--badge-width={`${CLIENT_CONNECTION_BADGE_TUNING.widthEm}em`}
	style:--badge-height={`${CLIENT_CONNECTION_BADGE_TUNING.heightEm}em`}
>
	{#if apiState.paused}
		<svg viewBox="0 0 14 14" aria-hidden="true">
			<rect
				x="2.5"
				y="2.5"
				width="3.2"
				height="9"
				rx="0.9"
				fill="currentColor"
			/>
			<rect
				x="8.3"
				y="2.5"
				width="3.2"
				height="9"
				rx="0.9"
				fill="currentColor"
			/>
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
	{#if audioMuted}
		<span class="mute-dot" aria-hidden="true"></span>
	{/if}
</button>

{#if menuOpen && trigger !== null}
	<PopupMenu
		anchor={trigger}
		label="Live API controls"
		items={menuItems}
		onselect={handleSelect}
		onclose={() => {
			menuOpen = false;
		}}
	/>
{/if}

<style>
	@layer components {
		.live-api-badge {
			position: relative;
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
		.live-api-badge svg {
			width: 1em;
			height: 1em;
			display: block;
		}
		.mute-dot {
			position: absolute;
			top: 0;
			right: 0;
			width: 0.34em;
			height: 0.34em;
			border-radius: 50%;
			background: var(--ui-color-warning);
		}
	}
</style>
