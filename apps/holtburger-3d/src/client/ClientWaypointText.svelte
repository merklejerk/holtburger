<script lang="ts">
	import {
		waypointTextSpans,
		type MapWaypointTarget,
	} from "../lib/game/map/map-waypoint";
	import ClientWaypointLink from "./ClientWaypointLink.svelte";

	interface Props {
		/** Displayed content, after any existing description truncation. */
		readonly text: string;
		/** The containing surface owns whether recognized coordinates admit interaction. */
		readonly interactive: boolean;
		/** Shared client intent action. */
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
	}
	const { text, interactive, onSetWaypoint }: Props = $props();
	const spans = $derived(waypointTextSpans(text));
</script>

{#each spans as span}{#if span.target === null}{span.text}{:else}<ClientWaypointLink
			text={span.text}
			{interactive}
			target={span.target}
			{onSetWaypoint}
		/>{/if}{/each}
