<script lang="ts">
	import {
		formatExplorerCameraResidency,
		formatExplorerOutdoorCoordinates,
		type ExplorerCameraLocation,
	} from "./explorer-camera-location";

	interface Props {
		/** Latest camera position and residency resolved by the Explorer coordinator. */
		readonly location: ExplorerCameraLocation | null;
	}

	let { location }: Props = $props();
</script>

<aside class="explorer-camera-location ac-panel" aria-label="Camera location">
	<span title="Resident EnvCell">
		{location === null
			? "—"
			: formatExplorerCameraResidency(location.residency)}
	</span>
	<span class="explorer-camera-location-separator" aria-hidden="true">•</span>
	<span title="Outdoor position">
		{location === null
			? "—"
			: formatExplorerOutdoorCoordinates(location.position)}
	</span>
</aside>
