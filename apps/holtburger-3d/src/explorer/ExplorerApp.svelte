<script lang="ts">
	import { onMount } from "svelte";
	import { TauriAnimationAssetSource } from "../lib/assets/tauri-animation-asset-source";
	import FrameMetricsOverlay, {
		type FrameMetrics,
	} from "../app/FrameMetricsOverlay.svelte";
	import ExplorerTools from "./ExplorerTools.svelte";
	import ExplorerCameraLocation from "./ExplorerCameraLocation.svelte";
	import {
		GameRuntime,
		type StaticObjectRuntimeDiagnostics,
	} from "../lib/game/runtime/game-runtime";
	import { StandardCommitPipeline } from "../lib/game/commit/pipeline";
	import { WebGL2Device } from "../lib/game/renderer/webgl2-device";
	import { TauriActiveRegionSource } from "../lib/assets/tauri-active-region-source";
	import { TauriLandblockSourceBatch } from "../lib/assets/tauri-landblock-source-batch";
	import { TauriTexturePixelSource } from "../lib/assets/tauri-texture-pixel-source";
	import type { LoDConfig } from "../lib/game/runtime/types";
	import { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
	import type { SceneResidency } from "../lib/game/scene";
	import {
		DEFAULT_FRAME_SETTINGS,
		type FrameSettings,
		type EnvCellRenderMode,
		type RendererFrameDiagnosticsSnapshot,
	} from "../lib/game/renderer/renderer";
	import {
		ExplorerCameraCoordinator,
		type ExplorerCameraFocusStatus,
	} from "./explorer-camera-coordinator";
	import { FreeFlyCameraController } from "./free-fly-camera-controller";
	import {
		resolveSceneEnvironment,
		type ExplorerEnvironmentSelection,
	} from "../lib/game/environment/scene-environment";
	import { resolveClockDayFraction } from "../lib/game/environment/game-clock";
	import type { ActiveRegionSource } from "../lib/assets/active-region-source";
	import { ActiveRegionStaticDetailOwner } from "../lib/game/resolution/active-region-static-detail";
	import type { Texture2DReadback } from "../lib/game/renderer/webgl2-device";
	import type { TexturePageId } from "../lib/game/textures/texture-manager";
	import type { ExplorerCameraLocation as ExplorerCameraLocationState } from "./explorer-camera-location";
	import {
		resolveTextureFilteringPolicy,
		supportedTextureFilteringPolicies,
		type TextureFilteringCapabilities,
		type TextureFilteringPolicy,
	} from "../lib/game/renderer/texture-filtering-policy";
	import {
		createExplorerFrameDiagnosticReport,
		type ExplorerFrameDiagnosticReport,
		type ExplorerSceneInterestSnapshot,
	} from "./explorer-frame-diagnostic-report";

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let frameHandle: number | null = null;
	let gameRuntime: GameRuntime | undefined;
	let commitPipeline: StandardCommitPipeline | undefined;
	let webglDevice: WebGL2Device | undefined;
	let activeRegionSource: TauriActiveRegionSource | undefined;
	let staticDetailOwner: ActiveRegionStaticDetailOwner | undefined;
	let cameraController: FreeFlyCameraController | undefined;
	let cameraCoordinator: ExplorerCameraCoordinator | undefined;
	let frameMetrics: FrameMetrics | null = $state(null);
	let rendererFrameDiagnostics: RendererFrameDiagnosticsSnapshot | null =
		$state(null);
	let sceneInterest: ExplorerSceneInterestSnapshot | null = null;
	let authoredDynamicRuntimeDiagnostics: ReturnType<
		GameRuntime["getAuthoredDynamicRuntimeDiagnostics"]
	> | null = $state(null);
	let lastFrameSelectionSampleAt = 0;
	let startupError: string | null = $state(null);
	let runtimeReady = $state(false);
	let cameraFocusStatus = $state<ExplorerCameraFocusStatus>(
		"No camera focus requested.",
	);
	let cameraLocation = $state<ExplorerCameraLocationState | null>(null);
	let activeRegion = $state<ActiveRegionSource | undefined>(undefined);
	/** Fast enough that a tick boundary is never visibly late; resolution is tick-quantized. */
	const CLOCK_SAMPLE_INTERVAL_MS = 250;
	/** Retail's `SkyDesc` default, used only when a region authors no sky (acclient.c:290941). */
	const DEFAULT_LIGHT_TICK_SECONDS = 20;

	let textureFilteringCapabilities =
		$state<TextureFilteringCapabilities | null>(null);
	let environmentSelection = $state<ExplorerEnvironmentSelection>({
		dayIndex: 0,
		timeOfDay: 0.5,
		dayGroupOverride: null,
	});
	/** Explorer-local dynamic display choices; they do not alter resolved regional data. */
	let frameSettings = $state<FrameSettings>({ ...DEFAULT_FRAME_SETTINGS });
	const supportedTextureFiltering = $derived(
		textureFilteringCapabilities === null
			? []
			: supportedTextureFilteringPolicies(textureFilteringCapabilities),
	);
	const effectiveTextureFiltering = $derived(
		textureFilteringCapabilities === null
			? frameSettings.quality.textureFiltering
			: resolveTextureFilteringPolicy(
					frameSettings.quality.textureFiltering,
					textureFilteringCapabilities,
				),
	);

	function updateEnvironment(selection: ExplorerEnvironmentSelection): void {
		environmentSelection = selection;
		applyEnvironment();
	}

	/**
	 * Follow the regional clock instead of the explicit time-of-day slider.
	 *
	 * Retail always runs the clock; the slider is this app's equivalent of the `/day` override
	 * (`LScape::SetDay`, acclient.c:295885), so the two are one path with a selector rather than
	 * two ways to reach the same resolution.
	 */
	let clockFollowing = $state(false);
	let clockStartedAtMs = 0;
	let clockTimer: ReturnType<typeof setInterval> | undefined;

	function updateClockFollowing(enabled: boolean): void {
		clockFollowing = enabled;
		clearInterval(clockTimer);
		clockTimer = undefined;
		if (!enabled) {
			applyEnvironment();
			return;
		}
		clockStartedAtMs = performance.now();
		applyEnvironment();
		// Sampling faster than the authored light tick costs nothing: the resolved fraction is
		// tick-quantized, so extra samples resolve to the identical environment.
		clockTimer = setInterval(applyEnvironment, CLOCK_SAMPLE_INTERVAL_MS);
	}

	function updateDistanceFog(enabled: boolean): void {
		frameSettings = { ...frameSettings, distanceFogEnabled: enabled };
		applyFrameSettings();
	}

	function updateViewerLight(enabled: boolean): void {
		frameSettings = { ...frameSettings, viewerLightEnabled: enabled };
		applyFrameSettings();
	}

	function updateEnvCellRenderMode(mode: EnvCellRenderMode): void {
		frameSettings = { ...frameSettings, envCellRenderMode: mode };
		applyFrameSettings();
	}

	function updateLayerVisibility(
		layer: LandblockLayerKind,
		visible: boolean,
	): void {
		frameSettings = {
			...frameSettings,
			layerVisibility: { ...frameSettings.layerVisibility, [layer]: visible },
		};
		applyFrameSettings();
	}

	function updateTextureFiltering(
		textureFiltering: TextureFilteringPolicy,
	): void {
		frameSettings = {
			...frameSettings,
			quality: { ...frameSettings.quality, textureFiltering },
		};
		applyFrameSettings();
	}

	function readStaticObjectRuntimeDiagnostics(): StaticObjectRuntimeDiagnostics | null {
		return gameRuntime?.getStaticObjectRuntimeDiagnostics() ?? null;
	}

	function updateRendererFrameProfiling(enabled: boolean): void {
		if (!gameRuntime)
			throw new Error("Renderer profiling requires an active runtime.");
		gameRuntime.setRendererFrameProfilingEnabled(enabled);
		rendererFrameDiagnostics = gameRuntime.getRendererFrameDiagnostics();
	}

	function captureFrameDiagnosticReport(): ExplorerFrameDiagnosticReport | null {
		if (!gameRuntime || !webglDevice || !canvasElement) return null;
		const frame = gameRuntime.getRendererFrameDiagnostics();
		if (!frame) return null;
		const viewport = canvasElement.getBoundingClientRect();
		return createExplorerFrameDiagnosticReport({
			applicationFrame: frameMetrics,
			browser: {
				userAgent: navigator.userAgent,
				webgl: webglDevice.getDiagnosticIdentity(),
			},
			camera: cameraController?.snapshotState() ?? null,
			cameraLocation,
			capturedAt: new Date().toISOString(),
			environment: environmentSelection,
			frame,
			frameSettings,
			sceneInterest,
			viewport: {
				cssHeight: viewport.height,
				cssWidth: viewport.width,
				devicePixelRatio: window.devicePixelRatio,
				drawingBufferHeight: canvasElement.height,
				drawingBufferWidth: canvasElement.width,
			},
		});
	}

	function applyEnvironment(): void {
		if (!activeRegion) return;
		const environment = resolveSceneEnvironment(activeRegion, {
			...environmentSelection,
			timeOfDay: clockFollowing
				? resolveClockDayFraction(
						(performance.now() - clockStartedAtMs) / 1_000,
						activeRegion.data.calendar.dayLength,
						activeRegion.data.sky?.lightTickSize ?? DEFAULT_LIGHT_TICK_SECONDS,
					)
				: environmentSelection.timeOfDay,
		});
		gameRuntime?.setSceneEnvironment(environment);
	}

	function applyFrameSettings(): void {
		gameRuntime?.setFrameSettings(frameSettings);
	}

	function requestSceneInterest(
		residency: SceneResidency,
		lod: LoDConfig,
	): void {
		cameraCoordinator?.requestSceneInterest(residency, lod);
		sceneInterest = {
			lod: { ...lod },
			residency: { ...residency },
		};
	}

	function readTextureAtlasPage(pageId: TexturePageId): Texture2DReadback {
		if (!gameRuntime || !webglDevice) {
			throw new Error(
				"Texture page readback requires an active Explorer runtime.",
			);
		}
		return webglDevice.readTexture2D(
			gameRuntime.getTextureAtlasPageResource(pageId),
		);
	}

	onMount(() => {
		if (canvasElement === null) {
			startupError = "Explorer canvas was not mounted.";
			return;
		}

		let destroyed = false;
		let teardown: Promise<void> | undefined;

		const stopFrameLoop = (): void => {
			if (frameHandle === null) return;
			window.cancelAnimationFrame(frameHandle);
			frameHandle = null;
		};

		const destroySystems = (): Promise<void> => {
			if (teardown) return teardown;
			const runtime = gameRuntime;
			const pipeline = commitPipeline;
			const device = webglDevice;
			const regionSource = activeRegionSource;
			const detailOwner = staticDetailOwner;
			const coordinator = cameraCoordinator;
			const controller = cameraController;
			gameRuntime = undefined;
			runtimeReady = false;
			cameraLocation = null;
			rendererFrameDiagnostics = null;
			sceneInterest = null;
			authoredDynamicRuntimeDiagnostics = null;
			commitPipeline = undefined;
			webglDevice = undefined;
			textureFilteringCapabilities = null;
			activeRegionSource = undefined;
			staticDetailOwner = undefined;
			activeRegion = undefined;
			cameraCoordinator = undefined;
			cameraController = undefined;
			teardown = (async () => {
				stopFrameLoop();
				coordinator?.dispose();
				controller?.dispose();
				try {
					await runtime?.destroy();
				} finally {
					try {
						await pipeline?.destroy();
					} finally {
						try {
							await device?.destroy();
						} finally {
							detailOwner?.teardown();
							regionSource?.destroy();
						}
					}
				}
			})();
			return teardown;
		};

		const start = async (): Promise<void> => {
			try {
				activeRegionSource = TauriActiveRegionSource.build();
				activeRegion = await activeRegionSource.load();
				if (destroyed) return;
				const sourceBatch = TauriLandblockSourceBatch.build(activeRegion);
				const texturePixelSource = TauriTexturePixelSource.build();
				staticDetailOwner = new ActiveRegionStaticDetailOwner(
					texturePixelSource,
				);
				const staticDetailBinding =
					await staticDetailOwner.install(activeRegion);
				if (destroyed) return;
				webglDevice = await WebGL2Device.build(canvasElement!);
				textureFilteringCapabilities =
					webglDevice.getTextureFilteringCapabilities();
				if (destroyed) return;
				commitPipeline = await StandardCommitPipeline.build({
					sourceBatch,
				});
				if (destroyed) return;

				gameRuntime = await GameRuntime.build(
					webglDevice,
					commitPipeline,
					texturePixelSource,
					TauriAnimationAssetSource.build(),
				);
				gameRuntime.installActiveRegionStaticDetails(staticDetailBinding);
				applyEnvironment();
				applyFrameSettings();
				if (destroyed) return;
				cameraController = new FreeFlyCameraController({
					canvas: canvasElement!,
					onChange(state) {
						if (cameraCoordinator) {
							cameraCoordinator.handleCameraState(state);
						}
					},
				});
				cameraCoordinator = new ExplorerCameraCoordinator(
					gameRuntime,
					cameraController,
					(status) => (cameraFocusStatus = status),
				);
				runtimeReady = true;

				const step = (): void => {
					if (gameRuntime === undefined) {
						frameMetrics = null;
						rendererFrameDiagnostics = null;
						authoredDynamicRuntimeDiagnostics = null;
						frameHandle = window.requestAnimationFrame(step);
						return;
					}

					const tickStartedAt = performance.now();
					gameRuntime.tick();
					const residencySync = cameraCoordinator?.syncCameraResidency();
					if (!residencySync) {
						throw new Error(
							"Explorer camera coordinator is unavailable during rendering.",
						);
					}
					cameraLocation = residencySync.location;
					const drawStartedAt = performance.now();
					if (residencySync.renderable) {
						gameRuntime.render(performance.now() / 1_000);
					}
					const frameFinishedAt = performance.now();

					frameMetrics = {
						tickMs: drawStartedAt - tickStartedAt,
						updateFrameMs: frameFinishedAt - drawStartedAt,
						frameMs: frameFinishedAt - tickStartedAt,
					};
					if (frameFinishedAt - lastFrameSelectionSampleAt >= 250) {
						rendererFrameDiagnostics =
							gameRuntime.getRendererFrameDiagnostics();
						authoredDynamicRuntimeDiagnostics =
							gameRuntime.getAuthoredDynamicRuntimeDiagnostics();
						lastFrameSelectionSampleAt = frameFinishedAt;
					}
					frameHandle = window.requestAnimationFrame(step);
				};

				frameHandle = window.requestAnimationFrame(step);
			} catch (error) {
				startupError =
					error instanceof Error
						? error.message
						: "Failed to initialize renderer.";
				await destroySystems();
			}
		};

		const startup = start();

		return () => {
			destroyed = true;
			clearInterval(clockTimer);
			clockTimer = undefined;
			void startup
				.then(() => destroySystems())
				.catch((error: unknown) =>
					console.error("Failed to shut down explorer systems.", error),
				);
		};
	});
</script>

<div class="explorer-screen">
	<canvas
		bind:this={canvasElement}
		class="explorer-canvas"
		aria-label="Explorer render viewport"
		tabindex="0"
	></canvas>

	<div class="explorer-overlay">
		{#if startupError !== null}
			<section class="explorer-startup-error" role="alert">
				{startupError}
			</section>
		{/if}

		<FrameMetricsOverlay metrics={frameMetrics} />
		{#if startupError === null}
			<ExplorerCameraLocation location={cameraLocation} />
		{/if}
		<ExplorerTools
			{runtimeReady}
			{requestSceneInterest}
			{cameraFocusStatus}
			{environmentSelection}
			dayGroupNames={activeRegion?.data.sky?.dayGroups.map(
				({ dayName }) => dayName,
			) ?? []}
			{updateEnvironment}
			distanceFogEnabled={frameSettings.distanceFogEnabled}
			{clockFollowing}
			{updateClockFollowing}
			{updateDistanceFog}
			{updateViewerLight}
			viewerLightEnabled={frameSettings.viewerLightEnabled}
			envCellRenderMode={frameSettings.envCellRenderMode}
			{updateEnvCellRenderMode}
			layerVisibility={frameSettings.layerVisibility}
			{updateLayerVisibility}
			textureFiltering={effectiveTextureFiltering}
			textureFilteringOptions={supportedTextureFiltering}
			maximumTextureAnisotropy={textureFilteringCapabilities?.maximumAnisotropy ??
				null}
			{updateTextureFiltering}
			{rendererFrameDiagnostics}
			{updateRendererFrameProfiling}
			{captureFrameDiagnosticReport}
			{authoredDynamicRuntimeDiagnostics}
			{readStaticObjectRuntimeDiagnostics}
			{readTextureAtlasPage}
		/>
	</div>
</div>
