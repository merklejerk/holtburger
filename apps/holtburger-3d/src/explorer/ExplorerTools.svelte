<script lang="ts">
	import type { LandblockId } from "../lib/game/game-types";
	import type { Vec3 } from "../lib/game/math/types";
	import type { SceneResidency } from "../lib/game/scene";
	import type { Camera } from "../lib/game/runtime/types";
	import ExplorerWorldPanel from "./ExplorerWorldPanel.svelte";

	type ExplorerTabId = "world" | "assets" | "entities" | "logs";

	interface ExplorerTab {
		/** Stable tab id used for selection and panel ids. */
		readonly id: ExplorerTabId;
		/** Emoji-only icon shown in the tab button. */
		readonly icon: string;
		/** Accessible and tooltip label for the tab. */
		readonly label: string;
		/** Placeholder text until the explorer workflow is implemented. */
		readonly stub: string;
	}

	interface Props {
		readonly runtimeReady: boolean;
		readonly requestSceneInterest: (
			anchorLandblockId: LandblockId,
			includeEnvCells: boolean,
		) => void;
		readonly queryWorldPointResidency: (point: Vec3) => SceneResidency | null;
		readonly setPrimaryCamera: (camera: Camera) => void;
	}

	let {
		runtimeReady,
		requestSceneInterest,
		queryWorldPointResidency,
		setPrimaryCamera,
	}: Props = $props();

	const tabs: readonly ExplorerTab[] = [
		{
			id: "world",
			icon: "🗺️",
			label: "World",
			stub: "World inspection controls will live here.",
		},
		{
			id: "assets",
			icon: "🧱",
			label: "Assets",
			stub: "Asset lookup and preview controls will live here.",
		},
		{
			id: "entities",
			icon: "👤",
			label: "Entities",
			stub: "Entity search and selection controls will live here.",
		},
		{
			id: "logs",
			icon: "📜",
			label: "Logs",
			stub: "Diagnostics and event history will live here.",
		},
	];

	let expanded = $state(false);
	let activeTabId = $state<ExplorerTabId>("world");

	const activeTab = $derived(
		tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
	);
</script>

<aside class:expanded class="explorer-tools" aria-label="Explorer tools">
	{#if expanded}
		<div class="explorer-tools-expanded">
			<div
				class="explorer-tab-list"
				role="tablist"
				aria-label="Explorer tool tabs"
			>
				{#each tabs as tab}
					<button
						type="button"
						class="explorer-tab-button"
						class:active={tab.id === activeTabId}
						role="tab"
						aria-selected={tab.id === activeTabId}
						aria-controls={`explorer-tab-panel-${tab.id}`}
						id={`explorer-tab-${tab.id}`}
						title={tab.label}
						onclick={() => (activeTabId = tab.id)}
					>
						<span aria-hidden="true">{tab.icon}</span>
						<span class="sr-only">{tab.label}</span>
					</button>
				{/each}
			</div>

			<div class="explorer-tools-panel ac-panel">
				<button
					type="button"
					class="emoji-button explorer-tools-close"
					aria-label="Collapse explorer tools"
					title="Collapse explorer tools"
					onclick={() => (expanded = false)}
				>
					📕
				</button>

				<div class="explorer-tools-body">
					<div
						class="explorer-tab-panel"
						role="tabpanel"
						id={`explorer-tab-panel-${activeTab.id}`}
						aria-labelledby={`explorer-tab-${activeTab.id}`}
					>
						<p class="ac-section-label">{activeTab.label}</p>
						{#if activeTab.id === "world"}
							<ExplorerWorldPanel
								{runtimeReady}
								{requestSceneInterest}
								{queryWorldPointResidency}
								{setPrimaryCamera}
							/>
						{:else}
							<p>{activeTab.stub}</p>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{:else}
		<button
			type="button"
			class="emoji-button explorer-tools-fab"
			aria-label="Open explorer tools"
			title="Open explorer tools"
			onclick={() => (expanded = true)}
		>
			🧭
		</button>
	{/if}
</aside>
