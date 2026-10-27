<script lang="ts">
	import ClientInlineTag from "./ClientInlineTag.svelte";
	import type { MapWaypointTarget } from "../lib/game/map/map-waypoint";

	interface Props {
		/** Preserve the source's original spelling rather than the target's normalized label. */
		readonly text: string;
		/** Chat can retain coordinate styling while leaving gameplay pointer input untouched. */
		readonly interactive: boolean;
		/** Prepared, valid outdoor destination. */
		readonly target: MapWaypointTarget;
		/** Session-owned mutation; no command submission or server routing. */
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
	}
	const { text, target, interactive, onSetWaypoint }: Props = $props();
</script>

<ClientInlineTag
	class="waypoint-link"
	{text}
	{interactive}
	label={`Set waypoint: ${target.label}`}
	onActivate={() => onSetWaypoint(target)}
/>
