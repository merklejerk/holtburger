<script lang="ts">
	import UiTabs from "../app/UiTabs.svelte";
	import AutoFillIcon from "../assets/icons/housing-auto-fill.svg?component";
	import { housingTypeLabel } from "./client-housing-presentation";
	import { onMount } from "svelte";
	import ItemGridCell from "../app/ItemGridCell.svelte";
	import RemovableItemCell from "../app/RemovableItemCell.svelte";
	import { startUiIconDisplay } from "../app/ui-icon-display";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import { useClientInput } from "./client-input-context";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import { CLIENT_TUNING } from "./client-tuning";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import type {
		ClientHouseCrystalState,
		HouseCrystalView,
	} from "./client-house-crystal-state";

	interface Props {
		readonly model: ClientHouseCrystalState;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		readonly onExamineItem: (item: number) => void;
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
	function handleKeydown(event: KeyboardEvent): void {
		const target =
			event.target instanceof HTMLElement
				? event.target.closest<HTMLElement>("[data-housing-requirement]")
				: null;
		if (target !== null && clientInput.shortcut("examine", event)) {
			event.preventDefault();
			const row = model
				.read()
				?.rows.find(
					(entry) =>
						entry.requirement.wcid ===
						Number(target.dataset.housingRequirement),
				);
			const item = row?.sources[0];
			if (!event.repeat && !event.isComposing && item !== undefined)
				onExamineItem(item.item);
		}
	}

	/** Markup pulls one bounded consumer snapshot, independent of scene publication. */
	let view = $state<HouseCrystalView | null>(null);
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());
	let refresh: (() => void) | null = null;
	function act(action: () => void): void {
		action();
		refresh?.();
	}
	function range(minimum: number, maximum: number): string {
		if (minimum === -1 && maximum === -1) return "No restriction";
		if (minimum === -1) return `Up to ${maximum}`;
		if (maximum === -1) return `${minimum} or higher`;
		return `${minimum}–${maximum}`;
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
	{@const crystal = current.profile.crystal}
	{#key crystal.crystal}
		<ClientHudWindow
			title={`${housingTypeLabel(crystal.houseType)} crystal`}
			icon="world"
			{placement}
			{viewport}
			{onPlacementChange}
			focusRevision={current.focusRevision}
			minWidth={CLIENT_UI_DEFAULTS.houseCrystal.minSize.width}
			minHeight={CLIENT_UI_DEFAULTS.houseCrystal.minSize.height}
			onClose={() => act(() => model.close())}
		>
			<div
				class="house-crystal-panel ui-body"
				data-house-crystal={crystal.crystal}
				use:keyboard.scope={{ nativeControls: true, keydown: handleKeydown }}
			>
				<div class="housing-content">
					<div class="housing-summary">
						<p class="housing-owner">
							{#if current.profile.ownership === "available"}Available for
								purchase
							{:else if current.profile.ownership === "character"}Owned by you · {crystal.ownerName}
							{:else if current.profile.ownership === "account"}Owned by your
								account · {crystal.ownerName}
							{:else}Owned by {crystal.ownerName}{/if}
						</p>
						{#if current.purpose === "maintenance"}
							<p>
								{crystal.maintenanceFree
									? "Maintenance is free this period."
									: crystal.maintenancePaid
										? "Maintenance is paid."
										: "Maintenance is due."}
							</p>
						{/if}
						{#if !crystal.active}<p class="ui-muted">
								This dwelling is disabled.
							</p>{/if}
					</div>
					<UiTabs
						label="Crystal information"
						tabs={[
							{
								value: "action",
								label: current.purpose === "purchase" ? "Purchase" : "Maintain",
								id: `housing-action-${crystal.crystal}`,
								panelId: `housing-action-panel-${crystal.crystal}`,
							},
							{
								value: "details",
								label: "Details",
								id: `housing-details-${crystal.crystal}`,
								panelId: `housing-details-panel-${crystal.crystal}`,
							},
						]}
						selected={current.tab}
						onSelect={(value) => act(() => model.selectTab(value))}
					/>
					{#if current.tab === "action"}
						<div
							role="tabpanel"
							tabindex="0"
							id={`housing-action-panel-${crystal.crystal}`}
							aria-labelledby={`housing-action-${crystal.crystal}`}
						>
							{#if current.purpose === "maintenance" && (crystal.maintenanceFree || crystal.maintenancePaid)}
								<p class="ui-muted">No maintenance payment is needed.</p>
							{:else}
								{#each current.rows as row (row.requirement.wcid)}
									{@const payment = row.requirement}
									{@const display =
										row.iconKey === null
											? undefined
											: displays.get(row.iconKey)}
									{@const cellIdentity =
										row.sources.length === 0
											? ({ itemGuid: null } as const)
											: ({
													itemGuid: null,
													templateWcid: payment.wcid,
												} as const)}
									<div
										class="housing-requirement-row"
										data-housing-requirement={payment.wcid}
									>
										<div
											class="housing-requirement-cell"
											data-housing-payment={crystal.crystal}
											data-housing-wcid={payment.wcid}
										>
											<RemovableItemCell
												removal={row.sources.length === 0
													? null
													: {
															label: `Remove prepared ${payment.name}`,
															disabled: !current.editable,
															onremove: () => {
																const captured = model.captureRow(payment.wcid);
																if (captured !== null)
																	act(() => model.clearRow(captured));
															},
														}}
											>
												<ItemGridCell
													{...cellIdentity}
													label={row.sources.length === 0
														? `${payment.name}. Drag payment in.`
														: `${payment.name}. Drag out or use Remove to clear prepared payment.`}
													{display}
													placeholderDisplay={display}
													equipped={false}
													selected={row.sources.length > 0}
													disabled={false}
													onselect={() => {
														const item = row.sources[0];
														if (item !== undefined) onExamineItem(item.item);
													}}
													oncontextmenu={(event) => {
														event.preventDefault();
														const item = row.sources[0];
														if (item !== undefined) onExamineItem(item.item);
													}}
												/>
											</RemovableItemCell>
										</div>
										<div class="housing-requirement-info">
											<strong>{payment.name}</strong>
											<p
												class="housing-progress"
												data-housing-progress={row.quote === null
													? payment.paid
													: row.quote.effectivePaid}
												data-housing-prepared={row.quote === null
													? 0
													: row.quote.credited}
												title={`${payment.paid.toLocaleString()} paid; ${row.quote === null ? "unquoted" : row.quote.credited.toLocaleString()} prepared`}
											>
												{(row.quote === null
													? payment.paid
													: row.quote.effectivePaid
												).toLocaleString()} / {payment.required.toLocaleString()}
											</p>
											{#if row.quote !== null && row.quote.excess > 0}<p>
													+{row.quote.excess.toLocaleString()} excess
												</p>{/if}
										</div>
										<button
											class="ui-button housing-auto-fill"
											aria-label={`Auto-fill ${payment.name}`}
											title={`Auto-fill ${payment.name}`}
											disabled={!current.editable ||
												(row.quote === null
													? payment.remaining
													: row.quote.shortfall) === 0}
											onclick={() => act(() => model.autoFill(payment.wcid))}
											><AutoFillIcon /></button
										>
									</div>
								{:else}<p class="ui-muted">No items required.</p>{/each}
								{#if current.problem !== null}<p role="status">
										{current.problem}
									</p>{/if}
							{/if}
						</div>
					{:else}
						<div
							role="tabpanel"
							tabindex="0"
							id={`housing-details-panel-${crystal.crystal}`}
							aria-labelledby={`housing-details-${crystal.crystal}`}
						>
							<section aria-label="Eligibility" class="housing-details-section">
								<h4>Eligibility</h4>
								<dl>
									<dt>Level</dt>
									<dd>{range(crystal.minLevel, crystal.maxLevel)}</dd>
									<dt>Allegiance rank</dt>
									<dd>
										{range(
											crystal.minAllegianceRank,
											crystal.maxAllegianceRank,
										)}
									</dd>
									<dt>Monarch</dt>
									<dd>
										{crystal.requiresMonarch ? "Required" : "Not required"}
									</dd>
								</dl>
							</section>
							{#each [{ name: "Purchase", payments: crystal.buy }, { name: "Maintenance", payments: crystal.rent }] as section}
								<section
									aria-label={`${section.name} requirements`}
									class="housing-details-section"
								>
									<h4>{section.name}</h4>
									{#if section.payments.length > 0}
										<table>
											<thead
												><tr
													><th scope="col">Item</th><th scope="col"
														>Paid / required</th
													></tr
												></thead
											>
											<tbody>
												{#each section.payments as payment (payment.wcid)}
													<tr
														><th scope="row">{payment.name}</th><td
															>{payment.paid.toLocaleString()} / {payment.required.toLocaleString()}</td
														></tr
													>
												{/each}
											</tbody>
										</table>
									{:else}<p class="ui-muted">No items required.</p>{/if}
								</section>
							{/each}
						</div>
					{/if}
					{#if current.paymentPending}
						<p role="status">
							Waiting for housing payment confirmation from the server.
						</p>
					{/if}
				</div>
				{#if current.tab === "action" && !(current.purpose === "maintenance" && (crystal.maintenanceFree || crystal.maintenancePaid))}
					<footer class="housing-payment-actions">
						<button
							class="ui-button housing-pay"
							disabled={!current.canPay}
							onclick={() => act(() => model.pay())}
						>
							{current.purpose === "purchase" ? "Buy house" : "Pay maintenance"}
						</button>
					</footer>
				{/if}
			</div>
		</ClientHudWindow>
	{/key}
{/if}

<style>
	@layer components {
		.house-crystal-panel {
			display: flex;
			flex-direction: column;
			height: 100%;
		}
		.housing-content {
			flex: 1;
			min-height: 0;
			overflow: auto;
		}
		h4 {
			margin: 8px 0;
		}
		p {
			margin: 6px 0;
		}
		dl {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: 4px 16px;
		}
		dd {
			margin: 0;
			text-align: right;
		}
		.housing-details-section + .housing-details-section {
			margin-top: 16px;
			border-top: 1px solid var(--ui-color-border);
			padding-top: 8px;
		}
		table {
			width: 100%;
			border-collapse: collapse;
		}
		th,
		td {
			padding: 4px 0;
			text-align: left;
		}
		thead {
			color: var(--ui-color-muted);
			border-bottom: 1px solid var(--ui-color-border);
		}
		tbody th {
			font-weight: normal;
		}
		th:last-child,
		td:last-child {
			text-align: right;
			font-variant-numeric: tabular-nums;
		}
		.housing-summary {
			margin-bottom: 12px;
		}
		.housing-requirement-row {
			display: grid;
			grid-template-columns:
				calc(var(--ui-item-cell-min-size) * var(--ui-icon-scale))
				minmax(0, 1fr) auto;
			align-items: start;
			gap: 8px;
			margin: 12px 0;
		}
		.housing-requirement-cell:global([data-inventory-drop="accepted"]) {
			outline: 2px solid var(--ui-color-accent);
		}
		.housing-requirement-cell:global([data-inventory-drop="rejected"]) {
			outline: 2px solid var(--ui-color-danger);
		}
		.housing-auto-fill {
			width: 28px;
			height: 28px;
			padding: 4px;
		}
		.housing-auto-fill :global(svg) {
			width: 100%;
			height: 100%;
		}
		.housing-payment-actions {
			display: flex;
			justify-content: flex-end;
			padding-top: 8px;
			flex-shrink: 0;
			flex-wrap: wrap;
			gap: 8px;
		}
	}
</style>
