<script lang="ts">
	import UiTabPanel from "../../app/ui/UiTabPanel.svelte";
	import UiTabs from "../../app/ui/UiTabs.svelte";
	import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
	import type { WeenieCatalogCapability } from "../../lib/host/weenie-catalog-capability";
	import ExplorerEntityList from "./ExplorerEntityList.svelte";
	import ExplorerEntitySpawnComposer from "./ExplorerEntitySpawnComposer.svelte";
	import type {
		ExplorerWeenieSearchRequest,
		ExplorerWeenieSearchResult,
	} from "./entity-commands";
	import type {
		ExplorerEntityOperation,
		ExplorerEntitySelection,
	} from "./entity-panel-state";

	type EntitiesTab = "spawn" | "active";

	interface Props {
		readonly selection: ExplorerEntitySelection | null;
		readonly possessed: ExplorerEntitySelection | null;
		readonly select: (selection: ExplorerEntitySelection) => void;
		readonly onInspect: (selection: ExplorerEntitySelection) => void;
		readonly runtimeReady: boolean;
		readonly catalog: WeenieCatalogCapability | null;
		readonly entities: readonly DynamicEntityView[];
		readonly pending: ExplorerEntityOperation | null;
		readonly search: (
			request: ExplorerWeenieSearchRequest,
		) => Promise<readonly ExplorerWeenieSearchResult[]>;
		readonly spawn: (wcid: number, distance: number) => Promise<void>;
		readonly clearAll: () => Promise<void>;
	}

	const {
		selection,
		possessed,
		select,
		onInspect,
		runtimeReady,
		catalog,
		entities,
		pending,
		search,
		spawn,
		clearAll,
	}: Props = $props();

	let activeTab = $state<EntitiesTab>("spawn");

	const catalogReady = $derived(catalog?.status === "available");
	const recordCount = $derived(
		catalog?.status === "available" ? catalog.recordCount : null,
	);
	const tabs = $derived([
		{
			value: "spawn" as const,
			label: "Spawn",
			id: "explorer-entities-spawn-tab",
			panelId: "explorer-entities-spawn-panel",
		},
		{
			value: "active" as const,
			label: entities.length > 0 ? `Active (${entities.length})` : "Active",
			id: "explorer-entities-active-tab",
			panelId: "explorer-entities-active-panel",
		},
	] as const);
</script>

<div class="explorer-entities-window ui-tabbed-panel ui-body">
	<UiTabs
		{tabs}
		selected={activeTab}
		label="Entities sections"
		onSelect={(value) => (activeTab = value)}
	/>

	<UiTabPanel
		id="explorer-entities-spawn-panel"
		labelledBy="explorer-entities-spawn-tab"
		active={activeTab === "spawn"}
		scroll={false}
	>
		<div class="entities-tab-body">
			{#if catalog?.status === "unavailable"}
				<p class="panel-note invalid">
					{catalog.reason} Configure a compiled <code>weenies.hwc</code> catalog in
					the Explorer Launcher to enable entity spawning.
				</p>
			{/if}
			<ExplorerEntitySpawnComposer
				enabled={runtimeReady && catalogReady}
				busy={pending !== null}
				spawning={pending?.kind === "spawn"}
				{recordCount}
				{search}
				{spawn}
			/>
		</div>
	</UiTabPanel>

	<UiTabPanel
		id="explorer-entities-active-panel"
		labelledBy="explorer-entities-active-tab"
		active={activeTab === "active"}
		scroll={false}
	>
		<div class="entities-active-tab">
			<div class="entities-active-header">
				<span class="entities-count">
					{entities.length === 1 ? "1 entity" : `${entities.length} entities`}
				</span>
				<button
					type="button"
					class="ui-button"
					disabled={!runtimeReady || entities.length === 0 || pending !== null}
					onclick={() => void clearAll()}
				>
					{pending?.kind === "reset-all" ? "Clearing…" : "Clear all"}
				</button>
			</div>
			<div class="entities-active-list">
				<ExplorerEntityList
					{entities}
					selected={selection}
					{possessed}
					{select}
					{onInspect}
				/>
			</div>
		</div>
	</UiTabPanel>
</div>

<style>
	@layer components {
		.explorer-entities-window {
			height: 100%;
			min-height: 0;
		}
		.entities-tab-body {
			display: flex;
			flex-direction: column;
			gap: 8px;
			height: 100%;
			min-height: 0;
		}
		.entities-tab-body > :global(:last-child) {
			flex: 1;
			min-height: 0;
		}
		.entities-active-tab {
			display: grid;
			grid-template-rows: auto minmax(0, 1fr);
			gap: 8px;
			height: 100%;
			min-height: 0;
		}
		.entities-active-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
		}
		.entities-count {
			color: var(--ui-color-muted);
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
		}
		.entities-active-list {
			min-height: 0;
			overflow-y: auto;
		}
		.panel-note {
			margin: 0;
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
		}
		.invalid {
			color: var(--ui-color-danger);
		}
	}
</style>
