<script lang="ts">
	import type { ClientAudioSettings } from "./client-settings-contract";
	import { CLIENT_AUDIO_DEFAULTS } from "./client-settings-defaults";
	import "./client-settings-controls.css";
	interface Props {
		/** Saved mix shared by pregame and gameplay. */
		readonly audio: ClientAudioSettings;
		readonly onAudioChange: (audio: ClientAudioSettings) => void;
	}
	let { audio, onAudioChange }: Props = $props();
	const audioControls = [
		{ key: "masterVolume", label: "Master" },
		{ key: "effectVolume", label: "Sound effects" },
		{ key: "ambientVolume", label: "Ambience" },
	] as const;
</script>

<div class="settings-section">
	{#each audioControls as control}
		<label
			>{control.label}: {Math.round(audio[control.key] * 100)}%
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				value={audio[control.key]}
				oninput={(event) =>
					onAudioChange({
						...audio,
						[control.key]: event.currentTarget.valueAsNumber,
					})}
			/>
		</label>
	{/each}
	<label class="ui-checkbox"
		><input
			type="checkbox"
			checked={audio.muted}
			onchange={(event) =>
				onAudioChange({ ...audio, muted: event.currentTarget.checked })}
		/> Mute all</label
	>
	<button
		type="button"
		class="ui-button"
		onclick={() => onAudioChange(CLIENT_AUDIO_DEFAULTS)}>Reset audio</button
	>
</div>
