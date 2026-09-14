<script lang="ts">
	import type { ClientItemInteractions } from "./client-item-interactions";
	import { bindingAction, type ActionItemDisplay } from "./client-action-item";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import { onMount, tick } from "svelte";
	import ClientActionBarView from "./ClientActionBar.svelte";
	import { ClientItemDrag } from "./client-item-drag";
	import {
		initialActionBar,
		requireActionBar,
		bindActionCell,
		swapActionCells,
		cycleActionBar,
		cloneActionBar,
		deleteActionBar,
		type ClientActionBar,
		type ActionSlotIndex,
	} from "./client-action-bar-state";
	import type { ClientInventoryState } from "./client-inventory-state";
	import {
		anchorClientHudPlacement,
		type ClientHudViewport,
	} from "./client-hud-layout";
	import {
		findActionBarClonePlacement,
		type ActionBarGeometry,
	} from "./client-action-bar-layout";
	import { CLIENT_TUNING, CLIENT_ACTION_BAR_TUNING } from "./client-tuning";
	interface Props {
		/** Common DOM boundary for inventory and action-cell gestures. */
		root: HTMLElement;
		/** Session-owned retained items and interaction capability. */
		inventory: ClientInventoryState;
		/** Session use flow shared with inventory and selected-entity controls. */
		interactions: ClientItemInteractions;
		/** Current layout editing policy and usable extent. */
		editable: boolean;
		viewport: ClientHudViewport;
	}
	let { root, inventory, interactions, editable, viewport }: Props = $props();
	let bars = $state<readonly ClientActionBar[]>([initialActionBar()]);
	let nextId = 2;
	// Readers belong to mounted surfaces; cloning pulls geometry once at the user action.
	const geometry = new Map<number, () => ActionBarGeometry>();
	function readGeometry(id: number): ActionBarGeometry {
		const read = geometry.get(id);
		if (read === undefined)
			throw new Error(`Missing action bar geometry ${id}`);
		return read();
	}
	const { keyboard } = useAppInputPolicy();
	/** Bounded UI sample; the inventory owner retains authoritative item facts. */
	let items = $state<ReadonlyMap<number, ActionItemDisplay>>(new Map());
	/** Fresh identities retire mounted focus, menus, geometry readers, and drag-source elements together. */
	function resetBars() {
		bars = [{ ...initialActionBar(), id: nextId++ }];
	}
	function change(bar: ClientActionBar) {
		bars = bars.map((current) => (current.id === bar.id ? bar : current));
	}
	function menu(id: number, operation: "clone" | "cycle" | "delete") {
		switch (operation) {
			case "cycle":
				bars = cycleActionBar(bars, id);
				break;
			case "delete":
				bars = deleteActionBar(bars, id);
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
				bars = cloneActionBar(bars, id, {
					id: nextId++,
					anchor: { horizontal, vertical },
				});
				break;
			}
		}
	}
	function activate(id: number, slot: ActionSlotIndex, alternate: boolean) {
		const content = requireActionBar(bars, id).slots[slot];
		if (content === null) return;
		interactions.activate(content.item, content.kind, alternate);
	}
	onMount(() => {
		const drag = new ClientItemDrag(
			root,
			inventory,
			{
				read: (cell) => requireActionBar(bars, cell.bar).slots[cell.slot],
				bind: (cell, content) => {
					bars = bindActionCell(bars, cell, content);
				},
				transfer: (source, target) => {
					bars =
						target === null
							? bindActionCell(bars, source, null)
							: swapActionCells(bars, source, target);
				},
			},
			keyboard,
			() => interactions.cancel(),
		);
		const repository = inventory.icons;
		const owner = repository.createOwner("display");
		let retained = new Set<string>();
		let disposed = false;
		let sampling = false;
		let playerGuid: number | null = null;
		const sample = async () => {
			if (disposed || sampling) return;
			sampling = true;
			try {
				const view = inventory.readItems();
				if (view.playerGuid !== null && view.playerGuid !== playerGuid) {
					if (playerGuid !== null) resetBars();
					playerGuid = view.playerGuid;
				}
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
						next.set(content.item, {
							label:
								facts?.description.kind === "known"
									? facts.description.name
									: `Unavailable item ${content.item}`,
							actionKind: bindingAction(facts)?.kind ?? null,
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
		const unsubscribe = inventory.interactions.subscribe((event) => {
			if (
				event.type === "lifecycle" &&
				(event.lifecycle.kind === "entering-world" ||
					event.lifecycle.kind === "character-selection")
			)
				resetBars();
		});
		return () => {
			disposed = true;
			clearInterval(timer);
			unsubscribe();
			drag.destroy();
			void tick().then(() => repository.releaseOwner(owner));
		};
	});
</script>

{#each bars as bar, index (bar.id)}
	<ClientActionBarView
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
		:global(.item-drag-ghost) {
			position: fixed;
			inset: 0 auto auto 0;
			z-index: 10000;
			pointer-events: none;
			margin: 0;
			padding: 0;
			border: 0;
			background: transparent;
			opacity: 0.8;
			color: var(--ui-color-text);
		}
		:global([data-inventory-drop="pending"]) {
			outline: 2px dashed var(--ui-color-muted);
		}
		:global([data-inventory-drop="accepted"]) {
			outline: 2px solid var(--ui-color-success);
		}
		:global([data-inventory-drop="rejected"]) {
			outline: 2px solid var(--ui-color-danger);
		}
		:global([data-inventory-displaced]) {
			outline: 2px solid var(--ui-color-warning);
		}
		:global([data-item-dragging]) {
			user-select: none;
		}
	}
</style>
