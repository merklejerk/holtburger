<script lang="ts">
	import { pulseItemCell } from "../app/item-cell-pulse";
	import { loadoutLabel } from "./client-loadout";
	import { presentClientBinding } from "./client-binding-catalog";
	import { sameConsumableIdentity } from "./client-action-item";
	import { useClientInput } from "./client-input-context";
	import {
		modifierName,
		type InputDisplayPlatform,
	} from "../lib/input/input-presentation";
	import type { ClientKeyboardConfiguration } from "../lib/input/input-contract";
	import PopupMenu from "../app/PopupMenu.svelte";
	import { CLIENT_ACTION_BAR_TUNING } from "./client-tuning";
	import { onMount } from "svelte";
	import ActionCell from "./ActionCell.svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import ShortcutBarLayoutControls from "./ShortcutBarLayoutControls.svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import {
		ACTION_SLOT_INDICES,
		MAX_ACTION_BARS,
		type ActionSlotIndex,
	} from "./client-action-bar-contract";
	import type { ClientActionBar } from "./client-action-bar-state";
	import {
		actionBarSurfaceId,
		actionBarGrid,
		actionCellPosition,
		navigateActionCell,
	} from "./client-action-bar-layout";
	import {
		resolveClientHudPlacement,
		type ClientHudViewport,
	} from "./client-hud-layout";
	import type { ActionItemDisplay } from "./client-action-item";
	interface Props {
		/** Accepted user keyboard map for shortcut hints. */
		input: ClientKeyboardConfiguration;
		displayPlatform: InputDisplayPlatform;
		/** Cold bar configuration from the collection owner. */
		bar: ClientActionBar;
		/** Current one-based hotkey position and collection size. */
		sequence: number;
		count: number;
		/** App-owned geometry editing mode and usable viewport. */
		editable: boolean;
		viewport: ClientHudViewport;
		/** Sampled bound-item presentation. */
		items: ReadonlyMap<number, ActionItemDisplay>;
		/** Register natural bar extent for collection-owned clone placement. */
		onmount: (read: () => { width: number; height: number }) => () => void;
		/** Publish geometry/configuration edits to the collection owner. */
		onchange: (bar: ClientActionBar) => void;
		/** Collection operations retain stable identities and contiguous sequence order. */
		onmenu: (operation: "cycle" | "clone" | "delete") => void;
		/** Execute one binding with the configured alternate-side modifier. */
		onactivate: (slot: ActionSlotIndex, alternate: boolean) => void;
	}
	let {
		input,
		displayPlatform,
		bar,
		sequence,
		count,
		editable,
		viewport,
		items,
		onmount,
		onchange,
		onmenu,
		onactivate,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	const clientInput = useClientInput();
	const focusSlot = $derived.by(() => {
		const slot = ACTION_SLOT_INDICES.find((index) => index + 1 === sequence);
		if (slot === undefined)
			throw new Error(`Invalid action bar sequence ${sequence}.`);
		return slot;
	});
	let focused = $state<ActionSlotIndex | null>(null);
	// Cold modifier edges drive hints only; activation still reads the actual input event.
	let alternateHeld = $state(false);
	let surface: HTMLDivElement;
	let menuOpen = $state(false);
	let menuButton = $state<HTMLButtonElement | null>(null);
	const grid = $derived(actionBarGrid(bar));
	// Resolved CSS geometry owns both anchored extent and actual grid cells.
	let metrics = $state<{ cell: number; gap: number; menu: number }>({
		cell: CLIENT_ACTION_BAR_TUNING.initialCellSize,
		gap: 0,
		menu: CLIENT_ACTION_BAR_TUNING.menuStripSize,
	});
	function measureMetrics(node: HTMLElement) {
		const menu = node.firstElementChild;
		if (menu === null) throw new Error("Missing action bar menu metric");
		const update = () => {
			const { width: cell, height: gap } = node.getBoundingClientRect();
			const menuSize = menu.getBoundingClientRect().width;
			if (!Number.isFinite(cell) || cell <= 0)
				throw new Error("Invalid action bar cell size");
			if (!Number.isFinite(gap) || gap < 0)
				throw new Error("Invalid action bar menu gap");
			if (!Number.isFinite(menuSize) || menuSize <= 0)
				throw new Error("Invalid action bar menu size");
			metrics = { cell, gap, menu: menuSize };
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
		observer.observe(menu);
		return { destroy: () => observer.disconnect() };
	}
	// The menu strip is part of the anchored bar extent, not an overlay on its cells.
	const stripInset = $derived({
		left: bar.orientation === "horizontal" ? metrics.menu + metrics.gap : 0,
		top: bar.orientation === "vertical" ? metrics.menu + metrics.gap : 0,
	});
	const minimum = $derived({
		width: metrics.cell + stripInset.left,
		height: metrics.cell + stripInset.top,
	});
	const extent = $derived({
		width: grid.columns * metrics.cell + stripInset.left,
		height: grid.rows * metrics.cell + stripInset.top,
	});
	const placement = $derived({
		...bar.anchor,
		preferredWidth: extent.width,
		preferredHeight: extent.height,
	});
	const resolved = $derived(
		resolveClientHudPlacement(placement, viewport, minimum),
	);
	function activate(slot: ActionSlotIndex, alternate: boolean) {
		keyboard.returnToGame();
		if (bar.slots[slot] !== null) {
			const cell = surface.querySelector<HTMLElement>(
				`[data-action-cell="${(slot + 1) % ACTION_SLOT_INDICES.length}"]`,
			);
			if (cell !== null) pulseItemCell(cell, "interaction");
		}
		onactivate(slot, alternate);
	}
	function keydown(event: KeyboardEvent) {
		if (focused === null) return;
		// Focus chords retain priority over cell bindings when switching between bars.
		if (
			ACTION_SLOT_INDICES.some((index) =>
				clientInput.actionBarFocus(index, event),
			)
		)
			return;
		if (clientInput.shortcut("cancel", event)) {
			event.preventDefault();
			keyboard.returnToGame();
			return;
		}
		const direction = clientInput.actionBarDirection(event);
		if (
			direction !== null &&
			(direction === "left" || direction === "right"
				? grid.columns > 1
				: grid.rows > 1)
		) {
			event.preventDefault();
			focused = navigateActionCell(bar, focused, direction);
			// A tiny viewport scrolls the fixed-size grid rather than losing or shrinking cells.
			surface
				.querySelector<HTMLElement>(
					`[data-action-cell="${(focused + 1) % ACTION_SLOT_INDICES.length}"]`,
				)
				?.scrollIntoView({ block: "nearest", inline: "nearest" });
			return;
		}
		const slot = clientInput.actionBarCommand("confirm", event)
			? focused
			: (ACTION_SLOT_INDICES.find((index) =>
					clientInput.actionBarCell(index, event),
				) ?? null);
		if (slot !== null) {
			event.preventDefault();
			if (!event.repeat) activate(slot, clientInput.actionBarAlternate(event));
		}
	}
	function operate(operation: "clear" | "cycle" | "clone" | "delete") {
		if (operation === "clear") {
			const slots: [...ClientActionBar["slots"]] = [...bar.slots];
			slots.fill(null);
			onchange({ ...bar, slots });
		} else onmenu(operation);
	}
	onMount(() => onmount(() => extent));
	const focusBinding = $derived(
		presentClientBinding(
			input,
			{ kind: "actionBarFocus", index: focusSlot },
			displayPlatform,
		),
	);
</script>

<ClientHudPanel
	label={`Action bar ${sequence}`}
	snapId={actionBarSurfaceId(bar.id)}
	{editable}
	{placement}
	{viewport}
	minWidth={minimum.width}
	minHeight={minimum.height}
	moveInset={stripInset}
	resizable={false}
	contentHitTesting="surface"
	onPlacementChange={(next) =>
		onchange({
			...bar,
			anchor: { horizontal: next.horizontal, vertical: next.vertical },
		})}
>
	<div
		class="action-bar"
		class:vertical={bar.orientation === "vertical"}
		style:--action-menu-strip-size={`calc(${CLIENT_ACTION_BAR_TUNING.menuStripSize}px * var(--ui-icon-scale))`}
		class:action-bar-focused={focused !== null}
		tabindex="-1"
		role="group"
		aria-label={`Action bar ${sequence}`}
		data-action-bar-surface={bar.id}
		bind:this={surface}
		use:keyboard.scope={{
			transient: true,
			passthrough: true,
			activation: (event) => {
				if (
					!ACTION_SLOT_INDICES.some(
						(index) =>
							index + 1 === sequence &&
							clientInput.actionBarFocus(index, event),
					)
				)
					return false;
				alternateHeld = clientInput.actionBarAlternate(event);
				focused = 0;
				return true;
			},
			keydown,
			modifiersChanged: (event) => {
				alternateHeld = clientInput.actionBarAlternate(event);
			},
			cancel: () => {
				focused = null;
				alternateHeld = false;
			},
		}}
	>
		<span class="action-bar-metrics" aria-hidden="true" use:measureMetrics
			><span class="action-menu-metric"></span></span
		>
		<button
			type="button"
			class="action-menu-strip ui-button"
			aria-label={`Action bar ${sequence} menu (focus: ${focusBinding.description})`}
			title={`Action bar ${sequence} menu (focus: ${focusBinding.description})`}
			bind:this={menuButton}
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={() => {
				menuOpen = !menuOpen;
			}}
			><span class="action-menu-hint">{focusBinding.hint ?? "—"}</span></button
		>
		<div class="action-bar-scroll">
			<div
				class="action-grid"
				style:grid-template-columns={`repeat(${grid.columns}, ${metrics.cell}px)`}
				style:grid-template-rows={`repeat(${grid.rows}, ${metrics.cell}px)`}
			>
				{#each ACTION_SLOT_INDICES as slot}
					{@const content = bar.slots[slot]}
					{@const item =
						content === null || content.kind === "loadout"
							? undefined
							: items.get(content.item)}
					{@const position = actionCellPosition(bar, slot)}
					{@const binding = presentClientBinding(
						input,
						{ kind: "actionBarCell", index: slot },
						displayPlatform,
					)}
					<div
						style:grid-row={position.row + 1}
						style:grid-column={position.column + 1}
					>
						<ActionCell
							bindingHint={binding.hint}
							bindingDescription={binding.description}
							alternateModifier={modifierName(
								input.actionBars.alternate,
								displayPlatform,
							)}
							alternateAction={item?.alternateLabel ?? null}
							bar={bar.id}
							digit={String((slot + 1) % ACTION_SLOT_INDICES.length)}
							{content}
							label={content === null
								? "Empty"
								: content.kind === "loadout"
									? loadoutLabel(content)
									: (item?.label ?? `Unavailable item ${content.item}`)}
							display={item?.display}
							count={item?.stackCount ?? null}
							structure={item?.structure ?? null}
							cooldown={item?.cooldown ?? null}
							capacity={item?.capacity ?? null}
							available={content?.kind === "loadout" ||
								(content !== null &&
									item?.actionKind === content.kind &&
									(content.replacement === null ||
										(item.readyReplacement !== null &&
											sameConsumableIdentity(
												content.replacement,
												item.readyReplacement,
											))))}
							alternateLabel={focused !== null && alternateHeld
								? (item?.alternateLabel ?? null)
								: null}
							equipped={item?.equipped === true}
							selected={focused === slot}
							onactivate={(alternate) => activate(slot, alternate)}
						/>
					</div>
				{/each}
			</div>
		</div>
		{#if editable}<ShortcutBarLayoutControls
				label={`Toggle action bar shape ${sequence}`}
				rotation={{
					label: `Rotate action bar ${sequence}`,
					onchange: () =>
						onchange({
							...bar,
							orientation:
								bar.orientation === "horizontal" ? "vertical" : "horizontal",
						}),
				}}
				topInset={0}
				orientation={bar.orientation}
				shape={bar.shape}
				bounds={resolved}
				{viewport}
				onchange={(shape) => onchange({ ...bar, shape })}
			/>{/if}
	</div>
</ClientHudPanel>
{#if menuOpen && menuButton !== null}
	<PopupMenu
		anchor={menuButton}
		label={`Action bar ${sequence} menu`}
		items={[
			{
				action: "clear",
				label: "Clear",
				disabled: bar.slots.every((slot) => slot === null),
			},
			{ action: "cycle", label: "Cycle", disabled: count <= 1 },
			{ action: "clone", label: "Clone", disabled: count >= MAX_ACTION_BARS },
			{ action: "delete", label: "Delete", disabled: count <= 1 },
		]}
		onselect={operate}
		onclose={() => {
			menuOpen = false;
		}}
	/>
{/if}

<style>
	@layer components {
		.action-bar {
			display: grid;
			gap: calc(var(--ui-action-bar-strip-gap) * var(--ui-icon-scale));
			grid-template-columns: var(--action-menu-strip-size) minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr);
			position: relative;
			width: 100%;
			height: 100%;
			outline: none;
		}
		.action-bar-metrics {
			position: absolute;
			visibility: hidden;
			pointer-events: none;
			width: calc(var(--ui-shortcut-cell-size) * var(--ui-icon-scale));
			height: calc(var(--ui-action-bar-strip-gap) * var(--ui-icon-scale));
		}
		.action-menu-metric {
			display: block;
			width: var(--action-menu-strip-size);
			height: 1px;
		}
		.action-bar.vertical {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: var(--action-menu-strip-size) minmax(0, 1fr);
		}
		.action-bar-focused {
			outline: 2px solid var(--ui-color-warning);
		}
		.action-bar-scroll {
			width: 100%;
			height: 100%;
			overflow: auto;
			scrollbar-width: thin;
		}
		.action-grid {
			display: grid;
		}
		.action-menu-strip {
			font-size: calc(
				var(--ui-action-bar-label-font-size) * var(--ui-icon-scale)
			);
			--ui-button-background-color: color-mix(
				in srgb,
				var(--ui-color-control) var(--ui-action-bar-strip-background-opacity),
				transparent
			);
			display: grid;
			place-items: center;
			align-self: stretch;
			min-width: 0;
			min-height: 0;
			padding: 0;
			border-radius: 0;
			font-weight: bold;
		}
		.action-menu-hint {
			max-width: 100%;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
</style>
