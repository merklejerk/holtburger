<script lang="ts">
	import { onMount } from "svelte";
	import FrameMetricsOverlay, {
		type FrameMetrics,
	} from "../app/FrameMetricsOverlay.svelte";
	import ExplorerTools from "./ExplorerTools.svelte";
	import { GameRuntime } from "../lib/game/runtime/game-runtime";
	import { StandardCommitPipeline } from "../lib/game/commit/pipeline";
	import { WebGL2Device } from "../lib/game/renderer/webgl2-device";
	import { TauriActiveRegionSource } from "../lib/assets/tauri-active-region-source";
	import { TauriLandblockTerrainSource } from "../lib/assets/tauri-landblock-terrain-source";
	import { TauriTexturePixelSource } from "../lib/assets/tauri-texture-pixel-source";
	import type { LoDConfig } from "../lib/game/runtime/types";
	import type { SceneResidency } from "../lib/game/scene";
	import {
		DEFAULT_FRAME_SETTINGS,
		type FrameSettings,
		type FrameSelectionMetrics,
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

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let frameHandle: number | null = null;
	let gameRuntime: GameRuntime | undefined;
	let commitPipeline: StandardCommitPipeline | undefined;
	let webglDevice: WebGL2Device | undefined;
	let activeRegionSource: TauriActiveRegionSource | undefined;
	let cameraController: FreeFlyCameraController | undefined;
	let cameraCoordinator: ExplorerCameraCoordinator | undefined;
	let frameMetrics: FrameMetrics | null = $state(null);
	let frameSelectionMetrics: FrameSelectionMetrics | null = $state(null);
	let lastFrameSelectionSampleAt = 0;
	let startupError: string | null = $state(null);
	let runtimeReady = $state(false);
	let cameraFocusStatus = $state<ExplorerCameraFocusStatus>(
		"No camera focus requested.",
	);
	let activeRegion = $state<ActiveRegionSource | undefined>(undefined);
	let environmentSelection = $state<ExplorerEnvironmentSelection>({
		dayIndex: 0,
		timeOfDay: 0.5,
		dayGroupOverride: null,
	});
	/** Explorer-local dynamic display choices; they do not alter resolved regional data. */
	let frameSettings = $state<FrameSettings>({ ...DEFAULT_FRAME_SETTINGS });

	function updateEnvironment(selection: ExplorerEnvironmentSelection): void {
		environmentSelection = selection;
		applyEnvironment();
	}

	function updateDistanceFog(enabled: boolean): void {
		frameSettings = { ...frameSettings, distanceFogEnabled: enabled };
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
			const coordinator = cameraCoordinator;
			const controller = cameraController;
			gameRuntime = undefined;
			runtimeReady = false;
			frameSelectionMetrics = null;
			commitPipeline = undefined;
			webglDevice = undefined;
			activeRegionSource = undefined;
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
				const terrainSource = TauriLandblockTerrainSource.build(activeRegion);
				const texturePixelSource = TauriTexturePixelSource.build();
				webglDevice = await WebGL2Device.build(canvasElement!);
				if (destroyed) return;
				commitPipeline = await StandardCommitPipeline.build(terrainSource);
				if (destroyed) return;

				gameRuntime = await GameRuntime.build(
					webglDevice,
					commitPipeline,
					texturePixelSource,
				);
				applyEnvironment();
				applyFrameSettings();
				if (destroyed) return;
				cameraController = new FreeFlyCameraController({
					canvas: canvasElement!,
					onChange(state) {
						cameraCoordinator?.handleCameraState(state);
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
						frameHandle = window.requestAnimationFrame(step);
						return;
					}

					const tickStartedAt = performance.now();
					gameRuntime.tick();
					const drawStartedAt = performance.now();
					gameRuntime.render(performance.now() / 1_000);
					const frameFinishedAt = performance.now();

					frameMetrics = {
						tickMs: drawStartedAt - tickStartedAt,
						updateFrameMs: frameFinishedAt - drawStartedAt,
						frameMs: frameFinishedAt - tickStartedAt,
					};
					if (frameFinishedAt - lastFrameSelectionSampleAt >= 250) {
						frameSelectionMetrics = gameRuntime.getFrameSelectionMetrics();
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
			{frameSelectionMetrics}
		/>
	</div>
</div>
