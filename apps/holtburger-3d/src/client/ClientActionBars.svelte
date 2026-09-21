<script lang="ts">
	import type { ClientViewportTargetPicker } from "./client-pointer-selection-controller";
	import { reconcileActionBars } from "./client-action-bar-reconciliation";
	import type { ClientItemInteractions } from "./client-item-interactions";
	import {
		bindingAction,
		sameConsumableIdentity,
		type ActionItemDisplay,
	} from "./client-action-item";
	import { onMount, tick } from "svelte";
	import ClientActionBarView from "./ClientActionBar.svelte";
	import type { ItemDragSession } from "./client-item-drag";
	import type { ClientWorldContainerPanelState } from "./client-world-container-panel-state";
	import { ClientItemDrag } from "./client-item-drag";
	import type { ActionSlotIndex } from "./client-action-bar-contract";
	import {
		nextActionBarId,
		requireActionBar,
		bindActionCell,
		swapActionCells,
		cycleActionBar,
		cloneActionBar,
		deleteActionBar,
		type ClientActionBar,
	} from "./client-action-bar-state";
	import type { ClientInventoryState } from "./client-inventory-state";
	import {
		anchorClientHudPlacement,
		type ClientHudViewport,
	} from "./client-hud-layout";
	import {
		findActionBarClonePlacement,
		resetActionBarPlacements,
		type ActionBarGeometry,
	} from "./client-action-bar-layout";
	import { CLIENT_TUNING, CLIENT_ACTION_BAR_TUNING } from "./client-tuning";
	import type { ClientKeyboardConfiguration } from "../lib/input/input-contract";
	interface Props {
		/** Accepted user keyboard map for accurate shortcut hints. */
		readonly input: ClientKeyboardConfiguration;
		/** Character-owned complete action-bar configuration. */
		readonly bars: readonly ClientActionBar[];
		readonly onBarsChange: (bars: readonly ClientActionBar[]) => void;
		/** Expose a reset operation only while mounted bar geometry is available. */
		readonly onResetOwner: (reset: (() => boolean) | null) => void;
		/** Expose the mounted item gesture owner to common HUD cancellation. */
		onDragOwner: (owner: ClientItemDrag | null) => void;
		/** Resolve world inventory destinations without changing selection. */
		onPickInventoryTarget: ClientViewportTargetPicker;
		/** Ordinary inventory refusal feedback. */
		onInventoryNotice: (message: string) => void;
		/** Select an inventory source once a real drag begins. */
		onSelectDragItem: (guid: number) => void;
		/** Common DOM boundary for inventory and action-cell gestures. */
		root: HTMLElement;
		/** Session-owned retained items and interaction capability. */
		inventory: ClientInventoryState;
		/** Shared command/fact authority for gestures and binding reconciliation. */
		session: ItemDragSession;
		worldContainer: ClientWorldContainerPanelState | null;
		/** Session use flow shared with inventory and selected-entity controls. */
		interactions: ClientItemInteractions;
		/** Current layout editing policy and usable extent. */
		editable: boolean;
		viewport: ClientHudViewport;
	}
	let {
		input,
		bars,
		onBarsChange,
		onResetOwner,
		root,
		onDragOwner,
		inventory,
		session,
		worldContainer,
		interactions,
		editable,
		viewport,
		onSelectDragItem,
		onPickInventoryTarget,
		onInventoryNotice,
	}: Props = $props();
	// Readers belong to mounted surfaces; cloning pulls geometry once at the user action.
	const geometry = new Map<number, () => ActionBarGeometry>();
	function readGeometry(id: number): ActionBarGeometry {
		const read = geometry.get(id);
		if (read === undefined)
			throw new Error(`Missing action bar geometry ${id}`);
		return read();
	}
	function resetPlacements(): boolean {
		const reset = resetActionBarPlacements(
			bars,
			readGeometry,
			viewport,
			CLIENT_ACTION_BAR_TUNING.cloneGap,
		);
		if (reset === null) {
			inventory.reportFailure(
				"Not enough room to separate every action bar. Enlarge the window and retry.",
			);
			return false;
		}
		onBarsChange(reset);
		return true;
	}
	onMount(() => {
		onResetOwner(resetPlacements);
		return () => onResetOwner(null);
	});
	/** Bounded UI sample; the inventory owner retains authoritative item facts. */
	let items = $state<ReadonlyMap<number, ActionItemDisplay>>(new Map());
	function change(bar: ClientActionBar) {
		onBarsChange(
			bars.map((current) => (current.id === bar.id ? bar : current)),
		);
	}
	function menu(id: number, operation: "clone" | "cycle" | "delete") {
		switch (operation) {
			case "cycle":
				onBarsChange(cycleActionBar(bars, id));
				break;
			case "delete":
				onBarsChange(deleteActionBar(bars, id));
				break;
			case "clone": {
				const source = requireActionBar(bars, id);
				const sourceGeometry = readGeometry(id);
				const rectangle = findActionBarClonePlacement(
					sourceGeometry,
					source.orientation,
					bars.map((bar) =>
						bar.id === id ? sourceGeometry.bounds : readGeometry(bar.id).bounds,
					),
					viewport,
					CLIENT_ACTION_BAR_TUNING.cloneGap,
				);
				if (rectangle === null) {
					inventory.reportFailure(
						"No room for another action bar. Move or resize bars, or enlarge the window.",
					);
					break;
				}
				const { horizontal, vertical } = anchorClientHudPlacement(
					rectangle,
					viewport,
					sourceGeometry.preferred,
				);
				onBarsChange(
					cloneActionBar(bars, id, {
						id: nextActionBarId(bars),
						anchor: { horizontal, vertical },
					}),
				);
				break;
			}
		}
	}
	function activate(id: number, slot: ActionSlotIndex, alternate: boolean) {
		reconcile();
		const content = requireActionBar(bars, id).slots[slot];
		if (content === null) return;
		if (content.replacement !== null) {
			const item = inventory.readItem(content.item);
			if (
				item?.description.kind !== "known" ||
				item.description.consumable?.availability !== "ready" ||
				!sameConsumableIdentity(
					content.replacement,
					item.description.consumable.identity,
				)
			) {
				inventory.reportFailure("Waiting for consumable inventory facts.");
				return;
			}
		}
		interactions.activate(content.item, content.kind, alternate);
	}
	/** Semantic updates reconcile bindings; artwork sampling only presents the result. */
	function reconcile() {
		if (
			!bars.some((bar) =>
				bar.slots.some((content) => content?.replacement != null),
			)
		)
			return;
		const reconciled = reconcileActionBars(bars, session.entities.read());
		if (reconciled !== bars) onBarsChange(reconciled);
	}

	onMount(() => {
		const drag = new ClientItemDrag(
			root,
			session,
			(root) => {
				const owned = inventory.read();
				if (owned.sections[0]?.container.guid === root) return owned;
				const external = worldContainer?.read();
				return external?.root.guid === root ? external : null;
			},
			inventory.reportFailure,
			{
				read: (cell) => requireActionBar(bars, cell.bar).slots[cell.slot],
				bind: (cell, content) => {
					onBarsChange(bindActionCell(bars, cell, content));
				},
				transfer: (source, target) => {
					onBarsChange(
						target === null
							? bindActionCell(bars, source, null)
							: swapActionCells(bars, source, target),
					);
				},
			},
			() => interactions.cancel(),
			onSelectDragItem,
			onPickInventoryTarget,
			onInventoryNotice,
		);
		onDragOwner(drag);
		const repository = inventory.icons;
		const owner = repository.createOwner("display");
		let retained = new Set<string>();
		let disposed = false;
		let sampling = false;
		const sample = async () => {
			if (disposed || sampling) return;
			sampling = true;
			try {
				const view = inventory.readItems();
				const keys = new Set<string>();
				const next = new Map<number, ActionItemDisplay>();
				for (const bar of bars)
					for (const content of bar.slots) {
						if (content === null || next.has(content.item)) continue;
						const facts = view.items.get(content.item);
						const key = view.iconKeys.get(content.item);
						if (key !== undefined) {
							repository.retainKey(owner, key);
							keys.add(key);
						}
						const action = bindingAction(facts);
						next.set(content.item, {
							label:
								facts?.description.kind === "known"
									? facts.description.name
									: `Unavailable item ${content.item}`,
							stackCount:
								facts?.description.kind === "known"
									? facts.description.stackCount
									: null,
							structure:
								facts?.description.kind === "known"
									? facts.description.structure
									: null,
							capacity: view.capacities.get(content.item) ?? null,
							actionKind: action?.kind ?? null,
							alternateLabel:
								action?.kind === "targeted"
									? "Use on selected target"
									: action?.kind === "equipment" &&
										  facts?.description.kind === "known" &&
										  facts.description.hasAlternateEquipSide
										? "Equip alternate side"
										: null,
							readyReplacement:
								facts?.description.kind === "known" &&
								facts.description.consumable?.availability === "ready"
									? facts.description.consumable.identity
									: null,
							equipped:
								facts?.ownedByPlayer === true &&
								facts.location.kind === "equipped",
							display: key === undefined ? undefined : repository.read(key),
						});
					}
				items = next;
				await tick();
				for (const key of retained)
					if (!keys.has(key)) repository.release(owner, key);
				retained = keys;
			} finally {
				sampling = false;
			}
		};
		void sample();
		const timer = window.setInterval(() => {
			void sample();
		}, CLIENT_TUNING.inventory.displayIntervalMs);
		const unsubscribe = session.subscribe((event) => {
			if (
				event.type === "entities" ||
				event.type === "current-state" ||
				(event.type === "lifecycle" && event.lifecycle.kind === "in-world")
			)
				reconcile();
		});
		return () => {
			disposed = true;
			clearInterval(timer);
			unsubscribe();
			onDragOwner(null);
			drag.destroy();
			void tick().then(() => repository.releaseOwner(owner));
		};
	});
</script>

{#each bars as bar, index (bar.id)}
	<ClientActionBarView
		{input}
		{bar}
		sequence={index + 1}
		count={bars.length}
		{editable}
		{viewport}
		{items}
		onmount={(read) => {
			geometry.set(bar.id, read);
			return () => {
				geometry.delete(bar.id);
			};
		}}
		onchange={change}
		onmenu={(operation) => menu(bar.id, operation)}
		onactivate={(slot, alternate) => activate(bar.id, slot, alternate)}
	/>
{/each}

<style>
	@layer components {
		:global([data-inventory-drop="pending"]) {
			outline: 2px dashed var(--ui-color-muted);
		}
		:global([data-inventory-drop="accepted"]) {
			outline: 2px solid var(--ui-color-success);
		}
		:global([data-inventory-drop="rejected"]) {
			outline: 2px solid var(--ui-color-danger);
		}
		:global([data-game-viewport][data-inventory-drop]) {
			outline-offset: -2px;
		}
		:global([data-inventory-displaced]) {
			outline: 2px solid var(--ui-color-warning);
		}
		:global([data-item-dragging]) {
			user-select: none;
		}
	}
</style>
