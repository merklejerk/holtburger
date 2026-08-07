<script lang="ts">
	import type { SceneResidency } from "../lib/game/scene";
	import type { LoDConfig } from "../lib/game/runtime/types";
	import type { ExplorerCameraFocusStatus } from "./explorer-camera-coordinator";
	import ExplorerFramePanel from "./ExplorerFramePanel.svelte";
	import ExplorerTexturesPanel from "./ExplorerTexturesPanel.svelte";
	import ExplorerWorldPanel from "./ExplorerWorldPanel.svelte";
	import type { StaticObjectRuntimeDiagnostics } from "../lib/game/runtime/game-runtime";
	import type { GameRuntime } from "../lib/game/runtime/game-runtime";
	import type { ExplorerEnvironmentSelection } from "../lib/game/environment/scene-environment";
	import type {
		EnvCellRenderMode,
		RendererFrameDiagnosticsSnapshot,
	} from "../lib/game/renderer/renderer";
	import type { Texture2DReadback } from "../lib/game/renderer/webgl2-device";
	import type { TexturePageId } from "../lib/game/textures/texture-manager";
	import type { TextureFilteringPolicy } from "../lib/game/renderer/texture-filtering-policy";
	import type { RenderLayerVisibility } from "../lib/game/renderer/renderer";
	import type { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
	import type { ExplorerFrameDiagnosticReport } from "./explorer-frame-diagnostic-report";

	type ExplorerTabId =
		"world" | "frame" | "textures" | "assets" | "entities" | "logs";

	interface ExplorerTab {
		/** Stable tab id used for selection and panel ids. */
		readonly id: ExplorerTabId;
		/** Emoji-only icon shown in the tab button. */
		readonly icon: string;
		/** Accessible and tooltip label for the tab. */
		readonly label: string;
		/** Supporting text for tabs without a dedicated panel component. */
		readonly stub: string;
	}

	interface Props {
		readonly runtimeReady: boolean;
		readonly requestSceneInterest: (
			residency: SceneResidency,
			lod: LoDConfig,
		) => void;
		readonly cameraFocusStatus: ExplorerCameraFocusStatus;
		readonly environmentSelection: ExplorerEnvironmentSelection;
		readonly dayGroupNames: readonly string[];
		readonly updateEnvironment: (
			selection: ExplorerEnvironmentSelection,
		) => void;
		/** Explorer-local switch controlling distance-fog presentation. */
		readonly distanceFogEnabled: boolean;
		readonly viewerLightEnabled: boolean;
		readonly clockFollowing: boolean;
		readonly audioFollowsCamera: boolean;
		readonly effectVolume: number;
		/** Update Explorer's distance-fog presentation switch. */
		readonly updateDistanceFog: (enabled: boolean) => void;
		readonly updateViewerLight: (enabled: boolean) => void;
		readonly updateClockFollowing: (enabled: boolean) => void;
		readonly updateAudioFollowsCamera: (enabled: boolean) => void;
		readonly updateEffectVolume: (volume: number) => void;
		readonly envCellRenderMode: EnvCellRenderMode;
		readonly updateEnvCellRenderMode: (mode: EnvCellRenderMode) => void;
		readonly layerVisibility: RenderLayerVisibility;
		readonly updateLayerVisibility: (
			layer: LandblockLayerKind,
			visible: boolean,
		) => void;
		/** Effective filterable texture quality selected for the next frame. */
		readonly textureFiltering: TextureFilteringPolicy;
		/** Device-supported texture filtering choices in display order. */
		readonly textureFilteringOptions: readonly TextureFilteringPolicy[];
		/** Raw device maximum shown beside the client-capped choices. */
		readonly maximumTextureAnisotropy: number | null;
		readonly updateTextureFiltering: (policy: TextureFilteringPolicy) => void;
		/** Latest atomic read of renderer selection and explicit profiling state. */
		readonly rendererFrameDiagnostics: RendererFrameDiagnosticsSnapshot | null;
		/** Explicitly create or tear down the renderer profiling session. */
		readonly updateRendererFrameProfiling: (enabled: boolean) => void;
		/** Compose current renderer and Explorer context into one exportable report. */
		readonly captureFrameDiagnosticReport: () => ExplorerFrameDiagnosticReport | null;
		readonly authoredDynamicRuntimeDiagnostics: ReturnType<
			GameRuntime["getAuthoredDynamicRuntimeDiagnostics"]
		> | null;
		/** Read an outdoor-static and texture atlas snapshot for the Explorer inspector. */
		readonly readStaticObjectRuntimeDiagnostics: () => StaticObjectRuntimeDiagnostics | null;
		/** Explicit diagnostic readback of one active packed atlas page. */
		readonly readTextureAtlasPage: (pageId: TexturePageId) => Texture2DReadback;
	}

	let {
		runtimeReady,
		requestSceneInterest,
		cameraFocusStatus,
		environmentSelection,
		dayGroupNames,
		updateEnvironment,
		distanceFogEnabled,
		viewerLightEnabled,
		clockFollowing,
		audioFollowsCamera,
		effectVolume,
		updateDistanceFog,
		updateViewerLight,
		updateClockFollowing,
		updateAudioFollowsCamera,
		updateEffectVolume,
		envCellRenderMode,
		updateEnvCellRenderMode,
		layerVisibility,
		updateLayerVisibility,
		textureFiltering,
		textureFilteringOptions,
		maximumTextureAnisotropy,
		updateTextureFiltering,
		rendererFrameDiagnostics,
		updateRendererFrameProfiling,
		captureFrameDiagnosticReport,
		authoredDynamicRuntimeDiagnostics,
		readStaticObjectRuntimeDiagnostics,
		readTextureAtlasPage,
	}: Props = $props();

	const tabs: readonly ExplorerTab[] = [
		{
			id: "world",
			icon: "🗺️",
			label: "World",
			stub: "World inspection controls will live here.",
		},
		{
			id: "frame",
			icon: "🎞️",
			label: "Frame info",
			stub: "Renderer frame selection diagnostics.",
		},
		{
			id: "textures",
			icon: "🖼️",
			label: "Textures",
			stub: "Packed texture atlas page diagnostics.",
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

	let expanded = $state(true);
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
								{cameraFocusStatus}
								{environmentSelection}
								{dayGroupNames}
								{updateEnvironment}
								{distanceFogEnabled}
								{viewerLightEnabled}
								{clockFollowing}
								{audioFollowsCamera}
								{effectVolume}
								{updateDistanceFog}
								{updateViewerLight}
								{updateClockFollowing}
								{updateAudioFollowsCamera}
								{updateEffectVolume}
								{envCellRenderMode}
								{updateEnvCellRenderMode}
								{layerVisibility}
								{updateLayerVisibility}
								{textureFiltering}
								{textureFilteringOptions}
								{maximumTextureAnisotropy}
								{updateTextureFiltering}
							/>
						{:else if activeTab.id === "frame"}
							<ExplorerFramePanel
								diagnostics={rendererFrameDiagnostics}
								dynamics={authoredDynamicRuntimeDiagnostics}
								setProfilingEnabled={updateRendererFrameProfiling}
								captureReport={captureFrameDiagnosticReport}
							/>
						{:else if activeTab.id === "textures"}
							<ExplorerTexturesPanel
								readDiagnostics={readStaticObjectRuntimeDiagnostics}
								{readTextureAtlasPage}
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
