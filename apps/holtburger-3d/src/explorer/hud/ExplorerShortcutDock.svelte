<script lang="ts">
	import HudTray from "../../app/hud/HudTray.svelte";
	import type { HudPlacement, HudViewport } from "../../app/hud/hud-geometry";
	import { hudTrayOrientation } from "../../app/hud/hud-tray-layout";
	import EntitiesIcon from "../../assets/icons/explorer-entities.svg?component";
	import RendererIcon from "../../assets/icons/explorer-renderer.svg?component";
	import WorldControlsIcon from "../../assets/icons/explorer-world-controls.svg?component";
	import DebugIcon from "../../assets/icons/hud-debug.svg?component";
	import SettingsIcon from "../../assets/icons/hud-settings.svg?component";
	import WorldMapIcon from "../../assets/icons/hud-world.svg?component";
	import type { ExplorerWindowId } from "./explorer-hud-layout";

	interface Props {
		readonly placement: HudPlacement;
		readonly viewport: HudViewport;
		readonly editable: boolean;
		readonly activePanel: ExplorerWindowId | null;
		readonly onToggle: (id: ExplorerWindowId) => void;
		readonly onPlacementChange: (placement: HudPlacement) => void;
	}

	const {
		placement,
		viewport,
		editable,
		activePanel,
		onToggle,
		onPlacementChange,
	}: Props = $props();

	const shortcuts = [
		{ id: "navigation", label: "Navigation", icon: WorldMapIcon },
		{ id: "scene", label: "Scene", icon: WorldControlsIcon },
		{ id: "visuals", label: "Visuals", icon: RendererIcon },
		{ id: "entities", label: "Entities", icon: EntitiesIcon },
		{ id: "diagnostics", label: "Diagnostics", icon: DebugIcon },
		{ id: "settings", label: "Settings", icon: SettingsIcon },
	] as const;

	const SHORTCUT_SIZE = 42;
	const trayPlacement = $derived.by<HudPlacement>(() => {
		const horizontalWidth = shortcuts.length * SHORTCUT_SIZE;
		const vertical = placement.preferredHeight > placement.preferredWidth;
		return {
			...placement,
			preferredWidth: vertical ? SHORTCUT_SIZE : horizontalWidth,
			preferredHeight: vertical ? horizontalWidth : SHORTCUT_SIZE,
		};
	});
	const orientation = $derived(hudTrayOrientation(trayPlacement));
</script>

<HudTray
	label="Explorer shortcuts"
	placement={trayPlacement}
	gapCount={shortcuts.length - 1}
	{editable}
	{viewport}
	{onPlacementChange}
>
	<nav
		class="shortcut-dock"
		class:vertical={orientation === "vertical"}
		style:--shortcut-count={shortcuts.length}
		aria-label="Explorer shortcuts"
	>
		{#each shortcuts as shortcut (shortcut.id)}
			{@const Icon = shortcut.icon}
			<button
				type="button"
				class="ui-hud-button ui-icon-button"
				title={shortcut.label}
				aria-label={shortcut.label}
				aria-pressed={activePanel === shortcut.id}
				onclick={() => onToggle(shortcut.id)}
			>
				<Icon />
			</button>
		{/each}
	</nav>
</HudTray>

<style>
	@layer components {
		.shortcut-dock {
			display: grid;
			box-sizing: border-box;
			width: 100%;
			height: 100%;
			grid-template-columns: repeat(var(--shortcut-count), minmax(0, 1fr));
			gap: var(--ui-hud-icon-gap);
		}
		.shortcut-dock.vertical {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: repeat(var(--shortcut-count), minmax(0, 1fr));
		}
		button {
			pointer-events: auto;
			min-width: 0;
			min-height: 0;
			padding: 8px;
		}
	}
</style>
