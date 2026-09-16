<script lang="ts">
	import { tick } from "svelte";
	import { useAppInputPolicy } from "../lib/input/app-input-policy-context";
	import type { InputDigitIndex } from "../lib/input/input-contract";
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
	interface Props {
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
		/** App-owned configuration survives hidden markup. */
		configuration: ClientSpellBarState;
		/** App-owned runtime availability. */
		enabled: boolean;
		/** Tab selection and casting share the keyboard entry points. */
		onSelectTab: (tab: InputDigitIndex) => void;
		onActivateCell: (slot: InputDigitIndex) => void;
	}
	let {
		placement,
		shape,
		editable,
		viewport,
		onPlacementChange,
		onShapeChange,
		spells,
		configuration,
		enabled,
		onSelectTab,
		onActivateCell,
	}: Props = $props();
	const { keyboard } = useAppInputPolicy();
	/** Cold measured CSS geometry also drives HUD placement and strip geometry. */
	let metrics = $state<{ cell: number; tabs: number }>({
		cell: CLIENT_ACTION_BAR_TUNING.initialCellSize,
		tabs: 0,
	});
	const grid = $derived.by(() => {
		const rows = shape === "single" ? 1 : 2;
		return { rows, columns: SPELL_BAR_INDICES.length / rows };
	});
	const naturalPlacement = $derived({
		...placement,
		preferredWidth: grid.columns * metrics.cell,
		preferredHeight: grid.rows * metrics.cell + metrics.tabs,
	});
	const minimum = $derived({
		width: metrics.cell,
		height: metrics.cell + metrics.tabs,
	});
	const resolved = $derived(
		resolveClientHudPlacement(naturalPlacement, viewport, minimum),
	);
	function measureMetrics(node: HTMLElement) {
		const update = () => {
			const { width, height } = node.getBoundingClientRect();
			if (
				!Number.isFinite(width) ||
				width <= 0 ||
				!Number.isFinite(height) ||
				height <= 0
			)
				throw new Error("Invalid spell bar theme dimensions");
			metrics = { cell: width, tabs: height };
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
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
				configuration.tabs[configuration.selected].filter((id) => id !== null),
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
		<span class="spell-bar-metrics" aria-hidden="true" use:measureMetrics
		></span>
		<div class="spell-bar-scroll">
			<div class="spell-tabs" role="group" aria-label="Spell bar tabs">
				{#each SPELL_BAR_INDICES as tab}
					<button
						type="button"
						class="ui-hud-button"
						aria-label={`Spell tab ${(tab + 1) % 10}`}
						aria-pressed={configuration.selected === tab}
						onclick={() => {
							keyboard.returnToGame();
							onSelectTab(tab);
						}}>{(tab + 1) % 10}</button
					>
				{/each}
			</div>
			<div
				class="spell-cells"
				style:grid-template-columns={`repeat(${grid.columns}, ${metrics.cell}px)`}
				role="group"
				aria-label={`Spell bar ${(configuration.selected + 1) % 10}`}
			>
				{#each SPELL_BAR_INDICES as slot}
					{@const spell = configuration.tabs[configuration.selected][slot]}
					{@const row = spell === null ? undefined : rows.get(spell)}
					{@const available =
						enabled && spell !== null && known?.includes(spell) === true}
					<SpellCell
						address={{ tab: configuration.selected, slot }}
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
		.spell-bar-scroll {
			width: 100%;
			height: 100%;
			overflow: auto;
			scrollbar-width: thin;
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
			grid-auto-rows: var(--spell-cell-size);
		}
	}
</style>
