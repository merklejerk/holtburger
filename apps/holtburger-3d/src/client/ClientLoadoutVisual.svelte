<script lang="ts">
	import LoadoutIcon from "../assets/icons/hud-loadout.svg?component";
	import type { LoadoutActionContent } from "./client-loadout";

	interface Props {
		/** Personal badge over the standard equipment-set silhouette. */
		icon: LoadoutActionContent["icon"];
	}
	let { icon }: Props = $props();
</script>

<span class="loadout-visual" data-drag-artwork aria-hidden="true">
	<LoadoutIcon />
	<span class="loadout-badge">{icon}</span>
</span>

<style>
	@layer components {
		.loadout-visual {
			position: relative;
			display: block;
			width: 100%;
			height: 100%;
			container-type: inline-size;
			color: var(--ui-color-text);
			pointer-events: none;
		}
		.loadout-badge {
			position: absolute;
			right: 0;
			bottom: 0;
			display: grid;
			place-items: center;
			width: 72%;
			height: 72%;
			background: radial-gradient(
				ellipse closest-side,
				color-mix(
						in srgb,
						var(--ui-loadout-badge-background-color)
							var(--ui-loadout-badge-background-opacity),
						transparent
					)
					0%,
				color-mix(
						in srgb,
						var(--ui-loadout-badge-background-color)
							calc(var(--ui-loadout-badge-background-opacity) * 0.75),
						transparent
					)
					65%,
				transparent 100%
			);
			font-size: 64cqw;
			line-height: 1;
		}
	}
</style>
