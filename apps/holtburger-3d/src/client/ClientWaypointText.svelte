<script lang="ts">
	import {
		waypointTextSpans,
		type MapWaypointTarget,
	} from "../lib/game/map/map-waypoint";
	import ClientWaypointLink from "./ClientWaypointLink.svelte";

	interface Props {
		/** Displayed content, after any existing description truncation. */
		readonly text: string;
		/** Shared client intent action. */
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
	}
	const { text, onSetWaypoint }: Props = $props();
	const spans = $derived(waypointTextSpans(text));
</script>

{#each spans as span}{#if span.target === null}{span.text}{:else}<ClientWaypointLink
			text={span.text}
			target={span.target}
			{onSetWaypoint}
		/>{/if}{/each}
