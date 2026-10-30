<script lang="ts">
	import KeysIcon from "../assets/icons/locks-keys.svg?component";
	import ItemCellVisual from "../app/ItemCellVisual.svelte";
	import { itemCellPresentation } from "../app/item-cell-presentation";
	import { useItemCooldown } from "../app/item-cooldowns.svelte";
	import { startUiIconDisplay } from "../app/ui-icon-display";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { ClientLocksState, LocksView } from "./client-locks-state";
	import type { ClientInventoryState } from "./client-inventory-state";
	import { CLIENT_TUNING } from "./client-tuning";
	interface Props {
		readonly model: ClientLocksState;
		readonly inventory: ClientInventoryState;
		readonly visible: boolean;
		readonly onExamineItem: (guid: number) => void;
	}
	const { model, inventory, visible, onExamineItem }: Props = $props();
	let view = $state<LocksView | null>(null);
	let items = $state<ReturnType<ClientInventoryState["readItems"]> | null>(
		null,
	);
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());
	const cooldown = useItemCooldown(() => {
		const pick = view?.preferredPick;
		const item = pick == null ? undefined : items?.items.get(pick.item.guid);
		return item?.description.kind === "known"
			? item.description.cooldown
			: null;
	}, "tooltip");
	$effect(() => {
		if (!visible) {
			view = null;
			return;
		}
		const display = startUiIconDisplay({
			repository: inventory.icons,
			intervalMs: CLIENT_TUNING.inventory.displayIntervalMs,
			read: () => ({ view: model.read(), items: inventory.readItems() }),
			keys: ({ view, items }) => {
				const pick = view.preferredPick;
				const key =
					pick === null ? undefined : items.iconKeys.get(pick.item.guid);
				return key === undefined ? [] : [key];
			},
			publish: (snapshot, images) => {
				view = snapshot.view;
				items = snapshot.items;
				displays = images;
			},
		});
		return () => display.destroy();
	});
</script>

{#if view !== null}
	<div class="locks-panel ui-body" data-locks-panel>
		<div class="locks-actions">
			{#if view.showKeys && view.keyCount > 0}
				<div class="locks-action">
					<button
						type="button"
						class="ui-button locks-action-button"
						data-attempt-all-keys
						disabled={view.pending}
						onclick={(event) => {
							if (event.detail <= 1) model.attemptAll();
						}}
					>
						<span class="locks-action-icon"><KeysIcon /></span>
						<span class="locks-action-label"
							>Try all {view.keyCount}
							{view.keyCount === 1 ? "key" : "keys"}</span
						>
					</button>
				</div>
			{/if}
			{#if view.preferredPick !== null}
				{@const pick = view.preferredPick}
				{@const key = items?.iconKeys.get(pick.item.guid)}
				{@const item = items?.items.get(pick.item.guid)}
				{@const description =
					item?.description.kind === "known" ? item.description : null}
				{@const presentation = itemCellPresentation({
					label: `${pick.item.name} · ${pick.item.bonus === null ? "Bonus unknown" : `Bonus: ${pick.item.bonus >= 0 ? "+" : ""}${pick.item.bonus}`}`,
					count: description?.stackCount ?? null,
					structure: description?.structure ?? null,
					capacity: null,
					equipped: item?.location.kind === "equipped",
					cooldownSeconds: cooldown.seconds,
				})}
				<div class="locks-action" data-locks-pick>
					<button
						type="button"
						class="ui-button locks-action-button"
						data-lockpick
						disabled={view.pending}
						onclick={(event) => {
							// A double-click's second click must not queue another attempt.
							if (event.detail <= 1) model.lockpick();
						}}
						oncontextmenu={(event) => {
							if (
								event.target instanceof Element &&
								event.target.closest("[data-item-guid]") !== null
							) {
								event.preventDefault();
								onExamineItem(pick.item.guid);
							}
						}}
					>
						<span class="locks-action-art">
							<span
								class="preferred-pick-cell ui-item-cell"
								data-item-guid={pick.item.guid}
								title={presentation.label}
							>
								<ItemCellVisual
									name={pick.item.name}
									display={key === undefined ? undefined : displays.get(key)}
									{presentation}
									tooltipLabel={presentation.label}
									cooldownAnimation={cooldown.animation}
								/>
							</span>
						</span>
						<span class="locks-action-label"
							>Lockpick{pick.successPercent === null
								? ""
								: ` · ${Math.round(pick.successPercent)}%`}</span
						>
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	@layer components {
		.locks-panel {
			display: flex;
			flex-direction: column;
			gap: var(--ui-list-row-gap);
			overflow-y: auto;
		}
		.locks-actions {
			display: flex;
			align-items: flex-start;
			justify-content: center;
			gap: var(--ui-list-row-gap);
		}
		.locks-action {
			display: flex;
			flex: 1;
			min-width: 0;
			flex-direction: column;
			align-items: center;
			gap: var(--ui-list-row-gap);
		}
		.locks-action-button {
			display: flex;
			width: 100%;
			flex-direction: column;
			align-items: center;
			gap: var(--ui-list-row-gap);
			text-align: center;
		}
		.locks-action-label {
			white-space: nowrap;
		}
		.locks-action-icon {
			display: block;
			width: calc(
				var(--ui-locks-action-icon-size, 48px) * var(--ui-icon-scale)
			);
			height: calc(
				var(--ui-locks-action-icon-size, 48px) * var(--ui-icon-scale)
			);
		}
		.locks-action-art {
			display: grid;
			place-items: center;
			height: calc(
				var(--ui-locks-action-icon-size, 48px) * var(--ui-icon-scale)
			);
		}
		.preferred-pick-cell {
			position: relative;
			display: block;
			flex: none;
			aspect-ratio: 1;
			overflow: hidden;
			width: calc(var(--ui-item-cell-min-size) * var(--ui-icon-scale));
		}
	}
</style>
