<script lang="ts">
	import ItemGridCell from "../app/ItemGridCell.svelte";
	import ItemGridStrip from "../app/ItemGridStrip.svelte";
	import ItemIcon from "../app/ItemIcon.svelte";
	import type { ItemIconDisplay } from "../app/item-icon-repository";
	import type { InventoryEquipment } from "./client-inventory-equipment";
	import EquipmentSlotIcon from "./EquipmentSlotIcon.svelte";

	interface Props {
		/** Sampled slot projection; unknown occupancy must not be labeled empty. */
		readonly equipment: InventoryEquipment;
		readonly pending: boolean;
		/** Same display leases and selection owner as the contents panel. */
		readonly iconFor: (guid: number) => ItemIconDisplay | undefined;
		readonly selectedGuid: number | null;
		readonly onSelectItem: (guid: number) => void;
		/** Cold pointer interaction; the panel owns dimming of incompatible contents. */
		readonly onHoverSlot: (mask: number | null) => void;
	}
	const {
		equipment,
		pending,
		iconFor,
		selectedGuid,
		onSelectItem,
		onHoverSlot,
	}: Props = $props();
	const updating = $derived(pending || equipment.pending);
</script>

<div class="equipment-strip" aria-busy={updating}>
	<ItemGridStrip>
		{#each equipment.rows as { slot, item } (slot.mask)}
			{@const description = item?.description}
			{@const name =
				description?.kind === "known" ? description.name : "Loading item…"}
			<div
				class="equipment-row"
				data-equipment-slot={slot.mask}
				role="group"
				aria-label={slot.label}
				onpointerenter={() => onHoverSlot(slot.mask)}
				onpointerleave={() => onHoverSlot(null)}
			>
				<EquipmentSlotIcon {slot} />
				<ItemGridCell
					label={`${slot.label}: ${item === null ? (updating ? "Updating equipment…" : "Empty") : name}`}
					itemGuid={item?.guid ?? null}
					count={description?.kind === "known" ? description.stackCount : null}
					structure={description?.kind === "known"
						? description.structure
						: null}
					selected={item !== null && item.guid === selectedGuid}
					disabled={updating || description?.kind !== "known"}
					onselect={() => {
						if (item !== null) onSelectItem(item.guid);
					}}
				>
					{#snippet visual(tooltipLabel: string)}
						<ItemIcon
							display={item === null ? undefined : iconFor(item.guid)}
							{name}
							{tooltipLabel}
						/>
					{/snippet}
				</ItemGridCell>
			</div>
		{/each}
	</ItemGridStrip>
</div>

<style>
	@layer components {
		.equipment-strip {
			height: 100%;
			--ui-item-strip-width: calc(
				var(--ui-inventory-equipment-slot-icon-size) +
					var(--ui-inventory-equipment-slot-gap) +
					var(--ui-item-cell-min-size) + 2 * var(--ui-item-strip-inset)
			);
		}
		.equipment-row {
			display: grid;
			grid-template-columns:
				var(--ui-inventory-equipment-slot-icon-size)
				minmax(0, 1fr);
			align-items: center;
			gap: var(--ui-inventory-equipment-slot-gap);
		}
	}
</style>
