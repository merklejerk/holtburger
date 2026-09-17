<script lang="ts">
	import ItemGridCell from "../app/ItemGridCell.svelte";
	import type { ItemCapacity } from "../app/item-capacity";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { ClientEntityFacts } from "./client-entity-mirror";
	import type { ClientContentsSection } from "./client-container-contents";
	interface Props {
		/** Grouped contents; this renderer owns no access or gesture policy. */
		readonly sections: readonly ClientContentsSection[];
		readonly pending: boolean;
		readonly selectedGuid: number | null;
		readonly capacities: ReadonlyMap<number, ItemCapacity>;
		readonly iconFor: (guid: number) => UiIconDisplay | undefined;
		readonly onSelectItem: (guid: number) => void;
		/** Player inventory supplies Main Pack; external roots keep their own name. */
		readonly rootLabel: string | null;
		/** Optional equipment-hover presentation, owned by the inventory panel. */
		readonly dimItem?: (item: ClientEntityFacts) => boolean;
		/** Optional item hover identity for inventory-owned equipment affordances. */
		readonly onHoverItem?: (guid: number | null) => void;
		/** Explicit pack pickup appears only for external contents. */
		readonly onTakePack?: (guid: number) => void;
	}
	const {
		sections,
		pending,
		selectedGuid,
		capacities,
		iconFor,
		onSelectItem,
		rootLabel,
		dimItem,
		onHoverItem,
		onTakePack,
	}: Props = $props();
	function itemName(item: ClientEntityFacts): string {
		return item.description.kind === "known"
			? item.description.name
			: "Loading item…";
	}
</script>

{#snippet cells(items: readonly ClientEntityFacts[])}
	<div class="contents-grid">
		{#each items as item (item.guid)}
			<ItemGridCell
				itemGuid={item.guid}
				display={iconFor(item.guid)}
				equipped={item.location.kind === "equipped"}
				capacity={capacities.get(item.guid)}
				label={itemName(item)}
				structure={item.description.kind === "known"
					? item.description.structure
					: null}
				count={item.description.kind === "known"
					? item.description.stackCount
					: null}
				selected={selectedGuid === item.guid}
				dimmed={dimItem?.(item) ?? false}
				disabled={pending || item.description.kind === "pending"}
				onselect={() => onSelectItem(item.guid)}
				onHoverChange={(hovered) => onHoverItem?.(hovered ? item.guid : null)}
			></ItemGridCell>
		{/each}
	</div>
{/snippet}

{#if pending}<p role="status">Updating contents…</p>{/if}
{#each sections as section (section.container.guid)}
	<section
		data-container-guid={section.container.guid}
		aria-label={section.rootSection && rootLabel !== null
			? rootLabel
			: itemName(section.container)}
	>
		<h3>
			<button
				type="button"
				class="contents-header ui-item-selection ui-hud-button"
				data-item-guid={section.container.guid}
				aria-pressed={selectedGuid === section.container.guid}
				disabled={pending || section.container.description.kind === "pending"}
				onclick={() => onSelectItem(section.container.guid)}
			>
				{section.rootSection && rootLabel !== null
					? rootLabel
					: itemName(section.container)}
				({section.items.length} / {section.container.storage.kind ===
				"container"
					? (section.container.storage.itemCapacity ?? "?")
					: "?"})
			</button>
			{#if !section.rootSection && onTakePack !== undefined}
				<button
					type="button"
					class="ui-button"
					disabled={pending || !section.container.canPickUp}
					onclick={() => onTakePack(section.container.guid)}>Take pack</button
				>
			{/if}
		</h3>
		{@render cells(section.items)}
		{#if section.packs.length > 0}
			<h4>Pack slots</h4>
			{@render cells(section.packs)}
		{/if}
		{#if section.unslotted.length > 0}
			<h4>Awaiting placement</h4>
			{@render cells(section.unslotted)}
		{/if}
		{#if section.container.storage.kind === "not-established" || section.container.storage.roster === "awaiting"}
			<p>Loading contents…</p>
		{:else if section.items.length + section.packs.length + section.unslotted.length === 0}
			<p>Empty</p>
		{/if}
	</section>
{/each}

<style>
	@layer components {
		section {
			flex: 0 0 auto;
		}
		/* The last pack owns the remaining pane area, including below its Empty label. */
		section:last-child {
			flex-grow: 1;
		}
		section + section {
			padding-top: var(--ui-inventory-section-gap);
		}
		h3,
		h4,
		p {
			margin: 0 0 8px;
		}
		h4,
		p {
			font-size: 0.85rem;
		}
		.contents-grid {
			display: grid;
			grid-template-columns: repeat(
				auto-fill,
				minmax(min(100%, var(--ui-item-cell-min-size)), 1fr)
			);
			gap: var(--ui-item-grid-gap);
			margin-bottom: 8px;
		}
		.contents-header {
			width: 100%;
			text-align: left;
			overflow-wrap: anywhere;
		}
	}
</style>
