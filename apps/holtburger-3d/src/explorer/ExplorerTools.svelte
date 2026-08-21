<script lang="ts">
	import type { SceneResidency } from "../lib/game/scene";
	import type { SceneInterestRadii } from "../lib/game/runtime/types";
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
	import type { AmbientOcclusionSettings } from "../lib/game/renderer/ambient-occlusion-policy";
	import type { PhysicalCameraStatus } from "./physical-camera-session";
	import type { ExplorerCameraMode } from "../lib/game/motion/host-physical-camera-path";
	import ExplorerEntitiesPanel from "./ExplorerEntitiesPanel.svelte";
	import type { ExplorerCatalogCapability } from "./explorer-entity-commands";
	import type { ExplorerPossession } from "./explorer-entity-possession";
	import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";

	type ExplorerTabId =
		| "world"
		| "frame"
		| "textures"
		| "assets"
		| "entities"
		| "logs";

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
			radii: SceneInterestRadii,
		) => void;
		readonly cameraFocusStatus: ExplorerCameraFocusStatus;
		readonly cameraMode: ExplorerCameraMode;
		readonly cameraModePending: boolean;
		readonly physicalCameraStatus: PhysicalCameraStatus | null;
		readonly physicalCameraError: string | null;
		readonly updateCameraMode: (mode: ExplorerCameraMode) => void;
		readonly environmentSelection: ExplorerEnvironmentSelection;
		readonly dayGroupNames: readonly string[];
		readonly updateEnvironment: (
			selection: ExplorerEnvironmentSelection,
		) => void;
		/** Explorer-local switch controlling distance-fog presentation. */
		readonly distanceFogEnabled: boolean;
		readonly ambientOcclusion: AmbientOcclusionSettings;
		readonly viewerLightEnabled: boolean;
		readonly weatherEnabled: boolean;
		readonly clockFollowing: boolean;
		/** Follow mode: scene interest re-anchors to the camera's landblock on crossings. */
		readonly interestFollowsCamera: boolean;
		readonly audioFollowsCamera: boolean;
		readonly effectVolume: number;
		readonly ambientVolume: number;
		/** Update Explorer's distance-fog presentation switch. */
		readonly updateDistanceFog: (enabled: boolean) => void;
		readonly updateAmbientOcclusionSettings: (
			settings: AmbientOcclusionSettings,
		) => void;
		readonly updateViewerLight: (enabled: boolean) => void;
		readonly updateWeather: (enabled: boolean) => void;
		readonly updateClockFollowing: (enabled: boolean) => void;
		readonly updateInterestFollowsCamera: (enabled: boolean) => void;
		readonly updateAudioFollowsCamera: (enabled: boolean) => void;
		readonly updateEffectVolume: (volume: number) => void;
		readonly updateAmbientVolume: (volume: number) => void;
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
		readonly renderScale: number;
		readonly renderScaleOptions: readonly number[];
		readonly updateRenderScale: (renderScale: number) => void;
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
		readonly entityCatalog: ExplorerCatalogCapability | null;
		readonly spawnedEntities: readonly DynamicEntityView[];
		readonly spawnedEntityPresentationError: string | null;
		readonly spawnExplorerEntity: (
			wcid: string,
			distance: number,
		) => Promise<void>;
		readonly despawnExplorerEntity: (
			entity: DynamicEntityView,
		) => Promise<void>;
		/** Possess one spawned entity so commands reach it, or release with `null`. */
		readonly possessExplorerEntity: (
			guid: number | null,
		) => Promise<ExplorerPossession>;
		readonly setExplorerEntityStance: (style: number) => Promise<void>;
		readonly explorerPossession: ExplorerPossession | null;
	}

	let {
		runtimeReady,
		requestSceneInterest,
		cameraFocusStatus,
		cameraMode,
		cameraModePending,
		physicalCameraStatus,
		physicalCameraError,
		updateCameraMode,
		environmentSelection,
		dayGroupNames,
		updateEnvironment,
		distanceFogEnabled,
		ambientOcclusion,
		viewerLightEnabled,
		weatherEnabled,
		clockFollowing,
		interestFollowsCamera,
		audioFollowsCamera,
		effectVolume,
		ambientVolume,
		updateDistanceFog,
		updateAmbientOcclusionSettings,
		updateViewerLight,
		updateWeather,
		updateClockFollowing,
		updateInterestFollowsCamera,
		updateAudioFollowsCamera,
		updateEffectVolume,
		updateAmbientVolume,
		envCellRenderMode,
		updateEnvCellRenderMode,
		layerVisibility,
		updateLayerVisibility,
		textureFiltering,
		textureFilteringOptions,
		maximumTextureAnisotropy,
		updateTextureFiltering,
		renderScale,
		renderScaleOptions,
		updateRenderScale,
		rendererFrameDiagnostics,
		updateRendererFrameProfiling,
		captureFrameDiagnosticReport,
		authoredDynamicRuntimeDiagnostics,
		readStaticObjectRuntimeDiagnostics,
		readTextureAtlasPage,
		entityCatalog,
		spawnedEntities,
		spawnedEntityPresentationError,
		spawnExplorerEntity,
		despawnExplorerEntity,
		possessExplorerEntity,
		setExplorerEntityStance,
		explorerPossession,
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
			stub: "Catalog-backed Explorer entity controls.",
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
								runtimeReady={runtimeReady && !cameraModePending}
								{requestSceneInterest}
								{cameraFocusStatus}
								{cameraMode}
								{cameraModePending}
								{physicalCameraStatus}
								{physicalCameraError}
								{updateCameraMode}
								{environmentSelection}
								{dayGroupNames}
								{updateEnvironment}
								{distanceFogEnabled}
								{ambientOcclusion}
								{viewerLightEnabled}
								{weatherEnabled}
								{clockFollowing}
								{interestFollowsCamera}
								{updateInterestFollowsCamera}
								{audioFollowsCamera}
								{effectVolume}
								{ambientVolume}
								{updateDistanceFog}
								{updateAmbientOcclusionSettings}
								{updateViewerLight}
								{updateWeather}
								{updateClockFollowing}
								{updateAudioFollowsCamera}
								{updateEffectVolume}
								{updateAmbientVolume}
								{envCellRenderMode}
								{updateEnvCellRenderMode}
								{layerVisibility}
								{updateLayerVisibility}
								{textureFiltering}
								{textureFilteringOptions}
								{maximumTextureAnisotropy}
								{updateTextureFiltering}
								{renderScale}
								{renderScaleOptions}
								{updateRenderScale}
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
						{:else if activeTab.id === "entities"}
							<ExplorerEntitiesPanel
								{runtimeReady}
								catalog={entityCatalog}
								entities={spawnedEntities}
								presentationError={spawnedEntityPresentationError}
								spawn={spawnExplorerEntity}
								despawn={despawnExplorerEntity}
								possess={possessExplorerEntity}
								setStance={setExplorerEntityStance}
								possession={explorerPossession}
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
