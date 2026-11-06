<script lang="ts">
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import MusicIcon from "../assets/icons/music-volume.svg?component";
	import UiRange from "../app/UiRange.svelte";
	import type { ClientAudioSettings } from "./client-settings-contract";

	interface Props {
		/** The same saved mix used by the full audio settings panel. */
		readonly audio: ClientAudioSettings;
		readonly onAudioChange: (audio: ClientAudioSettings) => void;
	}
	let { audio, onAudioChange }: Props = $props();
	const id = $props.id();
	let open = $state(false);
	const { keyboard } = useAppInputPolicy();
	let popup = $state<HTMLDivElement>();
	// A popup is an explicit keyboard interaction, like the existing command menus.
	$effect(() => {
		if (open && popup !== undefined) keyboard.activate(popup);
	});
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== "Escape") return;
		event.preventDefault();
		popup?.hidePopover();
	}
</script>

<div class="music-controls">
	<button
		type="button"
		class="ui-button ui-icon-button pregame-quiet"
		aria-label="Music volume"
		title="Music volume"
		aria-expanded={open}
		aria-controls={id}
		popovertarget={id}
	>
		<MusicIcon />
	</button>
	<div
		{id}
		bind:this={popup}
		popover="auto"
		inert={!open}
		role="group"
		aria-label="Music volume"
		tabindex="-1"
		use:keyboard.scope={{
			nativeControls: true,
			transient: true,
			keydown: handleKeydown,
			cancel: () => popup?.hidePopover(),
		}}
		class="music-popup ui-overlay-surface"
		ontoggle={(event) => (open = event.newState === "open")}
	>
		<label>
			<span>Music</span>
			<UiRange
				aria-orientation="vertical"
				min={0}
				max={1}
				step="0.01"
				value={audio.musicVolume}
				oninput={(event) =>
					onAudioChange({
						...audio,
						musicVolume: event.currentTarget.valueAsNumber,
					})}
			/>
			<span>{Math.round(audio.musicVolume * 100)}%</span>
		</label>
	</div>
</div>

<style>
	@layer components {
		.music-controls {
			anchor-scope: --music-volume;
		}
		.music-controls > button {
			anchor-name: --music-volume;
		}
		.music-controls :global(svg) {
			width: 1.1em;
			height: 1.1em;
		}
		.music-popup {
			position: fixed;
			position-anchor: --music-volume;
			position-area: top;
			inset: auto;
			margin: 0 0 8px;
			padding: 12px;
			width: max-content;
			max-width: 9rem;
			text-align: center;
		}
		.music-popup label {
			display: grid;
			gap: 8px;
			justify-items: center;
		}
		.music-popup :global(input[type="range"]) {
			writing-mode: vertical-lr;
			direction: rtl;
			inline-size: 8rem;
			--ui-range-fill-direction: 0deg;
		}
	}
</style>
