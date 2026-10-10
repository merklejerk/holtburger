<script lang="ts">
	import { onMount } from "svelte";
	import {
		CLIENT_ENVIRONMENT_INTERVAL_MS,
		type ClientEnvironmentReadout,
	} from "./client-environment";
	import type { ClientClockFormat } from "./client-environment-settings";
	import { formatGameTime } from "./client-environment-format";
	import SunnyIcon from "../assets/icons/weather-sunny.svg?component";
	import ClearIcon from "../assets/icons/weather-clear.svg?component";
	import CloudyIcon from "../assets/icons/weather-cloudy.svg?component";
	import RainyIcon from "../assets/icons/weather-rainy.svg?component";
	import UnknownIcon from "../assets/icons/weather-unknown.svg?component";

	interface Props {
		/** Direct server-source capability; local visual overrides are unreachable here. */
		readonly readEnvironment: () => ClientEnvironmentReadout | null;
		readonly clockFormat: ClientClockFormat;
	}
	const { readEnvironment, clockFormat }: Props = $props();
	/** Display snapshot is sampled at 4 Hz maximum, not published by the frame producer. */
	let readout = $state<ClientEnvironmentReadout | null>(null);
	const time = $derived(
		readout === null ? "—" : formatGameTime(readout.dayFraction, clockFormat),
	);
	const weather = $derived(readout?.weather ?? null);
	const Icon = $derived(
		(
			{
				sunny: SunnyIcon,
				clear: ClearIcon,
				cloudy: CloudyIcon,
				rainy: RainyIcon,
				unknown: UnknownIcon,
			} as const
		)[weather?.icon ?? "unknown"],
	);
	onMount(() => {
		const update = () => {
			const next = readEnvironment();
			// Keep identical display minutes/names out of the reactive graph.
			if (
				next === null ||
				readout === null ||
				formatGameTime(next.dayFraction, "24-hour") !==
					formatGameTime(readout.dayFraction, "24-hour") ||
				next.weather?.name !== readout.weather?.name ||
				next.weather?.icon !== readout.weather?.icon
			)
				readout = next;
		};
		update();
		const timer = window.setInterval(update, CLIENT_ENVIRONMENT_INTERVAL_MS);
		return () => window.clearInterval(timer);
	});
</script>

<span
	class="minimap-environment ui-readout"
	aria-label="Server time and weather"
>
	<span aria-label="Dereth time">{time}</span>
	<span
		class="weather-icon"
		role="img"
		aria-label={weather?.name ?? "Weather unavailable"}
		title={weather?.name ?? "Weather unavailable"}><Icon /></span
	>
</span>

<style>
	@layer components {
		.minimap-environment {
			display: inline-flex;
			align-items: center;
			gap: 0.5em;
			padding: 4px 10px;
			font-variant-numeric: tabular-nums;
			white-space: nowrap;
		}
		.weather-icon {
			display: inline-flex;
			width: 1.25em;
			height: 1.25em;
			pointer-events: auto;
		}
	}
</style>
