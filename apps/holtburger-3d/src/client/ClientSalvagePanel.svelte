<script lang="ts">
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { useClientInput } from "./client-input-context";
	import ItemCellVisual from "../app/ItemCellVisual.svelte";
	import ItemQueueCell from "../app/ItemQueueCell.svelte";
	import { itemCellPresentation } from "../app/item-cell-presentation";
	import { startUiIconDisplay } from "../app/ui-icon-display";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { ClientSalvageState, SalvageView } from "./client-salvage-state";
	import type { ClientInventoryState } from "./client-inventory-state";
	import { CLIENT_TUNING } from "./client-tuning";

	interface Props {
		readonly model: ClientSalvageState;
		readonly inventory: ClientInventoryState;
		readonly visible: boolean;
		readonly selectedGuid: number | null;
		readonly onSelectItem: (guid: number) => void;
		readonly onExamineItem: (guid: number) => void;
	}
	const {
		model,
		inventory,
		visible,
		selectedGuid,
		onSelectItem,
		onExamineItem,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const input = useClientInput();
	let view = $state<SalvageView | null>(null);
	let items = $state<ReturnType<ClientInventoryState["readItems"]> | null>(
		null,
	);
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());
	let refresh: (() => void) | null = null;
	$effect(() => {
		if (!visible) {
			view = null;
			items = null;
			return;
		}
		const display = startUiIconDisplay({
			repository: inventory.icons,
			intervalMs: CLIENT_TUNING.inventory.displayIntervalMs,
			read: () => ({ draft: model.read(), items: inventory.readItems() }),
			keys: (snapshot) =>
				(snapshot.draft?.items ?? []).flatMap((guid) => {
					const key = snapshot.items.iconKeys.get(guid);
					return key === undefined ? [] : [key];
				}),
			publish: (snapshot, images) => {
				view = snapshot.draft;
				items = snapshot.items;
				displays = images;
			},
		});
		refresh = display.refresh;
		return () => {
			refresh = null;
			display.destroy();
		};
	});
	function act(action: () => void): void {
		action();
		refresh?.();
	}
	function keydown(event: KeyboardEvent): void {
		if (!input.shortcut("examine", event)) return;
		const target =
			event.target instanceof Element
				? event.target.closest<HTMLElement>("[data-salvage-item]")
				: null;
		const item =
			target === null ? selectedGuid : Number(target.dataset.salvageItem);
		if (item === null || !view?.items.includes(item)) return;
		event.preventDefault();
		if (!event.repeat && !event.isComposing) onExamineItem(item);
	}
</script>

{#if view !== null}
	<div
		class="salvage-panel ui-body"
		data-salvage-panel
		use:keyboard.scope={{ nativeControls: true, keydown }}
	>
		<section class="salvage-input" aria-label="Items to salvage">
			<h3 class="ui-section-heading">Items to salvage</h3>
			<div
				class="salvage-queue"
				class:empty={view.items.length === 0}
				data-salvage-queue
				aria-label="Queued salvage items"
				aria-busy={view.pending}
			>
				{#if view.items.length === 0}<p class="queue-placeholder ui-muted">
						Drag items here to salvage
					</p>{/if}
				{#each view.items as guid (guid)}
					{@const item = items?.items.get(guid)}
					{@const description =
						item?.description.kind === "known" ? item.description : null}
					{@const name = description?.name ?? "Loading item"}
					{@const iconKey = items?.iconKeys.get(guid)}
					{@const presentation = itemCellPresentation({
						label: name,
						count: description?.stackCount ?? null,
						equipped: false,
						structure: description?.structure ?? null,
						capacity: null,
					})}
					{@const needsDetails =
						view.evaluation.kind === "pending-details" &&
						view.evaluation.items.includes(guid)}
					{@const failure = view.appraisalFailures.find(
						(failure) => failure.guid === guid,
					)}
					{@const label = `${presentation.label}. ${failure !== undefined ? `${failure.reason} Use Retry to load salvage details.` : needsDetails ? "Loading salvage details automatically." : "Right-click or Examine to inspect. Drag out of the queue to remove."}`}
					<ItemQueueCell
						type="button"
						removeLabel={`Remove ${name} from salvage queue`}
						removalDisabled={view.locked}
						onremove={() => act(() => model.remove(guid))}
						data-salvage-item={guid}
						data-salvage-pending-details={needsDetails}
						aria-pressed={selectedGuid === guid}
						aria-label={label}
						title={label}
						onclick={() => onSelectItem(guid)}
						ondblclick={() => onExamineItem(guid)}
						oncontextmenu={(event) => {
							event.preventDefault();
							onExamineItem(guid);
						}}
					>
						<ItemCellVisual
							display={iconKey === undefined
								? undefined
								: displays.get(iconKey)}
							{name}
							{presentation}
							tooltipLabel={label}
						/>
						{#if needsDetails}<span
								class="salvage-details ui-hud-group"
								aria-hidden="true">{failure === undefined ? "…" : "!"}</span
							>{/if}
					</ItemQueueCell>
				{/each}
			</div>
		</section>
		<section class="salvage-output" aria-label="Estimated salvage output">
			<h3 class="ui-section-heading">Estimated output</h3>
			<div class="salvage-output-content">
				{#if view.pending}<p role="status">Updating estimate…</p>
				{:else if view.evaluation.kind === "pending-details"}
					{#if view.appraisalFailures.length === 0}
						<p role="status">Calculating salvage output…</p>
					{:else}
						<div class="salvage-appraisal-failures" role="status">
							{#each view.appraisalFailures as failure (failure.guid)}
								{@const item = items?.items.get(failure.guid)}
								{@const name =
									item?.description.kind === "known"
										? item.description.name
										: "Queued item"}
								<p>{name}: {failure.reason}</p>
							{/each}
							<button
								type="button"
								class="ui-button"
								aria-label="Retry salvage appraisal"
								disabled={view.locked}
								onclick={() => act(() => model.retryDetails())}>Retry</button
							>
						</div>
					{/if}
				{:else if view.evaluation.kind === "rejected"}<p role="status">
						{view.evaluation.reason}
					</p>
				{:else if view.evaluation.bags.length === 0}<p>No items queued.</p>
				{:else}
					<table>
						<thead
							><tr><th>Material</th><th>Units</th><th>Workmanship</th></tr
							></thead
						>
						<tbody
							>{#each view.evaluation.bags as bag}<tr
									><td
										>{bag.materialType.replace(/([a-z])([A-Z])/g, "$1 $2")}</td
									><td>{bag.units}</td><td>{bag.workmanship.toFixed(2)}</td></tr
								>{/each}</tbody
						>
					</table>
				{/if}
			</div>
		</section>
		<footer class="salvage-actions">
			{#if view.problem !== null}<p role="status">{view.problem}</p>{/if}
			<div class="salvage-footer">
				<button
					type="button"
					class="ui-button"
					disabled={view.locked || view.items.length === 0}
					onclick={() => act(() => model.clear())}>Clear</button
				>
				<button
					type="button"
					class="ui-button"
					disabled={!view.canSalvage}
					onclick={() => act(() => model.confirm())}
				>
					{view.locked && model.question() === null ? "Submitting…" : "Salvage"}
				</button>
			</div>
		</footer>
	</div>
{/if}

<style>
	@layer components {
		.salvage-panel {
			display: flex;
			flex-direction: column;
			gap: 14px;
			height: 100%;
			min-height: 0;
		}
		p {
			margin: 0;
		}
		.salvage-input {
			display: flex;
			flex-direction: column;
			flex: 1;
			min-height: 64px;
		}
		.salvage-queue {
			display: flex;
			flex-wrap: wrap;
			align-content: start;
			gap: 4px;
			min-height: 0;
			overflow: auto;
			padding: 4px;
			flex: 1;
		}
		.salvage-queue.empty {
			align-content: center;
			justify-content: center;
		}
		.queue-placeholder {
			text-align: center;
		}

		.salvage-details {
			position: absolute;
			left: 2px;
			bottom: 2px;
			padding: 0 3px;
			font-weight: bold;
		}
		.salvage-output {
			display: flex;
			flex-direction: column;
			flex: 0 1 auto;
			min-height: 0;
			max-height: 40%;
		}
		.salvage-output-content {
			overflow: auto;
			padding-inline: 4px;
		}
		.salvage-actions {
			display: flex;
			flex-direction: column;
			flex: none;
			gap: 8px;
		}

		.salvage-appraisal-failures {
			display: grid;
			justify-items: start;
			gap: 8px;
		}
		.salvage-output table {
			width: 100%;
			text-align: left;
		}
		.salvage-output th,
		.salvage-output td {
			padding: 3px;
		}
		.salvage-footer {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
		}
		.salvage-queue:global([data-inventory-drop="accepted"]) {
			outline: 2px solid var(--ui-color-success);
		}
		.salvage-queue:global([data-inventory-drop="rejected"]) {
			outline: 2px solid var(--ui-color-warning);
		}
	}
</style>
