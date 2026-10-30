<script lang="ts">
	import MonsterIcon from "../assets/icons/entity-category-monster.svg?component";
	import NpcIcon from "../assets/icons/entity-category-npc.svg?component";
	import PlayerIcon from "../assets/icons/entity-category-player.svg?component";
	import CorpseIcon from "../assets/icons/entity-category-corpse.svg?component";
	import ContainerIcon from "../assets/icons/entity-category-container.svg?component";
	import ItemIcon from "../assets/icons/entity-category-item.svg?component";
	import PortalIcon from "../assets/icons/entity-category-portal.svg?component";
	import LifestoneIcon from "../assets/icons/entity-category-lifestone.svg?component";
	import DoorIcon from "../assets/icons/entity-category-door.svg?component";
	import UseableIcon from "../assets/icons/hud-interact.svg?component";
	import type { NearbyCategory } from "./client-nearby-policy";

	const {
		category,
	}: {
		/** Resolved row category selects artwork, independently of the selected HUD action. */
		readonly category: NearbyCategory;
	} = $props();
	const icons = {
		monster: MonsterIcon,
		npc: NpcIcon,
		player: PlayerIcon,
		corpse: CorpseIcon,
		container: ContainerIcon,
		prop: ItemIcon,
		pickup: ItemIcon,
		portal: PortalIcon,
		lifestone: LifestoneIcon,
		door: DoorIcon,
		useable: UseableIcon,
	} satisfies Record<NearbyCategory, typeof MonsterIcon>;
	const Icon = $derived(icons[category]);
</script>

<Icon />
