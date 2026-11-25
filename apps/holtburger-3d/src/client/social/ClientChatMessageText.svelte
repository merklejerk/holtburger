<script lang="ts">
	import type { MapWaypointTarget } from "../../lib/game/map/map-waypoint";
	import ClientWaypointText from "../world/ClientWaypointText.svelte";
	import { chatEntityTextSpans } from "./chat-entity-links";
	import ClientEntityChatTag from "./ClientEntityChatTag.svelte";

	interface Props {
		/** Plain-text chat body supporting inline `[Label](0xHEX)` mentions and outdoor coordinates. */
		readonly text: string;
		/** Coordinate and entity links follow the containing chat buffer's interaction mode. */
		readonly interactive: boolean;
		/** Resolve an explicit entity reference through the containing chat buffer owner. */
		readonly onSelectEntity: (guid: number) => void;
		/** Reuse the ordinary chat waypoint action. */
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
	}

	const { text, interactive, onSelectEntity, onSetWaypoint }: Props = $props();
	const spans = $derived(chatEntityTextSpans(text));
</script>

{#each spans as span}{#if span.kind === "entity"}<ClientEntityChatTag
			{interactive}
			guid={span.guid}
			text={span.text}
			{onSelectEntity}
		/>{:else}<ClientWaypointText
			text={span.text}
			{interactive}
			{onSetWaypoint}
		/>{/if}{/each}
