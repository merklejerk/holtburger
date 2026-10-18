<script lang="ts">
	import type { MapWaypointTarget } from "../lib/game/map/map-waypoint";

	interface Props {
		/** Preserve the source's original spelling rather than the target's normalized label. */
		readonly text: string;
		/** Prepared, valid outdoor destination. */
		readonly target: MapWaypointTarget;
		/** Session-owned mutation; no command submission or server routing. */
		readonly onSetWaypoint: (target: MapWaypointTarget) => void;
	}
	const { text, target, onSetWaypoint }: Props = $props();

	function activate(
		event: MouseEvent & { currentTarget: HTMLButtonElement },
	): void {
		const selection = document.getSelection();
		// A native selection drag may end with a click. Keyboard activation stays independent of selection.
		if (
			event.detail > 0 &&
			selection !== null &&
			!selection.isCollapsed &&
			selection.containsNode(event.currentTarget, true)
		)
			return;
		onSetWaypoint(target);
	}
</script>

<button
	type="button"
	class="waypoint-link ui-inline-button"
	title={`Set waypoint: ${target.label}`}
	aria-label={`Set waypoint: ${target.label}`}
	onclick={activate}>{text}</button
>

<style>
	.waypoint-link {
		user-select: text;
	}
</style>
