<script lang="ts">
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import ClientLogopolisBoard from "./ClientLogopolisBoard.svelte";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";

	interface Props {
		/** Command invocation count; zero means the easter egg has not been opened. */
		readonly launchRevision: number;
		/** Retained shell visibility is independent of whether the simulation is running. */
		readonly visible: boolean;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly onClose: () => void;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
	}
	const {
		launchRevision,
		visible,
		placement,
		viewport,
		onClose,
		onPlacementChange,
	}: Props = $props();
</script>

<ClientHudWindow
	title="Logopolis"
	icon="teleport"
	{visible}
	focusRevision={launchRevision}
	{placement}
	{viewport}
	{onClose}
	{onPlacementChange}
	minWidth={CLIENT_UI_DEFAULTS.logopolis.minSize.width}
	minHeight={CLIENT_UI_DEFAULTS.logopolis.minSize.height}
>
	<ClientLogopolisBoard {visible} {launchRevision} />
</ClientHudWindow>
