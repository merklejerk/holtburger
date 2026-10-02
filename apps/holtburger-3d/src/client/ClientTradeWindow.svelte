<script lang="ts">
	import { onMount } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { useClientInput } from "./client-input-context";
	import ItemCellVisual from "../app/ItemCellVisual.svelte";
	import { itemCellPresentation } from "../app/item-cell-presentation";
	import { startUiIconDisplay } from "../app/ui-icon-display";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import { CLIENT_TUNING } from "./client-tuning";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import type { ClientTradeState, TradeView } from "./client-trade-state";

	interface Props {
		readonly model: ClientTradeState;
		/** Shared entity selection also covers the partner’s preview items. */
		readonly selectedGuid: number | null;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		readonly onSelectItem: (guid: number) => void;
		readonly onExamineItem: (guid: number) => void;
	}
	const {
		model,
		selectedGuid,
		placement,
		viewport,
		onPlacementChange,
		onSelectItem,
		onExamineItem,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const input = useClientInput();
	/** Offer markup and artwork refresh only at the inventory display cadence. */
	let view = $state<TradeView | null>(null);
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());
	let refresh: (() => void) | null = null;
	function act(action: () => void): void {
		action();
		refresh?.();
	}
	function keydown(event: KeyboardEvent): void {
		const cell =
			event.target instanceof Element
				? event.target.closest<HTMLButtonElement>("[data-trade-item]")
				: null;
		if (cell === null || cell.disabled || !input.shortcut("examine", event))
			return;
		event.preventDefault();
		if (!event.repeat && !event.isComposing)
			onExamineItem(Number(cell.dataset.tradeItem));
	}
	onMount(() => {
		const display = startUiIconDisplay({
			repository: model.icons,
			intervalMs: CLIENT_TUNING.inventory.displayIntervalMs,
			read: () => model.read(),
			keys: (next) => next?.iconKeys ?? [],
			publish: (next, images) => {
				view = next;
				displays = images;
			},
		});
		refresh = display.refresh;
		return () => {
			refresh = null;
			display.destroy();
		};
	});
</script>

{#if view !== null}
	{@const current = view}
	{@const transferring =
		current.trade.self_side.accepted && current.trade.partner_side.accepted}
	<ClientHudWindow
		icon="inventory"
		title={`Trade with ${current.partnerName}`}
		{placement}
		{viewport}
		{onPlacementChange}
		minWidth={CLIENT_UI_DEFAULTS.trade.minSize.width}
		minHeight={CLIENT_UI_DEFAULTS.trade.minSize.height}
		onClose={() => act(() => model.close())}
	>
		<div
			class="trade-panel"
			data-trade-panel={current.trade.partner_guid}
			use:keyboard.scope={{ nativeControls: true, keydown }}
		>
			<div class="trade-offers">
				{#each [{ name: current.partnerName, own: false, items: current.partner, accepted: current.trade.partner_side.accepted }, { name: current.ownName, own: true, items: current.own, accepted: current.trade.self_side.accepted }] as side (side.own)}
					<section
						class="trade-side"
						class:own-offer={side.own}
						data-trade-side={side.own ? "self" : "partner"}
						data-trade-accepted={side.accepted}
						aria-label={side.name}
						data-trade-offer={side.own ? current.trade.partner_guid : undefined}
						data-trade-revision={side.own ? current.trade.revision : undefined}
					>
						<header class="trade-side-heading">
							<h3 title={side.name}>{side.name}</h3>
							{#if side.own}
								<button
									type="button"
									class="trade-confirm ui-button"
									class:confirmed={current.trade.self_side.accepted}
									aria-label={current.trade.self_side.accepted
										? "Withdraw acceptance"
										: "Confirm trade"}
									aria-pressed={current.trade.self_side.accepted}
									title={current.trade.self_side.accepted
										? "Withdraw acceptance"
										: "Confirm trade"}
									disabled={current.trade.self_side.accepted
										? !current.ready || transferring
										: !current.canAccept}
									onclick={() =>
										act(() =>
											current.trade.self_side.accepted
												? model.withdraw()
												: model.accept(current.trade.revision),
										)}
								>
									<svg viewBox="0 0 32 32" aria-hidden="true">
										{#if !current.ready || transferring || current.pendingItems > 0}
											<circle class="trade-spinner" cx="16" cy="16" r="10" />
										{:else if current.trade.self_side.accepted}
											<path d="m7 16 6 6L25 10" />
										{:else}
											<path d="M27 16H5M14 7l-9 9 9 9" />
										{/if}
									</svg>
									{!current.ready
										? "Updating"
										: transferring
											? "Trading"
											: current.pendingItems > 0
												? "Adding"
												: current.trade.self_side.accepted
													? "Ready"
													: "Confirm"}
								</button>
							{:else}
								<span
									class="trade-acceptance"
									role="status"
									aria-label={side.accepted
										? "Offer confirmed"
										: "Offer not confirmed"}
									title={side.accepted
										? "Offer confirmed"
										: "Offer not confirmed"}
								>
									{side.accepted ? "Accepted" : "Reviewing"}
									<svg viewBox="0 0 32 32" aria-hidden="true">
										<path d="M5 16h22M18 7l9 9-9 9" />
									</svg>
								</span>
							{/if}
						</header>
						<div class="trade-grid" class:empty={side.items.length === 0}>
							{#if side.items.length === 0}
								<p class="trade-placeholder">
									{side.own ? "Drop items" : "No items offered"}
								</p>
							{/if}
							{#each side.items as cell (cell.guid)}
								{@const label = `${cell.name}${cell.count > 1 ? ` ×${cell.count.toLocaleString()}` : ""}. E or right-click to inspect.`}
								<button
									type="button"
									class="trade-cell ui-item-cell ui-item-selection ui-hud-button"
									data-trade-item={cell.guid}
									aria-pressed={selectedGuid === cell.guid}
									aria-label={label}
									title={label}
									disabled={!cell.described || !current.ready}
									onclick={() => onSelectItem(cell.guid)}
									ondblclick={() => onExamineItem(cell.guid)}
									oncontextmenu={(event) => {
										event.preventDefault();
										onExamineItem(cell.guid);
									}}
								>
									<ItemCellVisual
										display={cell.iconKey === null
											? undefined
											: displays.get(cell.iconKey)}
										name={cell.name}
										presentation={itemCellPresentation({
											label: cell.name,
											count: cell.count,
											equipped: false,
											structure: null,
											capacity: null,
										})}
										tooltipLabel={label}
									/>
								</button>
							{/each}
						</div>
					</section>
				{/each}
			</div>
			<div class="trade-reset-notch">
				<button
					type="button"
					class="trade-reset ui-button"
					aria-label="Reset offers"
					title="Reset both offers"
					disabled={!current.ready || transferring}
					onclick={() => act(() => model.reset())}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path d="M5 8a8 8 0 1 1-1 7M5 3v5h5" /></svg
					>
				</button>
			</div>
		</div>
	</ClientHudWindow>
{/if}

<style>
	@layer components {
		.trade-panel {
			position: relative;
			height: 100%;
			min-height: 0;
			padding: var(--ui-trade-inset);
		}
		.trade-offers {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: var(--ui-trade-side-gap);
			height: 100%;
			min-height: 0;
		}
		.trade-side {
			--offer-color: var(--ui-trade-partner-color);
			--offer-background: var(--ui-trade-partner-background);
			--offer-header-background: var(--ui-trade-partner-header-background);
			border: var(--ui-trade-border-width) solid var(--offer-color);
			border-top-width: var(--ui-trade-header-border-width);
			background: var(--offer-background);
			display: flex;
			flex-direction: column;
			min-height: 0;
			min-width: 0;
		}
		.own-offer {
			--offer-color: var(--ui-trade-self-color);
			--offer-background: var(--ui-trade-self-background);
			--offer-header-background: var(--ui-trade-self-header-background);
		}
		.trade-side-heading {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--ui-trade-control-gap);
			flex-wrap: wrap;
			min-height: var(--ui-trade-header-min-height);
			padding: var(--ui-trade-content-inset);
			background: var(--offer-header-background);
			color: var(--offer-color);
		}
		.own-offer .trade-side-heading {
			flex-direction: row-reverse;
		}
		.own-offer h3 {
			text-align: right;
		}
		h3 {
			margin: 0;
			font-size: inherit;
			font-weight: var(--ui-trade-name-weight);
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		svg {
			fill: none;
			stroke: currentColor;
			stroke-width: 2;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
		.trade-acceptance {
			display: flex;
			align-items: center;
			gap: var(--ui-trade-control-gap);
			font-size: var(--ui-trade-status-font-size);
			color: var(--ui-trade-reviewing-color);
		}
		.trade-acceptance svg {
			width: var(--ui-trade-icon-size);
			height: var(--ui-trade-icon-size);
		}
		.trade-side:global([data-trade-accepted="true"]) .trade-acceptance {
			color: var(--ui-trade-accepted-color);
		}

		.trade-grid {
			flex: 1;
			display: grid;
			grid-template-columns: repeat(
				auto-fill,
				minmax(var(--ui-item-cell-min-size), 1fr)
			);
			align-content: start;
			gap: var(--ui-trade-grid-gap);
			overflow: auto;
			min-height: 0;
			padding: var(--ui-trade-content-inset);
			margin-bottom: max(
				0px,
				calc(
					var(--ui-trade-reset-size) + var(--ui-trade-reset-inset) -
						var(--ui-trade-inset)
				)
			);
		}
		.trade-grid.empty {
			grid-template-columns: minmax(0, 1fr);
			align-content: center;
			justify-items: center;
		}
		.trade-cell {
			aspect-ratio: 1;
			min-width: 0;
			padding: var(--ui-item-cell-padding);
			position: relative;
			overflow: hidden;
		}
		.trade-placeholder {
			color: var(--ui-trade-reviewing-color);
			text-align: center;
			margin: 0;
		}
		.trade-confirm {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: var(--ui-trade-control-gap);
			padding: 4px 6px;
			min-height: 30px;
			font-size: var(--ui-trade-status-font-size);
			white-space: nowrap;
		}
		.trade-confirm svg {
			width: var(--ui-trade-icon-size);
			height: var(--ui-trade-icon-size);
		}
		.trade-confirm.confirmed {
			color: var(--ui-button-color, var(--ui-trade-accepted-color));
			border-color: var(
				--ui-button-border-color,
				var(--ui-trade-accepted-color)
			);
		}
		/* Shared Reset overlaps both wells; reserved grid space keeps offered items reachable. */
		.trade-reset-notch {
			position: absolute;
			bottom: 0;
			left: 50%;
			transform: translateX(-50%);
			width: calc(var(--ui-trade-reset-size) + 2 * var(--ui-trade-reset-inset));
			height: calc(
				var(--ui-trade-reset-size) + 2 * var(--ui-trade-reset-inset)
			);
			padding: var(--ui-trade-reset-inset);
			background: var(--ui-trade-reset-background);
			border-radius: 50%;
		}
		.trade-reset {
			display: grid;
			place-items: center;
			width: var(--ui-trade-reset-size);
			height: var(--ui-trade-reset-size);
			min-height: var(--ui-trade-reset-size);
			padding: 4px;
			border-radius: 50%;
		}

		.trade-reset svg {
			width: var(--ui-trade-icon-size);
			height: var(--ui-trade-icon-size);
		}
		.trade-spinner {
			stroke-dasharray: 44 19;
			transform-origin: center;
			animation: trade-wait 1s linear infinite;
		}

		@keyframes trade-wait {
			to {
				transform: rotate(360deg);
			}
		}
		@media (prefers-reduced-motion: reduce) {
			.trade-spinner {
				animation: none;
			}
		}
		.trade-side:global([data-inventory-drop="accepted"]) {
			outline: 2px solid var(--ui-color-highlight);
		}
		.trade-side:global([data-inventory-drop="rejected"]) {
			outline: 2px solid var(--ui-color-danger);
		}
	}
</style>
