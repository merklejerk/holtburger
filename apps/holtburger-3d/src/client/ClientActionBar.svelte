<script lang="ts">
	import { sameConsumableIdentity } from "./client-action-item";
	import { APP_INPUT } from "../lib/input/app-input";
	import PopupMenu from "../app/PopupMenu.svelte";
	import { CLIENT_ACTION_BAR_TUNING } from "./client-tuning";
	import { onMount } from "svelte";
	import ActionCell from "./ActionCell.svelte";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import ShortcutBarShapeToggle from "./ShortcutBarShapeToggle.svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import {
		ACTION_SLOT_INDICES,
		MAX_ACTION_BARS,
		type ActionSlotIndex,
		type ClientActionBar,
	} from "./client-action-bar-state";
	import {
		type ActionBarGeometry,
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
		/** Register a cold geometry reader for collection-owned clone placement. */
		onmount: (read: () => ActionBarGeometry) => () => void;
		/** Publish geometry/configuration edits to the collection owner. */
		onchange: (bar: ClientActionBar) => void;
		/** Collection operations retain stable identities and contiguous sequence order. */
		onmenu: (operation: "cycle" | "clone" | "delete") => void;
		/** Execute one binding with the configured alternate-side modifier. */
		onactivate: (slot: ActionSlotIndex, alternate: boolean) => void;
	}
	let {
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
	let focused = $state<ActionSlotIndex | null>(null);
	// Cold modifier edges drive hints only; activation still reads the actual input event.
	let alternateHeld = $state(false);
	let surface: HTMLDivElement;
	let menuOpen = $state(false);
	let menuButton = $state<HTMLButtonElement | null>(null);
	const grid = $derived(actionBarGrid(bar));
	let cellSize = $state<number>(CLIENT_ACTION_BAR_TUNING.initialCellSize);
	// Geometry follows resolved CSS lengths, including live theme changes and non-pixel units.
	let stripGap = $state(0);
	function measureMetrics(node: HTMLElement) {
		const update = () => {
			const { width, height } = node.getBoundingClientRect();
			if (
				!Number.isFinite(width) ||
				width <= 0 ||
				!Number.isFinite(height) ||
				height < 0
			)
				throw new Error("Invalid action bar theme dimensions");
			cellSize = width;
			stripGap = height;
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}
	// The menu strip is part of the anchored bar extent, not an overlay on its cells.
	const stripInset = $derived({
		left:
			bar.orientation === "horizontal"
				? CLIENT_ACTION_BAR_TUNING.menuStripSize + stripGap
				: 0,
		top:
			bar.orientation === "vertical"
				? CLIENT_ACTION_BAR_TUNING.menuStripSize + stripGap
				: 0,
	});
	const minimum = $derived({
		width: cellSize + stripInset.left,
		height: cellSize + stripInset.top,
	});
	const extent = $derived({
		width: grid.columns * cellSize + stripInset.left,
		height: grid.rows * cellSize + stripInset.top,
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
		onactivate(slot, alternate);
	}
	function keydown(event: KeyboardEvent) {
		if (focused === null) return;
		// Focus chords retain priority over cell bindings when switching between bars.
		if (
			ACTION_SLOT_INDICES.some((index) =>
				APP_INPUT.actionBarFocus(index, event),
			)
		)
			return;
		if (APP_INPUT.actionBarCommand("cancel", event)) {
			event.preventDefault();
			keyboard.returnToGame();
			return;
		}
		const direction = APP_INPUT.actionBarDirection(event);
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
					`[data-action-cell="${(focused + 1) % MAX_ACTION_BARS}"]`,
				)
				?.scrollIntoView({ block: "nearest", inline: "nearest" });
			return;
		}
		const slot = APP_INPUT.actionBarCommand("confirm", event)
			? focused
			: (ACTION_SLOT_INDICES.find((index) =>
					APP_INPUT.actionBarCell(index, event),
				) ?? null);
		if (slot !== null) {
			event.preventDefault();
			if (!event.repeat) activate(slot, APP_INPUT.actionBarAlternate(event));
		}
	}
	function operate(operation: "rotate" | "cycle" | "clone" | "delete") {
		if (operation === "rotate") {
			if (editable)
				onchange({
					...bar,
					orientation:
						bar.orientation === "horizontal" ? "vertical" : "horizontal",
				});
		} else onmenu(operation);
	}
	onMount(() => onmount(() => ({ bounds: resolved, preferred: extent })));
</script>

<ClientHudPanel
	label={`Action bar ${sequence}`}
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
		style:--action-menu-strip-size={`${CLIENT_ACTION_BAR_TUNING.menuStripSize}px`}
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
							index + 1 === sequence && APP_INPUT.actionBarFocus(index, event),
					)
				)
					return false;
				alternateHeld = APP_INPUT.actionBarAlternate(event);
				focused = 0;
				return true;
			},
			keydown,
			modifiersChanged: (event) => {
				alternateHeld = APP_INPUT.actionBarAlternate(event);
			},
			cancel: () => {
				focused = null;
				alternateHeld = false;
			},
		}}
	>
		<span class="action-bar-metrics" aria-hidden="true" use:measureMetrics
		></span>
		<button
			type="button"
			class="action-menu-strip ui-button"
			aria-label={`Action bar ${sequence} menu`}
			title={`Action bar ${sequence} menu`}
			bind:this={menuButton}
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={() => {
				menuOpen = !menuOpen;
			}}>{sequence}</button
		>
		<div class="action-bar-scroll">
			<div
				class="action-grid"
				style:grid-template-columns={`repeat(${grid.columns}, ${cellSize}px)`}
				style:grid-template-rows={`repeat(${grid.rows}, ${cellSize}px)`}
			>
				{#each ACTION_SLOT_INDICES as slot}
					{@const content = bar.slots[slot]}
					{@const item = content === null ? undefined : items.get(content.item)}
					{@const position = actionCellPosition(bar, slot)}
					<div
						style:grid-row={position.row + 1}
						style:grid-column={position.column + 1}
					>
						<ActionCell
							bar={bar.id}
							digit={String((slot + 1) % MAX_ACTION_BARS)}
							{content}
							label={content === null
								? "Empty"
								: (item?.label ?? `Unavailable item ${content.item}`)}
							display={item?.display}
							count={item?.stackCount ?? null}
							structure={item?.structure ?? null}
							capacity={item?.capacity ?? null}
							available={content !== null &&
								item?.actionKind === content.kind &&
								(content.replacement === null ||
									(item.readyReplacement !== null &&
										sameConsumableIdentity(
											content.replacement,
											item.readyReplacement,
										)))}
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
		{#if editable}<ShortcutBarShapeToggle
				label={`Toggle action bar shape ${sequence}`}
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
			{ action: "rotate", label: "Rotate", disabled: !editable },
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
			gap: var(--ui-action-bar-strip-gap);
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
			width: var(--ui-item-cell-min-size);
			height: var(--ui-action-bar-strip-gap);
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
	}
</style>
