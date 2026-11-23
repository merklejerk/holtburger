<script lang="ts">
	import UiRange from "../ui/UiRange.svelte";
	import {
		SHARED_AUDIO_DEFAULTS,
		type SharedAudioSettings,
	} from "./shared-settings-contract";
	import "./settings-controls.css";

	interface Props {
		readonly audio: SharedAudioSettings;
		readonly onAudioChange: (audio: SharedAudioSettings) => void;
		/** Hide Client title-music slider in surfaces without title music (Explorer). */
		readonly showMusicVolume?: boolean;
	}
	let { audio, onAudioChange, showMusicVolume = true }: Props = $props();
	const audioControls = $derived(
		showMusicVolume
			? ([
					{ key: "masterVolume", label: "In-game master" },
					{ key: "effectVolume", label: "Sound effects" },
					{ key: "ambientVolume", label: "Ambience" },
					{ key: "musicVolume", label: "Music" },
				] as const)
			: ([
					{ key: "masterVolume", label: "Master volume" },
					{ key: "effectVolume", label: "Sound effects" },
					{ key: "ambientVolume", label: "Ambience" },
				] as const),
	);
</script>

<div class="settings-section">
	{#each audioControls as control}
		<label
			>{control.label}: {Math.round(audio[control.key] * 100)}%
			<UiRange
				min={0}
				max={1}
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
		/> Mute all audio</label
	>
	<label class="ui-checkbox"
		><input
			type="checkbox"
			checked={audio.playInBackground}
			onchange={(event) =>
				onAudioChange({
					...audio,
					playInBackground: event.currentTarget.checked,
				})}
		/> Play audio in background</label
	>
	<button
		type="button"
		class="ui-button"
		onclick={() =>
			onAudioChange(
				showMusicVolume
					? SHARED_AUDIO_DEFAULTS
					: { ...SHARED_AUDIO_DEFAULTS, musicVolume: audio.musicVolume },
			)}>Reset audio</button
	>
</div>
