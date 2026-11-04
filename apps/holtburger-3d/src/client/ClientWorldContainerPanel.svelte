<script lang="ts">
	import { onMount } from "svelte";

	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import ClientContentsView from "./ClientContentsView.svelte";
	import ClientContentsSortButton from "./ClientContentsSortButton.svelte";
	import { bindContentsActivation } from "./client-contents-activation";
	import type { ClientItemInteractions } from "./client-item-interactions";
	import type {
		ClientWorldContainerPanelState,
		ClientWorldContainerView,
	} from "./client-world-container-panel-state";
	interface Props {
		readonly model: ClientWorldContainerPanelState;
		readonly view: ClientWorldContainerView;
		readonly displays: ReadonlyMap<string, UiIconDisplay>;
		readonly interactions: ClientItemInteractions;
		readonly selectedGuid: number | null;
		readonly onSelectItem: (guid: number) => void;
		readonly onSort: () => void;
	}
	const {
		model,
		view,
		displays,
		interactions,
		selectedGuid,
		onSelectItem,
		onSort,
	}: Props = $props();
	let panel: HTMLDivElement;
	onMount(() =>
		bindContentsActivation(
			panel,
			".contents-grid .item-grid-cell[data-item-guid]:not(:disabled)",
			interactions,
			() => selectedGuid,
			onSelectItem,
			(guid) => model.pickup(guid),
		),
	);
	function iconFor(guid: number): UiIconDisplay | undefined {
		const key = view.iconKeys.get(guid);
		return key === undefined ? undefined : displays.get(key);
	}
	function selectItem(guid: number): boolean {
		const targeting = interactions.snapshot();
		if (targeting.kind === "acquiring") {
			interactions.target(guid, targeting.generation);
			return false;
		}
		onSelectItem(guid);
		return true;
	}
	function takePack(guid: number): void {
		const targeting = interactions.snapshot();
		if (targeting.kind === "acquiring")
			interactions.target(guid, targeting.generation);
		else model.pickup(guid);
	}
</script>

<div
	class="world-container-panel"
	bind:this={panel}
	aria-label="World container contents"
	aria-busy={view.pending}
>
	<ClientContentsView
		sections={view.sections}
		packs={view.packs}
		pending={view.pending}
		orientation="horizontal"
		{selectedGuid}
		capacities={view.capacities}
		{iconFor}
		onSelectItem={selectItem}
		rootLabel={null}
		onTakePack={takePack}
	>
		{#snippet footer()}
			<div class="world-container-footer">
				<ClientContentsSortButton
					mode={view.sortMode}
					label="container"
					onclick={onSort}
				/>
			</div>
		{/snippet}
	</ClientContentsView>
</div>

<style>
	@layer components {
		.world-container-panel {
			height: 100%;
			min-width: 0;
			min-height: 0;
		}
		.world-container-footer {
			display: flex;
			justify-content: flex-end;
			padding: 4px;
		}
	}
</style>
