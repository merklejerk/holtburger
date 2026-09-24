<script lang="ts">
	import type { Snippet } from "svelte";
	import LayoutHandleIcon from "../app/LayoutHandleIcon.svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import { rotateHudTray, hudTrayOrientation } from "./client-hud-tray-layout";

	interface Props {
		/** Accessible name for the tray and its layout controls. */
		readonly label: string;
		/** Fixed dimensions and saved viewport anchor. */
		readonly placement: ClientHudPlacement;
		readonly editable: boolean;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		readonly children: Snippet;
	}
	const {
		label,
		placement,
		editable,
		viewport,
		onPlacementChange,
		children,
	}: Props = $props();
	const orientation = $derived(hudTrayOrientation(placement));
</script>

<ClientHudPanel
	{label}
	{placement}
	{editable}
	{viewport}
	minWidth={placement.preferredWidth}
	minHeight={placement.preferredHeight}
	resizable={false}
	contentHitTesting="descendants"
	{onPlacementChange}
>
	<div
		class="hud-tray"
		class:vertical={orientation === "vertical"}
		class:editable
	>
		{@render children()}
		{#if editable}
			<button
				type="button"
				class="rotate-button ui-button ui-icon-button"
				aria-label={`Rotate ${label.toLowerCase()}`}
				title={`Rotate ${label.toLowerCase()}`}
				onclick={(event) => {
					event.stopPropagation();
					onPlacementChange(rotateHudTray(placement));
				}}><LayoutHandleIcon action="rotate" /></button
			>
		{/if}
	</div>
</ClientHudPanel>

<style>
	@layer components {
		.hud-tray {
			box-sizing: border-box;
			display: flex;
			align-items: center;
			gap: var(--ui-hud-icon-gap);
			position: relative;
			width: 100%;
			height: 100%;
		}
		.hud-tray.vertical {
			flex-direction: column;
		}
		.hud-tray.editable {
			padding-inline: 26px;
		}
		.hud-tray.vertical.editable {
			padding-inline: 0;
			padding-block: 26px;
		}
		.rotate-button {
			position: absolute;
			right: 2px;
			top: 5px;
			width: 22px;
			height: 22px;
			pointer-events: auto;
		}
		.hud-tray.vertical .rotate-button {
			right: 5px;
			top: auto;
			bottom: 2px;
		}
	}
</style>
