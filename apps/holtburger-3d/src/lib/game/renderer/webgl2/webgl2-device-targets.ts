import { SHARED_FRAME_SETTINGS } from "../../../frontend-frame-settings";
import { SHARED_FRONTEND_TUNING } from "../../../frontend-tuning";
import { landblockVec3 } from "../../../assets/ac-frame";
import {
	createRotationMat4,
	createViewMat4,
	multiplyMat4,
	transformPoint3,
} from "../../math/matrices";
import { Mat4, Quat, Vec3 } from "../../math/types";
import {
	DEFAULT_COLOR_GRADE_PARAMETERS,
	type ColorGradeSettings,
} from "../passes/color-grade-policy";
import type { EntitySelectionOutlineSettings } from "../overlays/entity-selection-outline-policy";
import { bucketObjectSubmissions } from "./object-rendering-policy";
import type { PortalWarpDriveTuning } from "../portal/portal-warp-drive-tuning";
import { type RenderExtent, validateRenderExtent } from "../render-extent";
import type {
	FrameInput,
	PortalTransitionFrame,
	PortalTransitionVisual,
} from "../renderer";
import { retainsRetailGeometry } from "../retail-geometry-visibility";
import type { TextureFilteringPolicy } from "./texture-filtering-policy";
import {
	playingClip,
	sampleAnimationPose,
	type PlayingClip,
} from "../../animation/animation-playback";
import { portalTunnelRollRadians } from "../../../client/portal-transition-visual";
import { validatePortalTransitionPresentationPlan } from "../../../client/portal-transition-presentation";
import { resolvePortalTransitionComposition } from "../portal/portal-transition-composition";
import { resolveSceneLightingByRole } from "../../environment/scene-lighting";
import { composeObjectPartTransform } from "../../resolution/object-part-transform";
import type { ObjectVisualTemplate } from "../../systems/object-visual-template-repository";
import { WebGL2DeviceStateApplicator } from "./webgl2-device-state-applicator";
import type { WebGL2EntitySelectionPass } from "../overlays/webgl2-entity-selection-pass";
import type { SkyParticleOverlayAndSelectionPasses } from "./webgl2-overlay-particle-sky-passes";
import {
	WebGL2FlatScenePresentation,
	type FlatScenePresentationInput,
} from "./webgl2-flat-scene-presentation";
import {
	WebGL2FlatSceneTarget,
	type WebGL2FlatSceneTargetSet,
} from "./webgl2-flat-scene-target";
import { WebGL2PortalScopeAtlasPipeline } from "../portal/webgl2-portal-scope-atlas-pipeline";
import type { WebGL2ResourceManager } from "./webgl2-resource-manager";
import {
	WebGL2SaoPass,
	type WebGL2SaoCoverageCensus,
} from "../passes/webgl2-sao-pass";
import type { WebGL2TextureFilteringSupport } from "./webgl2-texture-filtering-support";
import { WebGL2TextureSamplerCatalog } from "./webgl2-texture-sampler-catalog";
import { WebGL2TransitionSnapshot } from "./webgl2-transition-snapshot";
import type {
	RendererFrameDiagnosticsAndProfiler,
	RenderTargetMetricsSources,
} from "./webgl2-frame-diagnostics";
import {
	BLACK_SCENE_CLEAR_COLOR,
	EMPTY_LANDBLOCK_LIGHTS,
	PORTAL_TRANSITION_ANCHOR,
	PORTAL_TRANSITION_CAMERA,
	PORTAL_TRANSITION_LIGHTING,
	PORTAL_TRANSITION_SCOPE,
	type ObjectFrameInput,
	type PreparedObjectFrameInput,
	type PreparedView,
	type PreparedViewGeometry,
	type SceneShading,
} from "./webgl2-renderer-types";
import type { SceneContributionCompilerAndSelector } from "./webgl2-scene-compiler";
import type { ObjectAndShadowPassExecutor } from "./webgl2-object-shadow-pass";

export class WebGL2DeviceAndTargetPool implements RenderTargetMetricsSources {
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #resources: WebGL2ResourceManager;
	/** Device-wide guard preventing draws through any stale handle after context loss. */
	readonly #assertDeviceReady: () => void;
	/** Exact state mirror scoped to independently invalidated object phases. */
	readonly #deviceState: WebGL2DeviceStateApplicator;
	readonly #textureSamplers: WebGL2TextureSamplerCatalog;
	readonly #diagnostics: RendererFrameDiagnosticsAndProfiler;
	/** Frontend-selected portal look consumed only by the lazy fullscreen presenter. */
	readonly #portalWarpDriveTuning: PortalWarpDriveTuning;

	#frameWidth = 0;
	#frameHeight = 0;
	/** Sampling density the drawing buffer is currently sized for, retained for resize alone. */
	#renderScale: number =
		SHARED_FRONTEND_TUNING.rendering.frameDefaults.renderScale;
	/** Requested quality captured at frame entry and consumed by every nested draw path. */
	#frameTextureFiltering: TextureFilteringPolicy =
		SHARED_FRONTEND_TUNING.rendering.frameDefaults.textureFiltering;
	/** Shared clock seconds for the current frame, driving derived texture-velocity phase. */
	#frameClockSeconds = 0;
	/** This frame's presentation grade, snapshotted once and consumed at present time. */
	#frameColorGrade: ColorGradeSettings = {
		enabled: false,
		parameters: DEFAULT_COLOR_GRADE_PARAMETERS,
	};
	/** This frame's depth-independent selection edge appearance. */
	#frameEntitySelectionOutline: EntitySelectionOutlineSettings =
		SHARED_FRAME_SETTINGS.entitySelectionOutline;

	/** Unconditional flat-scene attachments, allocated lazily on the first flat frame. */
	#flatSceneTarget: WebGL2FlatSceneTarget | null = null;
	/** Flat color/depth presenter, compiled lazily with the first flat frame. */
	#flatScenePresentation: WebGL2FlatScenePresentation | null = null;
	/** Portal owner created lazily when the first portal frame needs GPU resources. */
	#portalScopeAtlasPipeline: WebGL2PortalScopeAtlasPipeline | null = null;
	/** Optional SAO programs and scratch ownership, created only by the first enabled frame. */
	#saoPass: WebGL2SaoPass | null = null;
	/** Harness-only category view; production never enables synchronous depth census work. */
	#saoCoverageVisualizationEnabled = false;
	/** Outgoing world color retained only while a transition compositor needs it. */
	#transitionSnapshot: WebGL2TransitionSnapshot | null = null;
	#transitionSnapshotGeneration: number | null = null;
	#activeTransition: PortalTransitionFrame | null = null;
	/** Prepared setup visual retained for the transition-only tunnel target. */
	#portalTransitionVisual: PortalTransitionVisual | null = null;
	#portalTransitionClip: PlayingClip | null = null;
	/** Transition-only authored tunnel color/depth target; ordinary frames never allocate it. */
	#portalTransitionTarget: WebGL2FlatSceneTarget | null = null;

	constructor(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
		textureFilteringSupport: WebGL2TextureFilteringSupport,
		portalWarpDriveTuning: PortalWarpDriveTuning,
		assertDeviceReady: () => void,
		diagnostics: RendererFrameDiagnosticsAndProfiler,
	) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.#resources = resources;
		this.#assertDeviceReady = assertDeviceReady;
		this.#portalWarpDriveTuning = portalWarpDriveTuning;
		this.#diagnostics = diagnostics;
		this.#textureSamplers = new WebGL2TextureSamplerCatalog(
			gl,
			textureFilteringSupport,
		);
		this.#deviceState = new WebGL2DeviceStateApplicator(gl);
	}

	get canvas(): HTMLCanvasElement {
		return this.#canvas;
	}

	get gl(): WebGL2RenderingContext {
		return this.#gl;
	}

	get resources(): WebGL2ResourceManager {
		return this.#resources;
	}

	get deviceState(): WebGL2DeviceStateApplicator {
		return this.#deviceState;
	}

	get textureSamplers(): WebGL2TextureSamplerCatalog {
		return this.#textureSamplers;
	}

	get frameWidth(): number {
		return this.#frameWidth;
	}

	get frameHeight(): number {
		return this.#frameHeight;
	}

	get renderScale(): number {
		return this.#renderScale;
	}

	setRenderScale(scale: number): void {
		this.#renderScale = scale;
	}

	get frameTextureFiltering(): TextureFilteringPolicy {
		return this.#frameTextureFiltering;
	}

	setFrameTextureFiltering(policy: TextureFilteringPolicy): void {
		this.#frameTextureFiltering = policy;
	}

	get frameClockSeconds(): number {
		return this.#frameClockSeconds;
	}

	setFrameClockSeconds(seconds: number): void {
		this.#frameClockSeconds = seconds;
	}

	setFramePresentationState(
		colorGrade: ColorGradeSettings,
		entitySelectionOutline: EntitySelectionOutlineSettings,
	): void {
		this.#frameColorGrade = colorGrade;
		this.#frameEntitySelectionOutline = entitySelectionOutline;
	}

	setActiveTransition(transition: PortalTransitionFrame | null): void {
		this.#activeTransition = transition;
	}

	get portalScopeAtlasPipeline(): WebGL2PortalScopeAtlasPipeline | null {
		return this.#portalScopeAtlasPipeline;
	}

	get transitionSnapshot(): WebGL2TransitionSnapshot | null {
		return this.#transitionSnapshot;
	}

	get portalTransitionTarget(): WebGL2FlatSceneTarget | null {
		return this.#portalTransitionTarget;
	}

	get portalTransitionVisualInstalled(): boolean {
		return this.#portalTransitionVisual !== null;
	}

	get activeTransition(): PortalTransitionFrame | null {
		return this.#activeTransition;
	}

	get flatSceneTarget(): WebGL2FlatSceneTarget | null {
		return this.#flatSceneTarget;
	}

	get saoPass(): WebGL2SaoPass | null {
		return this.#saoPass;
	}

	acquirePortalScopeAtlasPipeline(): WebGL2PortalScopeAtlasPipeline {
		return (this.#portalScopeAtlasPipeline ??=
			new WebGL2PortalScopeAtlasPipeline(this.#gl));
	}

	beginPortalFrame(): void {
		this.#portalScopeAtlasPipeline?.beginFrame();
	}

	applyRenderExtent(extent: RenderExtent): void {
		validateRenderExtent(extent, "WebGL2 frame");
		const { height, width } = extent;
		if (
			width === this.#frameWidth &&
			height === this.#frameHeight &&
			this.#canvas.width === width &&
			this.#canvas.height === height
		)
			return;

		const maximumViewport = this.#gl.getParameter(
			this.#gl.MAX_VIEWPORT_DIMS,
		) as readonly [number, number];
		if (width > maximumViewport[0] || height > maximumViewport[1])
			throw new Error(
				`Frame extent ${width}x${height} exceeds device viewport limit ${maximumViewport[0]}x${maximumViewport[1]}.`,
			);
		this.#frameWidth = width;
		this.#frameHeight = height;
		this.#canvas.width = width;
		this.#canvas.height = height;
		this.#gl.viewport(0, 0, width, height);
	}

	beginFrame(clearColor: readonly [number, number, number, number]): void {
		const gl = this.#gl;
		gl.clearColor(...clearColor);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
	}

	viewClearColor(
		view: PreparedViewGeometry,
		shading: SceneShading,
	): readonly [number, number, number, number] {
		return view.cameraInsideSealedCell
			? BLACK_SCENE_CLEAR_COLOR
			: shading.clearColor;
	}

	/**
	 * Reuse this frame's scene target, allocating it on the first frame that needs one.
	 *
	 * Both schedules render into the same target: the flat one because it always has, and the
	 * portal one because its composite must land somewhere samplable before presentation grades
	 * it. The default framebuffer cannot be sampled, so an offscreen target is what makes a
	 * whole-frame transform possible at all.
	 */
	acquireFlatSceneTarget(): WebGL2FlatSceneTargetSet {
		const owner = (this.#flatSceneTarget ??= new WebGL2FlatSceneTarget(
			this.#gl,
		));
		return owner.resizeDimensions(this.#frameWidth, this.#frameHeight);
	}

	/** Bind and clear one complete flat-scene target before any scene submission. */
	beginFlatOpaqueScene(
		target: WebGL2FlatSceneTargetSet,
		clearColor: readonly [number, number, number, number],
	): void {
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
		gl.viewport(0, 0, target.extent.width, target.extent.height);
		gl.colorMask(true, true, true, true);
		// Opaque visibility must not depend on state left by presentation or HUD overlays.
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.clearColor(...clearColor);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	}

	getSaoPass(): WebGL2SaoPass {
		if (this.#saoPass) return this.#saoPass;
		const pass = new WebGL2SaoPass(this.#gl);
		pass.setCoverageVisualizationEnabled(this.#saoCoverageVisualizationEnabled);
		this.#saoPass = pass;
		return pass;
	}

	disableSaoPass(): void {
		this.#saoPass?.disable();
	}

	/**
	 * Write one finished scene target to the default framebuffer.
	 *
	 * Both physical schedules present the complete world here, so grading and transition composition
	 * see every world fragment exactly once. Unplaced combat feedback draws afterward as a HUD
	 * overlay and bypasses those transforms.
	 */
	presentFlatScene(
		target: WebGL2FlatSceneTargetSet,
		view: PreparedViewGeometry | null,
		overlayPasses: SkyParticleOverlayAndSelectionPasses,
		objectShadowPass: ObjectAndShadowPassExecutor,
	): void {
		this.#diagnostics.profiler?.setGpuSystem("presentation");
		const selectionMask =
			view === null ? null : overlayPasses.drawEntitySelectionMask(view);
		const transition = this.transitionPresentationInput();
		(this.#flatScenePresentation ??= new WebGL2FlatScenePresentation(
			this.#gl,
			this.#portalWarpDriveTuning,
		)).present(
			target,
			this.#frameColorGrade,
			transition,
			this.#frameEntitySelectionOutline,
			this.#renderScale,
			selectionMask,
			this.#frameClockSeconds,
		);
		const activeTransition = this.#activeTransition;
		if (
			activeTransition === null ||
			activeTransition.kind !== "origin-to-tunnel"
		) {
			this.#transitionSnapshot?.clear();
			this.#transitionSnapshotGeneration = null;
		}
		if (
			activeTransition === null ||
			activeTransition.kind === "destination-only-awaiting-handoff"
		) {
			this.#portalTransitionTarget?.destroy();
			this.#portalTransitionTarget = null;
		}
		// Presentation changes program and texture bindings outside the device-state mirror.
		objectShadowPass.beginObjectPhase();
		this.#diagnostics.profiler?.setGpuSystem("other");
	}

	/** Capture or retire transition-only resources at frame entry, before the scene target is drawn. */
	prepareTransitionSnapshot(transition: FrameInput["portalTransition"]): void {
		if (
			transition === undefined ||
			transition.kind === "destination-only-awaiting-handoff"
		) {
			this.#transitionSnapshot?.clear();
			this.#transitionSnapshotGeneration = null;
			return;
		}
		validatePortalTransitionPresentationPlan(transition);
		if (this.#transitionSnapshotGeneration !== transition.generation) {
			this.#transitionSnapshot?.clear();
			this.#transitionSnapshotGeneration = transition.generation;
		}
		if (transition.kind !== "origin-to-tunnel") {
			this.#transitionSnapshot?.clear();
			return;
		}
		const source = this.#flatSceneTarget?.getCurrentTarget();
		if (source === null || source === undefined) return;
		const existing = this.#transitionSnapshot?.getCurrentTarget();
		if (existing !== null && existing !== undefined) {
			// The outgoing image is the last completed frame, not the incoming frame currently
			// being drawn. Keep the first capture stable for the whole transition generation. Its
			// native extent is intentional: the fullscreen compositor samples normalized UVs, so a
			// resize can preserve this useful warp source without an intermediate reallocation.
			return;
		}
		(this.#transitionSnapshot ??= new WebGL2TransitionSnapshot(
			this.#gl,
		)).capture(source.framebuffer, source.extent);
	}

	/** Convert renderer-owned snapshot state into the final presenter input. */
	transitionPresentationInput(): FlatScenePresentationInput {
		const transition = this.#activeTransition;
		const snapshot = this.#transitionSnapshot?.getCurrentTarget();
		const tunnel = this.#portalTransitionTarget?.getCurrentTarget();
		return resolvePortalTransitionComposition(transition ?? undefined, {
			origin: snapshot?.texture ?? null,
			tunnel: tunnel?.color ?? null,
		});
	}

	/**
	 * Render the authored portal setup into a transition-only target before final presentation.
	 *
	 * The setup is placed in a virtual camera room using the retail camera facts rather than added
	 * to the world scene. That keeps world authority and culling untouched while still exercising
	 * the same compiled geometry, atlas bindings, material partitions, and animation sampler used
	 * by ordinary setup visuals.
	 */
	drawPortalTransitionTunnel(
		sceneTarget: WebGL2FlatSceneTargetSet,
		showRetailHiddenGeometry: boolean,
		sceneCompiler: SceneContributionCompilerAndSelector,
		objectShadowPass: ObjectAndShadowPassExecutor,
	): void {
		const transition = this.#activeTransition;
		const visual = this.#portalTransitionVisual;
		const clip = this.#portalTransitionClip;
		if (
			transition === null ||
			transition.kind === "destination-only-awaiting-handoff" ||
			visual === null ||
			clip === null
		) {
			this.#portalTransitionTarget?.destroy();
			this.#portalTransitionTarget = null;
			return;
		}
		const target = (this.#portalTransitionTarget ??= new WebGL2FlatSceneTarget(
			this.#gl,
		)).resizeDimensions(this.#frameWidth, this.#frameHeight);

		try {
			this.beginPortalTransitionTarget(target);
			const view = sceneCompiler.prepareViewGeometry(PORTAL_TRANSITION_ANCHOR, {
				camera: PORTAL_TRANSITION_CAMERA,
				cameraInsideSealedCell: false,
			});
			// `animationFramePosition` is already a fractional cursor advanced at render cadence.
			// The authored 40 fps rate belongs to traversal, not to the display refresh cap.
			const framePosition = transition.tunnel.animationFramePosition;
			const partPoses = sampleAnimationPose(clip, framePosition);
			const portalView = createViewMat4(
				new Vec3(0.24, -2.7, 0.88),
				Quat.identity(),
			);
			const roll = portalTunnelRollRadians(
				transition.generation,
				transition.tunnel.axialRollFramePosition,
			);
			const portalCameraWorld = multiplyMat4(
				portalView,
				createRotationMat4(
					new Quat(Math.cos(roll / 2), 0, 0, Math.sin(roll / 2)),
				),
			);
			const objects = this.prepareIsolatedSetupObjects(
				visual.template,
				partPoses,
				portalCameraWorld,
				new Vec3(1, 1, 1),
				view,
				"portal-transition",
				PORTAL_TRANSITION_SCOPE,
				showRetailHiddenGeometry,
				sceneCompiler,
			);
			const portalViewInput: PreparedView = {
				...view,
				dynamicOpaque: [],
				landblockOffsets: new Map([[view.anchorLandblockId, [0, 0, 0]]]),
				// Portal space is a presentation-only authored setup, never a dynamic-entity view.
				entityBeacons: [],
				entityBeaconSettings: SHARED_FRAME_SETTINGS.entityBeacons,
				entityOverlays: [],
				entityOverlaySettings: SHARED_FRAME_SETTINGS.entityOverlays,
				healthBars: SHARED_FRAME_SETTINGS.healthBars,
				objectBuckets: bucketObjectSubmissions(objects),
				particles: [],
				skyParticles: [],
				terrain: [],
				entityAnalyticShadows: null,
			};
			const portalShading: SceneShading = {
				clearColor: BLACK_SCENE_CLEAR_COLOR,
				authoredLightResponse: 0,
				ambientOcclusion: { kind: "disabled" },
				anchorOrigin: { x: 0, z: 0 },
				dynamicLights: [],
				fog: null,
				sky: null,
				staticLights: () => EMPTY_LANDBLOCK_LIGHTS,
				weatherEnabled: false,
				lighting: resolveSceneLightingByRole(PORTAL_TRANSITION_LIGHTING, null),
			};
			const phases =
				objectShadowPass.createObjectSubmissionPhases(portalViewInput);
			const runs = objectShadowPass.prepareViewObjectRuns(phases);
			objectShadowPass.drawOpaqueObjects(
				portalViewInput,
				runs.opaque,
				portalShading,
				null,
			);
			objectShadowPass.drawBlendedObjects(
				portalViewInput,
				runs.blended,
				portalShading,
				null,
			);
		} finally {
			// The presenter samples the scene target next; restore its framebuffer and viewport even
			// when an authored material fails loudly during this transition-only pass.
			this.#gl.bindFramebuffer(
				this.#gl.DRAW_FRAMEBUFFER,
				sceneTarget.framebuffer,
			);
			this.#gl.viewport(
				0,
				0,
				sceneTarget.extent.width,
				sceneTarget.extent.height,
			);
		}
	}

	/** Clear a tunnel target with transparent color so only authored pixels cover the world. */
	beginPortalTransitionTarget(target: WebGL2FlatSceneTargetSet): void {
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
		gl.viewport(0, 0, target.extent.width, target.extent.height);
		gl.colorMask(true, true, true, true);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.clearColor(0, 0, 0, 0);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	}

	prepareIsolatedSetupObjects(
		template: ObjectVisualTemplate,
		partPoses: readonly Mat4[],
		root: Mat4,
		scale: Vec3,
		view: PreparedViewGeometry,
		source: "portal-transition",
		renderScopeKey: string,
		showRetailHiddenGeometry: boolean,
		sceneCompiler: SceneContributionCompilerAndSelector,
	): PreparedObjectFrameInput[] {
		const objects: PreparedObjectFrameInput[] = [];
		for (const part of template.parts) {
			const pose = partPoses[part.partIndex];
			if (!pose)
				throw new Error(
					`Isolated setup pose has no transform for part ${part.partIndex}.`,
				);
			const localToLandblock = multiplyMat4(
				root,
				composeObjectPartTransform(pose, scale, part.defaultScale),
			);
			const bounds = part.localBounds;
			const center = new Vec3(
				bounds ? (bounds.min.x + bounds.max.x) / 2 : 0,
				bounds ? (bounds.min.y + bounds.max.y) / 2 : 0,
				bounds ? (bounds.min.z + bounds.max.z) / 2 : 0,
			);
			const transparentCenter = landblockVec3(
				transformPoint3(localToLandblock, center),
			);
			for (const drawUnit of part.drawUnits) {
				if (
					!retainsRetailGeometry(
						drawUnit.retailVisibility,
						showRetailHiddenGeometry,
					)
				)
					continue;
				const geometry = sceneCompiler.resolveGeometry(drawUnit.geometry);
				const object: ObjectFrameInput = {
					cullFaceOverride: null,
					drawKind: "single",
					geometry,
					indexCount: drawUnit.indexCount,
					indexStart: drawUnit.indexStart,
					instances: null,
					landblockId: view.anchorLandblockId,
					localToLandblock,
					material: drawUnit.material,
					ordering: drawUnit.ordering,
					receivesOutdoorPssm: false,
					retailVisibility: drawUnit.retailVisibility,
					renderScopeKey,
					source,
					transparentSort: {
						center: transparentCenter,
						stableId: `${source}/${part.partIndex}/${drawUnit.batchKey}`,
					},
				};
				objects.push(sceneCompiler.compileStaticSubmission(drawUnit, object));
			}
		}
		return objects;
	}

	/** Install one validated setup/animation pair for the transition-only authored tunnel pass. */
	installPortalTransitionVisual(visual: PortalTransitionVisual): void {
		this.#assertDeviceReady();
		if (this.#portalTransitionVisual !== null) {
			throw new Error("Portal transition visual is already installed.");
		}
		if (visual.template.parts.length === 0) {
			throw new Error("Portal transition visual has no drawable parts.");
		}
		this.#portalTransitionVisual = visual;
		this.#portalTransitionClip = playingClip(
			visual.animation,
			visual.lowFrame,
			visual.animation.frameCount - 1,
			visual.animation.framesPerSecond,
			"loop",
		);
	}

	clearPresentation(
		entitySelectionPass: WebGL2EntitySelectionPass | null,
	): void {
		this.#assertDeviceReady();
		// Exceptional presentation failure is a clean cutover: stale portal/origin resources must not
		// remain live behind the explicit black error surface.
		this.#activeTransition = null;
		this.#transitionSnapshot?.clear();
		this.#transitionSnapshotGeneration = null;
		this.#portalTransitionTarget?.destroy();
		this.#portalTransitionTarget = null;
		// `clearPresentation` is itself an observable presentation edge. Refresh the owned-resource
		// facts now so failure diagnostics cannot report targets that this call already destroyed.
		this.#diagnostics.metrics.portalTransitionOnlyFramePresented = false;
		this.#diagnostics.updateRenderTargetMetrics(this, entitySelectionPass);
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
		gl.viewport(0, 0, this.#frameWidth, this.#frameHeight);
		gl.clearColor(0, 0, 0, 1);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.stencilMask(0xff);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
	}

	/** Toggle the harness-only AO category view without widening production frame settings. */
	setAmbientOcclusionCoverageVisualizationEnabled(enabled: boolean): void {
		this.#saoCoverageVisualizationEnabled = enabled;
		this.#saoPass?.setCoverageVisualizationEnabled(enabled);
	}

	/** Read the latest one-shot harness census, if a visualized AO frame completed. */
	getAmbientOcclusionCoverageCensus(): WebGL2SaoCoverageCensus | null {
		return this.#saoPass?.getCoverageCensus() ?? null;
	}

	destroySamplers(): void {
		this.#textureSamplers.destroy();
	}

	destroyTargetsAndPresentation(): void {
		this.#portalScopeAtlasPipeline?.destroy();
		this.#portalScopeAtlasPipeline = null;
		this.#flatSceneTarget?.destroy();
		this.#flatSceneTarget = null;
		this.#transitionSnapshot?.destroy();
		this.#transitionSnapshot = null;
		this.#transitionSnapshotGeneration = null;
		this.#activeTransition = null;
		this.#portalTransitionTarget?.destroy();
		this.#portalTransitionTarget = null;
		this.#portalTransitionVisual = null;
		this.#portalTransitionClip = null;
		this.#flatScenePresentation?.destroy();
		this.#flatScenePresentation = null;
	}

	destroySaoPass(): void {
		this.#saoPass?.destroy();
		this.#saoPass = null;
	}
}
