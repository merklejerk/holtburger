import {
	createLandblockOffset,
	getLandblockCoordinates,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";
import {
	createPerspectiveMat4,
	createTranslationMat4,
	createViewMat4,
	mat4ToFloat32Array,
	multiplyMat4,
	transformPoint3,
} from "../math/matrices";
import { createFrustumFromClipMatrix, type Frustum } from "../math/frustum";
import { Mat4, Vec3 } from "../math/types";
import type { SceneNodeId, SceneScope } from "../scene";
import { scopeFor, scopeKey } from "../scene/scope";
import { createCameraNearClipVolume } from "./portal-near-plane";
import {
	PortalRenderGraphPlanner,
	type PortalRenderGraphPlanResult,
	type PortalRenderWorkPlan,
} from "./portal-render-graph";
import type { TerrainDrawUnit } from "../terrain/types";
import type {
	ObjectMaterialBinding,
	StaticObjectDrawUnit,
} from "../commit/artifacts";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import { TextureWrapMode } from "../textures/types";
import type {
	FrameInput,
	FrameSelectionMetrics,
	RendererFrameDiagnostics,
	RendererFrameFeedback,
	FrameViewInput,
	Renderer,
} from "./renderer";
import { RenderWorld, type ObjectPresentationFootprint } from "./render-world";
import { retainsProjectedObjectFootprint } from "./object-footprint";
import type {
	GeometryResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";
import {
	OBJECT_INSTANCE_RECORD_BYTES,
	type ObjectInstanceData,
	type StaticInstanceStreamData,
} from "../systems/static-resources";
import type { TerrainProgramInput } from "./terrain-program-input";
import { LandblockLayerKind } from "../runtime/scene-interest";
import {
	WebGL2ResourceManager,
	type WebGL2GeometryBinding,
	type WebGL2Texture2DBinding,
	type WebGL2TextureArrayBinding,
} from "./webgl2-resource-manager";
import {
	createWebGL2TerrainProgram,
	type WebGL2TerrainProgram,
} from "./webgl2-terrain-program";
import { FrameInstanceStreamArena } from "./frame-instance-stream-arena";
import { GeneratedInstanceSelector } from "./generated-instance-selection";
import {
	createWebGL2ObjectProgram,
	OBJECT_TEXTURE_UNITS,
	type WebGL2FogObjectProgram,
	type WebGL2FogInstancedObjectProgram,
	type WebGL2InstancedObjectProgram,
	type WebGL2ObjectProgram,
} from "./webgl2-object-program";
import { bindWebGL2ObjectInstanceRange } from "./webgl2-instance-buffer";
import {
	DISABLED_VIEWER_LIGHT,
	UNAUTHORED_SCENE_LIGHTING,
	VIEWER_LIGHT,
} from "../environment/scene-environment";
import {
	objectLightingRole,
	resolveSceneLightingByRole,
	type SceneLightingByRole,
} from "../environment/scene-lighting";
import { bindWebGL2DistanceFog } from "./webgl2-fog";
import { bindWebGL2SceneLighting } from "./webgl2-lighting";
import {
	formAdjacentObjectInstanceRuns,
	formGroupedObjectInstanceRuns,
	areStaticObjectDrawsCompatible,
	objectBlendPolicy,
	orderTransparentObjectRanges,
	type PreparedObjectAtlasBinding,
	type PreparedObjectMaterial,
	type PreparedObjectTextureBinding,
	type PreparedStaticObjectDrawCompatibility,
	type ObjectBlendPolicy,
	type TransparentObjectRange,
} from "./object-rendering-policy";
import { resolveStaticMaterialDetail } from "./static-detail-binding";
import {
	MAXIMUM_PORTAL_RENDER_LAYER,
	WebGL2PortalSubstrate,
} from "./webgl2-portal-substrate";
import type { PreparedPortalProjection } from "./portal-view-window";
import {
	executePortalGraph,
	type PortalFrameDiagnostics,
} from "./webgl2-portal-executor";
import type { ResolvedPortalMask } from "./webgl2-portal-mask";
import type { WebGL2TextureFilteringSupport } from "./webgl2-texture-filtering-support";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import {
	WebGL2TextureSamplerCatalog,
	type TextureSamplingClass,
} from "./webgl2-texture-sampler-catalog";
import type { TextureFilteringPolicy } from "./texture-filtering-policy";
import { WebGL2ObjectStateApplicator } from "./webgl2-object-state-applicator";
import {
	WebGL2FrameProfiler,
	type WebGL2FrameProfileCapture,
} from "./webgl2-gpu-frame-profiler";

/** Keep terrain behind authored outdoor geometry at near-coplanar depth intersections. */
const TERRAIN_DEPTH_OFFSET = { factor: 1, units: 1 } as const;
/** Corruption guard only; fixed-point convergence, not this number, terminates valid planning. */
const PORTAL_PLANNING_WORK_ITEM_LIMIT = 100_000;

/** One visible landblock terrain source paired with selected renderer resources. */
/**
 * Shading state threaded through every draw pass.
 *
 * Fog and lighting travel together because both are resolved from the same regional
 * keyframes and both must agree for a given draw. Phase 3 of the scene lighting plan
 * varies this per draw unit so portal-visible interiors can drop the sun while the
 * outdoor pass keeps it.
 */
interface SceneShading {
	readonly fog: FrameInput["environment"]["distanceFog"];
	/** Lighting per draw role, derived once per frame so draw loops stay allocation-free. */
	readonly lighting: SceneLightingByRole;
}

/**
 * Shading for the browser-harness portal execution probe, which renders outside any
 * resolved frame environment. Fog stays disabled exactly as this probe path always had it.
 */
const PROBE_SHADING: SceneShading = {
	fog: null,
	lighting: resolveSceneLightingByRole(UNAUTHORED_SCENE_LIGHTING),
};

interface TerrainFrameInput {
	/** Selected LOD, transition range, and logical texture identities. */
	readonly drawUnit: TerrainDrawUnit;
	/** Device resources resolved by this renderer for the terrain shader contract. */
	readonly program: TerrainProgramInput;
}

/** One opaque or alpha-test static-object range paired with its resolved node placement. */
interface ObjectFrameInput {
	readonly source:
		| "outdoor"
		| "generated"
		| "env-cell-shell"
		| "env-cell-resident"
		| "dynamic";
	/** Scene/portal residency boundary that must never be crossed by an instance run. */
	readonly renderDomainKey: string;
	readonly cullFaceOverride:
		StaticObjectDrawUnit["material"]["polygon"]["cullFace"] | null;
	readonly drawKind: "baked" | "instanced";
	readonly geometry: GeometryResourceKey;
	readonly indexCount: number;
	readonly indexStart: number;
	readonly instances:
		| null
		| {
				readonly cohortKey: string;
				readonly data: StaticInstanceStreamData;
				readonly kind: "static-fragment";
		  }
		| {
				readonly cohortKey: string;
				readonly instance: import("../systems/static-resources").ObjectInstanceData;
				readonly kind: "frame-template";
		  }
		| {
				readonly firstInstance: number;
				readonly instanceCount: number;
				readonly kind: "frame-range";
		  };
	readonly landblockId: string;
	readonly localToLandblock: Mat4;
	readonly material: ObjectMaterialBinding;
	readonly ordering: ObjectMaterialOrdering;
	readonly transparentSort: {
		readonly stableId: string;
		readonly center: Vec3;
	} | null;
}

type PreparedObjectDrawCompatibility = PreparedStaticObjectDrawCompatibility<
	WebGL2GeometryBinding,
	WebGLTexture,
	WebGLSampler
>;

/** One object contribution paired with every renderer-resolved fact consumed at submission. */
interface PreparedObjectFrameInput extends ObjectFrameInput {
	readonly blendPolicy: ObjectBlendPolicy;
	readonly compatibility: PreparedObjectDrawCompatibility;
}

type AnyObjectProgram =
	| WebGL2ObjectProgram
	| WebGL2FogObjectProgram
	| WebGL2InstancedObjectProgram
	| WebGL2FogInstancedObjectProgram;

/** Anchor-relative matrices and content reused by all passes for one view. */
interface PreparedViewGeometry extends PreparedPortalProjection {
	/** Camera position expressed in the view's anchor-relative render frame. */
	readonly cameraPosition: Vec3;
	/** Projection matrix derived from the current drawing-buffer aspect ratio. */
	readonly projection: Mat4;
	/** Original camera frustum retained for topology and selected-scope culling. */
	readonly frustum: Frustum;
	/** Anchor-relative camera view transform. */
	readonly view: Mat4;
	/** Landblock defining the view's render-world origin. */
	readonly anchorLandblockId: FrameInput["anchorLandblockId"];
}

/** Resolved scene contributions independent from flat or portal scheduling policy. */
interface PreparedSceneContributions {
	/** Terrain selected by this renderer from its RenderWorld. */
	readonly terrain: readonly TerrainFrameInput[];
	/** Opaque and alpha-test static-object ranges visible to this view. */
	readonly objects: readonly PreparedObjectFrameInput[];
}

/** Anchor-relative matrices and content reused by all passes for one view. */
interface PreparedView
	extends PreparedViewGeometry, PreparedSceneContributions {}

/** Read-only Gate-E evidence from the final pure portal planner and shared scene query. */
export interface PortalRenderGraphProbeResult {
	readonly planningDurationMs: number;
	readonly result: PortalRenderGraphPlanResult;
	readonly selectedSceneEntryCount: number | null;
}

/** Explicit portal-graph execution evidence without enabling the public portal render mode. */
export interface PortalExecutionProbeResult {
	readonly diagnostics: PortalFrameDiagnostics | null;
	readonly planningDurationMs: number;
	readonly result: PortalRenderGraphPlanResult;
	/** Selection and submission facts sampled immediately after the explicit execution. */
	readonly selectionMetrics: FrameSelectionMetrics | null;
}

/** Mutable backing state copied only when Explorer samples renderer diagnostics. */
interface MutableFrameSelectionMetrics {
	envCellRenderMode: FrameInput["frameSettings"]["envCellRenderMode"];
	viewCount: number;
	visibleSceneEntries: number;
	terrainFrameInputs: number;
	visibleStaticLayerCount: number;
	visibleStaticNodeCount: number;
	visibleDynamicEntityCount: number;
	visibleDynamicPartCount: number;
	testedObjectPresentationCount: number;
	retainedObjectPresentationCount: number;
	rejectedObjectPresentationCount: number;
	visibleEnvCellShells: number;
	visibleEnvCellScopeCount: number;
	visibleEnvCellResidentNodes: number;
	submittedEnvCellShellDrawCount: number;
	submittedEnvCellShellTriangleCount: number;
	submittedEnvCellResidentDrawCount: number;
	submittedEnvCellResidentTriangleCount: number;
	envCellShellCullOverrideCount: number;
	submittedPortalApertureDrawCount: number;
	portalMaskEdgeCount: number;
	portalNearPlaneSeedCount: number;
	portalRejectedFacingCrossingCount: number;
	portalRejectedFootprintCount: number;
	portalSameDomainBoundaryCrossingCount: number;
	portalAdmittedScopeWindowStateCount: number;
	portalRenderLayerCount: number;
	portalRenderNodeCount: number;
	portalSubmittedRenderNodeCount: number;
	portalExteriorRenderCount: number;
	sceneDomainTargetCount: number;
	sceneDomainTargetBytes: number;
	submittedStaticObjectDrawCount: number;
	submittedStaticObjectTriangleCount: number;
	submittedBakedStaticObjectDrawCount: number;
	submittedBakedStaticObjectTriangleCount: number;
	selectedGeneratedInstanceFragmentCount: number;
	selectedGeneratedInstanceCount: number;
	testedGeneratedInstanceCount: number;
	retainedGeneratedInstanceCount: number;
	rejectedGeneratedInstanceCount: number;
	submittedCompactedGeneratedDrawCount: number;
	submittedCompactedGeneratedInstanceCount: number;
	submittedInstancedSourceTriangleCount: number;
	transparentObjectCandidateCount: number;
	farTransparentObjectCandidateCount: number;
	nearTransparentObjectCandidateCount: number;
	transparentFrameRunCount: number;
	farTransparentFrameRunCount: number;
	nearTransparentFrameRunCount: number;
	frameInstanceUploadCount: number;
	frameInstanceUploadBytes: number;
	submittedTransparentObjectDrawCount: number;
	submittedTransparentInstanceCount: number;
	submittedAdditiveObjectDrawCount: number;
	submittedDynamicDrawCount: number;
	submittedDynamicInstanceCount: number;
	frameInstanceCapacity: number;
	frameInstanceGrowthCount: number;
	frameInstanceViewHighWaterMark: number;
	objectLightingBinds: number;
	objectProgramChanges: number;
	objectTextureBinds: number;
}

export class WebGL2Renderer implements Renderer {
	/** Explicit diagnostic capability, separated from the production draw methods. */
	readonly frameDiagnostics: RendererFrameDiagnostics;
	static readonly #identityMatrix = Mat4.identity();

	readonly #matrixScratch = new Float32Array(16);
	readonly #offsetScratch = new Vec3(0, 0, 0);
	/** Reused while deriving transparent range distances before sorting a view. */
	readonly #transparentCenterScratch = new Vec3(0, 0, 0);
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #resources: WebGL2ResourceManager;
	readonly #textureSamplers: WebGL2TextureSamplerCatalog;
	/** Device-wide guard preventing draws through any stale handle after context loss. */
	readonly #assertDeviceReady: () => void;
	readonly #frameInstances: FrameInstanceStreamArena;
	/** Reuses one generated-stream selection across all material partitions in a view. */
	readonly #generatedInstanceSelector = new GeneratedInstanceSelector();
	/** Exact state mirror scoped to independently invalidated object phases. */
	readonly #objectState: WebGL2ObjectStateApplicator;
	/** Lazy portal mechanics; construction allocates no GPU target or shader resource. */
	readonly #portalSubstrate: WebGL2PortalSubstrate;
	/** Pure planner retaining only the immutable index for the active topology revision. */
	readonly #portalRenderGraphPlanner = new PortalRenderGraphPlanner();
	readonly #visibleStaticLayers = new Set<string>();
	readonly #visibleEnvCellScopes = new Set<string>();
	/** Dynamic roots selected in any view of the frame, retained as production feedback. */
	readonly #selectedDynamicNodeIds = new Set<SceneNodeId>();
	/** Read-only runtime gateway used to collect this renderer's frame submissions. */
	readonly #world: RenderWorld;
	readonly #terrainProgram: WebGL2TerrainProgram;
	readonly #objectProgram: WebGL2FogObjectProgram;
	readonly #instancedObjectProgram: WebGL2FogInstancedObjectProgram;
	/** Transparent and additive materials deliberately use a shader with no fog uniforms. */
	readonly #blendedObjectProgram: WebGL2ObjectProgram;
	readonly #blendedInstancedObjectProgram: WebGL2InstancedObjectProgram;
	/** Complete float-compatible fallback for every statically active object sampler. */
	readonly #objectFallbackBinding: PreparedObjectTextureBinding<
		WebGLTexture,
		WebGLSampler
	>;
	/** Requested quality captured at frame entry and consumed by every nested draw path. */
	#frameTextureFiltering: TextureFilteringPolicy =
		FRONTEND_TUNING.rendering.frameDefaults.textureFiltering;
	/** Requested portal footprint cutoff captured once at frame entry. */
	#minimumPortalFootprintPixelArea = 0;
	/** Requested object-presentation footprint cutoff captured once at frame entry. */
	#minimumObjectFootprintPixelArea = 0;
	/** Explicit session; null avoids clocks, extension probes, and GPU query resources. */
	#frameProfiler: WebGL2FrameProfiler | null = null;
	/** Reused per-frame diagnostics; cold reads return a copied snapshot. */
	readonly #frameSelectionMetrics: MutableFrameSelectionMetrics = {
		envCellRenderMode: "flat",
		terrainFrameInputs: 0,
		viewCount: 0,
		visibleDynamicEntityCount: 0,
		visibleDynamicPartCount: 0,
		testedObjectPresentationCount: 0,
		retainedObjectPresentationCount: 0,
		rejectedObjectPresentationCount: 0,
		visibleEnvCellShells: 0,
		visibleEnvCellScopeCount: 0,
		visibleEnvCellResidentNodes: 0,
		submittedEnvCellShellDrawCount: 0,
		submittedEnvCellShellTriangleCount: 0,
		submittedEnvCellResidentDrawCount: 0,
		submittedEnvCellResidentTriangleCount: 0,
		envCellShellCullOverrideCount: 0,
		submittedPortalApertureDrawCount: 0,
		portalMaskEdgeCount: 0,
		portalNearPlaneSeedCount: 0,
		portalRejectedFacingCrossingCount: 0,
		portalRejectedFootprintCount: 0,
		portalSameDomainBoundaryCrossingCount: 0,
		portalAdmittedScopeWindowStateCount: 0,
		portalRenderLayerCount: 0,
		portalRenderNodeCount: 0,
		portalSubmittedRenderNodeCount: 0,
		portalExteriorRenderCount: 0,
		sceneDomainTargetCount: 0,
		sceneDomainTargetBytes: 0,
		visibleSceneEntries: 0,
		visibleStaticLayerCount: 0,
		visibleStaticNodeCount: 0,
		submittedStaticObjectDrawCount: 0,
		submittedStaticObjectTriangleCount: 0,
		submittedBakedStaticObjectDrawCount: 0,
		submittedBakedStaticObjectTriangleCount: 0,
		selectedGeneratedInstanceFragmentCount: 0,
		selectedGeneratedInstanceCount: 0,
		testedGeneratedInstanceCount: 0,
		retainedGeneratedInstanceCount: 0,
		rejectedGeneratedInstanceCount: 0,
		submittedCompactedGeneratedDrawCount: 0,
		submittedCompactedGeneratedInstanceCount: 0,
		submittedInstancedSourceTriangleCount: 0,
		transparentObjectCandidateCount: 0,
		farTransparentObjectCandidateCount: 0,
		nearTransparentObjectCandidateCount: 0,
		transparentFrameRunCount: 0,
		farTransparentFrameRunCount: 0,
		nearTransparentFrameRunCount: 0,
		frameInstanceUploadCount: 0,
		frameInstanceUploadBytes: 0,
		submittedTransparentObjectDrawCount: 0,
		submittedTransparentInstanceCount: 0,
		submittedAdditiveObjectDrawCount: 0,
		submittedDynamicDrawCount: 0,
		submittedDynamicInstanceCount: 0,
		frameInstanceCapacity: 0,
		frameInstanceGrowthCount: 0,
		frameInstanceViewHighWaterMark: 0,
		objectLightingBinds: 0,
		objectProgramChanges: 0,
		objectTextureBinds: 0,
	};
	#frameWidth = 0;
	#frameHeight = 0;

	public static async build(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
		world: RenderWorld,
		textureFilteringSupport: WebGL2TextureFilteringSupport,
		assertDeviceReady: () => void,
	): Promise<WebGL2Renderer> {
		return new WebGL2Renderer(
			canvas,
			gl,
			resources,
			world,
			textureFilteringSupport,
			assertDeviceReady,
		);
	}

	protected constructor(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
		world: RenderWorld,
		textureFilteringSupport: WebGL2TextureFilteringSupport,
		assertDeviceReady: () => void,
	) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.#resources = resources;
		this.#assertDeviceReady = assertDeviceReady;
		this.#textureSamplers = new WebGL2TextureSamplerCatalog(
			gl,
			textureFilteringSupport,
		);
		this.#frameInstances = new FrameInstanceStreamArena(gl);
		this.#objectState = new WebGL2ObjectStateApplicator(gl);
		this.#portalSubstrate = new WebGL2PortalSubstrate(gl);
		this.#world = world;
		this.#terrainProgram = createWebGL2TerrainProgram(gl);
		this.#objectProgram = createWebGL2ObjectProgram(gl);
		this.#instancedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: true,
			transformSource: "instanced",
		});
		this.#blendedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: false,
		});
		this.#blendedInstancedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: false,
			transformSource: "instanced",
		});
		this.#objectFallbackBinding = {
			sampler: this.#textureSamplers.getSampler({
				mipLevels: 1,
				policy: FRONTEND_TUNING.rendering.frameDefaults.textureFiltering,
				samplingClass: "exact",
				wrap: TextureWrapMode.Clamp,
			}),
			texture: createObjectFallbackTexture(gl),
		};
		this.frameDiagnostics = {
			snapshot: () => ({
				profile: this.#frameProfiler?.getProfile() ?? null,
				profilingEnabled: this.#frameProfiler !== null,
				selectionMetrics: { ...this.#frameSelectionMetrics },
			}),
			setProfilingEnabled: (enabled) => this.#setFrameProfilingEnabled(enabled),
		};
		gl.clearColor(
			FRONTEND_TUNING.rendering.clearColor.red,
			FRONTEND_TUNING.rendering.clearColor.green,
			FRONTEND_TUNING.rendering.clearColor.blue,
			FRONTEND_TUNING.rendering.clearColor.alpha,
		);
		gl.enable(gl.DEPTH_TEST);
	}

	drawFrame(input: FrameInput): RendererFrameFeedback {
		this.#assertDeviceReady();
		const profile = this.#frameProfiler?.beginFrame() ?? null;
		try {
			this.#drawFrameContent(input, profile);
			return Object.freeze({
				selectedDynamicNodeIds: Object.freeze([
					...this.#selectedDynamicNodeIds,
				]),
			});
		} finally {
			profile?.finish();
		}
	}

	#drawFrameContent(
		input: FrameInput,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		const setupStartedAt = profile?.beginCpuPhase();
		this.#frameTextureFiltering = input.frameSettings.quality.textureFiltering;
		this.#minimumPortalFootprintPixelArea =
			input.frameSettings.quality.minimumPortalFootprintPixelArea;
		this.#minimumObjectFootprintPixelArea =
			input.frameSettings.quality.minimumObjectFootprintPixelArea;
		this.#resizeCanvasForDpr();
		this.#resetFrameSelectionMetrics(
			input.views.length,
			input.frameSettings.envCellRenderMode,
		);
		const fog = input.frameSettings.distanceFogEnabled
			? input.environment.distanceFog
			: null;
		// The headlamp tracks the live camera, so the renderer supplies it rather than the
		// resolved environment. Retail attaches it to the viewer on every viewer move.
		const headlampCamera = input.views[0]?.camera.placement.position ?? null;
		const shading: SceneShading = {
			fog,
			lighting: resolveSceneLightingByRole(
				input.environment.lighting,
				headlampCamera && input.frameSettings.viewerLightEnabled
					? {
							position: headlampCamera,
							falloff: VIEWER_LIGHT.falloff,
							intensity: VIEWER_LIGHT.intensity,
						}
					: DISABLED_VIEWER_LIGHT,
				input.views.some((view) => view.cameraInsideSealedCell),
			),
		};
		this.#beginFrame(input.environment, shading);
		if (profile && setupStartedAt !== undefined) {
			profile.finishCpuPhase("setup", setupStartedAt);
		}
		if (input.frameSettings.envCellRenderMode === "flat") {
			for (const view of input.views) {
				if (profile) {
					const preparationStartedAt = profile.beginCpuPhase();
					const geometry = this.#prepareViewGeometry(
						input.anchorLandblockId,
						view,
					);
					profile.finishCpuPhase("viewPreparation", preparationStartedAt);
					const contributions = this.#collectScene(geometry, "flat", profile);
					this.#drawProfiledView(
						{ ...geometry, ...contributions },
						shading,
						profile,
					);
				} else {
					this.#drawView(
						this.#prepareView(input.anchorLandblockId, view, "flat"),
						shading,
					);
				}
			}
		} else {
			const clear = fog?.color ?? input.environment.backgroundColor;
			const clearColor = [
				clear.red,
				clear.green,
				clear.blue,
				clear.alpha,
			] as const;
			for (const view of input.views) {
				const preparationStartedAt = profile?.beginCpuPhase();
				const prepared = this.#prepareViewGeometry(
					input.anchorLandblockId,
					view,
				);
				if (profile && preparationStartedAt !== undefined) {
					profile.finishCpuPhase("viewPreparation", preparationStartedAt);
				}
				this.#drawPortalView(prepared, view, clearColor, shading, profile);
			}
		}
		const finalizationStartedAt = profile?.beginCpuPhase();
		const portalTargets = this.#portalSubstrate.getDiagnostics();
		this.#frameSelectionMetrics.sceneDomainTargetCount =
			portalTargets.activeTargetCount;
		this.#frameSelectionMetrics.sceneDomainTargetBytes =
			portalTargets.activeBytes;
		this.#finishFrameSelectionMetrics();
		if (profile && finalizationStartedAt !== undefined) {
			profile.finishCpuPhase("finalization", finalizationStartedAt);
		}
		void input.timeSeconds;
	}

	#setFrameProfilingEnabled(enabled: boolean): void {
		this.#assertDeviceReady();
		if (enabled) {
			this.#frameProfiler ??= new WebGL2FrameProfiler(this.#gl);
			return;
		}
		this.#frameProfiler?.destroy();
		this.#frameProfiler = null;
	}

	/** Plan and execute one production portal view from its authoritative camera residency. */
	#drawPortalView(
		prepared: PreparedViewGeometry,
		viewInput: FrameViewInput,
		clearColor: readonly [number, number, number, number],
		shading: SceneShading,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		const placement = viewInput.camera.placement;
		const rootScope = scopeFor(placement.landblockId, placement.envCellId);
		const planningStartedAt = profile?.beginCpuPhase();
		const result = this.#planPortalRenderGraph(
			prepared,
			viewInput,
			rootScope,
			PORTAL_PLANNING_WORK_ITEM_LIMIT,
		);
		if (profile && planningStartedAt !== undefined) {
			profile.finishCpuPhase("portalGraphPlanning", planningStartedAt);
		}
		if (result.kind !== "planned") {
			throw new Error(
				`Portal frame planning failed ${result.reason}: required stencil ${result.requiredMaximumStencilValue}, work items ${result.workItemCount}.`,
			);
		}
		const contributionsByNode = this.#collectPortalNodeContributions(
			prepared,
			result.plan,
			profile,
		);
		const diagnostics = executePortalGraph(this.#portalSubstrate, {
			clearColor,
			destination: null,
			extent: { height: this.#frameHeight, width: this.#frameWidth },
			plan: result.plan,
			renderExterior: (_target, outdoorNodeId) => {
				const contributions = mergePortalNodeContributions(
					[outdoorNodeId],
					contributionsByNode,
					profile,
				);
				const view = { ...prepared, ...contributions };
				if (profile) this.#drawProfiledView(view, shading, profile);
				else this.#drawView(view, shading);
			},
			renderIndoorNodes: (_target, renderNodeIds) => {
				const contributions = mergePortalNodeContributions(
					renderNodeIds,
					contributionsByNode,
					profile,
				);
				const view = { ...prepared, ...contributions };
				if (profile) this.#drawProfiledView(view, shading, profile);
				else this.#drawView(view, shading);
			},
			resolveVisibilityAperture: (apertureId, crossingId) =>
				this.#resolvePortalMask(prepared, apertureId, crossingId),
		});
		this.#accumulatePortalDiagnostics(diagnostics);
		const portalTargets = this.#portalSubstrate.getDiagnostics();
		this.#frameSelectionMetrics.sceneDomainTargetCount =
			portalTargets.activeTargetCount;
		this.#frameSelectionMetrics.sceneDomainTargetBytes =
			portalTargets.activeBytes;
	}

	/** Aggregate one independent view's consumed graph facts into the frame snapshot. */
	#accumulatePortalDiagnostics(diagnostics: PortalFrameDiagnostics): void {
		const metrics = this.#frameSelectionMetrics;
		metrics.submittedPortalApertureDrawCount += diagnostics.maskDrawCount;
		metrics.portalMaskEdgeCount += diagnostics.maskEdgeCount;
		metrics.portalNearPlaneSeedCount += diagnostics.nearPlaneSeedCount;
		metrics.portalRejectedFacingCrossingCount +=
			diagnostics.rejectedFacingCrossingCount;
		metrics.portalRejectedFootprintCount +=
			diagnostics.rejectedPortalFootprintCount;
		metrics.portalSameDomainBoundaryCrossingCount +=
			diagnostics.sameDomainBoundaryCrossingCount;
		metrics.portalAdmittedScopeWindowStateCount +=
			diagnostics.admittedScopeWindowStateCount;
		metrics.portalRenderLayerCount += diagnostics.renderLayerCount;
		metrics.portalRenderNodeCount += diagnostics.renderNodeCount;
		metrics.portalSubmittedRenderNodeCount +=
			diagnostics.submittedRenderNodeCount;
		metrics.portalExteriorRenderCount += diagnostics.exteriorRenderCount;
	}

	/**
	 * Exercise final portal planning without allocating targets or activating portal drawing.
	 *
	 * The returned culling count consumes the same explicit-scope SceneGraph query that Phase 12
	 * will use, preventing the diagnostic seam from inventing a parallel selection policy.
	 */
	probePortalRenderGraph(
		anchorLandblockId: FrameInput["anchorLandblockId"],
		viewInput: FrameViewInput,
		rootScope: SceneScope,
		safetyWorkItemLimit: number,
	): PortalRenderGraphProbeResult {
		this.#assertDeviceReady();
		this.#resizeCanvasForDpr();
		const prepared = this.#prepareViewGeometry(anchorLandblockId, viewInput);
		const planningStartedAt = performance.now();
		const result = this.#planPortalRenderGraph(
			prepared,
			viewInput,
			rootScope,
			safetyWorkItemLimit,
		);
		const planningDurationMs = performance.now() - planningStartedAt;
		const selectedSceneEntryCount =
			result.kind === "planned"
				? this.#world.queryScopesScene(
						prepared.frustum,
						anchorLandblockId,
						result.plan.selectedScopes,
					).entries.length
				: null;
		return { planningDurationMs, result, selectedSceneEntryCount };
	}

	/**
	 * Execute one complete graph through production contribution and GPU paths.
	 *
	 * This explicit harness seam returns one-shot planning and execution facts without changing the
	 * continuous frame mode.
	 */
	probePortalExecution(
		anchorLandblockId: FrameInput["anchorLandblockId"],
		viewInput: FrameViewInput,
		rootScope: SceneScope,
		safetyWorkItemLimit: number,
	): PortalExecutionProbeResult {
		this.#assertDeviceReady();
		this.#resizeCanvasForDpr();
		const prepared = this.#prepareViewGeometry(anchorLandblockId, viewInput);
		const planningStartedAt = performance.now();
		const result = this.#planPortalRenderGraph(
			prepared,
			viewInput,
			rootScope,
			safetyWorkItemLimit,
		);
		const planningDurationMs = performance.now() - planningStartedAt;
		if (result.kind !== "planned") {
			return {
				diagnostics: null,
				planningDurationMs,
				result,
				selectionMetrics: null,
			};
		}
		this.#resetFrameSelectionMetrics(1, "portal");
		const contributionsByNode = this.#collectPortalNodeContributions(
			prepared,
			result.plan,
			null,
		);
		const diagnostics = executePortalGraph(this.#portalSubstrate, {
			clearColor: [
				FRONTEND_TUNING.rendering.clearColor.red,
				FRONTEND_TUNING.rendering.clearColor.green,
				FRONTEND_TUNING.rendering.clearColor.blue,
				FRONTEND_TUNING.rendering.clearColor.alpha,
			],
			destination: null,
			extent: { height: this.#frameHeight, width: this.#frameWidth },
			plan: result.plan,
			renderExterior: (_target, outdoorNodeId) => {
				const contributions = mergePortalNodeContributions(
					[outdoorNodeId],
					contributionsByNode,
					null,
				);
				this.#drawView({ ...prepared, ...contributions }, PROBE_SHADING);
			},
			renderIndoorNodes: (_target, renderNodeIds) => {
				const contributions = mergePortalNodeContributions(
					renderNodeIds,
					contributionsByNode,
					null,
				);
				this.#drawView({ ...prepared, ...contributions }, PROBE_SHADING);
			},
			resolveVisibilityAperture: (apertureId, crossingId) =>
				this.#resolvePortalMask(prepared, apertureId, crossingId),
		});
		this.#accumulatePortalDiagnostics(diagnostics);
		const portalTargets = this.#portalSubstrate.getDiagnostics();
		this.#frameSelectionMetrics.sceneDomainTargetCount =
			portalTargets.activeTargetCount;
		this.#frameSelectionMetrics.sceneDomainTargetBytes =
			portalTargets.activeBytes;
		this.#finishFrameSelectionMetrics();
		return {
			diagnostics,
			planningDurationMs,
			result,
			selectionMetrics: { ...this.#frameSelectionMetrics },
		};
	}

	async destroy(): Promise<void> {
		this.#frameProfiler?.destroy();
		this.#frameProfiler = null;
		this.#textureSamplers.destroy();
		this.#portalSubstrate.destroy();
		this.#gl.deleteProgram(this.#terrainProgram.program);
		this.#gl.deleteProgram(this.#objectProgram.program);
		this.#gl.deleteProgram(this.#instancedObjectProgram.program);
		this.#gl.deleteProgram(this.#blendedObjectProgram.program);
		this.#gl.deleteProgram(this.#blendedInstancedObjectProgram.program);
		this.#gl.deleteTexture(this.#objectFallbackBinding.texture);
		this.#frameInstances.destroy();
	}

	#beginFrame(
		environment: FrameInput["environment"],
		shading: SceneShading,
	): void {
		const gl = this.#gl;
		const clearColor = shading.fog?.color ?? environment.backgroundColor;
		gl.clearColor(
			clearColor.red,
			clearColor.green,
			clearColor.blue,
			clearColor.alpha,
		);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
	}

	#prepareView(
		anchorLandblockId: FrameInput["anchorLandblockId"],
		input: FrameViewInput,
		envCellRenderMode: FrameInput["frameSettings"]["envCellRenderMode"],
	): PreparedView {
		const prepared = this.#prepareViewGeometry(anchorLandblockId, input);
		const collected = this.#collectScene(prepared, envCellRenderMode, null);
		return {
			...prepared,
			objects: collected.objects,
			terrain: collected.terrain,
		};
	}

	#prepareViewGeometry(
		anchorLandblockId: FrameInput["anchorLandblockId"],
		input: FrameViewInput,
	): PreparedViewGeometry {
		const camera = input.camera;
		const anchorCoordinates = getLandblockCoordinates(anchorLandblockId);
		const anchorOriginX = anchorCoordinates.x * OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const anchorOriginZ = -anchorCoordinates.y * OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const cameraPosition = new Vec3(
			camera.placement.position.x - anchorOriginX,
			camera.placement.position.y,
			camera.placement.position.z - anchorOriginZ,
		);
		const aspectRatio = this.#frameWidth / Math.max(1, this.#frameHeight);
		const projection = createPerspectiveMat4(
			camera.fov,
			aspectRatio,
			camera.near,
			camera.far,
		);
		const view = createViewMat4(cameraPosition, camera.placement.rotation);
		const clipFromAnchor = multiplyMat4(projection, view);
		return {
			anchorCoordinates,
			anchorLandblockId,
			cameraPosition,
			clipFromAnchor,
			frustum: createFrustumFromClipMatrix(clipFromAnchor, cameraPosition),
			projection,
			view,
		};
	}

	#planPortalRenderGraph(
		prepared: PreparedViewGeometry,
		viewInput: FrameViewInput,
		rootScope: SceneScope,
		safetyWorkItemLimit: number,
	): PortalRenderGraphPlanResult {
		const aspectRatio = this.#frameWidth / Math.max(1, this.#frameHeight);
		const nearClipVolume = createCameraNearClipVolume(
			{
				...viewInput.camera,
				placement: {
					...viewInput.camera.placement,
					landblockId: prepared.anchorLandblockId,
					position: prepared.cameraPosition,
				},
			},
			aspectRatio,
		);
		return this.#portalRenderGraphPlanner.plan(
			this.#world.getPortalTopologyView(),
			{
				...prepared,
				maximumStencilValue: MAXIMUM_PORTAL_RENDER_LAYER,
				nearClipVolume,
				portalFootprint: {
					drawingBuffer: {
						height: this.#frameHeight,
						width: this.#frameWidth,
					},
					minimumPixelArea: this.#minimumPortalFootprintPixelArea,
				},
				rootScope,
				safetyWorkItemLimit,
			},
		);
	}

	/** Resolve each unique graph node through the shared explicit-scope scene query exactly once. */
	#collectPortalNodeContributions(
		prepared: PreparedViewGeometry,
		plan: PortalRenderWorkPlan,
		profile: WebGL2FrameProfileCapture | null,
	): ReadonlyMap<string, PreparedSceneContributions> {
		const contributionsByNode = new Map<string, PreparedSceneContributions>();
		const claimedSceneNodes = new Set<SceneNodeId>();
		for (const node of plan.nodes) {
			const queryStartedAt = profile?.beginCpuPhase();
			const visible = this.#world.queryScopesScene(
				prepared.frustum,
				prepared.anchorLandblockId,
				node.scopes,
			);
			if (profile && queryStartedAt !== undefined) {
				profile.finishCpuPhase("sceneQuery", queryStartedAt);
			}
			for (const sceneNodeId of visible.entries) {
				if (!claimedSceneNodes.add(sceneNodeId)) {
					throw new Error(
						`Portal scene node ${sceneNodeId} belongs to more than one render node.`,
					);
				}
			}
			contributionsByNode.set(
				node.id,
				this.#resolveSceneContributions(
					prepared,
					visible.entries,
					"portal",
					profile,
				),
			);
			profile?.recordPortalNodePreparation();
		}
		if (contributionsByNode.size !== plan.nodes.length) {
			throw new Error("Portal contribution collection lost a render node.");
		}
		return contributionsByNode;
	}

	/** Resolve one effective aperture in its owning landblock frame into this view's clip frame. */
	#resolvePortalMask(
		prepared: PreparedViewGeometry,
		apertureId: Extract<
			PortalRenderWorkPlan["maskEdges"][number]["maskSource"],
			{ readonly kind: "world-aperture" }
		>["visibilityApertureId"],
		crossingId: PortalRenderWorkPlan["maskEdges"][number]["crossingId"],
	): ResolvedPortalMask {
		const drawUnit = this.#world.getPortalDrawUnit(apertureId);
		if (!drawUnit) {
			throw new Error(
				`Portal crossing ${crossingId} cannot resolve visibility aperture ${apertureId}.`,
			);
		}
		const resolved = this.#world.resolvePortalDrawUnit(drawUnit);
		const landblockOffset = createLandblockOffset(
			getLandblockCoordinates(drawUnit.landblockId),
			prepared.anchorCoordinates,
		);
		const anchorFromLandblock = createTranslationMat4(landblockOffset);
		const clipFromLocal = multiplyMat4(
			prepared.clipFromAnchor,
			anchorFromLandblock,
		);
		return {
			clipFromLocal: mat4ToFloat32Array(clipFromLocal),
			geometry: this.#resources.getGeometry(resolved.geometry),
			indexCount: resolved.drawUnit.indexCount,
			indexStart: resolved.drawUnit.indexStart,
		};
	}

	#collectScene(
		prepared: PreparedViewGeometry,
		envCellRenderMode: FrameInput["frameSettings"]["envCellRenderMode"],
		profile: WebGL2FrameProfileCapture | null,
	): PreparedSceneContributions {
		const queryStartedAt = profile?.beginCpuPhase();
		const visible = this.#world.queryFlatScene(
			prepared.frustum,
			prepared.anchorLandblockId,
		);
		if (profile && queryStartedAt !== undefined) {
			profile.finishCpuPhase("sceneQuery", queryStartedAt);
		}
		const contributions = this.#resolveSceneContributions(
			prepared,
			visible.entries,
			envCellRenderMode,
			profile,
		);
		return contributions;
	}

	/**
	 * Resolve already-selected scene identities without importing flat or portal topology policy.
	 *
	 * Callers must consume a SceneGraph query's reused entry buffer before issuing another query.
	 */
	#resolveSceneContributions(
		prepared: PreparedViewGeometry,
		visibleEntries: readonly SceneNodeId[],
		envCellRenderMode: FrameInput["frameSettings"]["envCellRenderMode"],
		profile: WebGL2FrameProfileCapture | null,
	): PreparedSceneContributions {
		const resolutionStartedAt = profile?.beginCpuPhase();
		const terrain: TerrainFrameInput[] = [];
		const objects: ObjectFrameInput[] = [];
		this.#frameSelectionMetrics.visibleSceneEntries += visibleEntries.length;
		for (const nodeId of visibleEntries) {
			const contribution = this.#world.getRenderContributionDescriptor(
				nodeId,
				prepared.anchorLandblockId,
			);
			if (!contribution) continue;
			if (contribution.kind === "static-object") {
				if (!this.#retainsObjectFootprint(contribution.footprint, prepared)) {
					continue;
				}
				this.#frameSelectionMetrics.visibleStaticNodeCount += 1;
				const source =
					contribution.cullingGroup === "env-cell-static-residents"
						? "env-cell-resident"
						: contribution.cullingGroup === LandblockLayerKind.Generated
							? "generated"
							: "outdoor";
				if (source === "env-cell-resident") {
					this.#frameSelectionMetrics.visibleEnvCellResidentNodes += 1;
				}
				const node = this.#world.resolveStaticObjectNode(
					nodeId,
					contribution.renderable,
					contribution.footprint,
				);
				this.#visibleStaticLayers.add(
					`${node.placement.scope.kind === "outdoor" ? "outdoor" : `${node.placement.scope.landblockId}/${node.placement.scope.envCellId}`}/${contribution.cullingGroup}`,
				);
				if (node.placement.scope.kind === "env-cell") {
					this.#visibleEnvCellScopes.add(
						`${node.placement.scope.landblockId}/${node.placement.scope.envCellId}`,
					);
				}
				for (const resolved of node.drawUnits) {
					const { drawUnit } = resolved;
					if (resolved.instances !== null && source !== "generated") {
						throw new Error(
							`${contribution.cullingGroup} static objects unexpectedly resolved instance fragments.`,
						);
					}
					if (
						drawUnit.kind === "instanced" &&
						drawUnit.ordering === "transparent"
					) {
						throw new Error(
							"Transparent static instance draw requires a frame-streamed template.",
						);
					}
					const instances = resolveStaticFragmentInstanceInput(
						drawUnit,
						resolved.instances,
					);
					objects.push({
						cullFaceOverride: null,
						drawKind: drawUnit.kind,
						geometry: resolved.geometry,
						indexCount: drawUnit.indexCount,
						indexStart: drawUnit.indexStart,
						instances,
						landblockId: node.placement.landblockId,
						localToLandblock: node.placement.localToLandblock,
						material: drawUnit.material,
						ordering: drawUnit.ordering,
						renderDomainKey: `${node.placement.landblockId}/${scopeKey(node.placement.scope)}`,
						source,
						transparentSort: drawUnit.transparentSort,
					});
				}
				for (const resolved of node.frameStreamedInstances) {
					const { template } = resolved;
					objects.push({
						cullFaceOverride: null,
						drawKind: "instanced",
						geometry: resolved.geometry,
						indexCount: template.indexCount,
						indexStart: template.indexStart,
						instances: {
							cohortKey: template.cohortKey,
							instance: template.instance,
							kind: "frame-template",
						},
						landblockId: node.placement.landblockId,
						localToLandblock: node.placement.localToLandblock,
						material: template.material,
						ordering: "transparent",
						renderDomainKey: `${node.placement.landblockId}/${scopeKey(node.placement.scope)}`,
						source,
						transparentSort: template.transparentSort,
					});
				}
				continue;
			}
			if (contribution.kind === "dynamic") {
				if (!this.#retainsObjectFootprint(contribution.footprint, prepared)) {
					continue;
				}
				const dynamicContributions =
					this.#world.expandDynamicContributions(nodeId);
				this.#selectedDynamicNodeIds.add(nodeId);
				this.#frameSelectionMetrics.visibleDynamicEntityCount += 1;
				this.#frameSelectionMetrics.visibleDynamicPartCount +=
					dynamicContributions.length;
				for (const resolved of this.#world.resolveDynamicContributions(
					dynamicContributions,
				)) {
					const { domain, drawUnit, instance, transparentSort } =
						resolved.drawUnit;
					objects.push({
						cullFaceOverride: null,
						drawKind: "instanced",
						geometry: resolved.geometry,
						indexCount: drawUnit.indexCount,
						indexStart: drawUnit.indexStart,
						instances: {
							cohortKey: `${domain.key}/${drawUnit.batchKey}`,
							instance,
							kind: "frame-template",
						},
						landblockId: domain.landblockId,
						localToLandblock: instance.sourceToLandblock,
						material: drawUnit.material,
						ordering: drawUnit.ordering,
						renderDomainKey: domain.key,
						source: "dynamic",
						transparentSort,
					});
				}
				continue;
			}
			if (contribution.kind === "env-cell") {
				this.#frameSelectionMetrics.visibleEnvCellShells += 1;
				const node = this.#world.resolveEnvCellNode(
					nodeId,
					contribution.renderable,
				);
				if (node.placement.scope.kind !== "env-cell") {
					throw new Error(`EnvCell shell ${nodeId} has outdoor residency.`);
				}
				this.#visibleEnvCellScopes.add(
					`${node.placement.scope.landblockId}/${node.placement.scope.envCellId}`,
				);
				this.#visibleStaticLayers.add(
					`${node.placement.scope.landblockId}/${node.placement.scope.envCellId}/env-cell-shell`,
				);
				for (const resolved of node.drawUnits) {
					objects.push({
						cullFaceOverride: envCellRenderMode === "flat" ? "back" : null,
						drawKind: "baked",
						geometry: resolved.geometry,
						indexCount: resolved.drawUnit.indexCount,
						indexStart: resolved.drawUnit.indexStart,
						instances: null,
						landblockId: node.placement.landblockId,
						localToLandblock: node.placement.localToLandblock,
						material: resolved.drawUnit.material,
						ordering: resolved.drawUnit.ordering,
						renderDomainKey: `${node.placement.landblockId}/${scopeKey(node.placement.scope)}`,
						source: "env-cell-shell",
						transparentSort: resolved.drawUnit.transparentSort,
					});
				}
				continue;
			}
			const { drawUnit } = contribution;
			terrain.push({
				drawUnit,
				program: {
					geometry: this.#world.resolveGeometry(drawUnit.geometry),
					composition: this.#world.resolveTexture2D(drawUnit.composition),
					surfaceField: this.#world.resolveTexture2D(drawUnit.surfaceField),
					textures: {
						blendMasks: this.#world.resolveTextureArray(
							drawUnit.textures.blendMasks,
						),
						colors: this.#world.resolveTextureArray(drawUnit.textures.colors),
						detail: this.#world.resolveTexture2D(drawUnit.textures.detail),
						roadMasks: this.#world.resolveTextureArray(
							drawUnit.textures.roadMasks,
						),
					},
				},
			});
			this.#frameSelectionMetrics.terrainFrameInputs += 1;
		}
		if (profile && resolutionStartedAt !== undefined) {
			profile.finishCpuPhase(
				"sceneContributionResolution",
				resolutionStartedAt,
			);
		}
		const preparationStartedAt = profile?.beginCpuPhase();
		const preparedObjects = objects.map((object) =>
			this.#prepareObjectFrameInput(object, prepared.anchorLandblockId),
		);
		if (profile && preparationStartedAt !== undefined) {
			profile.finishCpuPhase("objectPreparation", preparationStartedAt);
			const dynamicObjectCount = objects.filter(
				(object) => object.source === "dynamic",
			).length;
			profile.recordObjectPreparation(
				objects.length - dynamicObjectCount,
				dynamicObjectCount,
			);
		}
		return { objects: preparedObjects, terrain };
	}

	#retainsObjectFootprint(
		footprint: ObjectPresentationFootprint,
		prepared: PreparedViewGeometry,
	): boolean {
		if (footprint.kind === "ineligible")
			return retainsProjectedObjectFootprint(
				null,
				this.#minimumObjectFootprintPixelArea,
			);
		const landblockOffset = createLandblockOffset(
			getLandblockCoordinates(footprint.placement.landblockId),
			prepared.anchorCoordinates,
		);
		const retained = retainsProjectedObjectFootprint(
			{
				bounds: footprint.localBounds,
				clipFromAnchor: prepared.clipFromAnchor,
				landblockOffsetX: landblockOffset.x,
				landblockOffsetY: landblockOffset.y,
				landblockOffsetZ: landblockOffset.z,
				localToLandblock: footprint.placement.localToLandblock,
				viewportHeight: this.#frameHeight,
				viewportWidth: this.#frameWidth,
			},
			this.#minimumObjectFootprintPixelArea,
		);
		if (this.#minimumObjectFootprintPixelArea > 0) {
			this.#frameSelectionMetrics.testedObjectPresentationCount += 1;
			if (retained)
				this.#frameSelectionMetrics.retainedObjectPresentationCount += 1;
			else this.#frameSelectionMetrics.rejectedObjectPresentationCount += 1;
		}
		return retained;
	}

	/** Compile every draw-consumed constant once before ordering, grouping, or submission. */
	#prepareObjectFrameInput(
		object: ObjectFrameInput,
		anchorLandblockId: FrameInput["anchorLandblockId"],
	): PreparedObjectFrameInput {
		const geometry = this.#resources.getGeometry(object.geometry);
		validateDrawRange(geometry, object.indexStart, object.indexCount);
		const landblockOffset = createLandblockOffset(
			getLandblockCoordinates(object.landblockId),
			getLandblockCoordinates(anchorLandblockId),
		);
		const { material } = object;
		const opacity = sourceOpacity(material.source.translucency);
		const diffuse = Math.max(0, material.source.diffuseScale);
		let preparedMaterial: PreparedObjectMaterial<WebGLTexture, WebGLSampler>;
		if (material.source.kind === "solid-color") {
			const [red, green, blue, alpha] = material.source.color;
			preparedMaterial = {
				color: [
					red * diffuse,
					green * diffuse,
					blue * diffuse,
					alpha * opacity,
				],
				kind: "solid-color",
			};
		} else {
			const base = material.textures.base;
			if (!base) {
				throw new Error(
					`Textured material ${material.source.id} has no base texture.`,
				);
			}
			const baseBinding = this.#prepareObjectAtlasBinding(
				base,
				material.source.textureEncoding === "direct-color"
					? "filterable"
					: "exact",
			);
			const color = [diffuse, diffuse, diffuse, opacity] as const;
			if (material.source.textureEncoding === "direct-color") {
				preparedMaterial = { base: baseBinding, color, kind: "direct-color" };
			} else {
				const palette = material.textures.palette;
				if (!palette) {
					throw new Error(
						`Indexed material ${material.source.id} has no palette texture.`,
					);
				}
				preparedMaterial = {
					base: baseBinding,
					color,
					kind: material.source.textureEncoding,
					palette: this.#prepareObjectAtlasBinding(palette, "exact"),
				};
			}
		}
		const detail = resolveStaticMaterialDetail(material, (role) =>
			this.#world.resolveActiveRegionStaticDetail(role),
		);
		return {
			...object,
			blendPolicy: objectBlendPolicy(material.source.rawSurfaceFlags),
			compatibility: {
				alphaTest:
					object.ordering === "alpha-test" && material.source.kind === "texture"
						? 200 / 255
						: 0,
				cullFace: object.cullFaceOverride ?? material.polygon.cullFace,
				detail:
					detail === null
						? null
						: {
								...this.#prepareObjectTextureBinding(
									this.#world.resolveTexture2D(detail.key),
									"filterable",
								),
								rect: [0, 0, 1, 1],
								tiling: detail.tiling,
							},
				geometry,
				indexCount: object.indexCount,
				indexStart: object.indexStart,
				landblockOffset: [
					landblockOffset.x,
					landblockOffset.y,
					landblockOffset.z,
				],
				luminosity: material.source.luminosity,
				material: preparedMaterial,
				palettedClipMap: material.palettedClipMap,
				wrapRepeat: material.sampler.wrap === TextureWrapMode.Repeat,
			},
		};
	}

	#prepareObjectAtlasBinding(
		key: NonNullable<ObjectMaterialBinding["textures"]["base"]>,
		samplingClass: TextureSamplingClass,
	): PreparedObjectAtlasBinding<WebGLTexture, WebGLSampler> {
		const atlas = this.#world.resolveAtlasTexture(key);
		const bounds = atlas.placement.bounds;
		return {
			...this.#prepareObjectTextureBinding(atlas.resource, samplingClass),
			rect: [
				bounds.min.x,
				bounds.min.y,
				bounds.max.x - bounds.min.x,
				bounds.max.y - bounds.min.y,
			],
		};
	}

	#prepareObjectTextureBinding(
		resource: Texture2DResourceKey,
		samplingClass: TextureSamplingClass,
	): PreparedObjectTextureBinding<WebGLTexture, WebGLSampler> {
		const binding = this.#resources.getTexture2D(resource);
		return {
			sampler: this.#textureSamplers.getSampler({
				mipLevels: binding.mipLevels,
				policy: this.#frameTextureFiltering,
				samplingClass,
				wrap: TextureWrapMode.Clamp,
			}),
			texture: binding.texture,
		};
	}

	#resetFrameSelectionMetrics(
		viewCount: number,
		envCellRenderMode: FrameInput["frameSettings"]["envCellRenderMode"],
	): void {
		const metrics = this.#frameSelectionMetrics;
		metrics.envCellRenderMode = envCellRenderMode;
		metrics.terrainFrameInputs = 0;
		metrics.viewCount = viewCount;
		metrics.visibleDynamicEntityCount = 0;
		metrics.visibleDynamicPartCount = 0;
		metrics.testedObjectPresentationCount = 0;
		metrics.retainedObjectPresentationCount = 0;
		metrics.rejectedObjectPresentationCount = 0;
		metrics.visibleEnvCellShells = 0;
		metrics.visibleEnvCellScopeCount = 0;
		metrics.visibleEnvCellResidentNodes = 0;
		metrics.submittedEnvCellShellDrawCount = 0;
		metrics.submittedEnvCellShellTriangleCount = 0;
		metrics.submittedEnvCellResidentDrawCount = 0;
		metrics.submittedEnvCellResidentTriangleCount = 0;
		metrics.envCellShellCullOverrideCount = 0;
		metrics.submittedPortalApertureDrawCount = 0;
		metrics.portalMaskEdgeCount = 0;
		metrics.portalNearPlaneSeedCount = 0;
		metrics.portalRejectedFacingCrossingCount = 0;
		metrics.portalRejectedFootprintCount = 0;
		metrics.portalSameDomainBoundaryCrossingCount = 0;
		metrics.portalAdmittedScopeWindowStateCount = 0;
		metrics.portalRenderLayerCount = 0;
		metrics.portalRenderNodeCount = 0;
		metrics.portalSubmittedRenderNodeCount = 0;
		metrics.portalExteriorRenderCount = 0;
		metrics.sceneDomainTargetCount = 0;
		metrics.sceneDomainTargetBytes = 0;
		metrics.visibleSceneEntries = 0;
		this.#visibleStaticLayers.clear();
		this.#visibleEnvCellScopes.clear();
		this.#selectedDynamicNodeIds.clear();
		metrics.visibleStaticLayerCount = 0;
		metrics.visibleStaticNodeCount = 0;
		metrics.submittedStaticObjectDrawCount = 0;
		metrics.submittedStaticObjectTriangleCount = 0;
		metrics.submittedBakedStaticObjectDrawCount = 0;
		metrics.submittedBakedStaticObjectTriangleCount = 0;
		metrics.selectedGeneratedInstanceFragmentCount = 0;
		metrics.selectedGeneratedInstanceCount = 0;
		metrics.testedGeneratedInstanceCount = 0;
		metrics.retainedGeneratedInstanceCount = 0;
		metrics.rejectedGeneratedInstanceCount = 0;
		metrics.submittedCompactedGeneratedDrawCount = 0;
		metrics.submittedCompactedGeneratedInstanceCount = 0;
		metrics.submittedInstancedSourceTriangleCount = 0;
		metrics.transparentObjectCandidateCount = 0;
		metrics.farTransparentObjectCandidateCount = 0;
		metrics.nearTransparentObjectCandidateCount = 0;
		metrics.transparentFrameRunCount = 0;
		metrics.farTransparentFrameRunCount = 0;
		metrics.nearTransparentFrameRunCount = 0;
		metrics.frameInstanceUploadCount = 0;
		metrics.frameInstanceUploadBytes = 0;
		metrics.submittedTransparentObjectDrawCount = 0;
		metrics.submittedTransparentInstanceCount = 0;
		metrics.submittedAdditiveObjectDrawCount = 0;
		metrics.submittedDynamicDrawCount = 0;
		metrics.submittedDynamicInstanceCount = 0;
		metrics.frameInstanceCapacity = 0;
		metrics.frameInstanceGrowthCount = 0;
		metrics.frameInstanceViewHighWaterMark = 0;
		metrics.objectLightingBinds = 0;
		metrics.objectProgramChanges = 0;
		metrics.objectTextureBinds = 0;
	}

	/** Finish counters shared by ordinary frames and explicit portal execution probes. */
	#finishFrameSelectionMetrics(): void {
		const arena = this.#frameInstances.getDiagnostics();
		this.#frameSelectionMetrics.visibleStaticLayerCount =
			this.#visibleStaticLayers.size;
		this.#frameSelectionMetrics.visibleEnvCellScopeCount =
			this.#visibleEnvCellScopes.size;
		this.#frameSelectionMetrics.frameInstanceCapacity = arena.capacity;
		this.#frameSelectionMetrics.frameInstanceGrowthCount = arena.growthCount;
		this.#frameSelectionMetrics.frameInstanceViewHighWaterMark =
			arena.viewHighWaterMark;
	}

	#drawView(view: PreparedView, shading: SceneShading): void {
		this.#drawTerrain(view, shading);
		this.#drawOpaqueObjects(view, shading, null);
		this.#drawBlendedObjects(view, shading, null);
		this.#gl.bindVertexArray(null);
		this.#beginObjectPhase();
	}

	/** Draw one view through opt-in CPU spans and non-blocking GPU timestamp intervals. */
	#drawProfiledView(
		view: PreparedView,
		shading: SceneShading,
		profile: WebGL2FrameProfileCapture,
	): void {
		const terrainGpu = profile.beginGpuPhase("terrain");
		const terrainStartedAt = profile.beginCpuPhase();
		try {
			this.#drawTerrain(view, shading);
		} finally {
			profile.finishCpuPhase("terrainSubmission", terrainStartedAt);
			terrainGpu?.finish();
		}

		const opaqueGpu = profile.beginGpuPhase("opaque");
		try {
			this.#drawOpaqueObjects(view, shading, profile);
		} finally {
			opaqueGpu?.finish();
		}

		const blendedGpu = profile.beginGpuPhase("blended");
		try {
			this.#drawBlendedObjects(view, shading, profile);
		} finally {
			blendedGpu?.finish();
		}

		this.#gl.bindVertexArray(null);
		this.#beginObjectPhase();
	}

	#drawTerrain(view: PreparedView, shading: SceneShading): void {
		if (view.terrain.length === 0) return;
		const gl = this.#gl;
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.enable(gl.POLYGON_OFFSET_FILL);
		gl.polygonOffset(TERRAIN_DEPTH_OFFSET.factor, TERRAIN_DEPTH_OFFSET.units);
		gl.useProgram(this.#terrainProgram.program);
		gl.uniformMatrix4fv(
			this.#terrainProgram.uniforms.projection,
			false,
			mat4ToFloat32Array(view.projection, this.#matrixScratch),
		);
		gl.uniform2f(
			this.#terrainProgram.uniforms.cameraHorizontalPosition,
			view.cameraPosition.x,
			view.cameraPosition.z,
		);
		gl.uniformMatrix4fv(
			this.#terrainProgram.uniforms.view,
			false,
			mat4ToFloat32Array(view.view, this.#matrixScratch),
		);
		gl.uniform1f(
			this.#terrainProgram.uniforms.detailFadeNear,
			FRONTEND_TUNING.rendering.terrainDetailFade.near,
		);
		gl.uniform1f(
			this.#terrainProgram.uniforms.detailFadeFar,
			FRONTEND_TUNING.rendering.terrainDetailFade.far,
		);
		bindWebGL2DistanceFog(gl, this.#terrainProgram.uniforms, shading.fog);
		bindWebGL2SceneLighting(
			gl,
			this.#terrainProgram.uniforms,
			shading.lighting.terrain,
		);
		for (const terrain of view.terrain) {
			const landblockOffset = createLandblockOffset(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
				this.#offsetScratch,
			);
			this.#bindTerrainResources(terrain);
			this.#drawTerrainGeometry(
				terrain.program.geometry,
				terrain.drawUnit.indexStart,
				terrain.drawUnit.indexCount,
				WebGL2Renderer.#identityMatrix,
				landblockOffset,
			);
		}
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.POLYGON_OFFSET_FILL);
	}

	#bindTerrainResources(input: TerrainFrameInput): void {
		const { textures } = input.program;
		const surfaceField = this.#resources.getTexture2D(
			input.program.surfaceField,
		);
		const composition = this.#resources.getTexture2D(input.program.composition);
		const colors = this.#resources.getTextureArray(textures.colors.resource);
		const blendMasks = this.#resources.getTextureArray(
			textures.blendMasks.resource,
		);
		const roadMasks = this.#resources.getTextureArray(
			textures.roadMasks.resource,
		);
		const detail = this.#resources.getTexture2D(textures.detail);
		const gl = this.#gl;
		this.#bindTexture2D(
			0,
			surfaceField,
			this.#terrainProgram.uniforms.surfaceField,
			"exact",
			TextureWrapMode.Clamp,
		);
		this.#bindTexture2D(
			1,
			composition,
			this.#terrainProgram.uniforms.composition,
			"exact",
			TextureWrapMode.Clamp,
		);
		this.#bindTextureArray(
			2,
			colors,
			this.#terrainProgram.uniforms.colors,
			"filterable",
			TextureWrapMode.Repeat,
		);
		this.#bindTextureArray(
			3,
			blendMasks,
			this.#terrainProgram.uniforms.blendMasks,
			"filterable",
			TextureWrapMode.Repeat,
		);
		this.#bindTextureArray(
			4,
			roadMasks,
			this.#terrainProgram.uniforms.roadMasks,
			"filterable",
			TextureWrapMode.Repeat,
		);
		this.#bindTexture2D(
			5,
			detail,
			this.#terrainProgram.uniforms.detail,
			"filterable",
			TextureWrapMode.Repeat,
		);
		gl.activeTexture(gl.TEXTURE0);
	}

	#bindTexture2D(
		unit: number,
		resource: WebGL2Texture2DBinding,
		uniform: WebGLUniformLocation,
		samplingClass: TextureSamplingClass,
		wrap: TextureWrapMode,
	): void {
		const gl = this.#gl;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, resource.texture);
		this.#textureSamplers.bind(unit, {
			mipLevels: resource.mipLevels,
			policy: this.#frameTextureFiltering,
			samplingClass,
			wrap,
		});
		gl.uniform1i(uniform, unit);
	}

	#bindTextureArray(
		unit: number,
		resource: WebGL2TextureArrayBinding,
		uniform: WebGLUniformLocation,
		samplingClass: TextureSamplingClass,
		wrap: TextureWrapMode,
	): void {
		const gl = this.#gl;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, resource.texture);
		this.#textureSamplers.bind(unit, {
			mipLevels: resource.description.mipLevels,
			policy: this.#frameTextureFiltering,
			samplingClass,
			wrap,
		});
		gl.uniform1i(uniform, unit);
	}

	#drawTerrainGeometry(
		geometryKey: GeometryResourceKey,
		indexStart: number,
		indexCount: number,
		localToLandblock: Mat4,
		landblockOffset: Vec3,
	): void {
		const binding = this.#resources.getGeometry(geometryKey);
		validateDrawRange(binding, indexStart, indexCount);
		const gl = this.#gl;
		gl.uniformMatrix4fv(
			this.#terrainProgram.uniforms.localToLandblock,
			false,
			mat4ToFloat32Array(localToLandblock),
		);
		gl.uniform3f(
			this.#terrainProgram.uniforms.landblockOffset,
			landblockOffset.x,
			landblockOffset.y,
			landblockOffset.z,
		);
		gl.bindVertexArray(binding.vertexArray);
		gl.drawElements(
			gl.TRIANGLES,
			indexCount,
			binding.indexType,
			indexStart * binding.indexElementBytes,
		);
	}

	#drawOpaqueObjects(
		view: PreparedView,
		shading: SceneShading,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		const candidates = view.objects.filter(
			({ ordering }) => ordering === "opaque" || ordering === "alpha-test",
		);
		if (candidates.length === 0) return;
		const objects = this.#prepareFrameInstanceRuns(
			[candidates],
			profile,
			["grouped"],
			view,
		).objects;
		const submissionStartedAt = profile?.beginCpuPhase();
		const gl = this.#gl;
		try {
			this.#beginObjectPhase();
			gl.depthMask(true);
			this.#objectState.applyBlend(null);
			for (const object of objects) {
				const program =
					object.drawKind === "instanced"
						? this.#instancedObjectProgram
						: this.#objectProgram;
				if (this.#objectState.applyProgram(program.program)) {
					this.#activateObjectProgram(program, view, shading);
				}
				this.#applyObjectLighting(program, object, shading);
				this.#drawObjectRange(program, object);
			}
		} finally {
			if (profile && submissionStartedAt !== undefined) {
				profile.finishCpuPhase("opaqueSubmission", submissionStartedAt);
			}
		}
	}

	#drawBlendedObjects(
		view: PreparedView,
		shading: SceneShading,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		const orderingStartedAt = profile?.beginCpuPhase();
		const transparent: TransparentObjectRange<PreparedObjectFrameInput>[] = [];
		const additive: PreparedObjectFrameInput[] = [];
		for (const object of view.objects) {
			if (object.ordering === "additive") {
				additive.push(object);
				continue;
			}
			if (object.ordering !== "transparent") continue;
			const facts = object.transparentSort;
			if (!facts)
				throw new Error(
					"Transparent static-object contribution lacks sort facts.",
				);
			if (object.instances?.kind === "frame-template") {
				transformPoint3(
					object.instances.instance.sourceToLandblock,
					facts.center,
					this.#transparentCenterScratch,
				);
			} else {
				transformPoint3(
					object.localToLandblock,
					facts.center,
					this.#transparentCenterScratch,
				);
			}
			const offset = createLandblockOffset(
				getLandblockCoordinates(object.landblockId),
				view.anchorCoordinates,
				this.#offsetScratch,
			);
			const x =
				this.#transparentCenterScratch.x + offset.x - view.cameraPosition.x;
			const y =
				this.#transparentCenterScratch.y + offset.y - view.cameraPosition.y;
			const z =
				this.#transparentCenterScratch.z + offset.z - view.cameraPosition.z;
			transparent.push({
				distanceSquared: x * x + y * y + z * z,
				range: object,
			});
		}
		const orderedTransparent = orderTransparentObjectRanges(
			transparent,
			(object) =>
				object.instances?.kind === "frame-template"
					? object.instances.cohortKey
					: null,
		);
		this.#frameSelectionMetrics.transparentObjectCandidateCount +=
			transparent.length;
		this.#frameSelectionMetrics.farTransparentObjectCandidateCount +=
			orderedTransparent.far.length;
		this.#frameSelectionMetrics.nearTransparentObjectCandidateCount +=
			orderedTransparent.near.length;
		if (profile && orderingStartedAt !== undefined) {
			profile.finishCpuPhase("blendedOrdering", orderingStartedAt);
		}
		const sortedBlended = this.#prepareFrameBlendedRuns(
			{
				additive,
				far: orderedTransparent.far.map(({ range }) => range),
				near: orderedTransparent.near.map(({ range }) => range),
			},
			profile,
		);
		if (sortedBlended.length === 0) return;
		const submissionStartedAt = profile?.beginCpuPhase();
		const gl = this.#gl;
		try {
			this.#objectState.invalidate();
			gl.depthMask(false);
			for (const object of sortedBlended) {
				const program =
					object.drawKind === "instanced"
						? this.#blendedInstancedObjectProgram
						: this.#blendedObjectProgram;
				if (this.#objectState.applyProgram(program.program)) {
					this.#activateObjectProgram(program, view, shading);
				}
				this.#applyObjectLighting(program, object, shading);
				this.#objectState.applyBlend(object.blendPolicy);
				this.#drawObjectRange(program, object);
			}
		} finally {
			if (profile && submissionStartedAt !== undefined) {
				profile.finishCpuPhase("blendedSubmission", submissionStartedAt);
			}
		}
	}

	/**
	 * Upload both transparent phases once while keeping their independent run boundaries.
	 */
	#prepareFrameBlendedRuns(
		ordered: {
			readonly additive: readonly PreparedObjectFrameInput[];
			readonly far: readonly PreparedObjectFrameInput[];
			readonly near: readonly PreparedObjectFrameInput[];
		},
		profile: WebGL2FrameProfileCapture | null,
	): readonly PreparedObjectFrameInput[] {
		const prepared = this.#prepareFrameInstanceRuns(
			[ordered.far, ordered.near, ordered.additive],
			profile,
			["adjacent", "adjacent", "grouped"],
			null,
		);
		const [farRunCount = 0, nearRunCount = 0] = prepared.runCounts;
		this.#frameSelectionMetrics.transparentFrameRunCount +=
			farRunCount + nearRunCount;
		this.#frameSelectionMetrics.farTransparentFrameRunCount += farRunCount;
		this.#frameSelectionMetrics.nearTransparentFrameRunCount += nearRunCount;
		return prepared.objects;
	}

	/** Form phase-local compatible runs and upload their complete sequential instance population. */
	#prepareFrameInstanceRuns(
		phases: readonly (readonly PreparedObjectFrameInput[])[],
		profile: WebGL2FrameProfileCapture | null,
		groupings: readonly ("adjacent" | "grouped")[],
		generatedCullView: PreparedView | null,
	): {
		readonly objects: readonly PreparedObjectFrameInput[];
		readonly runCounts: readonly number[];
	} {
		const orderedInstances: ObjectInstanceData[] = [];
		const objects: PreparedObjectFrameInput[] = [];
		const runCounts: number[] = [];
		if (generatedCullView) {
			this.#generatedInstanceSelector.beginView(
				generatedCullView.clipFromAnchor,
				this.#frameWidth,
				this.#frameHeight,
				this.#minimumObjectFootprintPixelArea,
			);
		}
		const cullingStartedAt = generatedCullView
			? profile?.beginCpuPhase()
			: undefined;
		for (const phase of phases) {
			for (const object of phase) {
				if (object.instances?.kind !== "static-fragment") continue;
				if (!generatedCullView || object.source !== "generated") {
					throw new Error(
						`${object.source} object unexpectedly entered generated-scenery compaction.`,
					);
				}
				this.#frameSelectionMetrics.selectedGeneratedInstanceFragmentCount += 1;
				const [offsetX, offsetY, offsetZ] =
					object.compatibility.landblockOffset;
				const selectedIndices = this.#generatedInstanceSelector.select(
					object.instances.data,
					offsetX,
					offsetY,
					offsetZ,
				);
				this.#frameSelectionMetrics.selectedGeneratedInstanceCount +=
					selectedIndices.length;
			}
		}
		if (generatedCullView) {
			this.#frameSelectionMetrics.testedGeneratedInstanceCount +=
				this.#generatedInstanceSelector.testedCount;
			this.#frameSelectionMetrics.retainedGeneratedInstanceCount +=
				this.#generatedInstanceSelector.retainedCount;
			this.#frameSelectionMetrics.rejectedGeneratedInstanceCount +=
				this.#generatedInstanceSelector.rejectedCount;
		}
		if (profile && cullingStartedAt !== undefined) {
			profile.finishCpuPhase("generatedInstanceCulling", cullingStartedAt);
		}
		const preparationStartedAt = profile?.beginCpuPhase();
		for (const [phaseIndex, phase] of phases.entries()) {
			const grouping = groupings[phaseIndex];
			if (!grouping) {
				throw new Error(
					`Object instance phase ${phaseIndex} has no grouping policy.`,
				);
			}
			const isFrameInstance = (object: PreparedObjectFrameInput): boolean =>
				object.instances?.kind === "frame-template" ||
				object.instances?.kind === "static-fragment";
			const isCompatible = (
				left: PreparedObjectFrameInput,
				right: PreparedObjectFrameInput,
			): boolean => {
				if (
					!areStaticObjectDrawsCompatible(
						left.compatibility,
						right.compatibility,
					)
				) {
					return false;
				}
				if (
					left.instances?.kind === "static-fragment" &&
					right.instances?.kind === "static-fragment"
				) {
					return true;
				}
				return (
					left.instances?.kind === "frame-template" &&
					right.instances?.kind === "frame-template" &&
					frameTemplateBatchIdentityEquals(left, right)
				);
			};
			const scheduled =
				grouping === "grouped"
					? formGroupedObjectInstanceRuns(
							phase,
							isFrameInstance,
							opaqueObjectInstanceBatchKey,
							isCompatible,
						)
					: formAdjacentObjectInstanceRuns(
							phase,
							isFrameInstance,
							isCompatible,
						);
			runCounts.push(
				scheduled.filter(
					(submission) => submission.kind === "frame-instance-run",
				).length,
			);
			for (const submission of scheduled) {
				if (submission.kind === "single") {
					objects.push(submission.value);
					continue;
				}
				const object = submission.values[0];
				const firstInstance = orderedInstances.length;
				for (const adjacent of submission.values) {
					if (adjacent.instances?.kind === "frame-template") {
						orderedInstances.push(adjacent.instances.instance);
					} else if (adjacent.instances?.kind === "static-fragment") {
						const [offsetX, offsetY, offsetZ] =
							adjacent.compatibility.landblockOffset;
						const selectedIndices = this.#generatedInstanceSelector.select(
							adjacent.instances.data,
							offsetX,
							offsetY,
							offsetZ,
						);
						for (const index of selectedIndices) {
							const instance = adjacent.instances.data.instances[index];
							if (!instance) {
								throw new Error(
									"Generated-instance selection referenced a missing instance.",
								);
							}
							orderedInstances.push(instance);
						}
					} else {
						throw new Error(
							"Object instance run contains prepared range state.",
						);
					}
				}
				const instanceCount = orderedInstances.length - firstInstance;
				if (instanceCount === 0) continue;
				objects.push({
					...object,
					instances: {
						firstInstance,
						instanceCount,
						kind: "frame-range",
					},
				});
			}
		}
		if (profile && preparationStartedAt !== undefined) {
			profile.finishCpuPhase("instanceRunPreparation", preparationStartedAt);
		}
		const uploadStartedAt = profile?.beginCpuPhase();
		this.#frameInstances.prepareView(orderedInstances);
		if (profile && uploadStartedAt !== undefined) {
			profile.finishCpuPhase("instanceUpload", uploadStartedAt);
		}
		if (orderedInstances.length > 0) {
			this.#frameSelectionMetrics.frameInstanceUploadCount += 1;
			this.#frameSelectionMetrics.frameInstanceUploadBytes +=
				orderedInstances.length * OBJECT_INSTANCE_RECORD_BYTES;
		}
		return { objects, runCounts };
	}

	#drawObjectRange(
		program: AnyObjectProgram,
		object: PreparedObjectFrameInput,
	): void {
		if (
			(object.drawKind === "baked") !==
			(program.transformSource === "baked")
		) {
			throw new Error(
				`${object.drawKind} draw cannot use ${program.transformSource} object program.`,
			);
		}
		const { compatibility } = object;
		const gl = this.#gl;
		this.#objectState.applyCullFace(compatibility.cullFace);
		if (program.transformSource === "baked") {
			gl.uniformMatrix4fv(
				program.uniforms.localToLandblock,
				false,
				mat4ToFloat32Array(object.localToLandblock, this.#matrixScratch),
			);
		}
		gl.uniform3f(
			program.uniforms.landblockOffset,
			compatibility.landblockOffset[0],
			compatibility.landblockOffset[1],
			compatibility.landblockOffset[2],
		);
		gl.uniform1i(program.uniforms.wrapRepeat, compatibility.wrapRepeat ? 1 : 0);
		gl.uniform1i(
			program.uniforms.palettedClipMap,
			compatibility.palettedClipMap ? 1 : 0,
		);
		gl.uniform1f(program.uniforms.alphaTest, compatibility.alphaTest);
		const preparedMaterial = compatibility.material;
		if (preparedMaterial.kind === "solid-color") {
			gl.uniform1i(program.uniforms.materialKind, 0);
			gl.uniform4f(program.uniforms.materialColor, ...preparedMaterial.color);
		} else {
			this.#bindPreparedObjectTexture(
				OBJECT_TEXTURE_UNITS.base,
				preparedMaterial.base,
			);
			gl.uniform4f(program.uniforms.baseRect, ...preparedMaterial.base.rect);
			gl.uniform1i(
				program.uniforms.materialKind,
				preparedMaterial.kind === "direct-color"
					? 1
					: preparedMaterial.kind === "index8"
						? 2
						: 3,
			);
			gl.uniform4f(program.uniforms.materialColor, ...preparedMaterial.color);
			if (preparedMaterial.kind !== "direct-color") {
				this.#bindPreparedObjectTexture(
					OBJECT_TEXTURE_UNITS.palette,
					preparedMaterial.palette,
				);
				gl.uniform4f(
					program.uniforms.paletteRect,
					...preparedMaterial.palette.rect,
				);
			}
		}
		const { detail } = compatibility;
		if (detail) {
			this.#bindPreparedObjectTexture(OBJECT_TEXTURE_UNITS.detail, detail);
			gl.uniform4f(program.uniforms.detailRect, ...detail.rect);
			gl.uniform1f(program.uniforms.detailTiling, detail.tiling);
			gl.uniform1i(program.uniforms.useDetail, 1);
		} else {
			gl.uniform1i(program.uniforms.useDetail, 0);
		}
		gl.uniform1f(program.uniforms.luminosity, compatibility.luminosity);
		const geometry = compatibility.geometry;
		this.#objectState.applyVertexArray(geometry.vertexArray);
		let submittedInstanceCount = 1;
		if (object.drawKind === "instanced") {
			if (!object.instances) {
				throw new Error("Instanced draw has no resolved instance stream.");
			}
			if (
				object.instances.kind === "frame-template" ||
				object.instances.kind === "static-fragment"
			) {
				throw new Error("Unprepared object instance data reached submission.");
			}
			const range = this.#frameInstances.getRange(
				object.instances.firstInstance,
				object.instances.instanceCount,
			);
			const instances = range.binding;
			if (range.instanceCount === 0)
				throw new Error("Instanced draw has an empty instance range.");
			bindWebGL2ObjectInstanceRange(
				gl,
				instances,
				range.firstInstance,
				range.instanceCount,
			);
			submittedInstanceCount = range.instanceCount;
			gl.drawElementsInstanced(
				gl.TRIANGLES,
				object.indexCount,
				geometry.indexType,
				object.indexStart * geometry.indexElementBytes,
				submittedInstanceCount,
			);
		} else {
			if (object.instances !== null) {
				throw new Error("Baked draw unexpectedly resolved an instance stream.");
			}
			gl.drawElements(
				gl.TRIANGLES,
				object.indexCount,
				geometry.indexType,
				object.indexStart * geometry.indexElementBytes,
			);
		}
		const sourceTriangleCount = object.indexCount / 3;
		if (object.source === "dynamic") {
			this.#frameSelectionMetrics.submittedDynamicDrawCount += 1;
			this.#frameSelectionMetrics.submittedDynamicInstanceCount +=
				submittedInstanceCount;
		} else {
			this.#frameSelectionMetrics.submittedStaticObjectDrawCount += 1;
			this.#frameSelectionMetrics.submittedStaticObjectTriangleCount +=
				sourceTriangleCount * submittedInstanceCount;
		}
		if (object.source === "env-cell-shell") {
			this.#frameSelectionMetrics.submittedEnvCellShellDrawCount += 1;
			this.#frameSelectionMetrics.submittedEnvCellShellTriangleCount +=
				sourceTriangleCount;
			if (object.cullFaceOverride !== null) {
				this.#frameSelectionMetrics.envCellShellCullOverrideCount += 1;
			}
		} else if (object.source === "env-cell-resident") {
			this.#frameSelectionMetrics.submittedEnvCellResidentDrawCount += 1;
			this.#frameSelectionMetrics.submittedEnvCellResidentTriangleCount +=
				sourceTriangleCount * submittedInstanceCount;
		}
		if (object.drawKind === "baked" && object.source !== "dynamic") {
			this.#frameSelectionMetrics.submittedBakedStaticObjectDrawCount += 1;
			this.#frameSelectionMetrics.submittedBakedStaticObjectTriangleCount +=
				sourceTriangleCount;
		} else {
			this.#frameSelectionMetrics.submittedInstancedSourceTriangleCount +=
				sourceTriangleCount;
			if (
				object.source === "generated" &&
				(object.ordering === "opaque" || object.ordering === "alpha-test")
			) {
				this.#frameSelectionMetrics.submittedCompactedGeneratedDrawCount += 1;
				this.#frameSelectionMetrics.submittedCompactedGeneratedInstanceCount +=
					submittedInstanceCount;
			}
		}
		if (object.ordering === "transparent") {
			this.#frameSelectionMetrics.submittedTransparentObjectDrawCount += 1;
			if (object.drawKind === "instanced") {
				this.#frameSelectionMetrics.submittedTransparentInstanceCount +=
					submittedInstanceCount;
			}
		}
		if (object.ordering === "additive") {
			this.#frameSelectionMetrics.submittedAdditiveObjectDrawCount += 1;
		}
	}

	#activateObjectProgram(
		program: AnyObjectProgram,
		view: PreparedView,
		shading: SceneShading,
	): void {
		const gl = this.#gl;
		this.#frameSelectionMetrics.objectProgramChanges += 1;
		gl.uniformMatrix4fv(
			program.uniforms.projection,
			false,
			mat4ToFloat32Array(view.projection, this.#matrixScratch),
		);
		gl.uniformMatrix4fv(
			program.uniforms.view,
			false,
			mat4ToFloat32Array(view.view, this.#matrixScratch),
		);
		if ("fogUniforms" in program) {
			gl.uniform2f(
				program.fogUniforms.cameraHorizontalPosition,
				view.cameraPosition.x,
				view.cameraPosition.z,
			);
			bindWebGL2DistanceFog(gl, program.fogUniforms, shading.fog);
		}
	}

	/**
	 * Bind the lighting this contribution's retail role requires.
	 *
	 * Interior and outdoor contributions interleave within one pass, so lighting is per draw
	 * rather than per program activation; the state applicator suppresses redundant binds.
	 */
	#applyObjectLighting(
		program: AnyObjectProgram,
		object: ObjectFrameInput,
		shading: SceneShading,
	): void {
		const role = objectLightingRole(object.source);
		if (!this.#objectState.applyLightingRole(role)) return;
		bindWebGL2SceneLighting(this.#gl, program.uniforms, shading.lighting[role]);
		this.#frameSelectionMetrics.objectLightingBinds += 1;
	}

	/** Start one object-owned phase with complete bindings for every active sampler. */
	#beginObjectPhase(): void {
		this.#objectState.invalidate();
		for (const unit of Object.values(OBJECT_TEXTURE_UNITS)) {
			this.#bindPreparedObjectTexture(unit, this.#objectFallbackBinding);
		}
	}

	#bindPreparedObjectTexture(
		unit: number,
		binding: PreparedObjectTextureBinding<WebGLTexture, WebGLSampler>,
	): void {
		if (this.#objectState.applyTextureUnit(unit, binding)) {
			this.#frameSelectionMetrics.objectTextureBinds += 1;
		}
	}

	#resizeCanvasForDpr(): void {
		const dpr = window.devicePixelRatio ?? 1;
		const width = Math.max(1, Math.floor(this.#canvas.clientWidth * dpr));
		const height = Math.max(1, Math.floor(this.#canvas.clientHeight * dpr));
		if (width === this.#frameWidth && height === this.#frameHeight) return;

		this.#frameWidth = width;
		this.#frameHeight = height;
		this.#canvas.width = width;
		this.#canvas.height = height;
		this.#gl.viewport(0, 0, width, height);
	}
}

function validateDrawRange(
	binding: WebGL2GeometryBinding,
	indexStart: number,
	indexCount: number,
): void {
	if (
		!Number.isInteger(indexStart) ||
		!Number.isInteger(indexCount) ||
		indexStart < 0 ||
		indexCount < 0 ||
		indexStart + indexCount > binding.indexCount
	) {
		throw new Error(
			`Invalid geometry draw range ${indexStart}+${indexCount}/${binding.indexCount}.`,
		);
	}
}

/** Pair generated instance data with the semantic partition that owns exact run grouping. */
function resolveStaticFragmentInstanceInput(
	drawUnit: StaticObjectDrawUnit,
	data: StaticInstanceStreamData | null,
): ObjectFrameInput["instances"] {
	if (data === null) return null;
	if (drawUnit.kind !== "instanced") {
		throw new Error("Baked static object unexpectedly resolved instance data.");
	}
	return { cohortKey: drawUnit.cohortKey, data, kind: "static-fragment" };
}

/**
 * Combine every unique render node assigned to one stencil layer before drawing its passes.
 *
 * Merging first presents one complete contribution to instance grouping and transparency policy
 * instead of accidentally treating each environment cell as an independent miniature scene.
 */
function mergePortalNodeContributions(
	renderNodeIds: readonly PortalRenderWorkPlan["nodes"][number]["id"][],
	contributionsByNode: ReadonlyMap<string, PreparedSceneContributions>,
	profile: WebGL2FrameProfileCapture | null,
): PreparedSceneContributions {
	profile?.recordPortalContributionUse(renderNodeIds);
	if (renderNodeIds.length === 1) {
		const renderNodeId = renderNodeIds[0];
		if (renderNodeId === undefined) {
			throw new Error(
				"Single-node portal merge lost its render node identity.",
			);
		}
		const contributions = contributionsByNode.get(renderNodeId);
		if (!contributions) {
			throw new Error(
				`Portal render layer cannot resolve contributions for ${renderNodeId}.`,
			);
		}
		return contributions;
	}
	const objects: PreparedObjectFrameInput[] = [];
	const terrain: TerrainFrameInput[] = [];
	const consumedNodeIds = new Set<string>();
	const mergeStartedAt = profile?.beginCpuPhase();
	for (const renderNodeId of renderNodeIds) {
		if (!consumedNodeIds.add(renderNodeId)) {
			throw new Error(
				`Portal render layer requests node ${renderNodeId} more than once.`,
			);
		}
		const contributions = contributionsByNode.get(renderNodeId);
		if (!contributions) {
			throw new Error(
				`Portal render layer cannot resolve contributions for ${renderNodeId}.`,
			);
		}
		objects.push(...contributions.objects);
		terrain.push(...contributions.terrain);
	}
	if (profile && mergeStartedAt !== undefined) {
		profile.finishCpuPhase("contributionMerge", mergeStartedAt);
		profile.recordContributionMerge();
	}
	return { objects, terrain };
}

/** Retail sources encode translucency as either a unit float or a legacy byte-scale value. */
function sourceOpacity(translucency: number): number {
	const normalized =
		translucency > 1 ? 1 - Math.min(translucency, 255) / 255 : 1 - translucency;
	return Math.max(0, Math.min(1, normalized));
}

/** Check the semantic frame-template identity required in addition to prepared compatibility. */
function frameTemplateBatchIdentityEquals(
	left: PreparedObjectFrameInput,
	right: PreparedObjectFrameInput,
): boolean {
	const leftInstances = left.instances;
	const rightInstances = right.instances;
	if (
		leftInstances?.kind !== "frame-template" ||
		rightInstances?.kind !== "frame-template"
	) {
		throw new Error(
			"Frame-template batch identity requires two frame templates.",
		);
	}
	return (
		leftInstances.cohortKey === rightInstances.cohortKey &&
		left.source === right.source &&
		left.renderDomainKey === right.renderDomainKey &&
		left.geometry === right.geometry &&
		left.landblockId === right.landblockId &&
		left.indexStart === right.indexStart &&
		left.indexCount === right.indexCount
	);
}

/** Stable semantic partition used to narrow exact opaque instance compatibility checks. */
function opaqueObjectInstanceBatchKey(
	object: PreparedObjectFrameInput,
): string {
	const instances = object.instances;
	if (
		instances?.kind !== "frame-template" &&
		instances?.kind !== "static-fragment"
	) {
		throw new Error(
			"Opaque instance grouping received a non-frame instance input.",
		);
	}
	return `${object.ordering}\0${object.source}\0${object.renderDomainKey}\0${object.landblockId}\0${instances.cohortKey}\0${object.geometry}\0${object.indexStart}\0${object.indexCount}`;
}

function createObjectFallbackTexture(gl: WebGL2RenderingContext): WebGLTexture {
	const texture = gl.createTexture();
	if (!texture) throw new Error("Failed to allocate object fallback texture.");
	try {
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA8,
			1,
			1,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			Uint8Array.of(255, 255, 255, 255),
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return texture;
	} catch (error) {
		gl.deleteTexture(texture);
		throw error;
	} finally {
		gl.bindTexture(gl.TEXTURE_2D, null);
	}
}
