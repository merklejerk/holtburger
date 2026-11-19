import {
	createFrameRateSampler,
	type FrameRates,
	type FrameRateSampler,
} from "../../app/performance/frame-rate-sampler";
import type { FrameMetrics } from "../panels/FrameMetricsOverlay.svelte";
import type { MinimapFrame } from "../../app/minimap/frame";
import { PerformanceSession } from "../../app/performance/performance-session";
import type { ActiveRegionSource } from "../../lib/assets/active-region-source";
import { resolveDayFraction } from "../../lib/game/environment/game-clock";
import {
	resolveSceneEnvironment,
	type SceneEnvironmentSelection,
} from "../../lib/game/environment/scene-environment";
import { createLandblockWorldOrigin } from "../../lib/game/landblocks";
import {
	mapHeadingFromSceneTransform,
	type MapAnchor,
} from "../../lib/game/map/map-view";
import type { AmbientOcclusionSettings } from "../../lib/game/renderer/passes/ambient-occlusion-policy";
import type { ColorGradeSettings } from "../../lib/game/renderer/passes/color-grade-policy";
import {
	createEntityShadowSettings,
	type EntityShadowSettings,
} from "../../lib/game/renderer/shadows/entity-shadow-policy";
import type { NameplateCategory } from "../../lib/game/renderer/overlays/nameplate-policy";
import { isRenderScale } from "../../lib/game/renderer/render-scale";
import type {
	EnvCellRenderMode,
	FrameSettings,
	RendererFrameDiagnosticsSnapshot,
} from "../../lib/game/renderer/renderer";
import type { TextureFilteringPolicy } from "../../lib/game/renderer/webgl2/texture-filtering-policy";
import type { Texture2DReadback } from "../../lib/game/renderer/webgl2/webgl2-device";
import type { GamePresentationOwner } from "../../lib/game/runtime/game-presentation-owner";
import type {
	GamePresentationRuntime,
	StaticObjectRuntimeDiagnostics,
} from "../../lib/game/runtime/game-presentation-runtime";
import type { LandblockLayerKind } from "../../lib/game/runtime/scene-interest";
import type { ScenePlacement } from "../../lib/game/scene";
import type { TexturePageId } from "../../lib/game/textures/texture-manager";
import type { ExplorerSceneInterestSnapshot } from "../camera/camera-coordinator";
import type { ExplorerCameraLocation } from "../camera/camera-location";
import type { FreeFlyCameraState } from "../camera/camera-input-controller";
import {
	createExplorerFrameDiagnosticReport,
	type ExplorerFrameDiagnosticReport,
} from "./frame-diagnostic-report";
import { EXPLORER_TUNING } from "../explorer-tuning";

/** Fast enough that a tick boundary is never visibly late; resolution is tick-quantized. */
const CLOCK_SAMPLE_INTERVAL_MS = 250;

/**
 * Sampling density presets.
 *
 * Explorer-local UX: the renderer accepts any density within its bounds, and which handful to
 * put in front of a viewer is a frontend choice. One is native CSS resolution; above it buys
 * supersampled edges for the square of the cost. Filtered against the renderer's own bounds so
 * tightening them can never leave a preset here that the next frame throws on.
 */
export const EXPLORER_RENDER_SCALE_OPTIONS = [0.5, 0.75, 1, 1.5, 2].filter(
	isRenderScale,
);

export interface ExplorerDisplayDiagnosticsDependencies {
	readonly isRuntimeReady: () => boolean;
	readonly readCameraLocation: () => ExplorerCameraLocation | null;
	readonly readCameraYawRadians: () => number;
	readonly readCameraSnapshot: () => FreeFlyCameraState | null;
	readonly readSceneInterest: () => ExplorerSceneInterestSnapshot | null;
	readonly readPossessedGuid: () => number | null;
	readonly readPossessedPlacement: () => ScenePlacement | null;
	readonly readSelectedEntityGuid: () => number | null;
	readonly onFrameSettingsChange: (settings: FrameSettings) => void;
	readonly onEnvironmentSelectionChange: (
		selection: SceneEnvironmentSelection,
	) => void;
	readonly onClockFollowingChange: (enabled: boolean) => void;
	readonly onEffectVolumeChange: (volume: number) => void;
	readonly onAmbientVolumeChange: (volume: number) => void;
}

/**
 * Owns Explorer environment clock-following, frame-settings mutation/application,
 * frame rate & performance diagnostics, texture atlas readbacks, and minimap frame assembly
 * outside Svelte reactive state.
 */
export class ExplorerDisplayDiagnosticsController {
	private frameSettings: FrameSettings = {
		...EXPLORER_TUNING.frameSettings,
	};
	private environmentSelection: SceneEnvironmentSelection = {
		dayIndex: EXPLORER_TUNING.environment.defaultDayIndex,
		timeOfDay: EXPLORER_TUNING.environment.defaultTimeOfDay,
		dayGroupOverride: EXPLORER_TUNING.environment.defaultDayGroupOverride,
	};
	private clockFollowing = false;
	private clockStartedAtMs = 0;
	private clockTimer: ReturnType<typeof setInterval> | undefined;
	private effectVolume = 1;
	private ambientVolume = 1;

	private frameMetrics: FrameMetrics | null = null;
	private readonly frameRateSampler: FrameRateSampler = createFrameRateSampler(
		EXPLORER_TUNING.diagnostics.frameMetricsEmaWindowMs,
	);
	private performanceSession: PerformanceSession | null = null;

	private presentationOwner: GamePresentationOwner | undefined;
	private gameRuntime: GamePresentationRuntime | undefined;
	private activeRegion: ActiveRegionSource | undefined;
	private canvasElement: HTMLCanvasElement | null = null;

	constructor(private readonly deps: ExplorerDisplayDiagnosticsDependencies) {}

	readFrameSettingsSnapshot(): FrameSettings {
		return this.frameSettings;
	}

	attachRuntime(params: {
		readonly presentation: GamePresentationOwner;
		readonly canvas: HTMLCanvasElement;
	}): void {
		this.presentationOwner = params.presentation;
		this.gameRuntime = params.presentation.runtime;
		this.activeRegion = params.presentation.activeRegion;
		this.canvasElement = params.canvas;
		this.performanceSession = new PerformanceSession({
			mode: "explorer",
			runtime: params.presentation.runtime,
			canvas: params.canvas,
			native: {
				kind: "unavailable",
				reason: "Not measured in Explorer.",
			},
			readGraphics: () => this.frameSettings,
			readDevice: () => params.presentation.device.getDiagnosticIdentity(),
			readFrameRates: () => this.frameRateSampler.readFrameRates(),
		});
		this.applyEnvironment();
		this.applyFrameSettings();
	}

	detach(): void {
		this.stopClockTimer();
		this.performanceSession?.retire();
		this.performanceSession = null;
		this.presentationOwner = undefined;
		this.gameRuntime = undefined;
		this.activeRegion = undefined;
		this.canvasElement = null;
		this.frameMetrics = null;
	}

	stopClockTimer(): void {
		clearInterval(this.clockTimer);
		this.clockTimer = undefined;
	}

	clearFrameMetrics(): void {
		this.frameMetrics = null;
	}

	recordFrameSample(
		animationFrameTimeMs: number,
		tickStartedAt: number,
		updateAndDrawStartedAt: number,
		frameFinishedAt: number,
	): void {
		this.performanceSession?.recordFrame(frameFinishedAt - tickStartedAt);
		this.frameRateSampler.recordFrame({
			animationFrameTimeMs,
			startedAtMs: tickStartedAt,
			workMs: frameFinishedAt - tickStartedAt,
		});
		this.frameMetrics = {
			tickMs: updateAndDrawStartedAt - tickStartedAt,
			updateFrameMs: frameFinishedAt - updateAndDrawStartedAt,
			frameMs: frameFinishedAt - tickStartedAt,
		};
	}

	readFrameRates(): FrameRates | null {
		return this.frameRateSampler.readFrameRates();
	}

	readFrameMetrics(): FrameMetrics | null {
		return this.frameMetrics;
	}

	readPerformanceSession(): PerformanceSession | null {
		return this.performanceSession;
	}

	readStaticObjectRuntimeDiagnostics(): StaticObjectRuntimeDiagnostics | null {
		return this.gameRuntime?.getStaticObjectRuntimeDiagnostics() ?? null;
	}

	readRendererFrameDiagnostics(): RendererFrameDiagnosticsSnapshot | null {
		return this.gameRuntime?.getRendererFrameDiagnostics() ?? null;
	}

	readAuthoredDynamicRuntimeDiagnostics(): ReturnType<
		GamePresentationRuntime["getAuthoredDynamicRuntimeDiagnostics"]
	> | null {
		return this.gameRuntime?.getAuthoredDynamicRuntimeDiagnostics() ?? null;
	}

	captureFrameDiagnosticReport(): ExplorerFrameDiagnosticReport | null {
		const device = this.presentationOwner?.device;
		const runtime = this.gameRuntime;
		const canvas = this.canvasElement;
		if (!runtime || !device || !canvas) return null;
		const frame = runtime.getRendererFrameDiagnostics();
		if (!frame) return null;
		const viewport = canvas.getBoundingClientRect();
		return createExplorerFrameDiagnosticReport({
			browser: {
				userAgent: navigator.userAgent,
				webgl: device.getDiagnosticIdentity(),
			},
			camera: this.deps.readCameraSnapshot(),
			cameraLocation: this.deps.readCameraLocation(),
			capturedAt: new Date().toISOString(),
			environment: this.environmentSelection,
			frame,
			frameSettings: this.frameSettings,
			sceneInterest: this.deps.readSceneInterest(),
			viewport: {
				cssHeight: viewport.height,
				cssWidth: viewport.width,
				devicePixelRatio: window.devicePixelRatio,
				drawingBufferHeight: canvas.height,
				drawingBufferWidth: canvas.width,
			},
		});
	}

	readTextureAtlasPage(pageId: TexturePageId): Texture2DReadback {
		const device = this.presentationOwner?.device;
		if (!this.gameRuntime || !device) {
			throw new Error(
				"Texture page readback requires an active Explorer runtime.",
			);
		}
		return device.readTexture2D(
			this.gameRuntime.getTextureAtlasPageResource(pageId),
		);
	}

	applyEnvironment(): void {
		if (!this.activeRegion) return;
		const environment = resolveSceneEnvironment(this.activeRegion, {
			...this.environmentSelection,
			timeOfDay: this.clockFollowing
				? resolveDayFraction(
						(performance.now() - this.clockStartedAtMs) / 1_000,
						this.activeRegion.data.calendar.dayLength,
					)
				: this.environmentSelection.timeOfDay,
		});
		this.gameRuntime?.setSceneEnvironment(environment);
	}

	updateEnvironment(selection: SceneEnvironmentSelection): void {
		this.environmentSelection = selection;
		this.deps.onEnvironmentSelectionChange(selection);
		this.applyEnvironment();
	}

	updateClockFollowing(enabled: boolean): void {
		this.clockFollowing = enabled;
		this.deps.onClockFollowingChange(enabled);
		this.stopClockTimer();
		if (!enabled) {
			this.applyEnvironment();
			return;
		}
		this.clockStartedAtMs = performance.now();
		this.applyEnvironment();
		// Sampling faster than the authored ticks costs nothing: the environment layer quantizes
		// each domain's fraction, so extra samples resolve to the identical environment.
		this.clockTimer = setInterval(
			() => this.applyEnvironment(),
			CLOCK_SAMPLE_INTERVAL_MS,
		);
	}

	updateEffectVolume(volume: number): void {
		this.effectVolume = volume;
		this.deps.onEffectVolumeChange(volume);
		this.gameRuntime?.setAudioSettings({
			ambientVolume: this.ambientVolume,
			effectVolume: volume,
		});
	}

	updateAmbientVolume(volume: number): void {
		this.ambientVolume = volume;
		this.deps.onAmbientVolumeChange(volume);
		this.gameRuntime?.setAudioSettings({
			ambientVolume: volume,
			effectVolume: this.effectVolume,
		});
	}

	private setFrameSettings(next: FrameSettings): void {
		this.frameSettings = next;
		this.deps.onFrameSettingsChange(next);
		this.applyFrameSettings();
	}

	applyFrameSettings(): void {
		this.gameRuntime?.setFrameSettings(this.frameSettings);
	}

	updateEntitySelectionColors(
		colors: FrameSettings["entitySelectionOutline"]["colors"],
	): void {
		this.setFrameSettings({
			...this.frameSettings,
			entitySelectionOutline: {
				...this.frameSettings.entitySelectionOutline,
				colors,
			},
		});
	}

	updateDistanceFog(enabled: boolean): void {
		this.setFrameSettings({
			...this.frameSettings,
			distanceFogEnabled: enabled,
		});
	}

	updateShowRetailHiddenGeometry(visible: boolean): void {
		this.setFrameSettings({
			...this.frameSettings,
			showRetailHiddenGeometry: visible,
		});
	}

	updateNameplateCategory(category: NameplateCategory, visible: boolean): void {
		this.setFrameSettings({
			...this.frameSettings,
			nameplates: {
				...this.frameSettings.nameplates,
				categoryVisibility: {
					...this.frameSettings.nameplates.categoryVisibility,
					[category]: visible,
				},
			},
		});
	}

	updateAmbientOcclusionSettings(
		ambientOcclusion: AmbientOcclusionSettings,
	): void {
		this.setFrameSettings({ ...this.frameSettings, ambientOcclusion });
	}

	updateEntityShadowSettings(entityShadows: EntityShadowSettings): void {
		this.setFrameSettings({
			...this.frameSettings,
			entityShadows: createEntityShadowSettings(entityShadows),
		});
	}

	updateColorGradeSettings(colorGrade: ColorGradeSettings): void {
		this.setFrameSettings({ ...this.frameSettings, colorGrade });
	}

	updateViewerLight(enabled: boolean): void {
		this.setFrameSettings({
			...this.frameSettings,
			viewerLightEnabled: enabled,
		});
	}

	updateWeather(enabled: boolean): void {
		this.setFrameSettings({
			...this.frameSettings,
			weatherEnabled: enabled,
		});
	}

	updateEnvCellRenderMode(mode: EnvCellRenderMode): void {
		this.setFrameSettings({
			...this.frameSettings,
			envCellRenderMode: mode,
		});
	}

	updateLayerVisibility(layer: LandblockLayerKind, visible: boolean): void {
		this.setFrameSettings({
			...this.frameSettings,
			layerVisibility: {
				...this.frameSettings.layerVisibility,
				[layer]: visible,
			},
		});
	}

	updateRenderScale(renderScale: number): void {
		this.setFrameSettings({
			...this.frameSettings,
			quality: { ...this.frameSettings.quality, renderScale },
		});
	}

	updateTextureFiltering(textureFiltering: TextureFilteringPolicy): void {
		this.setFrameSettings({
			...this.frameSettings,
			quality: { ...this.frameSettings.quality, textureFiltering },
		});
	}

	/**
	 * Anchor on the possessed entity itself, not on the camera watching it.
	 *
	 * Possession is the one mode where the two genuinely differ: the camera orbits while the
	 * character faces where it is going, and it is the character's own position and facing that a
	 * map should be drawn around. The pose is converted through the same helper the scene uses, so
	 * the map cannot drift from where the entity is actually drawn.
	 */
	anchorFromPossession(): MapAnchor | null {
		const placement = this.deps.readPossessedPlacement();
		if (placement === null) return null;
		const origin = createLandblockWorldOrigin(placement.landblockId);
		return {
			// The possessed character is the subject, so its own facing is up and the boom is not
			// consulted; the boom's bearing still reaches the panel separately, to draw where the
			// operator is looking relative to the character.
			headingRadians: mapHeadingFromSceneTransform(placement.localTransform),
			residency: {
				envCellId: placement.envCellId,
				landblockId: placement.landblockId,
			},
			worldX: origin.x + placement.localTransform.m41,
			worldY: origin.y + placement.localTransform.m42,
			worldZ: origin.z + placement.localTransform.m43,
		};
	}

	/** Anchor on the free camera, which is what the Explorer has whenever nothing is possessed. */
	anchorFromCamera(): MapAnchor | null {
		const location = this.deps.readCameraLocation();
		if (location === null) return null;
		return {
			headingRadians: this.deps.readCameraYawRadians(),
			residency:
				location.residency.kind === "resolved"
					? location.residency.residency
					: null,
			worldX: location.position.x,
			worldY: location.position.y,
			worldZ: location.position.z,
		};
	}

	private readPresentedMapEntities = () => {
		return this.gameRuntime?.listPresentedSpawnedEntities() ?? [];
	};

	/** Pull the scene's current map picture without publishing presentation-rate Svelte state. */
	readMinimapFrame(): MinimapFrame {
		const runtime = this.deps.isRuntimeReady()
			? (this.gameRuntime ?? null)
			: null;
		const controlledGuid = this.deps.readPossessedGuid();
		const controlledAnchor = this.anchorFromPossession();
		const freeCameraAnchor = this.anchorFromCamera();
		const residency = (controlledAnchor ?? freeCameraAnchor)?.residency;
		return {
			surfaceMapEligible:
				runtime !== null &&
				residency != null &&
				runtime.sceneInterestMembership().surfaceMapEligible(residency) ===
					true,
			waypoint: null,
			cameraFovRadians: (EXPLORER_TUNING.camera.framing.fov * Math.PI) / 180,
			cameraHeadingRadians: this.deps.readCameraYawRadians(),
			presentedEntities: this.readPresentedMapEntities,
			presentedEntitiesRevision: runtime?.mapEntityRevision ?? 0,
			landmarkRevision: 0,
			selectedGuid: this.deps.readSelectedEntityGuid(),
			source: runtime,
			subject:
				controlledGuid !== null && controlledAnchor !== null
					? {
							anchor: controlledAnchor,
							guid: controlledGuid,
							kind: "controlled-entity",
						}
					: freeCameraAnchor === null
						? null
						: { anchor: freeCameraAnchor, kind: "free-camera" },
		};
	}
}
