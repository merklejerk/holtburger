<script lang="ts">
	import ClientLoadoutIconDropdown from "./ClientLoadoutIconDropdown.svelte";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import EquipmentSlotIcon from "./EquipmentSlotIcon.svelte";
	import ItemCellVisual from "../app/ItemCellVisual.svelte";
	import { itemCellPresentation } from "../app/item-cell-presentation";
	import { startUiIconDisplay } from "../app/ui-icon-display";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import type { ClientInventoryState } from "./client-inventory-state";
	import { EQUIPMENT_SLOTS } from "./client-inventory-equipment";
	import {
		LOADOUT_ICONS,
		loadoutActionContentSchema,
		type LoadoutDraft,
		type EquipmentSlotMask,
	} from "./client-loadout";
	import type { ClientItemDrag } from "./client-item-drag";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import {
		CLIENT_LOADOUT_BUILDER_TUNING,
		CLIENT_TUNING,
	} from "./client-tuning";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";

	interface Props {
		/** Opening snapshot; null hides the window and discards its unplaced draft. */
		capture: LoadoutDraft | null;
		/** Session icon repository; only captured item identities acquire display leases. */
		inventory: ClientInventoryState;
		/** Existing gesture owner handles action-cell placement and cancellation. */
		owner: ClientItemDrag | null;
		/** Existing HUD viewport constrains this retained window. */
		viewport: ClientHudViewport;
		/** Close or successful placement discards the unplaced snapshot. */
		onClose: () => void;
	}
	let { capture, inventory, owner, viewport, onClose }: Props = $props();
	const { keyboard } = useAppInputPolicy();
	let name = $state("");
	let icon = $state<(typeof LOADOUT_ICONS)[number]>(LOADOUT_ICONS[0]);
	let included = $state<ReadonlySet<EquipmentSlotMask>>(new Set());
	let displays = $state<ReadonlyMap<number, UiIconDisplay>>(new Map());
	let placement = $state<ClientHudPlacement>({
		horizontal: { alignment: "center", offset: 0 },
		vertical: { alignment: "center", offset: 0 },
		preferredWidth: CLIENT_LOADOUT_BUILDER_TUNING.width,
		preferredHeight: CLIENT_LOADOUT_BUILDER_TUNING.height,
	});
	$effect(() => {
		name = "";
		if (capture !== null) icon = capture.icon;
		included = new Set(
			capture?.bindings
				.filter((binding) => binding.item !== null)
				.map((binding) => binding.slot),
		);
	});
	$effect(() => {
		const opening = capture;
		displays = new Map();
		if (opening === null) return;
		const snapshot = inventory.readItems();
		const keys = new Map(
			opening.bindings.flatMap((binding) => {
				if (binding.item === null) return [];
				const key = snapshot.iconKeys.get(binding.item);
				return key === undefined ? [] : [[binding.item, key] as const];
			}),
		);
		const display = startUiIconDisplay({
			repository: inventory.icons,
			intervalMs: CLIENT_TUNING.inventory.displayIntervalMs,
			read: () => opening,
			keys: () => keys.values(),
			publish: (_, images) => {
				displays = new Map(
					[...keys].flatMap(([item, key]) => {
						const image = images.get(key);
						return image === undefined ? [] : [[item, image] as const];
					}),
				);
			},
		});
		return () => display.destroy();
	});
	const bindings = $derived(capture?.bindings ?? []);
	const content = $derived.by(() => {
		const parsed = loadoutActionContentSchema.safeParse({
			kind: "loadout",
			name,
			icon,
			bindings: bindings.filter((binding) => included.has(binding.slot)),
		});
		return parsed.success ? parsed.data : null;
	});
	function toggle(slot: EquipmentSlotMask, checked: boolean) {
		const next = new Set(included);
		if (checked) next.add(slot);
		else next.delete(slot);
		included = next;
	}
</script>

<ClientHudWindow
	title="Create loadout"
	icon="save-loadout"
	{placement}
	{viewport}
	visible={capture !== null}
	{onClose}
	minWidth={CLIENT_LOADOUT_BUILDER_TUNING.minimumWidth}
	minHeight={CLIENT_LOADOUT_BUILDER_TUNING.minimumHeight}
	onPlacementChange={(next) => (placement = next)}
>
	<div
		class="loadout-builder ui-body"
		data-loadout-builder
		use:keyboard.scope={{ nativeControls: true, keydown: () => false }}
	>
		<div class="loadout-scroll" data-loadout-scroll>
			<div class="loadout-slots ui-item-grid">
				{#each EQUIPMENT_SLOTS as slot (slot.mask)}
					{@const binding = bindings.find(
						(candidate) => candidate.slot === slot.mask,
					)}
					{@const label = `${slot.label}: ${binding?.item == null ? "Empty (unequip)" : binding.name}`}
					<div class="loadout-slot">
						<div class="loadout-slot-heading">
							<EquipmentSlotIcon {slot} /><input
								type="checkbox"
								aria-label={`Include ${slot.label}`}
								checked={included.has(slot.mask)}
								onchange={(event) =>
									toggle(slot.mask, event.currentTarget.checked)}
							/>
						</div>
						<button
							type="button"
							class="ui-item-cell ui-item-selection ui-hud-button loadout-item-cell"
							data-loadout-slot={slot.mask}
							data-item-guid={binding?.item ?? undefined}
							data-empty={binding?.item == null}
							title={label}
							aria-label={label}
							aria-pressed={included.has(slot.mask)}
							onclick={() => toggle(slot.mask, !included.has(slot.mask))}
						>
							{#if binding !== undefined && binding.item !== null}
								<ItemCellVisual
									display={displays.get(binding.item)}
									name={binding.name}
									presentation={itemCellPresentation({
										label,
										count: null,
										structure: null,
										capacity: null,
										equipped: false,
									})}
									tooltipLabel={label}
								/>
							{:else}<EquipmentSlotIcon {slot} />{/if}
						</button>
						<span class="loadout-slot-label" title={slot.label}
							>{slot.compactLabel}</span
						>
					</div>
				{/each}
			</div>
		</div>
		<div class="loadout-result">
			<div class="loadout-result-details">
				<input
					class="ui-input"
					aria-label="Loadout name"
					placeholder="Loadout name (optional)"
					bind:value={name}
				/>
				<span>Drag the icon onto an action cell to save.</span>
			</div>
			<ClientLoadoutIconDropdown
				{icon}
				{content}
				{owner}
				visible={capture !== null}
				onIconChange={(choice) => (icon = choice)}
				onPlaced={onClose}
			/>
		</div>
	</div>
</ClientHudWindow>

<style>
	@layer components {
		.loadout-builder {
			height: 100%;
			box-sizing: border-box;
			display: grid;
			grid-template-rows: minmax(0, 1fr) auto;
			gap: 0.6rem;
			min-height: 0;
			min-width: 0;
		}
		.loadout-scroll {
			min-height: 0;
			overflow: auto;
			display: flex;
			flex-direction: column;
			gap: 0.6rem;
		}
		.loadout-slots {
			column-gap: calc(2 * var(--ui-item-grid-gap));
			row-gap: calc(3 * var(--ui-item-grid-gap));
		}
		.loadout-slot {
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 0.2rem;
			align-items: center;
		}
		.loadout-slot-heading {
			display: flex;
			width: 100%;
			align-items: center;
			justify-content: space-between;
		}
		.ui-item-cell.loadout-item-cell {
			position: relative;
			width: 100%;
			aspect-ratio: 1;
			padding: var(--ui-item-cell-padding);
			overflow: hidden;
		}
		.loadout-slot-label {
			font-size: var(--ui-font-size-caption);
			line-height: 1.2;
			text-align: center;
			overflow-wrap: anywhere;
		}
		.loadout-result {
			display: flex;
			justify-content: flex-end;
			align-items: center;
			gap: 0.6rem;
		}
		.loadout-result-details {
			min-width: 0;
			flex: 0 1 14rem;
			display: flex;
			flex-direction: column;
			gap: 0.3rem;
		}
		.loadout-result-details input {
			min-width: 0;
			width: 100%;
		}
		.loadout-result-details span {
			text-align: right;
			font-size: var(--ui-font-size-caption);
		}
	}
</style>
