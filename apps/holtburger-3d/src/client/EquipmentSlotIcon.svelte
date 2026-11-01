<script lang="ts">
	import WeaponIcon from "../assets/icons/equipment-weapon.svg?component";
	import ShieldIcon from "../assets/icons/equipment-shield.svg?component";
	import AmmoIcon from "../assets/icons/equipment-ammo.svg?component";
	import HelmetIcon from "../assets/icons/helmet.svg?component";
	import ChestIcon from "../assets/icons/equipment-chest.svg?component";
	import AbdomenIcon from "../assets/icons/equipment-abdomen.svg?component";
	import ArmIcon from "../assets/icons/equipment-arm.svg?component";
	import ForearmIcon from "../assets/icons/equipment-forearm.svg?component";
	import HandIcon from "../assets/icons/equipment-hand.svg?component";
	import LegIcon from "../assets/icons/equipment-leg.svg?component";
	import ShinIcon from "../assets/icons/equipment-shin.svg?component";
	import FootIcon from "../assets/icons/equipment-foot.svg?component";
	import CloakIcon from "../assets/icons/equipment-cloak.svg?component";
	import NeckIcon from "../assets/icons/equipment-neck.svg?component";
	import WristIcon from "../assets/icons/equipment-wrist.svg?component";
	import RingIcon from "../assets/icons/equipment-ring.svg?component";
	import TrinketIcon from "../assets/icons/equipment-trinket.svg?component";
	import SigilIcon from "../assets/icons/equipment-sigil.svg?component";
	import type { InventoryEquipmentRow } from "./client-inventory-equipment";
	interface Props {
		/** Slot identity supplies the symbol and the tooltip, including layer/side. */
		readonly slot: InventoryEquipmentRow["slot"];
	}
	const { slot }: Props = $props();
	const icons = {
		weapon: WeaponIcon,
		shield: ShieldIcon,
		ammo: AmmoIcon,
		head: HelmetIcon,
		chest: ChestIcon,
		abdomen: AbdomenIcon,
		arm: ArmIcon,
		forearm: ForearmIcon,
		hand: HandIcon,
		leg: LegIcon,
		shin: ShinIcon,
		foot: FootIcon,
		cloak: CloakIcon,
		neck: NeckIcon,
		wrist: WristIcon,
		ring: RingIcon,
		trinket: TrinketIcon,
		sigil: SigilIcon,
	} as const;
	const Icon = $derived(icons[slot.symbol]);
</script>

<span role="img" aria-label={slot.label} title={slot.label}>
	<Icon
		style="display: inline; width: var(--ui-inventory-equipment-slot-icon-size); height: var(--ui-inventory-equipment-slot-icon-size); color: var(--ui-inventory-equipment-slot-icon-color); stroke-width: 1.5"
	/>
</span>
