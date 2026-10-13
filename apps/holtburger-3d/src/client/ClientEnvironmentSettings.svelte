<script lang="ts">
	import {
		MINUTES_PER_GAME_DAY,
		type ClientClockFormat,
		type ClientEnvironmentOverrides,
	} from "./client-environment-settings";
	import { formatGameTime } from "./client-environment-format";
	import type { ClientWeatherPreset } from "./client-environment";

	interface Props {
		/** Cold user choices, independent of rendered environment facts. */
		readonly clockFormat: ClientClockFormat;
		readonly overrides: ClientEnvironmentOverrides;
		/** Authored choices from the active content owner. */
		readonly presets: readonly ClientWeatherPreset[];
		readonly issue: string | null;
		readonly onClockFormatChange: (format: ClientClockFormat) => void;
		readonly onOverridesChange: (overrides: ClientEnvironmentOverrides) => void;
	}
	const {
		clockFormat,
		overrides,
		presets,
		issue,
		onClockFormatChange,
		onOverridesChange,
	}: Props = $props();
	function changeWeather(value: string): void {
		if (value === "server") {
			onOverridesChange({ ...overrides, weather: { kind: "server" } });
			return;
		}
		const preset = presets.find(
			({ choice }) => choice.dayGroupIndex === Number(value),
		);
		if (preset === undefined)
			throw new Error("Selected weather preset is unavailable.");
		onOverridesChange({ ...overrides, weather: preset.choice });
	}
</script>

<label class="ui-checkbox">
	<input
		type="checkbox"
		checked={clockFormat === "24-hour"}
		onchange={(event) =>
			onClockFormatChange(event.currentTarget.checked ? "24-hour" : "12-hour")}
	/> Use 24-hour clock
</label>
<label class="ui-checkbox">
	<input
		type="checkbox"
		checked={overrides.time.kind === "fixed"}
		onchange={(event) =>
			onOverridesChange({
				...overrides,
				time: event.currentTarget.checked
					? { kind: "fixed", minuteOfDay: MINUTES_PER_GAME_DAY / 2 }
					: { kind: "server" },
			})}
	/> Use fixed local time
</label>
{#if overrides.time.kind === "fixed"}
	{@const timeLabel = formatGameTime(
		overrides.time.minuteOfDay / MINUTES_PER_GAME_DAY,
		clockFormat,
	)}
	<label class="ui-label">
		Fixed time: {timeLabel}
		<input
			type="range"
			min="0"
			max={MINUTES_PER_GAME_DAY - 1}
			step="1"
			value={overrides.time.minuteOfDay}
			aria-valuetext={timeLabel}
			oninput={(event) =>
				onOverridesChange({
					...overrides,
					time: {
						kind: "fixed",
						minuteOfDay: event.currentTarget.valueAsNumber,
					},
				})}
		/>
	</label>
{/if}
<label class="ui-label"
	>Local weather
	<select
		class="ui-input"
		disabled={presets.length === 0 && overrides.weather.kind === "server"}
		value={issue === null && overrides.weather.kind === "preset"
			? overrides.weather.dayGroupIndex
			: overrides.weather.kind === "server"
				? "server"
				: "unavailable"}
		onchange={(event) => changeWeather(event.currentTarget.value)}
	>
		<option value="server">Server</option>
		{#if issue !== null}<option value="unavailable" disabled
				>Saved preset unavailable</option
			>{/if}
		{#each presets as preset}<option value={preset.choice.dayGroupIndex}
				>{preset.label}</option
			>{/each}
	</select>
</label>
{#if issue !== null}<p class="ui-error" role="status">{issue}</p>{/if}
