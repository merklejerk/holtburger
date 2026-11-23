<script lang="ts">
	import { presentClientBinding } from "../settings/binding-catalog";
	import { onMount, untrack } from "svelte";
	import HudSelectedEntityBar from "../../app/hud/HudSelectedEntityBar.svelte";
	import { formatQuantity } from "../../app/ui/quantity-format";
	import { itemStructureDisplay } from "../widgets/item-structure";

	import {
		EMPTY_CLIENT_SELECTED_DISPLAY,
		type ClientSelectedEntityDisplay,
	} from "../world/selected-entity-tracking";
	import ClientHudIcon, {
		type ClientHudIconName,
	} from "./ClientHudIcon.svelte";
	import type { ClientKeyboardConfiguration } from "../../lib/input/input-contract";
	import type { InputPlatform } from "../../lib/input/input-platform";

	import { CLIENT_TUNING } from "../settings/tuning";

	interface Props {
		/** Accepted bindings keep tooltip hints current after keyboard remapping. */
		readonly input: ClientKeyboardConfiguration;
		/** Platform vocabulary matches the other client HUD shortcut hints. */
		readonly displayPlatform: InputPlatform;
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
		/** Sample the same carried-container eligibility used by inventory context actions. */
		readonly readCanAutoMerge: () => boolean;
		/** Submit the selected container through the inventory-owned command and feedback path. */
		readonly onAutoMerge: () => void;
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
		/** Chat owner supplies admission and activates the existing selected-tell editor. */
		readonly tell?: {
			readonly available: () => boolean;
			readonly activate: () => void;
		};
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
		readCanAutoMerge,
		onAutoMerge,
		readCanInvite,
		readCanAddFriend,
		readCanIgnoreAccount,
		onAddFriend,
		onIgnoreAccount,
		readCanCorpsePermission,
		onCorpsePermission,
		readCanSwear,
		tell,
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
	/** Cold action availability sampled at the selected HUD display cadence. */
	let canAutoMerge = $state(false);
	let canInvite = $state(false);
	let canAddFriend = $state(false);
	let canIgnoreAccount = $state(false);
	let canCorpsePermission = $state(false);
	let canSwear = $state(false);
	let canTell = $state(false);
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
						| "tell"
						| "salvage"
						| "auto-merge"
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
		if (canTell && tell !== undefined)
			available.push({
				action: "tell",
				label: "Tell",
				icon: "tell",
				disabled: false,
				activate: tell.activate,
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
		if (canAutoMerge)
			available.push({
				action: "auto-merge",
				label: "Auto-merge",
				icon: "inventory",
				disabled: false,
				activate: onAutoMerge,
			});

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
		// Selection identity is cold UI state; the runtime lookup must not own this effect's lifecycle.
		untrack(() => {
			display =
				guid === null ? EMPTY_CLIENT_SELECTED_DISPLAY : readSelectedDisplay();
			canSalvage = guid !== null && readCanSalvage();
			canSplit = guid !== null && readCanSplit();
			canAutoMerge = guid !== null && readCanAutoMerge();
			canInvite = guid !== null && readCanInvite();
			canAddFriend = guid !== null && readCanAddFriend();
			canIgnoreAccount = guid !== null && readCanIgnoreAccount();
			canCorpsePermission = guid !== null && readCanCorpsePermission();
			canSwear = guid !== null && readCanSwear();
			canTell = guid !== null && tell?.available() === true;
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
			canAutoMerge = selectedGuid !== null && readCanAutoMerge();
			canInvite = selectedGuid !== null && readCanInvite();
			canAddFriend = selectedGuid !== null && readCanAddFriend();
			canIgnoreAccount = selectedGuid !== null && readCanIgnoreAccount();
			canCorpsePermission = selectedGuid !== null && readCanCorpsePermission();
			canSwear = selectedGuid !== null && readCanSwear();
			canTell = selectedGuid !== null && tell?.available() === true;
		};
		const interval = window.setInterval(
			sample,
			CLIENT_TUNING.selectedEntityHud.displayIntervalMs,
		);
		return () => window.clearInterval(interval);
	});
</script>

<HudSelectedEntityBar
	selectedKey={selectedGuid}
	{displayName}
	nameColor={display.nameColor}
	{actions}
	examineLabel={examinePending ? "Examining selected entity" : "Examine"}
	examineTitle={`${examinePending ? "Examining selected entity" : "Examine"} (${presentClientBinding(input, { kind: "client", action: "examine" }, displayPlatform).description})`}
	{examinePending}
	{onExamine}
>
	{#snippet actionIcon(action: SelectedAction)}
		<ClientHudIcon name={action.icon} />
	{/snippet}
	{#snippet footer()}
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
	{/snippet}
</HudSelectedEntityBar>

<style>
	@layer components {
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
