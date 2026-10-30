<script lang="ts">
	import { onMount, untrack } from "svelte";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import ClientLocksPanel from "./ClientLocksPanel.svelte";
	import type { ClientLocksState } from "./client-locks-state";
	import type { ClientInventoryState } from "./client-inventory-state";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	interface Props {
		readonly model: ClientLocksState;
		readonly inventory: ClientInventoryState;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		readonly onExamineItem: (guid: number) => void;
	}
	const {
		model,
		inventory,
		placement,
		viewport,
		onPlacementChange,
		onExamineItem,
	}: Props = $props();
	let visible = $state(untrack(() => model.visible));
	let focusRevision = $state(untrack(() => model.focusRevision));
	let title = $state(untrack(() => model.windowTitle));
	onMount(() =>
		model.subscribe(() => {
			visible = model.visible;
			focusRevision = model.focusRevision;
			title = model.windowTitle;
		}),
	);
</script>

<ClientHudWindow
	{title}
	icon="locked"
	placement={{
		...placement,
		preferredWidth: CLIENT_UI_DEFAULTS.locks.size.width,
	}}
	resizable={false}
	fitContentHeight={true}
	{viewport}
	{onPlacementChange}
	{visible}
	{focusRevision}
	minWidth={CLIENT_UI_DEFAULTS.locks.minSize.width}
	minHeight={CLIENT_UI_DEFAULTS.locks.minSize.height}
	onClose={() => model.close()}
>
	<ClientLocksPanel {model} {inventory} {visible} {onExamineItem} />
</ClientHudWindow>
