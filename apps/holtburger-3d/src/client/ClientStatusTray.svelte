<script lang="ts">
	import { hudAttention } from "./client-hud-attention";
	import type { EnchantmentTrayPresentation } from "./client-enchantments-view";
	import { untrack } from "svelte";
	import { presentClientBurden } from "./client-burden-presentation";
	import type { ClientInventoryState } from "./client-inventory-state";
	import { CLIENT_TUNING } from "./client-tuning";
	import ClientHudTray from "./ClientHudTray.svelte";
	import ClientHudIcon, {
		type ClientHudIconName,
	} from "./ClientHudIcon.svelte";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";

	interface Props {
		/** Saved position and long-axis orientation of the fixed-size tray. */
		readonly placement: ClientHudPlacement;
		readonly editable: boolean;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		/** Visibility and change identities for effective ordinary spells and the vitae penalty. */
		readonly enchantments: EnchantmentTrayPresentation;
		/** Session owner supplies world burden even while Inventory is closed. */
		readonly inventory: ClientInventoryState | null;
		readonly onOpenInventory: () => void;
		readonly onOpenEnchantments: (kind: "beneficial" | "harmful") => void;
	}

	const {
		placement,
		editable,
		viewport,
		onPlacementChange,
		enchantments,
		onOpenEnchantments,
		inventory,
		onOpenInventory,
	}: Props = $props();
	/** Only the bounded warning display enters the reactive graph. */
	let burden = $state<number | null>(null);
	const burdenPresentation = $derived(presentClientBurden(burden));
	$effect(() => {
		const owner = inventory;
		const sample = () => {
			burden = owner?.readBurden() ?? null;
		};
		// The initial display read must not make producer facts own the timer lifetime.
		untrack(sample);
		if (owner === null) return;
		const timer = setInterval(
			sample,
			CLIENT_TUNING.inventory.displayIntervalMs,
		);
		return () => clearInterval(timer);
	});
	const statuses = $derived<
		readonly {
			name: ClientHudIconName;
			label: string;
			kind: "beneficial" | "harmful";
			/** Category-local registry identity used only to restart its pulse. */
			identity: string;
		}[]
	>([
		...(enchantments.beneficial.visible
			? [
					{
						name: "buffed" as const,
						label: "Beneficial enchantments",
						kind: "beneficial" as const,
						identity: enchantments.beneficial.identity,
					},
				]
			: []),
		...(enchantments.harmful.visible
			? [
					{
						name: "debuffed" as const,
						label: "Harmful enchantments",
						kind: "harmful" as const,
						identity: enchantments.harmful.identity,
					},
				]
			: []),
	]);
</script>

{#if editable || statuses.length > 0 || burdenPresentation.warning !== null}
	<ClientHudTray
		label="Status tray"
		{placement}
		{editable}
		{viewport}
		{onPlacementChange}
	>
		{#each statuses as status (status.kind)}
			<button
				type="button"
				class="status-icon ui-hud-button"
				use:hudAttention={status.identity}
				title={status.label}
				aria-label={status.label}
				onclick={() => onOpenEnchantments(status.kind)}
			>
				<ClientHudIcon name={status.name} />
			</button>
		{/each}
		{#if burdenPresentation.warning !== null}
			<button
				type="button"
				class="status-icon burden-icon ui-hud-button"
				use:hudAttention={burdenPresentation.level}
				data-level={burdenPresentation.level}
				title={burdenPresentation.warning.tooltip}
				aria-label={`${burdenPresentation.warning.label} — ${burdenPresentation.percent} burden. Open Inventory`}
				onclick={onOpenInventory}
			>
				<ClientHudIcon name="encumbered" />
				{#if burdenPresentation.level === "overburdened"}
					<span class="burden-severity" aria-hidden="true">!</span>
				{/if}
			</button>
		{/if}
	</ClientHudTray>
{/if}

<style>
	@layer components {
		.burden-icon {
			position: relative;
			color: var(--ui-color-warning);
		}
		.burden-icon[data-level="overburdened"] {
			color: var(--ui-color-danger);
		}
		.burden-severity {
			position: absolute;
			right: 2px;
			top: 0;
			font-weight: 700;
			font-size: calc(var(--ui-status-badge-font-size) * var(--ui-icon-scale));
		}
		.status-icon {
			box-sizing: border-box;
			flex: 0 0 calc(32px * var(--ui-icon-scale));
			width: calc(32px * var(--ui-icon-scale));
			height: calc(32px * var(--ui-icon-scale));
			pointer-events: auto;
		}
	}
</style>
