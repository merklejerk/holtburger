<script lang="ts">
	import type { InventoryEquipmentRow } from "./client-inventory-equipment";
	interface Props {
		/** Slot identity supplies the symbol and the tooltip, including layer/side. */
		readonly slot: InventoryEquipmentRow["slot"];
	}
	const { slot }: Props = $props();
	/** App-authored silhouettes share geometry between clothing/armor and left/right slots. */
	const paths = {
		weapon: "M6 18 18 6l1-3-3 1L4 16m-1-3 8 8m-4-3-4 4",
		shield: "M12 3 20 6v6c0 5-8 9-8 9s-8-4-8-9V6Z",
		ammo: "m5 19 14-14m-5 0h5v5M5 14v5h5",
		head: "M5 16V9a7 7 0 0 1 14 0v7l-4 4v-8H9v8Zm4-8h6",
		chest: "m8 3-5 4 3 5 2-2v11h8V10l2 2 3-5-5-4c0 4-8 4-8 0Z",
		abdomen: "M5 5h14l-2 6 2 8-7 3-7-3 2-8Zm2 6h10",
		arm: "m7 3 8 2 4 10-7 3-4-8-4-1Z",
		forearm: "m8 3 10 3-6 16-7-2Zm-1 4 9 3",
		hand: "M7 21 3 12l2-1 3 4V5h2v7-9h3v9-7h3v8-5h3v8l-4 5Z",
		leg: "M5 3h14l-2 18h-5l-1-12-2 12H4Zm0 4h13",
		shin: "m8 3 10 1-4 18H8L6 8Zm-1 5h10",
		foot: "M7 3h8v11l6 3v4H3v-7h4Z",
		cloak: "M9 3h6l6 18H3Zm0 0 3 5 3-5",
		neck: "M5 3C2 14 8 18 12 18S22 14 19 3M9 18l3 4 3-4-3-3Z",
		wrist: "M5 7c0-5 14-5 14 0v10c0 5-14 5-14 0Zm0 0c0 5 14 5 14 0",
		ring: "M8 8a7 7 0 1 0 8 0M8 5l4-3 4 3-4 5Z",
		trinket: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z",
		sigil: "m12 2 7 5-2 13-5 2-5-2L5 7Zm0 4-3 7h6l-3 5",
	} as const;
</script>

<svg viewBox="0 0 24 24" role="img" aria-label={slot.label}>
	<title>{slot.label}</title>
	<path d={paths[slot.symbol]} />
</svg>

<style>
	@layer components {
		svg {
			width: var(--ui-inventory-equipment-slot-icon-size);
			height: var(--ui-inventory-equipment-slot-icon-size);
			color: var(--ui-inventory-equipment-slot-icon-color);
			fill: none;
			stroke: currentColor;
			stroke-width: 1.5;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
	}
</style>
