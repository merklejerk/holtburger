<script lang="ts">
	import LayoutHandleIcon from "../app/LayoutHandleIcon.svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import ClientHudIcon, {
		type ClientHudIconName,
	} from "./ClientHudIcon.svelte";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import {
		rotateStatusTray,
		statusTrayOrientation,
	} from "./client-status-tray-layout";

	interface Props {
		/** Saved position and long-axis orientation of the fixed-size tray. */
		readonly placement: ClientHudPlacement;
		readonly editable: boolean;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		/** World-resolved effective ordinary spell presence. */
		readonly kinds: { readonly beneficial: boolean; readonly harmful: boolean };
		readonly onOpenEnchantments: (kind: "beneficial" | "harmful") => void;
	}

	const {
		placement,
		editable,
		viewport,
		onPlacementChange,
		kinds,
		onOpenEnchantments,
	}: Props = $props();
	const orientation = $derived(statusTrayOrientation(placement));
	const statuses = $derived<
		readonly {
			name: ClientHudIconName;
			label: string;
			kind: "beneficial" | "harmful";
		}[]
	>([
		...(kinds.beneficial
			? [
					{
						name: "buffed" as const,
						label: "Beneficial enchantments",
						kind: "beneficial" as const,
					},
				]
			: []),
		...(kinds.harmful
			? [
					{
						name: "debuffed" as const,
						label: "Harmful enchantments",
						kind: "harmful" as const,
					},
				]
			: []),
	]);
</script>

<ClientHudPanel
	label="Status tray"
	{placement}
	{editable}
	{viewport}
	minWidth={placement.preferredWidth}
	minHeight={placement.preferredHeight}
	resizable={CLIENT_UI_DEFAULTS.statusTray.resizable}
	contentHitTesting="descendants"
	{onPlacementChange}
>
	<div
		class="status-tray ui-hud-group"
		class:vertical={orientation === "vertical"}
		class:editable
		role="group"
		aria-label="Status icons"
	>
		{#each statuses as status}
			<button
				type="button"
				class="status-icon"
				title={status.label}
				aria-label={status.label}
				onclick={() => onOpenEnchantments(status.kind)}
			>
				<ClientHudIcon name={status.name} />
			</button>
		{/each}
		{#if editable}
			<button
				type="button"
				class="rotate-button ui-button ui-icon-button"
				aria-label="Rotate status tray"
				title="Rotate status tray"
				onclick={(event) => {
					event.stopPropagation();
					onPlacementChange(rotateStatusTray(placement));
				}}><LayoutHandleIcon action="rotate" /></button
			>
		{/if}
	</div>
</ClientHudPanel>

<style>
	@layer components {
		.status-tray {
			box-sizing: border-box;
			display: flex;
			align-items: center;
			gap: 10px;
			position: relative;
			width: 100%;
			height: 100%;
		}
		.status-tray.vertical {
			flex-direction: column;
		}
		.status-tray.editable {
			gap: 4px;
			padding-inline: 26px;
		}
		.status-tray.vertical.editable {
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
		.status-tray.vertical .rotate-button {
			right: 5px;
			top: auto;
			bottom: 2px;
		}
		.status-icon {
			box-sizing: border-box;
			width: 32px;
			height: 32px;
			padding: 6px;
			cursor: pointer;
			pointer-events: auto;
		}
		.editable .status-icon {
			flex: 0 0 23px;
			width: 23px;
			height: 23px;
			padding: 4px;
		}
	}
</style>
