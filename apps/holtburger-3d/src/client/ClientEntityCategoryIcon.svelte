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
	import SwitchIcon from "../assets/icons/entity-category-switch.svg?component";
	import type { NearbyEntityCategory } from "./client-entity-mirror";

	const {
		category,
	}: {
		/** Public entity category selects dedicated artwork, independently of HUD action icons. */
		readonly category: NearbyEntityCategory;
	} = $props();
	const icons = {
		monster: MonsterIcon,
		npc: NpcIcon,
		player: PlayerIcon,
		corpse: CorpseIcon,
		container: ContainerIcon,
		item: ItemIcon,
		portal: PortalIcon,
		lifestone: LifestoneIcon,
		door: DoorIcon,
		switch: SwitchIcon,
	} satisfies Record<NearbyEntityCategory, typeof MonsterIcon>;
	const Icon = $derived(icons[category]);
</script>

<Icon />
