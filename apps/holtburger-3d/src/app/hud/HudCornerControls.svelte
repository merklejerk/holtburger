<script lang="ts" generics="Action extends string">
	import PopupMenu, { type PopupMenuItem } from "../ui/PopupMenu.svelte";
	import HideHudIcon from "../../assets/icons/explorer-hide-hud.svg?component";
	import LockedIcon from "../../assets/icons/hud-locked.svg?component";
	import PowerIcon from "../../assets/icons/hud-power.svg?component";
	import UnlockedIcon from "../../assets/icons/hud-unlocked.svg?component";

	interface Props {
		/** Current HUD layout edit mode. */
		readonly hudMode: "runtime" | "layout";
		/** Toggle between locked runtime HUD and editable HUD layout mode. */
		readonly onToggleHudMode: () => void;
		/** System menu items rendered in the top-right power popup menu. */
		readonly menuItems: readonly PopupMenuItem<Action>[];
		/** Whether `show()` (Escape fallback) is currently permitted to open the menu. */
		readonly canShowMenu?: boolean;
		readonly onMenuSelect: (action: Action) => void;
		/** Optional Hide UI button (Explorer-only). */
		readonly onHideHud?: (() => void) | null;
		readonly hideHudTooltip?: string;
	}

	const {
		hudMode,
		onToggleHudMode,
		menuItems,
		canShowMenu = true,
		onMenuSelect,
		onHideHud = null,
		hideHudTooltip = "Hide UI",
	}: Props = $props();

	let menuButton = $state<HTMLButtonElement>();
	let open = $state(false);

	/** Called only after existing modal, editor, and Escape cancellation. */
	export function show(): void {
		if (canShowMenu) open = true;
	}
</script>

<div class="hud-corner-controls">
	{#if onHideHud !== null}
		<button
			type="button"
			class="hud-corner-button ui-hud-button ui-icon-button"
			aria-label={hideHudTooltip}
			title={hideHudTooltip}
			onclick={onHideHud}
		>
			<HideHudIcon />
		</button>
	{/if}

	<button
		type="button"
		class="hud-corner-button ui-hud-button ui-icon-button"
		aria-label={hudMode === "runtime" ? "Unlock UI layout" : "Lock UI layout"}
		aria-pressed={hudMode === "layout"}
		title={hudMode === "runtime" ? "Unlock UI layout" : "Lock UI layout"}
		onclick={onToggleHudMode}
	>
		{#if hudMode === "runtime"}
			<LockedIcon />
		{:else}
			<UnlockedIcon />
		{/if}
	</button>

	<button
		bind:this={menuButton}
		type="button"
		class="hud-corner-button ui-hud-button ui-icon-button"
		aria-label="System menu"
		title="System menu"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<PowerIcon />
	</button>
</div>

{#if open && menuButton !== undefined}
	<PopupMenu
		anchor={menuButton}
		label="System"
		items={menuItems}
		onclose={() => (open = false)}
		onselect={onMenuSelect}
	/>
{/if}

<style>
	@layer components {
		.hud-corner-controls {
			position: fixed;
			top: 8px;
			right: 8px;
			z-index: 500;
			display: flex;
			align-items: center;
			gap: 8px;
			pointer-events: none;
		}
		.hud-corner-button {
			pointer-events: auto;
			width: 28px;
			height: 28px;
			min-height: 0;
			padding: 5px;
		}
	}
</style>
