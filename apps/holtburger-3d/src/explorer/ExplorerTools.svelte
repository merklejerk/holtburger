<script lang="ts">
	import ExplorerFramePanel from "./ExplorerFramePanel.svelte";
	import ExplorerTexturesPanel from "./ExplorerTexturesPanel.svelte";
	import ExplorerWorldPanel from "./ExplorerWorldPanel.svelte";
	import ExplorerRendererPanel from "./ExplorerRendererPanel.svelte";
	import ExplorerGradingPanel from "./ExplorerGradingPanel.svelte";
	import ExplorerEntitiesPanel from "./ExplorerEntitiesPanel.svelte";
	import type {
		ExplorerToolsCameraSurface,
		ExplorerToolsDiagnosticsSurface,
		ExplorerToolsEntitiesSurface,
		ExplorerToolsEnvironmentSurface,
		ExplorerToolsRenderingSurface,
	} from "./explorer-tools-surfaces";

	type ExplorerTabId =
		"world" | "renderer" | "grading" | "frame" | "textures" | "entities";

	interface ExplorerTab {
		/** Stable tab id used for selection and panel ids. */
		readonly id: ExplorerTabId;
		/** Emoji-only icon shown in the tab button. */
		readonly icon: string;
		/** Accessible and tooltip label for the tab. */
		readonly label: string;
	}

	interface Props {
		readonly camera: ExplorerToolsCameraSurface;
		readonly environment: ExplorerToolsEnvironmentSurface;
		readonly rendering: ExplorerToolsRenderingSurface;
		readonly diagnostics: ExplorerToolsDiagnosticsSurface;
		readonly entities: ExplorerToolsEntitiesSurface;
	}

	let { camera, environment, rendering, diagnostics, entities }: Props =
		$props();

	const tabs: readonly ExplorerTab[] = [
		{
			id: "world",
			icon: "🗺️",
			label: "World",
		},
		{
			id: "renderer",
			icon: "🖥️",
			label: "Renderer",
		},
		{
			id: "grading",
			icon: "🎨",
			label: "Grading",
		},
		{
			id: "frame",
			icon: "🎞️",
			label: "Frame info",
		},
		{
			id: "textures",
			icon: "🖼️",
			label: "Textures",
		},
		{
			id: "entities",
			icon: "👤",
			label: "Entities",
		},
	];

	let expanded = $state(true);
	let activeTabId = $state<ExplorerTabId>("world");
	$effect(() => {
		if (entities.entitySelection !== null) {
			activeTabId = "entities";
			expanded = true;
		}
	});

	const activeTab = $derived(
		tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
	);
</script>

<aside
	class:expanded
	class="explorer-tools ui-theme"
	aria-label="Explorer tools"
>
	{#if expanded}
		<div class="explorer-tools-expanded">
			<div
				class="explorer-tab-list ui-tabs"
				role="tablist"
				aria-label="Explorer tool tabs"
				aria-orientation="vertical"
			>
				{#each tabs as tab}
					<button
						type="button"
						class="explorer-tab-button ui-tab"
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

			<div class="explorer-tools-panel ui-panel">
				<header class="ui-frame">{activeTab.label}</header>
				<button
					type="button"
					class="explorer-tools-close ui-button"
					aria-label="Collapse explorer tools"
					title="Collapse explorer tools"
					onclick={() => (expanded = false)}
				>
					📕
				</button>

				<div class="explorer-tools-body">
					<div
						class="explorer-tab-panel ui-body"
						role="tabpanel"
						id={`explorer-tab-panel-${activeTab.id}`}
						aria-labelledby={`explorer-tab-${activeTab.id}`}
					>
						{#if activeTab.id === "world"}
							<ExplorerWorldPanel
								runtimeReady={camera.runtimeReady && !camera.cameraModePending}
								requestSceneInterest={camera.requestSceneInterest}
								cameraFocusStatus={camera.cameraFocusStatus}
								cameraResidencyLabel={camera.cameraResidencyLabel}
								cameraMode={camera.cameraMode}
								cameraModePending={camera.cameraModePending}
								readPhysicalCameraStatus={camera.readPhysicalCameraStatus}
								physicalCameraError={camera.physicalCameraError}
								updateCameraMode={camera.updateCameraMode}
								environmentSelection={environment.environmentSelection}
								dayGroupNames={environment.dayGroupNames}
								updateEnvironment={environment.updateEnvironment}
								weatherEnabled={environment.weatherEnabled}
								clockFollowing={environment.clockFollowing}
								interestFollowsCamera={camera.interestFollowsCamera}
								updateInterestFollowsCamera={camera.updateInterestFollowsCamera}
								audioFollowsCamera={camera.audioFollowsCamera}
								effectVolume={environment.effectVolume}
								ambientVolume={environment.ambientVolume}
								updateWeather={environment.updateWeather}
								updateClockFollowing={environment.updateClockFollowing}
								updateAudioFollowsCamera={camera.updateAudioFollowsCamera}
								updateEffectVolume={environment.updateEffectVolume}
								updateAmbientVolume={environment.updateAmbientVolume}
							/>
						{:else if activeTab.id === "renderer"}
							<ExplorerRendererPanel
								runtimeReady={camera.runtimeReady}
								distanceFogEnabled={rendering.distanceFogEnabled}
								updateDistanceFog={rendering.updateDistanceFog}
								viewerLightEnabled={rendering.viewerLightEnabled}
								updateViewerLight={rendering.updateViewerLight}
								envCellRenderMode={rendering.envCellRenderMode}
								updateEnvCellRenderMode={rendering.updateEnvCellRenderMode}
								layerVisibility={rendering.layerVisibility}
								updateLayerVisibility={rendering.updateLayerVisibility}
								showRetailHiddenGeometry={rendering.showRetailHiddenGeometry}
								updateShowRetailHiddenGeometry={rendering.updateShowRetailHiddenGeometry}
								nameplates={rendering.nameplates}
								updateNameplateCategory={rendering.updateNameplateCategory}
								ambientOcclusion={rendering.ambientOcclusion}
								updateAmbientOcclusionSettings={rendering.updateAmbientOcclusionSettings}
								entityShadows={rendering.entityShadows}
								updateEntityShadowSettings={rendering.updateEntityShadowSettings}
								textureFiltering={rendering.textureFiltering}
								textureFilteringOptions={rendering.textureFilteringOptions}
								maximumTextureAnisotropy={rendering.maximumTextureAnisotropy}
								updateTextureFiltering={rendering.updateTextureFiltering}
								renderScale={rendering.renderScale}
								renderScaleOptions={rendering.renderScaleOptions}
								updateRenderScale={rendering.updateRenderScale}
							/>
						{:else if activeTab.id === "grading"}
							<ExplorerGradingPanel
								colorGrade={rendering.colorGrade}
								updateColorGradeSettings={rendering.updateColorGradeSettings}
							/>
						{:else if activeTab.id === "frame"}
							<ExplorerFramePanel
								readRendererFrameDiagnostics={diagnostics.readRendererFrameDiagnostics}
								readAuthoredDynamicRuntimeDiagnostics={diagnostics.readAuthoredDynamicRuntimeDiagnostics}
								readPerformanceSession={diagnostics.readPerformanceSession}
								captureReport={diagnostics.captureFrameDiagnosticReport}
							/>
						{:else if activeTab.id === "textures"}
							<ExplorerTexturesPanel
								readDiagnostics={diagnostics.readStaticObjectRuntimeDiagnostics}
								readTextureAtlasPage={diagnostics.readTextureAtlasPage}
							/>
						{:else if activeTab.id === "entities"}
							<ExplorerEntitiesPanel
								selection={entities.entitySelection}
								select={entities.selectEntity}
								runtimeReady={camera.runtimeReady}
								catalog={entities.entityCatalog}
								entities={entities.spawnedEntities}
								presentationError={entities.spawnedEntityPresentationError}
								spawn={entities.spawnExplorerEntity}
								search={entities.searchExplorerWeenies}
								despawn={entities.despawnExplorerEntity}
								possess={entities.possessExplorerEntity}
								setStance={entities.setExplorerEntityStance}
								setRunRate={entities.setExplorerEntityRunRate}
								possession={entities.explorerPossession}
								possessionControls={entities.explorerPossessionControls}
								readPossessionMotionProbe={entities.readPossessionMotionProbe}
								readExplorerEntity={entities.readExplorerEntity}
								readBoomCameraStatus={entities.readBoomCameraStatus}
							/>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{:else}
		<button
			type="button"
			class="explorer-tools-fab ui-button"
			aria-label="Open explorer tools"
			title="Open explorer tools"
			onclick={() => (expanded = true)}
		>
			🧭
		</button>
	{/if}
</aside>
