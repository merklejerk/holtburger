<script lang="ts">
	import type { Snippet } from "svelte";
	import HudWindow from "../../app/hud/HudWindow.svelte";
	import type { HudPlacement, HudViewport } from "../../app/hud/hud-geometry";
	import ClientHudIcon, {
		type ClientHudIconName,
	} from "./ClientHudIcon.svelte";

	interface Props {
		readonly children: Snippet;
		readonly minHeight: number;
		readonly minWidth: number;
		readonly placement: HudPlacement;
		readonly title: string;
		readonly resizable?: boolean;
		readonly fitContentHeight?: boolean;
		readonly icon: ClientHudIconName;
		readonly viewport: HudViewport;
		readonly focusRevision?: number;
		readonly visible?: boolean;
		readonly onClose: () => void;
		readonly onPlacementChange: (placement: HudPlacement) => void;
	}

	const { icon: iconName, children, ...rest }: Props = $props();
</script>

<HudWindow {...rest}>
	{#snippet icon()}<ClientHudIcon name={iconName} />{/snippet}
	{@render children()}
</HudWindow>
