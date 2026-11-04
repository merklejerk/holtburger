<script lang="ts">
	import NonPlayerKillerIcon from "../assets/icons/status-non-player-killer.svg?component";
	import PlayerKillerLiteIcon from "../assets/icons/status-player-killer-lite.svg?component";
	import PlayerKillerIcon from "../assets/icons/status-player-killer.svg?component";
	import type { CharacterIdentity } from "./client-object-inspection-contract";
	import { formatPlayerKillerStatus } from "./client-object-inspection-format";

	interface Props {
		readonly status: CharacterIdentity["playerKillerStatus"];
	}

	const { status }: Props = $props();
	const label = $derived(formatPlayerKillerStatus(status));
	const icons = {
		"non-player-killer": NonPlayerKillerIcon,
		"player-killer-lite": PlayerKillerLiteIcon,
		"player-killer": PlayerKillerIcon,
	} satisfies Record<
		CharacterIdentity["playerKillerStatus"],
		typeof NonPlayerKillerIcon
	>;
	const Icon = $derived(icons[status]);
</script>

<span
	class:non-player-killer={status === "non-player-killer"}
	class:player-killer-lite={status === "player-killer-lite"}
	class:player-killer={status === "player-killer"}
	class="player-killer-status-icon"
	data-player-killer-status={status}
	role="img"
	aria-label={label}
	title={label}
>
	<Icon />
</span>

<style>
	@layer components {
		.player-killer-status-icon {
			display: inline-grid;
			place-items: center;
			flex: 0 0 auto;
			width: 18px;
			height: 18px;
			border-radius: 3px;
			background: color-mix(in srgb, currentcolor 16%, transparent);
			filter: drop-shadow(0 1px 2px var(--ui-color-shadow));
			pointer-events: auto;
		}
		.player-killer-status-icon.non-player-killer {
			color: var(--ui-color-success);
		}
		.player-killer-status-icon.player-killer-lite {
			color: var(--ui-color-pk-lite, #e58acb);
		}
		.player-killer-status-icon.player-killer {
			color: var(--ui-color-danger);
		}
	}
</style>
