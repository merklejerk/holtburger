<script lang="ts">
	import { onMount, tick } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { useClientInput } from "./client-input-context";
	import ItemCellVisual from "../app/ItemCellVisual.svelte";
	import UiIcon from "../app/UiIcon.svelte";
	import { itemCellPresentation } from "../app/item-cell-presentation";
	import { startUiIconDisplay } from "../app/ui-icon-display";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import ClientQuantityDialog from "./ClientQuantityDialog.svelte";
	import ClientVendorCurrencyAmount from "./ClientVendorCurrencyAmount.svelte";
	import { CLIENT_TUNING } from "./client-tuning";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import type { ClientVendorState, VendorView } from "./client-vendor-state";

	interface Props {
		readonly model: ClientVendorState;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		readonly onExamineItem: (guid: number) => void;
	}
	const {
		model,
		placement,
		viewport,
		onPlacementChange,
		onExamineItem,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const clientInput = useClientInput();
	const pyreals = { wcid: 273, name: "Pyreals" } as const;
	/** Bounded display sampling owns artwork and markup; core owns execution. */
	let view = $state<VendorView | null>(null);
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());
	let selected = $state<number | null>(null);
	let panel = $state<HTMLDivElement>();
	let refresh: (() => void) | null = null;
	const locked = $derived(
		view !== null && (view.pending || view.phase !== null),
	);
	function act(action: () => void): void {
		action();
		refresh?.();
	}
	function cancelQuantity(item: number): void {
		act(() => model.cancelBuyQuantity());
		void tick().then(() =>
			panel
				?.querySelector<HTMLButtonElement>(`[data-vendor-offer="${item}"]`)
				?.focus(),
		);
	}
	function handleVendorKeydown(event: KeyboardEvent): void {
		const target = event.target instanceof HTMLElement ? event.target : null;
		const queued =
			target?.closest<HTMLButtonElement>("[data-vendor-queued-item]") ?? null;
		const offer =
			target?.closest<HTMLButtonElement>("[data-vendor-offer]") ?? null;
		if (queued !== null && event.key === "Enter") {
			event.preventDefault();
			if (event.repeat || event.isComposing || queued.disabled) return;
			selected = Number(queued.dataset.vendorQueuedItem);
			return;
		}
		if (
			view?.quantityRequest === null &&
			clientInput.shortcut("examine", event)
		) {
			let guid: number | null = null;
			if (offer !== null && !offer.disabled)
				guid = Number(offer.dataset.vendorOffer);
			else if (queued !== null && !queued.disabled)
				guid = Number(queued.dataset.vendorQueuedItem);
			else if (
				offer === null &&
				queued === null &&
				selected !== null &&
				view.queue.some((cell) => cell.sources[0] === selected)
			)
				guid = selected;
			if (guid !== null) {
				event.preventDefault();
				if (!event.repeat && !event.isComposing) onExamineItem(guid);
				return;
			}
		}
		if (offer === null || offer.disabled || event.key !== "Enter") return;
		event.preventDefault();
		if (
			event.repeat ||
			event.isComposing ||
			event.shiftKey ||
			event.ctrlKey ||
			event.altKey ||
			event.metaKey
		)
			return;
		const guid = Number(offer.dataset.vendorOffer);
		act(() => model.queueBuy(guid));
	}
	function presentation(name: string, count: number) {
		return itemCellPresentation({
			label: name,
			count,
			equipped: false,
			structure: null,
			capacity: null,
		});
	}
	function currencyDisplay(
		current: VendorView,
		wcid: number,
	): UiIconDisplay | undefined {
		const key = current.currencyIconKeys.get(wcid);
		return key === undefined ? undefined : displays.get(key);
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
	{@const availableCurrency = current.quote?.currencies.find(
		(currency) => currency.wcid === current.currency.wcid,
	)?.projected}
	{#key current.vendor}
		<ClientHudWindow
			icon="inventory"
			title={current.name}
			{placement}
			{viewport}
			{onPlacementChange}
			minWidth={CLIENT_UI_DEFAULTS.vendor.minSize.width}
			minHeight={CLIENT_UI_DEFAULTS.vendor.minSize.height}
			onClose={() => act(() => model.close())}
		>
			<div
				bind:this={panel}
				class="vendor-panel"
				data-vendor-panel={current.vendor}
				use:keyboard.scope={{
					nativeControls: true,
					keydown: handleVendorKeydown,
				}}
			>
				<div class="vendor-content" inert={current.quantityRequest !== null}>
					<div class="vendor-catalog">
						{#each current.sections as section (section.name)}
							<section aria-label={section.name}>
								<h3>{section.name}</h3>
								<div class="vendor-list">
									{#each section.cells as cell (cell.offer.guid)}
										{@const offer = cell.offer}
										{@const price =
											offer.price.kind === "quoted"
												? `${offer.price.amount.toLocaleString()} ${current.currency.name} for ${offer.price.quantity.toLocaleString()}`
												: offer.price.reason}
										{@const unaffordable =
											offer.price.kind === "quoted" &&
											availableCurrency !== undefined &&
											offer.price.amount > availableCurrency}
										{@const label = `${cell.name} — ${price}; stock: ${offer.supply === null ? "unlimited" : offer.supply.toLocaleString()}.${unaffordable ? ` Not enough ${current.currency.name} for this offer.` : ""} Double-click or Enter to ${offer.stackable ? "choose a buying quantity" : "buy"}; E or right-click to inspect.`}
										<button
											type="button"
											class="vendor-offer-row ui-item-selection"
											data-vendor-offer={offer.guid}
											data-vendor-guid={current.vendor}
											aria-label={label}
											title={label}
											aria-pressed={selected === offer.guid}
											disabled={locked || offer.supply === 0}
											onclick={() => (selected = offer.guid)}
											ondblclick={() => act(() => model.queueBuy(offer.guid))}
											oncontextmenu={(event) => {
												event.preventDefault();
												onExamineItem(offer.guid);
											}}
										>
											<span class="offer-icon"
												><UiIcon
													display={displays.get(cell.iconKey)}
													name={cell.name}
													tooltipLabel={label}
												/></span
											>
											<span class="offer-name"
												>{cell.name}{#if offer.stack_count > 1}
													<span class="offer-count"
														>×{offer.stack_count.toLocaleString()}</span
													>
												{/if}</span
											>
											<span class="offer-price" class:unaffordable>
												{#if offer.price.kind === "quoted"}
													<ClientVendorCurrencyAmount
														name={current.currency.name}
														display={currencyDisplay(
															current,
															current.currency.wcid,
														)}
														amount={offer.price.amount}
													/>
												{:else}Unavailable{/if}
											</span>
										</button>
									{/each}
								</div>
							</section>
						{/each}
						{#if current.sections.length === 0}<p>No items for sale.</p>{/if}
					</div>
					<div
						class="vendor-currencies"
						aria-label="Currency balances"
						aria-live="polite"
					>
						<div class="vendor-currency-list">
							{#if current.quote === null}<span
									>{current.problem ?? "Loading balances…"}</span
								>
							{:else}
								{#each current.quote.currencies as currency (currency.wcid)}
									<ClientVendorCurrencyAmount
										name={currency.name}
										display={currencyDisplay(current, currency.wcid)}
										amount={currency.current}
										projected={current.queue.length > 0
											? currency.projected
											: undefined}
									/>
								{/each}
								{#if current.pending}<span>Updating…</span>{/if}
							{/if}
						</div>
					</div>
					<div
						class="vendor-queue"
						data-vendor-queue={current.vendor}
						aria-label="Queued vendor trade"
					>
						{#if current.queue.length === 0}<p class="queue-placeholder">
								Drag items here to buy or sell
							</p>{/if}
						{#each ["buy", "sell"] as side}
							{@const cells = current.queue.filter(
								(cell) => cell.side === side,
							)}
							{@const currency = side === "buy" ? current.currency : pyreals}
							{#if cells.length > 0}
								<section
									class="queue-group"
									class:buy={side === "buy"}
									class:sell={side === "sell"}
								>
									<h3 class="queue-heading">
										{side === "buy" ? "Buying for" : "Selling for"}
										<ClientVendorCurrencyAmount
											name={currency.name}
											display={currencyDisplay(current, currency.wcid)}
											amount={cells.reduce((sum, cell) => sum + cell.total, 0)}
										/>
									</h3>
									<div class="queue-grid">
										{#each cells as cell (cell.key)}
											{@const label = `${cell.name}: ${cell.amount.toLocaleString()}, ${cell.total.toLocaleString()} ${currency.name}. Click to select; E or right-click to inspect.`}
											<div class="queue-entry">
												<button
													type="button"
													class="vendor-cell ui-item-cell ui-item-selection ui-hud-button"
													data-vendor-queued-item={cell.sources[0]}
													aria-label={label}
													title={label}
													aria-pressed={selected === cell.sources[0]}
													onclick={() => (selected = cell.sources[0])}
													oncontextmenu={(event) => {
														event.preventDefault();
														selected = cell.sources[0];
														onExamineItem(cell.sources[0]);
													}}
												>
													<ItemCellVisual
														display={displays.get(cell.iconKey)}
														name={cell.name}
														presentation={presentation(cell.name, cell.amount)}
														tooltipLabel={label}
													/>
												</button>
												<button
													type="button"
													class="queue-remove"
													aria-label={`Remove ${cell.name} from ${side === "buy" ? "buying" : "selling"} queue`}
													title={`Remove ${cell.name}`}
													disabled={locked}
													onclick={() => act(() => model.remove(cell))}
													>×</button
												>
											</div>
										{/each}
									</div>
								</section>
							{/if}
						{/each}
					</div>
					{#if current.problem !== null && current.quote !== null}<p
							class="vendor-problem"
							role="status"
						>
							{current.problem}
						</p>{/if}
					<div class="vendor-footer">
						<button
							class="ui-button"
							type="button"
							disabled={locked || current.queue.length === 0}
							onclick={() => act(() => model.clear())}>Clear</button
						>
						<button
							class="ui-button trade-button"
							type="button"
							disabled={!current.canTrade}
							onclick={() => act(() => model.trade())}
						>
							{current.phase === "selling"
								? "Selling…"
								: current.phase === "buying"
									? "Buying…"
									: "Trade"}
						</button>
					</div>
				</div>
				{#if current.quantityRequest !== null}
					{@const request = current.quantityRequest}
					<ClientQuantityDialog
						purpose="buy"
						{request}
						onSubmit={(amount) =>
							act(() => model.confirmBuyQuantity(request.item, amount))}
						onCancel={() => cancelQuantity(request.item)}
					/>
				{/if}
			</div>
		</ClientHudWindow>
	{/key}
{/if}

<style>
	@layer components {
		.vendor-panel {
			position: relative;
			height: 100%;
		}
		.vendor-content {
			display: flex;
			flex-direction: column;
			height: 100%;
			min-height: 0;
			gap: 8px;
		}
		.vendor-catalog {
			flex: 1;
			min-height: 0;
			overflow: auto;
			scrollbar-gutter: stable;
			padding: var(--ui-vendor-inset);
		}
		h3 {
			margin: 0 0 5px;
			font-size: inherit;
		}
		.vendor-catalog section + section {
			margin-top: var(--ui-inventory-section-gap);
		}
		.vendor-list {
			display: grid;
			gap: var(--ui-vendor-offer-row-gap);
		}
		.vendor-offer-row {
			display: grid;
			grid-template-columns:
				var(--ui-vendor-offer-icon-size) minmax(0, 1fr)
				auto;
			align-items: center;
			gap: var(--ui-vendor-offer-column-gap);
			width: 100%;
			min-width: 0;
			padding: var(--ui-vendor-offer-padding);
			border: 1px solid transparent;
			background: var(--ui-vendor-offer-background);
			color: var(--ui-color-text);
			font: inherit;
			text-align: left;
			cursor: pointer;
			user-select: none;
		}
		.vendor-offer-row:hover:not(:disabled) {
			border-color: var(--ui-color-border);
		}
		.vendor-offer-row:disabled {
			color: var(--ui-color-muted);
			cursor: not-allowed;
		}
		.offer-icon {
			width: var(--ui-vendor-offer-icon-size);
			height: var(--ui-vendor-offer-icon-size);
			min-width: 0;
			overflow: hidden;
		}
		.offer-name {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.offer-count {
			margin-left: 5px;
			color: var(--ui-color-muted);
		}
		.offer-price {
			font-variant-numeric: tabular-nums;
			white-space: nowrap;
		}
		.offer-price.unaffordable {
			color: var(--ui-color-danger);
		}
		.vendor-cell {
			position: relative;
			aspect-ratio: 1;
			width: 100%;
			min-width: 0;
			padding: var(--ui-item-cell-padding);
			overflow: hidden;
			user-select: none;
		}
		.vendor-currencies {
			flex: none;
			overflow-x: auto;
			border-top: 1px solid var(--ui-color-border);
			margin: 0 var(--ui-vendor-inset);
			padding: 8px 0 0;
		}
		.vendor-currency-list {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			gap: 12px;
			width: max-content;
			min-width: 100%;
			white-space: nowrap;
		}
		.vendor-problem {
			color: var(--ui-color-warning);
		}
		.vendor-queue {
			display: flex;
			gap: 6px;
			flex: 0 1 auto;
			max-height: 35%;
			min-height: 48px;
			overflow: auto;
			padding: 0 var(--ui-vendor-inset);
		}
		.queue-placeholder {
			width: 100%;
			margin: 0;
			padding: 12px;
			border: 1px dashed var(--ui-color-border);
			text-align: center;
		}
		.queue-group {
			flex: 1 1 0;
			min-width: 0;
			padding: 5px;
			border: 1px solid;
			border-radius: 3px;
		}
		.queue-heading {
			display: flex;
			align-items: center;
			gap: 4px;
		}
		.buy,
		.buy .vendor-cell {
			border-color: var(--ui-vendor-buy-color);
		}
		.sell,
		.sell .vendor-cell {
			border-color: var(--ui-vendor-sell-color);
		}
		.queue-grid {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
		}
		.queue-entry {
			position: relative;
			width: var(--ui-item-cell-min-size);
		}
		.queue-remove {
			position: absolute;
			top: -4px;
			right: -4px;
			z-index: 1;
			display: grid;
			place-items: center;
			width: 20px;
			height: 20px;
			padding: 0;
			border: 1px solid var(--ui-color-border);
			border-radius: 50%;
			background: color-mix(in srgb, var(--ui-color-shadow) 85%, transparent);
			color: var(--ui-color-text);
			font-size: 15px;
			font-weight: bold;
			line-height: 1;
			cursor: pointer;
			opacity: 0;
			pointer-events: none;
		}
		.queue-entry:hover .queue-remove,
		.queue-entry:focus-within .queue-remove {
			opacity: 1;
			pointer-events: auto;
		}
		.queue-remove:hover:not(:disabled),
		.queue-remove:focus-visible {
			color: var(--ui-color-highlight);
			border-color: currentColor;
		}
		.queue-remove:focus-visible {
			outline: 2px solid var(--ui-color-focus);
		}
		.queue-remove:disabled {
			color: var(--ui-color-muted);
			cursor: not-allowed;
		}
		.vendor-footer {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
			flex: none;
			padding: 0 var(--ui-vendor-inset) var(--ui-vendor-inset);
		}
		.vendor-problem {
			margin: 0;
		}
		.vendor-queue:global([data-inventory-drop="accepted"]) {
			outline: 2px solid var(--ui-color-success);
		}
		.vendor-queue:global([data-inventory-drop="rejected"]) {
			outline: 2px solid var(--ui-color-warning);
		}
	}
</style>
