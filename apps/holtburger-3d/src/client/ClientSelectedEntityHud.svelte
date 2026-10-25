<script lang="ts">
	import { presentClientBinding } from "./client-binding-catalog";
	import { onMount, untrack } from "svelte";
	import { formatQuantity } from "../app/quantity-format";
	import { itemStructureDisplay } from "../app/item-structure";

	import {
		EMPTY_CLIENT_SELECTED_DISPLAY,
		type ClientSelectedEntityDisplay,
	} from "./client-selected-entity-tracking";
	import PopupMenu from "../app/PopupMenu.svelte";
	import MoreActionsIcon from "../assets/icons/hud-more-actions.svg?component";
	import ClientHudIcon, {
		type ClientHudIconName,
	} from "./ClientHudIcon.svelte";
	import type { ClientKeyboardConfiguration } from "../lib/input/input-contract";
	import { type InputDisplayPlatform } from "../lib/input/input-presentation";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		/** Accepted bindings keep tooltip hints current after keyboard remapping. */
		readonly input: ClientKeyboardConfiguration;
		/** Platform vocabulary matches the other client HUD shortcut hints. */
		readonly displayPlatform: InputDisplayPlatform;
		/** Cold selection identity controlling whether the runtime surface is present. */
		readonly selectedGuid: number | null;
		/** Bounded display read kept separate from frame-hot target projection. */
		readonly readSelectedDisplay: () => ClientSelectedEntityDisplay;
		/** Shared candidate admission, independent of Ust ownership. */
		readonly readCanSalvage: () => boolean;
		/** Capture the selected source and enter the session-owned salvage workflow. */
		readonly onSalvage: () => void;
		/** Bounded inventory-owned eligibility read sampled with the selected display. */
		readonly readCanSplit: () => boolean;
		/** Sample app-owned party eligibility alongside the selected display. */
		readonly readCanInvite: () => boolean;
		/** Read friend shortcut eligibility without introducing HUD request state. */
		readonly readCanAddFriend: () => boolean;
		/** Read account-ignore eligibility from the existing social owner. */
		readonly readCanIgnoreAccount: () => boolean;
		/** Dispatch selected-player shortcuts through their app owners. */
		readonly onAddFriend: () => void;
		readonly onIgnoreAccount: () => void;
		/** Other known selected player and active session; no guessed permission status. */
		readonly readCanCorpsePermission: () => boolean;
		/** Dispatch the requested operation using the selection captured at activation. */
		readonly onCorpsePermission: (granted: boolean) => void;
		/** Sample allegiance-owned swear admission with the selected display. */
		readonly readCanSwear: () => boolean;
		/** Server confirmation owns the selected-player swear request. */
		readonly onSwear: () => void;
		/** Invite the current eligible selection through its party owner. */
		readonly onInvite: () => void;
		/** Forward the button edge to the session-owned interaction controller. */
		readonly onInteract: () => void;
		/** Request examination for the selection captured by the app owner. */
		readonly onExamine: () => void;
		/** Disable only while this same selected identity is already pending. */
		readonly examinePending: boolean;
		/** Open the inventory-owned split flow for the selected stack. */
		readonly onSplit: (source: HTMLButtonElement) => void;
	}

	const {
		input,
		displayPlatform,
		selectedGuid,
		readSelectedDisplay,
		readCanSalvage,
		onSalvage,
		readCanSplit,
		readCanInvite,
		readCanAddFriend,
		readCanIgnoreAccount,
		onAddFriend,
		onIgnoreAccount,
		readCanCorpsePermission,
		onCorpsePermission,
		readCanSwear,
		onSwear,
		onInvite,
		onInteract,
		onExamine,
		examinePending,
		onSplit,
	}: Props = $props();
	let display = $state<ClientSelectedEntityDisplay>(
		EMPTY_CLIENT_SELECTED_DISPLAY,
	);
	let canSalvage = $state(false);
	let canSplit = $state(false);
	let canInvite = $state(false);
	let canAddFriend = $state(false);
	let canIgnoreAccount = $state(false);
	let canCorpsePermission = $state(false);
	let canSwear = $state(false);
	/** Eligible selected-entity command; the source remains mounted for follow-up dialogs. */
	type SelectedAction = {
		/** Command name used by the accessible direct button and unbound menu rows. */
		readonly label: string;
		/** Shared artwork used by the direct button and menu row. */
		readonly icon: ClientHudIconName;
		/** Only eligible commands are included in this menu. */
		readonly disabled: false;
		/** App-owned command; source anchors follow-up dialogs. */
		readonly activate: (source: HTMLButtonElement) => void;
	} &
		/** Bound actions carry a prepared description for icon tooltips and visible menu labels. */
		(
			| { readonly action: "interact" | "split"; readonly description: string }
			| {
					readonly action:
						| "salvage"
						| "swear"
						| "invite"
						| "friend"
						| "ignore"
						| "grant-corpse"
						| "revoke-corpse";
					readonly description?: never;
			  }
		);
	const actions = $derived.by(() => {
		const available: SelectedAction[] = [];
		if (display.canInteract)
			available.push({
				action: "interact",
				label: display.interactionLabel,
				description: `${display.interactionLabel} (${presentClientBinding(input, { kind: "client", action: "interact" }, displayPlatform).description})`,
				icon: display.interactionLabel === "Trade" ? "trade" : "interact",
				disabled: false,
				activate: onInteract,
			});
		if (canSwear)
			available.push({
				action: "swear",
				label: "Swear allegiance",
				icon: "leader",
				disabled: false,
				activate: onSwear,
			});
		if (canInvite)
			available.push({
				action: "invite",
				label: "Invite to party",
				icon: "invite",
				disabled: false,
				activate: onInvite,
			});
		if (canAddFriend)
			available.push({
				action: "friend",
				label: "Add friend",
				icon: "add",
				disabled: false,
				activate: onAddFriend,
			});
		if (canIgnoreAccount)
			available.push({
				action: "ignore",
				label: "Ignore account",
				icon: "remove",
				disabled: false,
				activate: onIgnoreAccount,
			});
		if (canCorpsePermission) {
			available.push({
				action: "grant-corpse",
				label: "Grant corpse access",
				icon: "add",
				disabled: false,
				activate: () => onCorpsePermission(true),
			});
			available.push({
				action: "revoke-corpse",
				label: "Revoke corpse access",
				icon: "remove",
				disabled: false,
				activate: () => onCorpsePermission(false),
			});
		}
		if (canSalvage)
			available.push({
				action: "salvage",
				label: "Salvage",
				icon: "salvage",
				disabled: false,
				activate: onSalvage,
			});
		if (canSplit)
			available.push({
				action: "split",
				label: "Split stack",
				description: `Split stack (${presentClientBinding(input, { kind: "client", action: "splitStack" }, displayPlatform).description})`,
				icon: "split",
				disabled: false,
				activate: onSplit,
			});
		return available;
	});
	let menuAnchor = $state<HTMLButtonElement | null>(null);
	$effect(() => {
		if (actions.length <= 1) menuAnchor = null;
	});

	function selectMenuAction(source: HTMLButtonElement) {
		// Capture the mounted trigger before PopupMenu dismisses and clears menuAnchor.
		return (id: SelectedAction["action"]): void => {
			const action = actions.find((action) => action.action === id);
			if (action !== undefined) action.activate(source);
		};
	}

	const structureDisplay = $derived(itemStructureDisplay(display.structure));
	const displayName = $derived(
		(display.name ?? "Selected Entity") +
			(display.stackCount !== null && display.stackCount > 1
				? ` (${formatQuantity(display.stackCount)})`
				: "") +
			(structureDisplay === null ? "" : ` ${structureDisplay.label}`),
	);
	const healthPercent = $derived(
		display.health.kind !== "known"
			? null
			: Math.max(0, Math.min(100, display.health.fraction * 100)),
	);

	$effect(() => {
		const guid = selectedGuid;
		menuAnchor = null;
		// Selection identity is cold UI state; the runtime lookup must not own this effect's lifecycle.
		untrack(() => {
			display =
				guid === null ? EMPTY_CLIENT_SELECTED_DISPLAY : readSelectedDisplay();
			canSalvage = guid !== null && readCanSalvage();
			canSplit = guid !== null && readCanSplit();
			canInvite = guid !== null && readCanInvite();
			canAddFriend = guid !== null && readCanAddFriend();
			canIgnoreAccount = guid !== null && readCanIgnoreAccount();
			canCorpsePermission = guid !== null && readCanCorpsePermission();
			canSwear = guid !== null && readCanSwear();
		});
	});

	onMount(() => {
		const sample = (): void => {
			display =
				selectedGuid === null
					? EMPTY_CLIENT_SELECTED_DISPLAY
					: readSelectedDisplay();
			canSalvage = selectedGuid !== null && readCanSalvage();
			canSplit = selectedGuid !== null && readCanSplit();
			canInvite = selectedGuid !== null && readCanInvite();
			canAddFriend = selectedGuid !== null && readCanAddFriend();
			canIgnoreAccount = selectedGuid !== null && readCanIgnoreAccount();
			canCorpsePermission = selectedGuid !== null && readCanCorpsePermission();
			canSwear = selectedGuid !== null && readCanSwear();
		};
		const interval = window.setInterval(
			sample,
			CLIENT_TUNING.selectedEntityHud.displayIntervalMs,
		);
		return () => window.clearInterval(interval);
	});
</script>

<section class="selected-entity" aria-label={`Selected entity: ${displayName}`}>
	<div class="selected-entity__heading ui-hud-group">
		{#if actions.length > 1}
			<button
				class="ui-hud-button"
				type="button"
				aria-label="Selected entity actions"
				title="Selected entity actions"
				aria-haspopup="menu"
				aria-expanded={menuAnchor !== null}
				onclick={(event) => {
					menuAnchor = menuAnchor === null ? event.currentTarget : null;
				}}><MoreActionsIcon /></button
			>
		{:else}
			{#each actions as action (action.action)}
				<button
					class="ui-hud-button"
					type="button"
					aria-label={action.label}
					title={action.description ?? action.label}
					onclick={(event) => action.activate(event.currentTarget)}
					><ClientHudIcon name={action.icon} /></button
				>
			{/each}
		{/if}
		<strong title={displayName} style:color={display.nameColor}
			><span>{displayName}</span></strong
		>
		<button
			class="ui-hud-button"
			type="button"
			disabled={examinePending}
			onclick={onExamine}
			aria-label={examinePending ? "Examining selected entity" : "Examine"}
			title={`${examinePending ? "Examining selected entity" : "Examine"} (${presentClientBinding(input, { kind: "client", action: "examine" }, displayPlatform).description})`}
			aria-busy={examinePending}
		>
			<ClientHudIcon name="examine" />
		</button>
	</div>
	{#if display.health.kind === "known" || display.health.kind === "awaiting-response"}
		<div
			class="selected-entity__health ui-hud-surface"
			role="meter"
			aria-label="Selected entity health"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={healthPercent ?? undefined}
			aria-valuetext={healthPercent === null
				? "Unknown"
				: `${Math.round(healthPercent)}%`}
		>
			{#if healthPercent !== null}<div
					class="selected-entity__health-fill"
					style:width={`${healthPercent}%`}
				></div>{/if}
		</div>
	{/if}
</section>

{#if menuAnchor !== null && actions.length > 1}
	{@const source = menuAnchor}
	<PopupMenu
		anchor={source}
		label="Selected entity actions"
		items={actions.map((action) => ({
			...action,
			label: action.description ?? action.label,
		}))}
		onselect={selectMenuAction(source)}
		onclose={() => {
			menuAnchor = null;
		}}
	>
		{#snippet icon(action: SelectedAction)}
			<ClientHudIcon name={action.icon} />
		{/snippet}
	</PopupMenu>
{/if}

<style>
	@layer components {
		.selected-entity {
			display: grid;
			box-sizing: border-box;
			width: 100%;
			height: 100%;
			grid-template-rows: 24px 5px;
			gap: 3px;
		}
		.selected-entity__heading {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) 24px;
			gap: 4px;
			align-items: center;
		}
		.selected-entity__heading strong {
			/* Keep the name centered when no left-side action is available. */
			grid-column: 2;
			font-weight: 600;
			text-align: center;
			white-space: nowrap;
			min-width: 0;
		}
		.selected-entity__heading strong span {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.selected-entity__heading button {
			display: grid;
			width: 24px;
			height: 24px;
			padding: 4px;
			place-items: center;
			pointer-events: auto;
		}
		.selected-entity__heading button :global(svg) {
			width: 16px;
			height: 16px;
		}
		.selected-entity__health {
			overflow: hidden;
			background: var(--_ui-hud-background-color);
		}
		.selected-entity__health-fill {
			height: 100%;
			background: var(--ui-color-health);
		}
	}
</style>
