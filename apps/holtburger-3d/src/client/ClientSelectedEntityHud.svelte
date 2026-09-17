<script lang="ts">
	import { onMount, untrack } from "svelte";
	import { formatQuantity } from "../app/quantity-format";
	import { itemStructureDisplay } from "../app/item-structure";

	import {
		EMPTY_CLIENT_SELECTED_DISPLAY,
		type ClientSelectedEntityDisplay,
	} from "./client-selected-entity-tracking";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		/** Cold selection identity controlling whether the runtime surface is present. */
		readonly selectedGuid: number | null;
		/** Bounded display read kept separate from frame-hot target projection. */
		readonly readSelectedDisplay: () => ClientSelectedEntityDisplay;
		/** Bounded inventory-owned eligibility read sampled with the selected display. */
		readonly readCanSplit: () => boolean;
		/** Forward the button edge to the session-owned interaction controller. */
		readonly onInteract: () => void;
		/** Open the inventory-owned split flow for the selected stack. */
		readonly onSplit: (source: HTMLButtonElement) => void;
	}

	const {
		selectedGuid,
		readSelectedDisplay,
		readCanSplit,
		onInteract,
		onSplit,
	}: Props = $props();
	let display = $state<ClientSelectedEntityDisplay>(
		EMPTY_CLIENT_SELECTED_DISPLAY,
	);
	let canSplit = $state(false);
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
			canSplit = guid !== null && readCanSplit();
		});
	});

	onMount(() => {
		const sample = (): void => {
			display =
				selectedGuid === null
					? EMPTY_CLIENT_SELECTED_DISPLAY
					: readSelectedDisplay();
			canSplit = selectedGuid !== null && readCanSplit();
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
		<div class="selected-entity__actions">
			<button
				class="ui-hud-button"
				type="button"
				disabled={!display.canInteract}
				onclick={onInteract}
				aria-label="Interact"
			>
				<ClientHudIcon name="interact" />
			</button>
			{#if canSplit}<button
					class="ui-hud-button"
					type="button"
					onclick={(event) => onSplit(event.currentTarget)}
					aria-label="Split stack"
				>
					<ClientHudIcon name="split" />
				</button>{/if}
		</div>
		<strong title={displayName} style:color={display.nameColor}
			><span>{displayName}</span></strong
		>
		<button
			class="ui-hud-button"
			type="button"
			disabled
			aria-label="Examine (not yet available)"
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
		.selected-entity__actions {
			display: flex;
			gap: 4px;
		}
		.selected-entity__heading strong {
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
