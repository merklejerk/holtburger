<script lang="ts">
	import { presentClientBinding } from "../settings/binding-catalog";
	import { tick, untrack } from "svelte";
	import { useAppInputPolicy } from "../../lib/input/app-input-policy-context";
	import type {
		ClientKeyboardConfiguration,
		InputDigitIndex,
	} from "../../lib/input/input-contract";
	import type { InputPlatform } from "../../lib/input/input-platform";

	import type { UiIconDisplay } from "../widgets/ui-icon-repository";
	import {
		SPELL_BAR_INDICES,
		visibleSpellTabs,
		type ClientSpellBarState,
	} from "./spell-bar-state";
	import {
		prepareSpellRow,
		type SpellRow,
		type ClientSpellServices,
	} from "./spells";
	import { CLIENT_ACTION_BAR_TUNING, CLIENT_TUNING } from "../settings/tuning";
	import ClientHudPanel from "../hud/ClientHudPanel.svelte";
	import ShortcutBarLayoutControls from "../hud/ShortcutBarLayoutControls.svelte";
	import {
		resolveClientHudPlacement,
		topAnchoredClientHudPlacement,
		type ClientHudPlacement,
		type ClientHudViewport,
	} from "../hud/hud-layout";
	import SpellCell from "./SpellCell.svelte";
	import type { ClientInventoryState } from "../inventory/inventory-state";
	import type { ClientItemInteractions } from "../inventory/item-interactions";
	import {
		findWieldedCasterSpell,
		type WieldedCasterSpell,
	} from "../inventory/inventory-equipment";
	interface Props {
		/** Accepted spell shortcuts for visible hints and full descriptions. */
		input: ClientKeyboardConfiguration;
		displayPlatform: InputPlatform;
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
		/** Inspect a spell independently of cast availability. */
		onExamineSpell: (spellId: number) => void;
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
		onExamineSpell,
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
	let metrics = $state<{
		cell: number;
		tabs: number;
		scrollbar: number;
		/** Measured separation between the equipped spell and the configured rail. */
		casterGap: number;
	}>({
		cell: CLIENT_ACTION_BAR_TUNING.initialCellSize,
		tabs: 0,
		scrollbar: 0,
		casterGap: 0,
	});
	const grid = $derived.by(() => {
		const rows = shape === "single" ? 1 : 2;
		return { rows, columns: SPELL_BAR_INDICES.length / rows };
	});
	const cells = $derived(configuration.tabs[configuration.selected]);
	/** One published tab list owns both rendering and the bookend geometry. */
	const tabs = $derived(visibleSpellTabs(configuration));
	// Each group of ten keeps slots 1–5 above 6–10 in two-row mode.
	const totalColumns = $derived(
		Math.floor((cells.length - 1) / SPELL_BAR_INDICES.length) * grid.columns +
			Math.min(
				grid.columns,
				((cells.length - 1) % SPELL_BAR_INDICES.length) + 1,
			),
	);
	/** The equipped spell and its gap reserve space inside the movable HUD bounds. */
	const casterExtent = $derived(
		caster === null ? 0 : metrics.cell + metrics.casterGap,
	);
	/** Resize geometry stays in logical UI units; ClientHudPanel owns pointer-scale conversion. */
	const minimumWidth = $derived(
		Math.ceil(grid.columns * metrics.cell + casterExtent),
	);
	const preferredWidth = $derived(
		Math.max(minimumWidth, placement.preferredWidth),
	);
	const widthPlacement = $derived(
		resolveClientHudPlacement({ ...placement, preferredWidth }, viewport, {
			width: minimumWidth,
			height: metrics.cell + metrics.tabs,
		}),
	);
	// A viewport too small for ten spells uses the outer scrollport rather than shrinking cells.
	const stripWidth = $derived(
		Math.max(grid.columns * metrics.cell, widthPlacement.width - casterExtent),
	);
	const visibleColumns = $derived(stripWidth / metrics.cell);
	const overflowColumns = $derived(Math.max(0, totalColumns - visibleColumns));
	function shortcut(
		slot: number,
	): { hint: string | null; description: string } | null {
		const index = SPELL_BAR_INDICES.find((numbered) => numbered === slot);
		if (index === undefined) return null;
		return presentClientBinding(
			input,
			{ kind: "spellCell", index },
			displayPlatform,
		);
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
	const minimum = $derived({
		width: minimumWidth,
		height: metrics.cell + metrics.tabs,
	});
	const naturalPlacement = $derived({
		...topAnchoredClientHudPlacement(placement, viewport, minimum),
		// Reserve outward for fractional theme lengths and browser layout rounding.
		preferredWidth,
		preferredHeight: Math.ceil(
			grid.rows * metrics.cell +
				metrics.tabs +
				(overflowColumns > 0 ? metrics.scrollbar : 0),
		),
	});
	const resolved = $derived(
		resolveClientHudPlacement(naturalPlacement, viewport, minimum),
	);
	const constrained = $derived(
		resolved.width < naturalPlacement.preferredWidth ||
			resolved.height < naturalPlacement.preferredHeight,
	);
	function changeShape(next: "single" | "double"): void {
		const columns = SPELL_BAR_INDICES.length / (next === "single" ? 1 : 2);
		// Preserve the user's extra viewing width when folding or unfolding the numbered cells.
		onPlacementChange({
			...naturalPlacement,
			preferredWidth:
				Math.ceil(columns * metrics.cell + casterExtent) +
				preferredWidth -
				minimumWidth,
		});
		onShapeChange(next);
	}
	function measureMetrics(node: HTMLElement) {
		const scrollbarMetric = node.querySelector<HTMLElement>(
			".spell-scrollbar-metrics",
		);
		if (scrollbarMetric === null)
			throw new Error("Missing spell scrollbar metric");
		const casterGapMetric = node.querySelector<HTMLElement>(
			".spell-caster-gap-metrics",
		);
		if (casterGapMetric === null)
			throw new Error("Missing spell caster gap metric");
		const update = () => {
			// Theme probes already resolve CSS lengths; avoid a zoomed bounds round trip.
			const style = getComputedStyle(node);
			const width = Number.parseFloat(style.width);
			const height = Number.parseFloat(style.height);
			const scrollbar = Number.parseFloat(
				getComputedStyle(scrollbarMetric).height,
			);
			if (
				!Number.isFinite(width) ||
				width <= 0 ||
				!Number.isFinite(height) ||
				height <= 0 ||
				!Number.isFinite(scrollbar) ||
				scrollbar <= 0
			)
				throw new Error("Invalid spell bar theme dimensions");
			const casterGap = Number.parseFloat(
				getComputedStyle(casterGapMetric).width,
			);
			if (!Number.isFinite(casterGap) || casterGap < 0)
				throw new Error("Invalid spell caster gap");
			metrics = { cell: width, tabs: height, scrollbar, casterGap };
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
		observer.observe(scrollbarMetric);
		observer.observe(casterGapMetric);
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

<!-- The shell must retain the resolved clipping height rather than refit the full content. -->
<ClientHudPanel
	label="Spell bar"
	{editable}
	placement={naturalPlacement}
	{viewport}
	moveInset={{ left: casterExtent, top: metrics.tabs }}
	minWidth={minimum.width}
	minHeight={minimum.height}
	resizable={true}
	resizeWidthStep={metrics.cell}
	contentHeight={resolved.height}
	contentHitTesting="surface"
	{onPlacementChange}
>
	<div
		class="spell-bar ui-hud-fade"
		class:ui-hud-emphasized={editable}
		data-spell-bar-surface
		style:--spell-cell-size={`${metrics.cell}px`}
		style:--spell-tab-count={tabs.length}
		style:--spell-caster-gap={`${metrics.casterGap}px`}
		data-spell-bar-shape={shape}
	>
		<span class="spell-bar-metrics" aria-hidden="true" use:measureMetrics>
			<span class="spell-scrollbar-metrics"></span>
			<span class="spell-caster-gap-metrics"></span>
		</span>
		<!-- Match the tab strip width while keeping its bookend hints outside the cell scrollport. -->
		<div class="spell-cycle-hints" style:left={`${casterExtent}px`}>
			{#each ["previous", "next"] as const as direction}
				{@const binding = presentClientBinding(
					input,
					{ kind: "spellTabCycle", direction },
					displayPlatform,
				)}
				{#if binding.hint !== null}
					<span
						class="spell-cycle-hint ui-hud-shortcut-label {direction}"
						role="img"
						aria-label={`${direction === "previous" ? "Previous" : "Next"} non-empty spell tab. Key: ${binding.description}`}
						title={`${direction === "previous" ? "Previous" : "Next"} non-empty spell tab — ${binding.description}`}
						>{direction === "previous"
							? `← ${binding.hint}`
							: `${binding.hint} →`}</span
					>
				{/if}
			{/each}
		</div>
		<div class="spell-bar-scroll" class:constrained data-spell-scroll-container>
			{#if caster !== null}
				{@const row = rows.get(caster.spell)}
				<div class="caster-spell" data-caster-spell={caster.spell}>
					<SpellCell
						address={null}
						shortcut={presentClientBinding(
							input,
							{ kind: "spellCaster" },
							displayPlatform,
						)}
						spell={caster.spell}
						onexamine={onExamineSpell}
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
			<div class="spell-shortcuts" style:width={`${stripWidth}px`}>
				<div class="spell-tabs" role="group" aria-label="Spell bar tabs">
					{#each tabs as { index: tab, empty } (tab)}
						{@const binding = presentClientBinding(
							input,
							{ kind: "spellTab", index: tab },
							displayPlatform,
						)}
						<button
							type="button"
							class="spell-tab ui-hud-control"
							data-spell-tab-source={tab}
							data-empty={empty}
							aria-label={`Spell tab ${(tab + 1) % 10} (${binding.description})`}
							title={`Spell tab ${(tab + 1) % 10} — ${binding.description}`}
							aria-pressed={configuration.selected === tab}
							onclick={() => {
								keyboard.returnToGame();
								onSelectTab(tab);
							}}
							><span class="spell-tab-hint">{binding.hint ?? "—"}</span></button
						>
					{/each}
				</div>
				<!-- The configured cells and their scrollbar share a frame; tabs sit above it. -->
				<div class="spell-rail">
					<div
						class="spell-cells-viewport"
						data-spell-scroll-viewport
						bind:this={cellsViewport}
						style:width={`${stripWidth}px`}
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
											Math.floor(slot / SPELL_BAR_INDICES.length) *
												grid.columns +
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
									onexamine={onExamineSpell}
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
							style:--scroll-thumb-width={`${(visibleColumns / totalColumns) * 100}%`}
							oninput={(event) =>
								(cellsViewport.scrollLeft =
									Number(event.currentTarget.value) * metrics.cell)}
						/>
					{/if}
				</div>
			</div>
		</div>
		{#if editable}<ShortcutBarLayoutControls
				label="Toggle spell bar shape"
				topInset={metrics.tabs}
				orientation="horizontal"
				{shape}
				bounds={resolved}
				{viewport}
				onchange={changeShape}
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
		.spell-cycle-hints {
			position: absolute;
			top: 0;
			right: 0;
			max-width: calc(var(--spell-tab-count) * var(--ui-spell-tab-width));
			height: var(--ui-spell-tab-height);
			pointer-events: none;
		}
		.spell-cycle-hint {
			position: absolute;
			z-index: 1;
			top: 50%;
			width: max-content;
			max-width: min(40vw, 16rem);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			transform: translateY(-50%) scale(0.85);
			opacity: 0;
			transition:
				opacity 100ms ease-out,
				transform 100ms ease-out;
		}
		.spell-cycle-hint.previous {
			transform-origin: right center;
			left: auto;
			right: calc(100% + 4px);
		}
		.spell-cycle-hint.next {
			transform-origin: left center;
			left: calc(100% + 4px);
		}
		.spell-bar:hover .spell-cycle-hint,
		.spell-bar:focus-within .spell-cycle-hint {
			transform: translateY(-50%) scale(1);
			opacity: 1;
		}
		.spell-bar-metrics {
			position: absolute;
			visibility: hidden;
			pointer-events: none;
			width: var(--ui-shortcut-cell-size);
			height: var(--ui-spell-tab-height);
		}
		.spell-scrollbar-metrics {
			display: block;
			width: 0;
			height: var(--ui-spell-scrollbar-height);
		}
		.spell-caster-gap-metrics {
			display: block;
			width: var(--ui-spell-caster-gap);
			height: 0;
		}
		.spell-rail {
			position: relative;
		}
		.spell-rail::before {
			/* Overlay the rail so themed frames cannot shift cells or change scroll limits. */
			content: "";
			position: absolute;
			inset: 0;
			z-index: 1;
			pointer-events: none;
			border: 1px solid var(--ui-color-border);
			border-radius: var(--ui-radius-surface);
		}
		.spell-shortcuts {
			/* Keep the shortcut group at its content height beside the equipped spell. */
			align-self: flex-start;
		}
		.spell-bar-scroll {
			display: flex;
			width: 100%;
			height: 100%;
		}
		.spell-bar-scroll.constrained {
			/* Cell overflow has its own viewport; this scrollport is only for a clamped HUD. */
			overflow: auto;
			scrollbar-width: thin;
		}
		.caster-spell {
			flex: 0 0 var(--spell-cell-size);
			width: var(--spell-cell-size);
			height: var(--spell-cell-size);
			margin-right: var(--spell-caster-gap);
			margin-top: var(--ui-spell-tab-height);
		}
		.spell-tabs,
		.spell-cells {
			display: grid;
			width: max-content;
		}
		.spell-tabs {
			grid-template-columns: repeat(var(--spell-tab-count), minmax(0, 1fr));
			width: min(
				100%,
				calc(var(--spell-tab-count) * var(--ui-spell-tab-width))
			);
			height: var(--ui-spell-tab-height);
		}
		.spell-tabs button {
			--ui-hud-control-background: var(
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
			font-size: calc(var(--ui-spell-tab-font-size) * var(--ui-text-scale));
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
		.spell-tabs button[data-empty="true"]:not([aria-pressed="true"]) {
			opacity: var(--ui-spell-empty-tab-opacity);
		}
		.spell-tabs button[aria-pressed="true"] {
			--ui-hud-control-background: var(
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
		.spell-tab:global([data-spell-drop]) {
			outline: 2px solid var(--ui-color-highlight);
			outline-offset: -2px;
		}
		.spell-tabs button:hover:not([aria-pressed="true"]) {
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
