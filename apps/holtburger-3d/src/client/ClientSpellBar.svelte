<script lang="ts">
	import { tick, untrack } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type {
		ClientKeyboardConfiguration,
		InputDigitIndex,
	} from "../lib/input/input-contract";
	import {
		compactInputHint,
		formatInputBindings,
		type InputDisplayPlatform,
	} from "../lib/input/input-presentation";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import {
		SPELL_BAR_INDICES,
		type ClientSpellBarState,
	} from "./client-spell-bar-state";
	import {
		prepareSpellRow,
		type SpellRow,
		type ClientSpellServices,
	} from "./client-spells";
	import { CLIENT_ACTION_BAR_TUNING, CLIENT_TUNING } from "./client-tuning";
	import ClientHudPanel from "./ClientHudPanel.svelte";
	import ShortcutBarShapeToggle from "./ShortcutBarShapeToggle.svelte";
	import {
		resolveClientHudPlacement,
		type ClientHudPlacement,
		type ClientHudViewport,
	} from "./client-hud-layout";
	import SpellCell from "./SpellCell.svelte";
	import type { ClientInventoryState } from "./client-inventory-state";
	import type { ClientItemInteractions } from "./client-item-interactions";
	import {
		findWieldedCasterSpell,
		type WieldedCasterSpell,
	} from "./client-inventory-equipment";
	interface Props {
		/** Accepted spell shortcuts for visible hints and full descriptions. */
		input: ClientKeyboardConfiguration["spellBar"];
		displayPlatform: InputDisplayPlatform;
		/** Retained HUD anchors; natural extent is derived from measured theme geometry. */
		placement: ClientHudPlacement;
		/** Retained shape survives stance hiding and tab switches. */
		shape: "single" | "double";
		/** Layout editing exposes move and shape-toggle controls. */
		editable: boolean;
		/** Usable viewport dimensions for anchored fitting. */
		viewport: ClientHudViewport;
		/** Publish placement and shape edits to the HUD owner. */
		onPlacementChange: (placement: ClientHudPlacement) => void;
		/** Publish a one-row or two-row cell arrangement. */
		onShapeChange: (shape: "single" | "double") => void;
		/** Shared reference/artwork and spellbook services. */
		spells: ClientSpellServices;
		/** Existing inventory owner supplies sampled, confirmed equipment. */
		inventory: ClientInventoryState | null;
		/** Existing item-use owner handles target acquisition and guarded dispatch. */
		itemInteractions: ClientItemInteractions | null;
		/** App-owned configuration survives hidden markup. */
		configuration: ClientSpellBarState;
		/** App-owned runtime availability. */
		enabled: boolean;
		/** Tab selection and casting share the keyboard entry points. */
		onSelectTab: (tab: InputDigitIndex) => void;
		onActivateCell: (slot: number) => void;
		/** The caster cell and its shortcut use the same app-owned activation. */
		onActivateCaster: () => void;
	}
	let {
		input,
		displayPlatform,
		placement,
		shape,
		editable,
		viewport,
		onPlacementChange,
		onShapeChange,
		spells,
		inventory,
		itemInteractions,
		configuration,
		enabled,
		onSelectTab,
		onActivateCell,
		onActivateCaster,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	/** Bounded inventory-cadence display snapshot; never subscribes to raw world publications. */
	let caster = $state<WieldedCasterSpell | null>(null);
	$effect(() => {
		const owner = inventory;
		const sample = () => {
			const next =
				owner === null
					? null
					: findWieldedCasterSpell(owner.readItems().items.values());
			if (
				next?.item !== caster?.item ||
				next?.spell !== caster?.spell ||
				next?.name !== caster?.name
			)
				caster = next;
		};
		// The imperative sample must not make its display snapshot own this timer's lifetime.
		untrack(sample);
		const timer = setInterval(
			sample,
			CLIENT_TUNING.inventory.displayIntervalMs,
		);
		return () => clearInterval(timer);
	});
	/** Cold measured CSS geometry also drives HUD placement and strip geometry. */
	let metrics = $state<{ cell: number; tabs: number; scrollbar: number }>({
		cell: CLIENT_ACTION_BAR_TUNING.initialCellSize,
		tabs: 0,
		scrollbar: 0,
	});
	const grid = $derived.by(() => {
		const rows = shape === "single" ? 1 : 2;
		return { rows, columns: SPELL_BAR_INDICES.length / rows };
	});
	const cells = $derived(configuration.tabs[configuration.selected]);
	// Each group of ten keeps slots 1–5 above 6–10 in two-row mode.
	const totalColumns = $derived(
		Math.floor((cells.length - 1) / SPELL_BAR_INDICES.length) * grid.columns +
			Math.min(
				grid.columns,
				((cells.length - 1) % SPELL_BAR_INDICES.length) + 1,
			),
	);
	const overflowColumns = $derived(totalColumns - grid.columns);
	function shortcut(
		slot: number,
	): { hint: string | null; description: string } | null {
		const index = SPELL_BAR_INDICES.find((numbered) => numbered === slot);
		if (index === undefined) return null;
		return {
			hint: compactInputHint(input.cells[index], displayPlatform),
			description: formatInputBindings(input.cells[index], displayPlatform),
		};
	}
	let cellsViewport: HTMLDivElement;
	let scrollHandle = $state<HTMLInputElement>();
	let previousView: {
		tab: InputDigitIndex;
		shape: "single" | "double";
	} | null = null;
	$effect(() => {
		const tab = configuration.selected;
		if (previousView?.tab === tab && previousView.shape === shape) return;
		previousView = { tab, shape };
		void tick().then(() => {
			if (cellsViewport) cellsViewport.scrollLeft = 0;
			if (scrollHandle) scrollHandle.value = "0";
		});
	});
	const naturalPlacement = $derived({
		...placement,
		preferredWidth: (grid.columns + (caster === null ? 0 : 1)) * metrics.cell,
		preferredHeight:
			grid.rows * metrics.cell +
			metrics.tabs +
			(overflowColumns > 0 ? metrics.scrollbar : 0),
	});
	const minimum = $derived({
		width: metrics.cell,
		height: metrics.cell + metrics.tabs,
	});
	const resolved = $derived(
		resolveClientHudPlacement(naturalPlacement, viewport, minimum),
	);
	function measureMetrics(node: HTMLElement) {
		const scrollbarMetric = node.querySelector<HTMLElement>(
			".spell-scrollbar-metrics",
		);
		if (scrollbarMetric === null)
			throw new Error("Missing spell scrollbar metric");
		const update = () => {
			const { width, height } = node.getBoundingClientRect();
			const scrollbar = scrollbarMetric.getBoundingClientRect().height;
			if (
				!Number.isFinite(width) ||
				width <= 0 ||
				!Number.isFinite(height) ||
				height <= 0 ||
				!Number.isFinite(scrollbar) ||
				scrollbar <= 0
			)
				throw new Error("Invalid spell bar theme dimensions");
			metrics = { cell: width, tabs: height, scrollbar };
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
		observer.observe(scrollbarMetric);
		return { destroy: () => observer.disconnect() };
	}

	let rows = $state<ReadonlyMap<number, SpellRow>>(new Map());
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());
	let known = $state<readonly number[] | null>(null);
	$effect(() => {
		const services = spells;
		const update = () => {
			known = services.session.state().knownSpells;
		};
		const unsubscribe = services.session.subscribe((event) => {
			if (
				["spells", "current-state", "lifecycle", "resyncing"].includes(
					event.type,
				)
			)
				update();
		});
		update();
		return unsubscribe;
	});
	$effect(() => {
		const services = spells;
		const ids = [
			...new Set(
				[
					...configuration.tabs[configuration.selected],
					caster?.spell ?? null,
				].filter((id) => id !== null),
			),
		];
		let disposed = false;
		const owner = services.icons.createOwner("display");
		rows = new Map();
		displays = new Map();
		let revision = -1;
		const sample = () => {
			if (revision === services.icons.revision) return;
			revision = services.icons.revision;
			displays = new Map(
				[...rows.values()].flatMap((row) =>
					row.artwork.kind === "failed"
						? []
						: [
								[
									row.artwork.key,
									services.icons.read(row.artwork.key),
								] as const,
							],
				),
			);
		};
		void services
			.load(ids)
			.then((references) => {
				if (disposed) return;
				rows = new Map(
					references.map((reference) => [
						reference.id,
						prepareSpellRow(reference, services.icons, owner),
					]),
				);
				sample();
			})
			.catch((error: unknown) => {
				if (!disposed)
					rows = new Map(
						ids.map((id) => [
							id,
							{
								id,
								name: `Spell ${id}`,
								details: null,
								artwork: { kind: "failed", detail: String(error) },
							},
						]),
					);
			});
		const timer = setInterval(
			sample,
			CLIENT_TUNING.spells.iconDisplayIntervalMs,
		);
		return () => {
			disposed = true;
			clearInterval(timer);
			void tick().then(() => services.icons.releaseOwner(owner));
		};
	});
</script>

<ClientHudPanel
	label="Spell bar"
	{editable}
	placement={naturalPlacement}
	{viewport}
	moveInset={{ left: 0, top: metrics.tabs }}
	minWidth={minimum.width}
	minHeight={minimum.height}
	resizable={false}
	contentHitTesting="surface"
	{onPlacementChange}
>
	<div
		class="spell-bar"
		data-spell-bar-surface
		style:--spell-cell-size={`${metrics.cell}px`}
		data-spell-bar-shape={shape}
	>
		<span class="spell-bar-metrics" aria-hidden="true" use:measureMetrics>
			<span class="spell-scrollbar-metrics"></span>
		</span>
		<div class="spell-bar-scroll">
			{#if caster !== null}
				{@const row = rows.get(caster.spell)}
				<div class="caster-spell" data-caster-spell={caster.spell}>
					<SpellCell
						address={null}
						shortcut={{
							hint: compactInputHint(input.caster, displayPlatform),
							description: formatInputBindings(input.caster, displayPlatform),
						}}
						spell={caster.spell}
						label={`${row?.name ?? `Spell ${caster.spell}`} (${caster.name})${row?.artwork.kind === "failed" ? `: ${row.artwork.detail}` : ""}`}
						display={row?.artwork.kind === "icon"
							? displays.get(row.artwork.key)
							: undefined}
						available={enabled && itemInteractions !== null}
						onactivate={() => {
							keyboard.returnToGame();
							onActivateCaster();
						}}
					/>
				</div>
			{/if}
			<div class="spell-shortcuts">
				<div class="spell-tabs" role="group" aria-label="Spell bar tabs">
					{#each SPELL_BAR_INDICES as tab}
						<button
							type="button"
							class="ui-hud-button"
							aria-label={`Spell tab ${(tab + 1) % 10} (${formatInputBindings(input.tabs[tab], displayPlatform)})`}
							title={`Spell tab ${(tab + 1) % 10} — ${formatInputBindings(input.tabs[tab], displayPlatform)}`}
							aria-pressed={configuration.selected === tab}
							onclick={() => {
								keyboard.returnToGame();
								onSelectTab(tab);
							}}
							><span class="spell-tab-hint"
								>{compactInputHint(input.tabs[tab], displayPlatform) ??
									"—"}</span
							></button
						>
					{/each}
				</div>
				<div
					class="spell-cells-viewport"
					bind:this={cellsViewport}
					style:width={`${grid.columns * metrics.cell}px`}
					onscroll={() => {
						if (scrollHandle)
							scrollHandle.value = String(
								cellsViewport.scrollLeft / metrics.cell,
							);
					}}
				>
					<div
						class="spell-cells"
						style:grid-template-rows={`repeat(${grid.rows}, ${metrics.cell}px)`}
						role="group"
						aria-label={`Spell bar ${(configuration.selected + 1) % 10}`}
					>
						{#each cells as spell, slot}
							{@const row = spell === null ? undefined : rows.get(spell)}
							{@const available =
								enabled && spell !== null && known?.includes(spell) === true}
							<SpellCell
								gridPosition={{
									column:
										Math.floor(slot / SPELL_BAR_INDICES.length) * grid.columns +
										(slot % grid.columns) +
										1,
									row:
										Math.floor(
											(slot % SPELL_BAR_INDICES.length) / grid.columns,
										) + 1,
								}}
								address={{ tab: configuration.selected, slot }}
								shortcut={shortcut(slot)}
								{spell}
								label={spell === null
									? "Empty spell slot"
									: `${row === undefined ? `Spell ${spell}` : row.artwork.kind === "failed" ? `${row.name}: ${row.artwork.detail}` : row.name}${known?.includes(spell) === true ? "" : " (unavailable)"}`}
								display={row?.artwork.kind === "icon"
									? displays.get(row.artwork.key)
									: undefined}
								{available}
								onactivate={() => {
									keyboard.returnToGame();
									onActivateCell(slot);
								}}
							/>
						{/each}
					</div>
				</div>
				{#if overflowColumns > 0}
					<input
						class="spell-scroll-handle"
						bind:this={scrollHandle}
						type="range"
						aria-label="Scroll spell bar cells"
						min="0"
						max={overflowColumns}
						step="any"
						value="0"
						style:--scroll-thumb-width={`${(grid.columns / totalColumns) * 100}%`}
						oninput={(event) =>
							(cellsViewport.scrollLeft =
								Number(event.currentTarget.value) * metrics.cell)}
					/>
				{/if}
			</div>
		</div>
		{#if editable}<ShortcutBarShapeToggle
				label="Toggle spell bar shape"
				topInset={metrics.tabs}
				orientation="horizontal"
				{shape}
				bounds={resolved}
				{viewport}
				onchange={onShapeChange}
			/>{/if}
	</div>
</ClientHudPanel>

<style>
	@layer components {
		.spell-bar {
			position: relative;
			width: 100%;
			height: 100%;
		}
		.spell-bar-metrics {
			position: absolute;
			visibility: hidden;
			pointer-events: none;
			width: var(--ui-item-cell-min-size);
			height: var(--ui-spell-tab-height);
		}
		.spell-scrollbar-metrics {
			display: block;
			width: 0;
			height: var(--ui-spell-scrollbar-height);
		}
		.spell-bar-scroll {
			display: flex;
			width: 100%;
			height: 100%;
			overflow: auto;
			scrollbar-width: thin;
		}
		.caster-spell {
			flex: 0 0 var(--spell-cell-size);
			width: var(--spell-cell-size);
			height: var(--spell-cell-size);
			margin-top: var(--ui-spell-tab-height);
		}
		.spell-tabs,
		.spell-cells {
			display: grid;
			width: max-content;
		}
		.spell-tabs {
			grid-template-columns: repeat(10, calc(var(--spell-cell-size) / 2));
			height: var(--ui-spell-tab-height);
		}
		.spell-tabs button {
			--ui-hud-button-background: var(
				--ui-spell-tab-background,
				color-mix(
					in srgb,
					var(--ui-spell-bar-color) var(--ui-spell-tab-background-opacity),
					transparent
				)
			);
			overflow: hidden;
			min-width: 0;
			min-height: 0;
			padding: 0;
			font-size: var(--ui-spell-tab-font-size);
			color: var(--ui-spell-tab-color, var(--ui-color-text));
			border: var(--ui-spell-tab-border, 0);
			border-radius: var(--ui-spell-tab-radius, 0);
		}
		.spell-tab-hint {
			max-width: 100%;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.spell-tabs button[aria-pressed="true"] {
			--ui-hud-button-background: var(
				--ui-spell-tab-active-background,
				color-mix(
					in srgb,
					var(--ui-spell-bar-color)
						var(--ui-spell-tab-active-background-opacity),
					transparent
				)
			);
			color: var(--ui-spell-tab-active-color, var(--ui-color-text));
			box-shadow: var(
				--ui-spell-tab-active-shadow,
				inset 0 -1px var(--ui-spell-bar-color)
			);
		}
		.spell-tabs button:hover {
			color: var(--ui-spell-tab-hover-color, var(--ui-color-highlight));
		}
		.spell-cells {
			grid-auto-flow: column;
			grid-auto-columns: var(--spell-cell-size);
		}
		.spell-cells-viewport {
			overflow-x: auto;
			scrollbar-width: none;
		}
		.spell-cells-viewport::-webkit-scrollbar {
			display: none;
		}
		.spell-scroll-handle {
			--spell-scrollbar-track-opacity: var(--ui-spell-scrollbar-track-opacity);
			--spell-scrollbar-thumb-opacity: var(--ui-spell-scrollbar-thumb-opacity);
			display: block;
			width: calc(100% - 4px);
			height: var(--ui-spell-scrollbar-height);
			margin: 0 2px;
			padding: 0;
			appearance: none;
			background: transparent;
			cursor: pointer;
		}
		.spell-scroll-handle:is(:hover, :focus-visible, :active) {
			--spell-scrollbar-track-opacity: var(
				--ui-spell-scrollbar-hover-track-opacity
			);
			--spell-scrollbar-thumb-opacity: var(
				--ui-spell-scrollbar-hover-thumb-opacity
			);
		}
		.spell-scroll-handle::-webkit-slider-runnable-track {
			height: 3px;
			background: color-mix(
				in srgb,
				var(--ui-spell-scrollbar-color) var(--spell-scrollbar-track-opacity),
				transparent
			);
		}
		.spell-scroll-handle::-webkit-slider-thumb {
			width: var(--scroll-thumb-width);
			height: calc(var(--ui-spell-scrollbar-height) - 2px);
			margin-top: calc((5px - var(--ui-spell-scrollbar-height)) / 2);
			appearance: none;
			border-radius: 3px;
			background: color-mix(
				in srgb,
				var(--ui-spell-scrollbar-color) var(--spell-scrollbar-thumb-opacity),
				transparent
			);
		}
		.spell-scroll-handle::-moz-range-track {
			height: 3px;
			background: color-mix(
				in srgb,
				var(--ui-spell-scrollbar-color) var(--spell-scrollbar-track-opacity),
				transparent
			);
		}
		.spell-scroll-handle::-moz-range-thumb {
			width: var(--scroll-thumb-width);
			height: calc(var(--ui-spell-scrollbar-height) - 2px);
			border: 0;
			border-radius: 3px;
			background: color-mix(
				in srgb,
				var(--ui-spell-scrollbar-color) var(--spell-scrollbar-thumb-opacity),
				transparent
			);
		}
	}
</style>
