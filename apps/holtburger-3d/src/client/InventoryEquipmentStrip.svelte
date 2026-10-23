<script lang="ts">
	import { equipmentStripFilter } from "./client-equipment-strip-filter";
	import type { ItemCapacity } from "../app/item-capacity";
	import ItemGridCell from "../app/ItemGridCell.svelte";
	import ItemGridStrip from "../app/ItemGridStrip.svelte";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { InventoryEquipment } from "./client-inventory-equipment";
	import EquipmentSlotIcon from "./EquipmentSlotIcon.svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";

	interface Props {
		/** Sampled slot projection; unknown occupancy must not be labeled empty. */
		readonly equipment: InventoryEquipment;
		/** Known container occupancy from the same accepted inventory baseline. */
		readonly capacities: ReadonlyMap<number, ItemCapacity>;
		readonly pending: boolean;
		/** Same display leases and selection owner as the contents panel. */
		readonly iconFor: (guid: number) => UiIconDisplay | undefined;
		readonly selectedGuid: number | null;
		readonly onSelectItem: (guid: number) => void;
		/** Cold pointer interaction; the panel owns dimming of incompatible contents. */
		readonly onHoverSlot: (mask: number | null) => void;
		/** Established target compatibility for the hovered item; absent compatibility keeps all rows. */
		readonly hoveredEquipLocations: number | null | undefined;
	}
	const {
		equipment,
		capacities,
		pending,
		iconFor,
		selectedGuid,
		onSelectItem,
		onHoverSlot,
		hoveredEquipLocations,
	}: Props = $props();
	const updating = $derived(pending || equipment.pending);

	const attentionIndexes = $derived(
		new Set(
			equipment.rows.flatMap(({ slot, availability }, index) =>
				!updating &&
				availability === "available" &&
				hoveredEquipLocations !== undefined &&
				hoveredEquipLocations !== null &&
				(hoveredEquipLocations & slot.mask) !== 0
					? [index]
					: [],
			),
		),
	);
</script>

<div
	class="equipment-strip"
	aria-busy={updating}
	use:equipmentStripFilter={{
		locations: updating ? undefined : hoveredEquipLocations,
		rows: equipment.rows,
	}}
>
	<ItemGridStrip {attentionIndexes}>
		{#each equipment.rows as { slot, item, availability } (slot.mask)}
			{@const description = item?.description}
			{@const name =
				description?.kind === "known" ? description.name : "Loading item…"}
			{@const status =
				availability === "locked"
					? "Not activated"
					: availability === "pending"
						? "Activation unknown"
						: null}
			{@const contents =
				item === null
					? updating
						? "Updating equipment…"
						: (status ?? "Empty")
					: name}
			{@const label = `${slot.label}: ${contents}${item !== null && status !== null ? ` (${status})` : ""}`}
			<div
				class="equipment-row"
				data-equipment-slot={slot.mask}
				data-equipment-availability={availability}
				title={status === null ? slot.label : `${slot.label}: ${status}`}
				role="group"
				aria-label={status === null ? slot.label : `${slot.label}: ${status}`}
				onpointerenter={() =>
					onHoverSlot(availability === "available" ? slot.mask : null)}
				onpointerleave={() => onHoverSlot(null)}
			>
				<EquipmentSlotIcon {slot} />
				<div class="equipment-cell">
					<ItemGridCell
						{label}
						itemGuid={item?.guid ?? null}
						display={item === null ? undefined : iconFor(item.guid)}
						equipped={item?.location.kind === "equipped"}
						showEquipped={false}
						capacity={item === null ? null : capacities.get(item.guid)}
						count={description?.kind === "known"
							? description.stackCount
							: null}
						structure={description?.kind === "known"
							? description.structure
							: null}
						selected={item !== null && item.guid === selectedGuid}
						disabled={updating || description?.kind !== "known"}
						onselect={() => {
							if (item !== null) onSelectItem(item.guid);
						}}
					></ItemGridCell>
					{#if availability === "locked"}
						<span class="equipment-lock" aria-hidden="true"
							><ClientHudIcon name="locked" /></span
						>
					{/if}
				</div>
			</div>
		{/each}
	</ItemGridStrip>
</div>

<style>
	@layer components {
		.equipment-strip {
			height: 100%;
			--ui-item-strip-width: calc(
				calc(
						var(--ui-inventory-equipment-slot-icon-size) * var(--ui-icon-scale)
					) +
					calc(var(--ui-inventory-equipment-slot-gap) * var(--ui-icon-scale)) +
					calc(var(--ui-item-cell-min-size) * var(--ui-icon-scale)) + 2 *
					calc(var(--ui-item-strip-inset) * var(--ui-icon-scale))
			);
		}
		.equipment-cell {
			display: grid;
			position: relative;
		}
		.equipment-lock {
			position: absolute;
			inset: 25%;
			pointer-events: none;
			color: var(--ui-inventory-equipment-slot-icon-color);
		}
		.equipment-row:global([hidden]) {
			display: none;
		}
		.equipment-row:global([data-hover-dimmed="true"]) {
			opacity: var(--ui-item-dimmed-opacity, 0.3);
		}
		.equipment-row {
			transition: opacity var(--ui-item-dim-duration, 150ms) ease-out;
			display: grid;
			grid-template-columns:
				calc(
					var(--ui-inventory-equipment-slot-icon-size) * var(--ui-icon-scale)
				)
				minmax(0, 1fr);
			align-items: center;
			gap: calc(var(--ui-inventory-equipment-slot-gap) * var(--ui-icon-scale));
		}
		@media (prefers-reduced-motion: reduce) {
			.equipment-row {
				transition: none;
			}
		}
	}
</style>
