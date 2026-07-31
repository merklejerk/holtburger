<script lang="ts">
	import { onMount } from "svelte";
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
	import type { SceneResidency } from "../lib/game/scene";
	import {
		DEFAULT_FRAME_SETTINGS,
		type FrameSettings,
		type FrameSelectionMetrics,
		type EnvCellRenderMode,
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
	let frameSelectionMetrics: FrameSelectionMetrics | null = $state(null);
	let staticObjectRuntimeDiagnostics: StaticObjectRuntimeDiagnostics | null =
		$state(null);
	let lastFrameSelectionSampleAt = 0;
	let startupError: string | null = $state(null);
	let runtimeReady = $state(false);
	let cameraFocusStatus = $state<ExplorerCameraFocusStatus>(
		"No camera focus requested.",
	);
	let cameraLocation = $state<ExplorerCameraLocationState | null>(null);
	let activeRegion = $state<ActiveRegionSource | undefined>(undefined);
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

	function updateDistanceFog(enabled: boolean): void {
		frameSettings = { ...frameSettings, distanceFogEnabled: enabled };
		applyFrameSettings();
	}

	function updateEnvCellRenderMode(mode: EnvCellRenderMode): void {
		frameSettings = { ...frameSettings, envCellRenderMode: mode };
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

	function applyEnvironment(): void {
		if (activeRegion) {
			const environment = resolveSceneEnvironment(
				activeRegion,
				environmentSelection,
			);
			gameRuntime?.setSceneEnvironment(environment);
		}
	}

	function applyFrameSettings(): void {
		gameRuntime?.setFrameSettings(frameSettings);
	}

	function requestSceneInterest(
		residency: SceneResidency,
		lod: LoDConfig,
	): void {
		cameraCoordinator?.requestSceneInterest(residency, lod);
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
			frameSelectionMetrics = null;
			staticObjectRuntimeDiagnostics = null;
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
						frameSelectionMetrics = null;
						staticObjectRuntimeDiagnostics = null;
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
						frameSelectionMetrics = gameRuntime.getFrameSelectionMetrics();
						staticObjectRuntimeDiagnostics =
							gameRuntime.getStaticObjectRuntimeDiagnostics();
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
			{updateDistanceFog}
			envCellRenderMode={frameSettings.envCellRenderMode}
			{updateEnvCellRenderMode}
			textureFiltering={effectiveTextureFiltering}
			textureFilteringOptions={supportedTextureFiltering}
			maximumTextureAnisotropy={textureFilteringCapabilities?.maximumAnisotropy ??
				null}
			{updateTextureFiltering}
			{frameSelectionMetrics}
			{staticObjectRuntimeDiagnostics}
			{readTextureAtlasPage}
		/>
	</div>
</div>
