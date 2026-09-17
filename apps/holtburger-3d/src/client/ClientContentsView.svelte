<script lang="ts">
	import type { Snippet } from "svelte";
	import ItemGridCell from "../app/ItemGridCell.svelte";
	import ItemGridStrip from "../app/ItemGridStrip.svelte";
	import type { ItemCapacity } from "../app/item-capacity";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { ClientEntityFacts } from "./client-entity-mirror";
	import type { ClientContentsSection } from "./client-container-contents";
	import ClientContentsGrid from "./ClientContentsGrid.svelte";
	interface Props {
		/** Prepared sections retain the panel owner's resource lifetime. */
		readonly sections: readonly ClientContentsSection[];
		/** Native navigation order; null entries represent known empty carried pack slots. */
		readonly packs: readonly (ClientEntityFacts | null)[];
		/** Retained recovery pictures are visible with actions disabled. */
		readonly pending: boolean;
		/** Layout policy belongs to the composing panel. */
		readonly orientation: "vertical" | "horizontal";
		/** Inventory supplies Main Pack; external roots retain their actual names. */
		readonly rootLabel: string | null;
		/** Shared entity selection highlights cells and headers. */
		readonly selectedGuid: number | null;
		/** Prepared occupancy for grid and navigation capacity bars. */
		readonly capacities: ReadonlyMap<number, ItemCapacity>;
		/** Artwork remains leased by the panel's bounded display sampler. */
		readonly iconFor: (guid: number) => UiIconDisplay | undefined;
		/** Returns false when target acquisition consumed a navigation click. */
		readonly onSelectItem: (guid: number) => boolean;
		/** Optional equipment-hover presentation, owned by the inventory panel. */
		readonly dimItem?: (item: ClientEntityFacts) => boolean;
		/** Optional item hover identity for inventory-owned equipment affordances. */
		readonly onHoverItem?: (guid: number | null) => void;
		/** External shells provide explicit whole-pack pickup alongside drag/drop. */
		readonly onTakePack?: (guid: number) => void;
		/** Panel-specific summary and the shared compact sort control. */
		readonly footer: Snippet;
	}
	const {
		sections,
		packs,
		pending,
		orientation,
		rootLabel,
		selectedGuid,
		capacities,
		iconFor,
		onSelectItem,
		dimItem,
		onHoverItem,
		onTakePack,
		footer,
	}: Props = $props();
	let contents: HTMLDivElement;
	function navigate(guid: number): void {
		if (!onSelectItem(guid)) return;
		const section = contents.querySelector<HTMLElement>(
			`[data-container-guid="${guid}"]`,
		);
		// Foci occupy carried pack slots but do not own a contents section.
		if (section === null) return;
		const inset = Number.parseFloat(getComputedStyle(contents).paddingTop);
		contents.scrollTop +=
			section.getBoundingClientRect().top -
			contents.getBoundingClientRect().top -
			contents.clientTop -
			inset;
	}
</script>

<div
	class="contents-view"
	data-orientation={orientation}
	data-contents-root={sections[0]?.container.guid}
>
	<aside class="contents-packs" aria-label="Containers">
		<ItemGridStrip {orientation}>
			{#each packs as item, index (index)}
				<ItemGridCell
					itemGuid={item?.guid ?? null}
					display={item === null ? undefined : iconFor(item.guid)}
					equipped={item?.location.kind === "equipped"}
					capacity={item === null ? null : capacities.get(item.guid)}
					structure={index !== 0 && item?.description.kind === "known"
						? item.description.structure
						: null}
					count={index !== 0 && item?.description.kind === "known"
						? item.description.stackCount
						: null}
					label={index === 0 && rootLabel !== null
						? rootLabel
						: item === null
							? "Empty pack slot"
							: item.description.kind === "known"
								? item.description.name
								: "Loading pack…"}
					selected={item !== null && selectedGuid === item.guid}
					disabled={pending ||
						item === null ||
						item.description.kind === "pending"}
					onselect={() => {
						if (item !== null) navigate(item.guid);
					}}
				/>
			{/each}
		</ItemGridStrip>
	</aside>
	<div class="contents-scroll" bind:this={contents}>
		<ClientContentsGrid
			{sections}
			{pending}
			{selectedGuid}
			{capacities}
			{iconFor}
			{onSelectItem}
			{rootLabel}
			{dimItem}
			{onHoverItem}
			{onTakePack}
		/>
	</div>
	<div class="contents-footer">{@render footer()}</div>
</div>

<style>
	@layer components {
		.contents-view {
			display: grid;
			min-width: 0;
			min-height: 0;
			height: 100%;
			grid-template-rows: auto minmax(0, 1fr) auto;
		}
		.contents-packs {
			min-width: 0;
			min-height: 0;
			border-bottom: var(--ui-inventory-divider);
		}
		.contents-scroll {
			display: flex;
			flex-direction: column;
			min-width: 0;
			min-height: 0;
			overflow-y: auto;
			padding: var(--ui-inventory-padding);
		}
		.contents-footer {
			border-top: var(--ui-inventory-divider);
		}
		.contents-view[data-orientation="vertical"] {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-rows: minmax(0, 1fr) auto;
		}
		.contents-view[data-orientation="vertical"] .contents-packs {
			grid-column: 2;
			grid-row: 1 / -1;
			border-bottom: none;
			border-left: var(--ui-inventory-divider);
		}
		.contents-view[data-orientation="vertical"] .contents-scroll {
			grid-column: 1;
			grid-row: 1;
		}
		.contents-view[data-orientation="vertical"] .contents-footer {
			grid-column: 1;
			grid-row: 2;
		}
	}
</style>
