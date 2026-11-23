import { setWebGL2FailureFrame } from "./webgl2-failure-diagnostics";
import { reportWebGL2Failure } from "../../webgl/diagnostics";
import { createLandblockWorldOrigin } from "../../landblocks";
import { SHARED_FRONTEND_TUNING } from "../../../frontend-tuning";
import type { SceneScope } from "../../scene";
import { scopeFor } from "../../scene/scope";
import {
	createEntityShadowSettings,
	type EntityShadowSettings,
} from "../shadows/entity-shadow-policy";
import {
	type FrameInput,
	type FrameSettings,
	type FrameViewInput,
	type PortalTransitionOnlyFrameInput,
	type PortalTransitionVisual,
	type Renderer,
	type RendererFrameDiagnostics,
	type RendererFrameFeedback,
	type ResolvedResourceInvalidation,
} from "../renderer";
import type { RendererCombatEffectsCapability } from "../../systems/combat-effects-system";
import type {
	RendererParticleCapability,
	RendererSkyCapability,
} from "../renderer";
import type { PortalTransitionPresentationReceipt } from "../../../client/portal-transition-presentation";
import type { RenderWorld } from "../render-world";
import {
	MAX_DYNAMIC_LIGHTS,
	fitLightsToBudget,
	type RuntimeLight,
} from "../../environment/runtime-lights";
import { VIEWER_LIGHT } from "../../environment/viewer-light";
import {
	resolveAuthoredLightResponse,
	resolveSceneLightingByRole,
} from "../../environment/scene-lighting";
import type { WebGL2TextureFilteringSupport } from "./webgl2-texture-filtering-support";
import { devicePixelArea, validateRenderScale } from "../render-scale";
import type { RenderExtent } from "../render-extent";
import type { WebGL2ResourceManager } from "./webgl2-resource-manager";
import type { DynamicLayout } from "../../geometry/dynamic-layout";
import type { DynamicAppearance } from "../../systems/dynamic-appearance";
import type { WebGL2PortalScopeAtlasPipeline } from "../portal/webgl2-portal-scope-atlas-pipeline";
import type { PortalWarpDriveTuning } from "../portal/portal-warp-drive-tuning";
import {
	AMBIENT_OCCLUSION_DISTANCE_FADE,
	resolveEffectiveAmbientOcclusionPolicy,
} from "../passes/ambient-occlusion-policy";
import type { WebGL2SaoCoverageCensus } from "../passes/webgl2-sao-pass";
import { RendererFrameDiagnosticsAndProfiler } from "./webgl2-frame-diagnostics";
import { WebGL2DeviceAndTargetPool } from "./webgl2-device-targets";
import { SceneContributionCompilerAndSelector } from "./webgl2-scene-compiler";
import { ObjectAndShadowPassExecutor } from "./webgl2-object-shadow-pass";
import { TerrainPassExecutor } from "./webgl2-terrain-pass";
import { SkyParticleOverlayAndSelectionPasses } from "./webgl2-overlay-particle-sky-passes";
import {
	BLACK_SCENE_CLEAR_COLOR,
	FRONTEND_CLEAR_COLOR,
	ORIGIN,
	PROBE_SHADING,
	portalTransitionPresentationReceipt,
	type PortalExecutionProbeResult,
	type PreparedPortalView,
	type PreparedView,
	type PreparedViewGeometry,
	type SceneRenderDomain,
	type SceneShading,
} from "./webgl2-renderer-types";

export type { PortalExecutionProbeResult } from "./webgl2-renderer-types";

export class WebGL2Renderer implements Renderer {
	/** Explicit diagnostic capability, separated from the production draw methods. */
	readonly frameDiagnostics: RendererFrameDiagnostics;
	/** Each combat subsystem leases one independently disposable draw adapter. */
	readonly combatEffects: RendererCombatEffectsCapability;
	/** Authored particle residency and per-frame source submission. */
	readonly particles: RendererParticleCapability;
	/** Region-scoped celestial sky residency. */
	readonly sky: RendererSkyCapability;

	readonly #gl: WebGL2RenderingContext;
	readonly #world: RenderWorld;
	/** Device-wide guard preventing draws through any stale handle after context loss. */
	readonly #assertDeviceReady: () => void;

	readonly #diagnostics: RendererFrameDiagnosticsAndProfiler;
	readonly #deviceTargets: WebGL2DeviceAndTargetPool;
	readonly #sceneCompiler: SceneContributionCompilerAndSelector;
	readonly #objectShadowPass: ObjectAndShadowPassExecutor;
	readonly #terrainPass: TerrainPassExecutor;
	readonly #overlayPasses: SkyParticleOverlayAndSelectionPasses;

	static async build(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
		world: RenderWorld,
		textureFilteringSupport: WebGL2TextureFilteringSupport,
		portalWarpDriveTuning: PortalWarpDriveTuning,
		assertDeviceReady: () => void,
	): Promise<WebGL2Renderer> {
		return new WebGL2Renderer(
			canvas,
			gl,
			resources,
			world,
			textureFilteringSupport,
			portalWarpDriveTuning,
			assertDeviceReady,
		);
	}

	protected constructor(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
		world: RenderWorld,
		textureFilteringSupport: WebGL2TextureFilteringSupport,
		portalWarpDriveTuning: PortalWarpDriveTuning,
		assertDeviceReady: () => void,
	) {
		this.#gl = gl;
		this.#world = world;
		this.#assertDeviceReady = assertDeviceReady;

		this.#diagnostics = new RendererFrameDiagnosticsAndProfiler(
			gl,
			assertDeviceReady,
		);
		this.#deviceTargets = new WebGL2DeviceAndTargetPool(
			canvas,
			gl,
			resources,
			textureFilteringSupport,
			portalWarpDriveTuning,
			assertDeviceReady,
			this.#diagnostics,
		);
		this.#sceneCompiler = new SceneContributionCompilerAndSelector(
			world,
			this.#deviceTargets,
			this.#diagnostics,
		);
		this.#objectShadowPass = new ObjectAndShadowPassExecutor(
			world,
			this.#deviceTargets,
			this.#diagnostics,
			this.#sceneCompiler,
		);
		this.#terrainPass = new TerrainPassExecutor(
			this.#deviceTargets,
			this.#diagnostics,
			this.#objectShadowPass,
			this.#sceneCompiler,
		);
		this.#overlayPasses = new SkyParticleOverlayAndSelectionPasses(
			world,
			this.#deviceTargets,
			this.#diagnostics,
			this.#sceneCompiler,
			this.#objectShadowPass,
		);

		this.combatEffects = this.#overlayPasses.combatEffects;
		this.particles = this.#overlayPasses.particles;
		this.sky = this.#overlayPasses.sky;
		this.frameDiagnostics = this.#diagnostics.createCapability({
			getAppearancesUsage: () =>
				this.#sceneCompiler.dynamicAppearances.getResourceUsage(),
			getPosesUsage: () =>
				this.#sceneCompiler.dynamicPosePages.getResourceUsage(),
			getCompiledObjectDrawsDiagnostics: () =>
				this.#sceneCompiler.compiledDraws.getDiagnostics(),
			getOutdoorTargetsDiagnostics: () =>
				this.#objectShadowPass.outdoorPssmPass.getDiagnostics(),
			getNameplateCacheDiagnostics: () =>
				this.#overlayPasses.nameplateTextureCache.diagnostics(),
			getNameplateIconDiagnostics: () =>
				this.#overlayPasses.nameplateIconRepository.diagnostics(),
		});

		gl.clearColor(
			FRONTEND_CLEAR_COLOR.red,
			FRONTEND_CLEAR_COLOR.green,
			FRONTEND_CLEAR_COLOR.blue,
			FRONTEND_CLEAR_COLOR.alpha,
		);
		gl.enable(gl.DEPTH_TEST);
	}

	drawFrame(input: FrameInput): RendererFrameFeedback {
		this.#assertDeviceReady();
		setWebGL2FailureFrame(this.#gl, input);
		const profile = this.#diagnostics.profiler?.beginFrame() ?? null;
		try {
			this.#drawFrameContent(input);
			this.#overlayPasses.drawCombatEffectLanes();
			this.#diagnostics.profiler?.setGpuSystem("other");
			this.#diagnostics.profiler?.setCpuPhase("other");
			return Object.freeze({
				portalTransitionReceipt: portalTransitionPresentationReceipt(
					input.portalTransition,
				),
				selectedDynamicNodeIds: Object.freeze([
					...this.#sceneCompiler.selectedDynamicNodeIds,
				]),
			});
		} catch (error) {
			profile?.discard();
			reportWebGL2Failure(
				this.#gl,
				error instanceof Error ? error.message : String(error),
			);
			throw error;
		} finally {
			profile?.finish();
		}
	}

	/** Present the authored portal room without querying or advancing the render world. */
	drawPortalTransitionFrame(
		input: PortalTransitionOnlyFrameInput,
	): PortalTransitionPresentationReceipt | null {
		this.#assertDeviceReady();
		setWebGL2FailureFrame(this.#gl, input);
		const profile = this.#diagnostics.profiler?.beginFrame() ?? null;
		try {
			this.#drawPortalTransitionFrameContent(input);
			return portalTransitionPresentationReceipt(input.portalTransition);
		} catch (error) {
			profile?.discard();
			reportWebGL2Failure(
				this.#gl,
				error instanceof Error ? error.message : String(error),
			);
			throw error;
		} finally {
			profile?.finish();
		}
	}

	clearPresentation(): void {
		this.#deviceTargets.clearPresentation(
			this.#overlayPasses.entitySelectionPass,
		);
	}

	/** Install one validated setup/animation pair for the transition-only authored tunnel pass. */
	installPortalTransitionVisual(visual: PortalTransitionVisual): void {
		this.#deviceTargets.installPortalTransitionVisual(visual);
	}

	/**
	 * Drop compiled draw facts because a runtime event invalidated them.
	 *
	 * Implements the shared renderer contract: the events that move atlas placements or replace
	 * active-region detail are owned by the runtime and cannot be observed from inside a frame.
	 */
	invalidateResolvedResources(reason: ResolvedResourceInvalidation): void {
		this.#sceneCompiler.invalidateResolvedResources(reason);
	}

	retainDynamicAppearance(
		layout: DynamicLayout,
		appearance: DynamicAppearance,
	): () => void {
		return this.#sceneCompiler.retainDynamicAppearance(layout, appearance);
	}

	/** Toggle the harness-only AO category view without widening production frame settings. */
	setAmbientOcclusionCoverageVisualizationEnabled(enabled: boolean): void {
		this.#deviceTargets.setAmbientOcclusionCoverageVisualizationEnabled(
			enabled,
		);
	}

	/** Read the latest one-shot harness census, if a visualized AO frame completed. */
	getAmbientOcclusionCoverageCensus(): WebGL2SaoCoverageCensus | null {
		return this.#deviceTargets.getAmbientOcclusionCoverageCensus();
	}

	/**
	 * Execute the public portal path through production contribution and GPU paths.
	 *
	 * This harness seam shares both planning and execution with continuous portal rendering.
	 */
	probePortalExecution(
		anchorLandblockId: FrameInput["anchorLandblockId"],
		viewInput: FrameViewInput,
		rootScope: SceneScope,
		extent: RenderExtent,
		frameSettings: FrameSettings,
	): PortalExecutionProbeResult {
		this.#assertDeviceReady();
		this.#deviceTargets.applyRenderExtent(extent);
		this.#resetFrame(1, "portal");
		this.#overlayPasses.prepareEntitySelection(
			frameSettings.showRetailHiddenGeometry,
		);
		const prepared = this.#sceneCompiler.prepareViewGeometry(
			anchorLandblockId,
			viewInput,
		);
		const pipeline = this.#deviceTargets.acquirePortalScopeAtlasPipeline();
		const planningStartedAt = performance.now();
		const frame = pipeline.prepare(
			this.#world.getPortalTopologyView(),
			this.#sceneCompiler.createPortalScopeWindowCullInput(
				prepared,
				viewInput,
				rootScope,
			),
		);
		const planningDurationMs = performance.now() - planningStartedAt;
		this.#diagnostics.accumulatePortalScopeAtlasMetrics(frame);
		const plan = this.#sceneCompiler.preparePortalContributions(
			prepared,
			frame,
			frameSettings,
			null,
			this.#objectShadowPass,
			this.#overlayPasses,
		);
		this.#sceneCompiler.uploadDynamicPoses(
			this.#deviceTargets.frameClockSeconds,
		);
		this.#executePortalScopeAtlasFrame(
			plan,
			PROBE_SHADING,
			frameSettings,
			pipeline,
		);
		this.#updateRenderTargetMetrics();
		this.#finishFrameSelectionMetrics();
		return {
			crossingCount: frame.atlas.visibility.selectedCrossingCount,
			objectSubmissionCount: frame.opaqueRouting.trace.objectSubmissionCount,
			planningDurationMs,
			scopeCount: frame.count,
			selectionMetrics: { ...this.#diagnostics.metrics },
			targetBytes: this.#diagnostics.metrics.portalTargetBytes,
			terrainSubmissionCount: frame.opaqueRouting.trace.terrainSubmissionCount,
			traversalDepth: frame.atlas.commands.traversalDepth,
		};
	}

	async destroy(): Promise<void> {
		this.#overlayPasses.destroyParticlesAndCombatEffects();
		this.#sceneCompiler.resetDynamicFrameState();
		this.#objectShadowPass.destroyDynamicPrograms();
		this.#sceneCompiler.clearDynamicFrameCaches();
		this.#overlayPasses.clearPreparedSelection();
		this.#sceneCompiler.destroyDynamicResources();
		this.#diagnostics.destroy();
		this.#deviceTargets.destroySamplers();
		this.#terrainPass.destroyLightMask();
		this.#deviceTargets.destroyTargetsAndPresentation();
		this.#overlayPasses.destroyEntitySelectionPass();
		this.#deviceTargets.destroySaoPass();
		this.#overlayPasses.destroyPassesAndNameplates();
		this.#overlayPasses.destroySkyPrograms();
		this.#terrainPass.destroyPrograms();
		this.#objectShadowPass.destroy();
	}

	#drawFrameContent(input: FrameInput): void {
		const entityShadows = createEntityShadowSettings(
			input.frameSettings.entityShadows,
		);
		if (entityShadows.mode !== "shadow-maps") {
			this.#objectShadowPass.disableOutdoorPssm();
		}
		this.#objectShadowPass.resetActiveOutdoorPssmFrame();
		const textureFiltering = input.frameSettings.quality.textureFiltering;
		this.#deviceTargets.setFrameTextureFiltering(textureFiltering);
		this.#sceneCompiler.syncCompiledSettings(
			textureFiltering,
			input.frameSettings.envCellRenderMode,
		);
		this.#deviceTargets.setFrameClockSeconds(input.timeSeconds);
		this.#overlayPasses.setFrameInputs(
			input.worldIndicator ?? null,
			input.transformGizmo ?? null,
			input.summonLeashes ?? [],
			input.selectionTarget,
			input.entityOverlays,
			input.viewerEntityIdentity,
		);
		// Snapshotted here because the flat schedule never receives frame settings, and both
		// schedules reach presentation through the same shared helper.
		this.#deviceTargets.setFramePresentationState(
			input.frameSettings.colorGrade,
			input.frameSettings.entitySelectionOutline,
		);
		const quality = input.frameSettings.quality;
		validateRenderScale(quality.renderScale, "Frame settings");
		this.#deviceTargets.setRenderScale(quality.renderScale);
		// Cutoffs are authored in CSS pixels so a density change stays a sampling decision. The
		// conversion happens once here; the projection math downstream is drawing-buffer only.
		this.#sceneCompiler.setMinimumFootprintAreas(
			devicePixelArea(
				quality.minimumPortalFootprintCssPixelArea,
				quality.renderScale,
			),
			devicePixelArea(
				quality.minimumObjectFootprintCssPixelArea,
				quality.renderScale,
			),
		);
		// Capture before resizing the scene target: if a transition begins on the same frame as a
		// drawing-buffer resize, the outgoing image is still the last completed native-sized frame.
		this.#deviceTargets.prepareTransitionSnapshot(input.portalTransition);
		this.#deviceTargets.applyRenderExtent(input.extent);
		this.#deviceTargets.setActiveTransition(input.portalTransition ?? null);
		this.#resetFrame(input.views.length, input.frameSettings.envCellRenderMode);
		this.#overlayPasses.prepareEntitySelection(
			input.frameSettings.showRetailHiddenGeometry,
		);
		const fog = input.frameSettings.distanceFogEnabled
			? input.environment.distanceFog
			: null;
		// RETAIL DIVERGENCE: Retail draws before-landscape sky, opaque landblocks, then the
		// after-landscape weather overlay and deferred alpha work with no screen-space
		// obscurance stage. This default-on presentation adds ambient occlusion before
		// weather; removing it as a retail "correction" loses that enabled visual benefit,
		// while moving it later would incorrectly attenuate weather/transparency. The retained
		// DA55 portal census measured 102,140 opaque committed tile pixels: 204 (0.2%)
		// full/fading and 101,936 neutral after distance policy, plus 819,696 clear pixels
		// excluded from the denominator. The fixed 128-unit cutoff bounds the divergence
		// independently of authored time-of-day fog; minor overlap with fog is an accepted
		// first-version concession.
		const ambientOcclusion = resolveEffectiveAmbientOcclusionPolicy(
			input.frameSettings.ambientOcclusion,
			AMBIENT_OCCLUSION_DISTANCE_FADE,
		);
		if (ambientOcclusion.kind === "disabled") {
			this.#deviceTargets.disableSaoPass();
		}
		this.#diagnostics.recordAmbientOcclusionDistanceFade(ambientOcclusion);
		// Dynamic lights are frame-global and reach every draw, so they are assembled once here
		// rather than per role. Positions stay in canonical scene space; the bind rebases them.
		const sceneCameraPosition =
			input.views[0]?.camera.placement.position ?? ORIGIN;
		const dynamicCandidates: RuntimeLight[] = [...input.dynamicLights];
		if (input.frameSettings.viewerLightEnabled) {
			// Where the light hangs — on the body being driven, or on the camera when nothing
			// is — is the frontend's call; this only admits it as one more candidate for the
			// dynamic budget.
			dynamicCandidates.push({
				position: input.viewerLightOrigin,
				color: VIEWER_LIGHT.color,
				range: VIEWER_LIGHT.range,
				intensity: VIEWER_LIGHT.intensity,
			});
		}
		const fittedDynamic = fitLightsToBudget(
			dynamicCandidates,
			sceneCameraPosition,
			MAX_DYNAMIC_LIGHTS,
		);
		this.#diagnostics.metrics.droppedLights += fittedDynamic.dropped;
		const clear = fog?.color ?? input.environment.backgroundColor;
		const shading: SceneShading = {
			clearColor: [clear.red, clear.green, clear.blue, clear.alpha],
			ambientOcclusion,
			fog,
			sky: input.environment.sky,
			weatherEnabled: input.frameSettings.weatherEnabled,
			anchorOrigin: createLandblockWorldOrigin(input.anchorLandblockId),
			authoredLightResponse: resolveAuthoredLightResponse(
				input.environment.lighting,
			),
			dynamicLights: fittedDynamic.lights,
			staticLights: (landblockId) =>
				this.#objectShadowPass.resolveStaticLights(
					input,
					landblockId,
					sceneCameraPosition,
				),
			lighting: resolveSceneLightingByRole(
				input.environment.lighting,
				input.views.some((view) => view.cameraInsideSealedCell)
					? input.frameSettings.sealedInteriorAmbientLevel
					: null,
			),
		};
		this.#deviceTargets.beginFrame(shading.clearColor);
		this.#overlayPasses.beginParticleFrame();

		if (input.frameSettings.envCellRenderMode === "flat") {
			this.#diagnostics.profiler?.setCpuPhase("sceneSelection");
			const plans = input.views.map((view) => {
				const geometry = this.#sceneCompiler.prepareViewGeometry(
					input.anchorLandblockId,
					view,
				);

				const shadows = this.#objectShadowPass.prepareOutdoorShadows(
					geometry,
					entityShadows,
					input.frameSettings.showRetailHiddenGeometry,
					shading,
				);
				const contributions = this.#sceneCompiler.collectScene(
					geometry,
					input.frameSettings,
					shadows,
					this.#objectShadowPass,
					this.#overlayPasses,
				);
				return { view: { ...geometry, ...contributions }, shadows };
			});
			this.#diagnostics.profiler?.setCpuPhase("opaqueSubmission");
			this.#sceneCompiler.uploadDynamicPoses(
				this.#deviceTargets.frameClockSeconds,
			);
			for (const plan of plans) {
				this.#diagnostics.profiler?.setCpuPhase("opaqueSubmission");
				this.#objectShadowPass.executeOutdoorShadows(plan.shadows);
				this.#drawFlatView(
					plan.view,
					shading,
					"exterior",
					input.frameSettings.showRetailHiddenGeometry,
				);
			}
			this.#diagnostics.profiler?.setCpuPhase("other");
		} else {
			const pipeline = this.#deviceTargets.acquirePortalScopeAtlasPipeline();
			const plans = input.views.map((view) => {
				this.#diagnostics.profiler?.setCpuPhase("sceneSelection");
				const prepared = this.#sceneCompiler.prepareViewGeometry(
					input.anchorLandblockId,
					view,
				);

				return this.#preparePortalView(
					prepared,
					view,
					shading,
					input.frameSettings,
					entityShadows,
					pipeline,
				);
			});
			this.#diagnostics.profiler?.setCpuPhase("opaqueSubmission");
			this.#sceneCompiler.uploadDynamicPoses(
				this.#deviceTargets.frameClockSeconds,
			);
			for (const plan of plans) {
				this.#executePortalScopeAtlasFrame(
					plan,
					shading,
					input.frameSettings,
					pipeline,
				);
			}
			this.#diagnostics.profiler?.setCpuPhase("other");
		}

		this.#updateRenderTargetMetrics();
		this.#finishFrameSelectionMetrics();
	}

	#drawPortalTransitionFrameContent(
		input: PortalTransitionOnlyFrameInput,
	): void {
		const textureFiltering = input.frameSettings.quality.textureFiltering;
		this.#deviceTargets.setFrameTextureFiltering(textureFiltering);
		this.#sceneCompiler.syncCompiledSettings(textureFiltering);
		this.#deviceTargets.setFramePresentationState(
			input.frameSettings.colorGrade,
			input.frameSettings.entitySelectionOutline,
		);
		validateRenderScale(
			input.frameSettings.quality.renderScale,
			"Frame settings",
		);
		this.#deviceTargets.setRenderScale(input.frameSettings.quality.renderScale);
		this.#deviceTargets.prepareTransitionSnapshot(input.portalTransition);
		this.#deviceTargets.applyRenderExtent(input.extent);
		this.#deviceTargets.setActiveTransition(input.portalTransition);
		this.#resetFrame(0, input.frameSettings.envCellRenderMode);
		this.#diagnostics.metrics.portalTransitionOnlyFramePresented = true;

		const target = this.#deviceTargets.acquireFlatSceneTarget();
		this.#deviceTargets.beginFlatOpaqueScene(target, BLACK_SCENE_CLEAR_COLOR);
		this.#diagnostics.profiler?.setCpuPhase("postAndPresentation");
		this.#deviceTargets.drawPortalTransitionTunnel(
			target,
			input.frameSettings.showRetailHiddenGeometry,
			this.#sceneCompiler,
			this.#objectShadowPass,
		);
		this.#deviceTargets.presentFlatScene(
			target,
			null,
			this.#overlayPasses,
			this.#objectShadowPass,
		);
		this.#diagnostics.profiler?.setCpuPhase("other");
		this.#updateRenderTargetMetrics();
		this.#finishFrameSelectionMetrics();
	}

	/** Prepare one production portal view from its authoritative camera residency. */
	#preparePortalView(
		prepared: PreparedViewGeometry,
		viewInput: FrameViewInput,
		shading: SceneShading,
		frameSettings: FrameSettings,
		entityShadows: EntityShadowSettings,
		pipeline: WebGL2PortalScopeAtlasPipeline,
	): PreparedPortalView {
		this.#diagnostics.profiler?.setCpuPhase("portalPlanning");
		const placement = viewInput.camera.placement;
		const rootScope = scopeFor(placement.landblockId, placement.envCellId);

		const frame = pipeline.prepare(
			this.#world.getPortalTopologyView(),
			this.#sceneCompiler.createPortalScopeWindowCullInput(
				prepared,
				viewInput,
				rootScope,
			),
		);

		this.#diagnostics.accumulatePortalScopeAtlasMetrics(frame);
		this.#diagnostics.profiler?.setCpuPhase("sceneSelection");
		const shadows =
			frame.atlas.visibility.selectedScopeOrdinal("outdoor") !== null
				? this.#objectShadowPass.prepareOutdoorShadows(
						prepared,
						entityShadows,
						frameSettings.showRetailHiddenGeometry,
						shading,
					)
				: null;
		return this.#sceneCompiler.preparePortalContributions(
			prepared,
			frame,
			frameSettings,
			shadows,
			this.#objectShadowPass,
			this.#overlayPasses,
		);
	}

	/** Execute the same already-prepared compositor schedule for continuous frames and probes. */
	#executePortalScopeAtlasFrame(
		plan: PreparedPortalView,
		shading: SceneShading,
		frameSettings: FrameSettings,
		pipeline: WebGL2PortalScopeAtlasPipeline,
	): void {
		const { view, frame, particlesByScope } = plan;
		const clearColor = this.#deviceTargets.viewClearColor(view, shading);
		this.#diagnostics.profiler?.setCpuPhase("opaqueSubmission");
		this.#objectShadowPass.executeOutdoorShadows(plan.shadows);
		this.#diagnostics.profiler?.setCpuPhase("other");
		const target = this.#deviceTargets.acquireFlatSceneTarget();
		const usesPortalAtlas = !frame.atlas.directRootOutput;
		if (usesPortalAtlas) {
			this.#diagnostics.profiler?.setCpuPhase("portalComposition");
			this.#diagnostics.profiler?.setGpuSystem("portalComposition");
		}
		const portalTargets = pipeline.beginOpaqueScene(
			frame,
			clearColor,
			target.framebuffer,
		);
		if (usesPortalAtlas) {
			this.#diagnostics.profiler?.setGpuSystem("other");
		}
		this.#diagnostics.profiler?.setCpuPhase("sceneSelection");
		const objectPhases =
			this.#objectShadowPass.createObjectSubmissionPhases(view);
		const objectRuns =
			this.#objectShadowPass.prepareViewObjectRuns(objectPhases);
		const hasOutdoorScope =
			frame.atlas.visibility.selectedScopeOrdinal("outdoor") !== null;
		if (hasOutdoorScope) {
			this.#diagnostics.profiler?.setCpuPhase("transparencyAndOverlays");
			this.#overlayPasses.drawSky(view, shading, "before-world", pipeline);
			const skyBatches = particlesByScope.get("sky");
			if (
				skyBatches &&
				skyBatches.length > 0 &&
				SHARED_FRONTEND_TUNING.rendering.skyParticles.opacityScale > 0
			) {
				this.#overlayPasses.drawParticleBatches(
					view,
					skyBatches,
					this.#deviceTargets.frameClockSeconds *
						SHARED_FRONTEND_TUNING.rendering.skyParticles.speedMultiplier,
					SHARED_FRONTEND_TUNING.rendering.skyParticles.opacityScale,
				);
			}
		}
		// Submit opaque objects before terrain so buildings, walls, and props populate hardware
		// Early-Z before multi-layer near-terrain shading executes. Terrain uses LESS with the
		// same positive polygon offset, keeping coplanar object-vs-terrain ties identical.
		this.#diagnostics.profiler?.setCpuPhase("opaqueSubmission");
		this.#objectShadowPass.drawOpaqueObjects(
			view,
			objectRuns.opaque,
			shading,
			pipeline,
		);
		this.#diagnostics.profiler?.setCpuPhase("terrainSubmission");
		this.#terrainPass.drawTerrain(view, shading, pipeline);
		if (portalTargets !== null) {
			this.#diagnostics.profiler?.setCpuPhase("portalComposition");
			this.#diagnostics.profiler?.setGpuSystem("portalComposition");
		} else {
			this.#diagnostics.profiler?.setCpuPhase("other");
		}
		pipeline.execute(target.framebuffer);
		pipeline.beginDeferredScene(target.framebuffer);
		if (portalTargets !== null) {
			this.#diagnostics.profiler?.setGpuSystem("other");
		}
		// Entity color participates once, after static portal composition. Its depth both
		// occludes later draws and contributes to the same AO evaluation as static geometry.
		this.#diagnostics.profiler?.setCpuPhase("opaqueSubmission");
		this.#objectShadowPass.drawDynamicOpaque(view, shading);
		if (shading.ambientOcclusion.kind === "enabled") {
			this.#diagnostics.profiler?.setCpuPhase("postAndPresentation");
			this.#diagnostics.profiler?.setGpuSystem("ambientOcclusion");
			this.#deviceTargets
				.getSaoPass()
				.apply(target, view.camera, view.projection, shading.ambientOcclusion);
			this.#diagnostics.recordAmbientOcclusionWork(
				target.extent.width * target.extent.height,
			);
			this.#diagnostics.profiler?.setGpuSystem("other");
		}
		this.#diagnostics.profiler?.setCpuPhase("transparencyAndOverlays");
		// Outdoor foreground weather follows complete-scene AO, including doorway images.
		if (hasOutdoorScope) {
			this.#overlayPasses.drawSky(view, shading, "after-landscape", null);
		}
		// AO and sky change framebuffer, viewport and sampler bindings.
		this.#diagnostics.profiler?.setCpuPhase(
			portalTargets !== null ? "portalComposition" : "other",
		);
		pipeline.beginDeferredScene(target.framebuffer);
		this.#diagnostics.profiler?.setCpuPhase("transparencyAndOverlays");
		this.#objectShadowPass.drawBlendedObjects(
			view,
			objectRuns.blended,
			shading,
			pipeline,
		);
		this.#overlayPasses.drawWorldParticles(view, particlesByScope);
		this.#overlayPasses.drawEntityBeacons(view, pipeline);
		this.#overlayPasses.drawEntityOverlays(view, pipeline);
		this.#overlayPasses.drawSummonLeashes(view);
		this.#overlayPasses.drawCombatEffects(
			view,
			pipeline,
			frame.atlas.visibility,
		);
		this.#overlayPasses.drawWorldIndicator(view, {
			visibility: frame.atlas.visibility,
			routing: pipeline,
		});
		this.#overlayPasses.drawTransformGizmo(view);
		this.#diagnostics.profiler?.setCpuPhase("postAndPresentation");
		this.#deviceTargets.drawPortalTransitionTunnel(
			target,
			frameSettings.showRetailHiddenGeometry,
			this.#sceneCompiler,
			this.#objectShadowPass,
		);
		this.#deviceTargets.presentFlatScene(
			target,
			view,
			this.#overlayPasses,
			this.#objectShadowPass,
		);
		this.#diagnostics.profiler?.setCpuPhase("other");
	}

	/** Draw one flat view through the shared physical schedule. */
	#drawFlatView(
		view: PreparedView,
		shading: SceneShading,
		domain: SceneRenderDomain,
		showRetailHiddenGeometry: boolean,
	): void {
		this.#diagnostics.profiler?.setCpuPhase("other");
		const target = this.#deviceTargets.acquireFlatSceneTarget();
		this.#deviceTargets.beginFlatOpaqueScene(
			target,
			this.#deviceTargets.viewClearColor(view, shading),
		);
		this.#diagnostics.profiler?.setCpuPhase("sceneSelection");
		const objectPhases =
			this.#objectShadowPass.createObjectSubmissionPhases(view);
		const objectRuns =
			this.#objectShadowPass.prepareViewObjectRuns(objectPhases);
		if (domain === "exterior") {
			this.#diagnostics.profiler?.setCpuPhase("transparencyAndOverlays");
			this.#overlayPasses.drawSky(view, shading, "before-world", null);
			if (
				view.skyParticles.length > 0 &&
				SHARED_FRONTEND_TUNING.rendering.skyParticles.opacityScale > 0
			) {
				this.#overlayPasses.drawParticleBatches(
					view,
					view.skyParticles,
					this.#deviceTargets.frameClockSeconds *
						SHARED_FRONTEND_TUNING.rendering.skyParticles.speedMultiplier,
					SHARED_FRONTEND_TUNING.rendering.skyParticles.opacityScale,
				);
			}
		}
		this.#diagnostics.profiler?.setCpuPhase("opaqueSubmission");
		this.#objectShadowPass.drawOpaqueObjects(
			view,
			objectRuns.opaque,
			shading,
			null,
		);
		this.#objectShadowPass.drawDynamicOpaque(view, shading);
		this.#diagnostics.profiler?.setCpuPhase("terrainSubmission");
		this.#terrainPass.drawTerrain(view, shading, null);
		if (shading.ambientOcclusion.kind === "enabled") {
			this.#diagnostics.profiler?.setCpuPhase("postAndPresentation");
			this.#diagnostics.profiler?.setGpuSystem("ambientOcclusion");
			this.#deviceTargets
				.getSaoPass()
				.apply(target, view.camera, view.projection, shading.ambientOcclusion);
			this.#diagnostics.recordAmbientOcclusionWork(
				target.extent.width * target.extent.height,
			);
			this.#diagnostics.profiler?.setGpuSystem("other");
		}
		this.#diagnostics.profiler?.setCpuPhase("transparencyAndOverlays");
		// Retail's after-landscape weather: drawn once the landblock loop is down but before
		// the deferred translucent flush, which is legitimately allowed to cover it.
		if (domain === "exterior") {
			this.#overlayPasses.drawSky(view, shading, "after-landscape", null);
		}
		this.#objectShadowPass.drawBlendedObjects(
			view,
			objectRuns.blended,
			shading,
			null,
		);
		// After the blended pass: particles are transparent and must not occlude the geometry they
		// sort against.
		this.#overlayPasses.drawParticleBatches(
			view,
			view.particles,
			this.#deviceTargets.frameClockSeconds,
			1.0,
		);
		this.#overlayPasses.drawEntityBeacons(view, null);
		this.#overlayPasses.drawEntityOverlays(view, null);
		this.#overlayPasses.drawSummonLeashes(view);
		this.#overlayPasses.drawCombatEffects(view, null, null);
		this.#overlayPasses.drawWorldIndicator(view, null);
		this.#overlayPasses.drawTransformGizmo(view);
		this.#gl.bindVertexArray(null);
		this.#diagnostics.profiler?.setCpuPhase("postAndPresentation");
		this.#deviceTargets.drawPortalTransitionTunnel(
			target,
			showRetailHiddenGeometry,
			this.#sceneCompiler,
			this.#objectShadowPass,
		);
		this.#deviceTargets.presentFlatScene(
			target,
			view,
			this.#overlayPasses,
			this.#objectShadowPass,
		);
		this.#diagnostics.profiler?.setCpuPhase("other");
	}

	#resetFrame(
		viewCount: number,
		envCellRenderMode: FrameInput["frameSettings"]["envCellRenderMode"],
	): void {
		this.#deviceTargets.beginPortalFrame();
		this.#sceneCompiler.beginFrame();
		this.#overlayPasses.clearPreparedSelection();
		this.#objectShadowPass.beginFrame();
		this.#diagnostics.resetFrameSelectionMetrics(viewCount, envCellRenderMode);
	}

	#updateRenderTargetMetrics(): void {
		this.#diagnostics.updateRenderTargetMetrics(
			this.#deviceTargets,
			this.#overlayPasses.entitySelectionPass,
		);
	}

	#finishFrameSelectionMetrics(): void {
		this.#diagnostics.finishFrameSelectionMetrics(
			this.#sceneCompiler.visibleStaticLayerCount,
			this.#sceneCompiler.visibleEnvCellScopeCount,
			this.#objectShadowPass.frameInstances.getDiagnostics(),
		);
	}
}
