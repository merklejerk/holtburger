<script lang="ts">
	import type { CharacterIdentity } from "./client-object-inspection-contract";
	import { formatPlayerKillerStatus } from "./client-object-inspection-format";

	interface Props {
		readonly status: CharacterIdentity["playerKillerStatus"];
	}

	const { status }: Props = $props();
	const label = $derived(formatPlayerKillerStatus(status));
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
	<svg viewBox="0 0 24 24" aria-hidden="true">
		{#if status === "non-player-killer"}
			<path
				d="M12 2.5 20 5.5v6.2c0 5.1-3.2 8.2-8 10.3-4.8-2.1-8-5.2-8-10.3V5.5Z"
			/>
			<path d="m8.4 12.1 2.2 2.2 5-5" />
		{:else if status === "player-killer-lite"}
			<path
				d="M12 2.5 20 5.5v6.2c0 5.1-3.2 8.2-8 10.3-4.8-2.1-8-5.2-8-10.3V5.5Z"
			/>
			<path d="m8 16 8-8m-6-2 2 2m4 6 2 2m-9.5.5-1 3 3-1Z" />
		{:else}
			<path d="m5 3 3 1 11 14-2 2L6 7Zm14 0-3 1-4 5m-3 4-4 5 2 2 4-5" />
			<path d="M3 16 8 21m8-5 5 5" />
		{/if}
	</svg>
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
		svg {
			display: block;
			width: 16px;
			height: 16px;
			fill: none;
			stroke: currentcolor;
			stroke-width: 1.8;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
	}
</style>
