<script lang="ts">
	import { onMount, untrack } from "svelte";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import ClientSalvagePanel from "./ClientSalvagePanel.svelte";
	import type { ClientSalvageState } from "./client-salvage-state";
	import type { ClientInventoryState } from "./client-inventory-state";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	interface Props {
		readonly model: ClientSalvageState;
		readonly inventory: ClientInventoryState;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		readonly selectedGuid: number | null;
		readonly onSelectItem: (guid: number) => void;
		readonly onExamineItem: (guid: number) => void;
	}
	const {
		model,
		inventory,
		placement,
		viewport,
		onPlacementChange,
		selectedGuid,
		onSelectItem,
		onExamineItem,
	}: Props = $props();
	let visible = $state(untrack(() => model.visible));
	let focusRevision = $state(untrack(() => model.focusRevision));
	onMount(() =>
		model.subscribe(() => {
			visible = model.visible;
			focusRevision = model.focusRevision;
		}),
	);
</script>

<ClientHudWindow
	title="Salvaging"
	icon="salvage"
	{placement}
	{viewport}
	{onPlacementChange}
	{visible}
	{focusRevision}
	minWidth={CLIENT_UI_DEFAULTS.salvage.minSize.width}
	minHeight={CLIENT_UI_DEFAULTS.salvage.minSize.height}
	onClose={() => model.close()}
>
	<ClientSalvagePanel
		{model}
		{inventory}
		{visible}
		{selectedGuid}
		{onSelectItem}
		{onExamineItem}
	/>
</ClientHudWindow>
