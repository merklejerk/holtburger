import {
	createLandblockOffset,
	createLandblockWorldOrigin,
	getLandblockCoordinates,
	landblockChebyshevDistance,
} from "../landblocks";
import { farTerrainCutoffLandblocks } from "../environment/terrain-fog";
import {
	createPerspectiveMat4,
	createViewMat4,
	mat4ToFloat32Array,
	multiplyMat4,
	transformPoint3,
} from "../math/matrices";
import { createFrustumFromClipMatrix, type Frustum } from "../math/frustum";
import { Mat4, Vec3 } from "../math/types";
import { type SceneNodeId, type SceneScope } from "../scene";
import { scopeFor, scopeKey } from "../scene/scope";
import { createCameraNearClipVolume } from "./portal-near-plane";
import type { TerrainDrawUnit } from "../terrain/types";
import type {
	ObjectMaterialBinding,
	StaticObjectDrawUnit,
} from "../commit/artifacts";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import { TextureWrapMode } from "../textures/types";
import type { ColorGradeSettings } from "./color-grade-policy";
import {
	DEFAULT_FRAME_SETTINGS,
	type FrameInput,
	type FrameSelectionMetrics,
	type FrameSettings,
	type RendererFrameDiagnostics,
	type RendererFrameFeedback,
	type FrameViewInput,
	type Renderer,
	type ResolvedResourceInvalidation,
} from "./renderer";
import { renderCullingGroupFilter } from "./render-layer-visibility";
import type { LandblockVec3 } from "../../assets/ac-frame";
import {
	RenderWorld,
	type ObjectPresentationFootprint,
	type RenderContribution,
} from "./render-world";
import { retainsProjectedObjectFootprint } from "./object-footprint";
import type {
	GeometryResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";
import {
	OBJECT_INSTANCE_RECORD_BYTES,
	type ObjectInstanceData,
} from "../systems/static-resources";
import {
	assertSharedTerrainRegion,
	type TerrainProgramInput,
} from "./terrain-program-input";
import { LandblockLayerKind } from "../runtime/scene-interest";
import {
	WebGL2ResourceManager,
	type WebGL2GeometryBinding,
	type WebGL2Texture2DBinding,
	type WebGL2TextureArrayBinding,
} from "./webgl2-resource-manager";
import {
	createWebGL2NearTerrainProgram,
	type WebGL2NearTerrainProgram,
} from "./webgl2-terrain-program";
import {
	createWebGL2FarTerrainProgram,
	type WebGL2FarTerrainProgram,
} from "./webgl2-far-terrain-program";
import { FrameInstanceStreamArena } from "./frame-instance-stream-arena";
import {
	createWebGL2ObjectProgram,
	OBJECT_TEXTURE_UNITS,
	type WebGL2FogObjectProgram,
	type WebGL2FogInstancedObjectProgram,
	type WebGL2InstancedObjectProgram,
	type WebGL2ObjectProgram,
} from "./webgl2-object-program";
import { bindWebGL2ObjectInstanceRange } from "./webgl2-instance-buffer";
import type { LandblockId } from "../game-types";
import {
	UNAUTHORED_SCENE_LIGHTING,
	VIEWER_LIGHT,
} from "../environment/scene-environment";
import {
	MAX_DYNAMIC_LIGHTS,
	MAX_STATIC_LIGHTS,
	type RuntimeLight,
	selectNearestLights,
} from "../environment/runtime-lights";
import type { LandblockLights } from "../environment/outdoor-light-index";
import {
	TERRAIN_LIGHT_MASK_ALL,
	TERRAIN_LIGHT_MASK_LENGTH,
} from "../environment/terrain-light-mask";
import {
	createWebGL2TerrainLightMaskTexture,
	destroyWebGL2TerrainLightMaskTexture,
	uploadWebGL2TerrainLightMask,
	type WebGL2TerrainLightMaskTexture,
} from "./webgl2-terrain-light-mask";
import {
	objectLightingRole,
	resolveAuthoredLightResponse,
	resolveSceneLightingByRole,
	type SceneLightingByRole,
} from "../environment/scene-lighting";
import { bindWebGL2DistanceFog, type WebGL2FogUniforms } from "./webgl2-fog";
import {
	bindWebGL2DynamicLights,
	bindWebGL2SceneLighting,
	bindWebGL2StaticLights,
	type LightAnchorOrigin,
	createDynamicLightScratch,
	type WebGL2DirectionalLightingUniforms,
} from "./webgl2-lighting";
import {
	formAdjacentObjectInstanceRuns,
	formGroupedObjectInstanceRuns,
	areStaticObjectDrawsCompatible,
	type ObjectBlendPolicy,
	createObjectSubmissionPhases,
	objectBlendPolicy,
	type ObjectSubmissionPhases,
	type PreparedObjectAtlasBinding,
	type PreparedObjectMaterial,
	type PreparedObjectTextureBinding,
	type PreparedStaticObjectDrawCompatibility,
	type TransparentObjectRange,
} from "./object-rendering-policy";
import { resolveStaticMaterialDetail } from "./static-detail-binding";
import {
	CompiledObjectDrawStore,
	type CompiledObjectDraw,
} from "./compiled-object-draws";
import type { PreparedPortalProjection } from "./portal-view-window";
import type { PortalScopeWindowCullInput } from "./portal-scope-window-culler";
import {
	type DynamicRenderDomainSelection,
	selectedDynamicRenderScopeKeys,
} from "./dynamic-render-scopes";
import type { WebGL2TextureFilteringSupport } from "./webgl2-texture-filtering-support";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import {
	WebGL2TextureSamplerCatalog,
	type TextureSamplingClass,
} from "./webgl2-texture-sampler-catalog";
import { devicePixelArea, validateRenderScale } from "./render-scale";
import type { TextureFilteringPolicy } from "./texture-filtering-policy";
import type { Camera } from "../runtime/types";
import type {
	RendererParticleCapability,
	RendererSkyCapability,
} from "./renderer";
import { SKY_FAR_PLANE, skyViewMatrix, WebGL2SkyPass } from "./webgl2-sky-pass";
import type { SkyDrawPass } from "../environment/sky-state";
import { ParticleMeshResidency } from "./particle-mesh-residency";
import {
	type ParticleDrawContext,
	type ParticleRecordFrame,
	WebGL2ParticlePass,
} from "./webgl2-particle-pass";
import {
	EXTERIOR_PARTICLE_RENDER_OWNER,
	SKY_PARTICLE_RENDER_OWNER,
	type ParticleSourceRange,
} from "../systems/particle-system";
import {
	ParticleRenderBatcher,
	type ParticleDrawRange,
} from "./particle-render-routing";
import {
	createWebGL2SkyProgram,
	type WebGL2SkyProgram,
} from "./webgl2-sky-program";
import { WebGL2ObjectStateApplicator } from "./webgl2-object-state-applicator";
import { sourceOpacity } from "./object-rendering-policy";
import {
	WebGL2FrameProfiler,
	type WebGL2FrameProfileCapture,
} from "./webgl2-gpu-frame-profiler";
import {
	WebGL2PortalScopeAtlasPipeline,
	type WebGL2PortalScopeAtlasFrame,
} from "./webgl2-portal-scope-atlas-pipeline";
import {
	WebGL2FlatSceneTarget,
	type WebGL2FlatSceneTargetSet,
} from "./webgl2-flat-scene-target";
import { WebGL2FlatScenePresentation } from "./webgl2-flat-scene-presentation";
import {
	AMBIENT_OCCLUSION_DISTANCE_FADE,
	resolveEffectiveAmbientOcclusionPolicy,
	type EffectiveAmbientOcclusionPolicy,
} from "./ambient-occlusion-policy";
import { WebGL2SaoPass, type WebGL2SaoCoverageCensus } from "./webgl2-sao-pass";

/**
 * Texture unit for the terrain light mask, after the six the terrain shader samples: unit 0 is the
 * per-landblock surface field, units 1-5 the region-constant pass textures.
 * Object programs bind only units 0-2, so nothing contends for it.
 */
const TERRAIN_LIGHT_MASK_TEXTURE_UNIT = 6;

/** Stand-in before any emitter has published records, so the context is never partially built. */
const EMPTY_PARTICLE_RECORDS: ParticleRecordFrame = {
	data: new Float32Array(0),
	dirtySlots: null,
};

/** Keep terrain behind authored outdoor geometry at near-coplanar depth intersections. */
const TERRAIN_DEPTH_OFFSET = { factor: 1, units: 1 } as const;

/**
 * Convert a canonical scene position into the frame's anchor-relative render frame.
 *
 * Shaders receive landblock-local positions offset by `uLandblockOffset`, which is relative to
 * the frame anchor rather than the scene origin. Anything compared against a vertex position must
 * be converted the same way.
 */
function anchorRelativePosition(
	position: Vec3,
	anchorLandblockId: LandblockId,
): Vec3 {
	const origin = createLandblockWorldOrigin(anchorLandblockId);
	return new Vec3(position.x - origin.x, position.y, position.z - origin.z);
}

interface SceneShading {
	/** Effective optional near-field presentation policy resolved once for this frame. */
	readonly ambientOcclusion: EffectiveAmbientOcclusionPolicy;
	readonly fog: FrameInput["environment"]["distanceFog"];
	/** Resolved sky for this frame, celestial and weather, or null when the region authors none. */
	readonly sky: FrameInput["environment"]["sky"];
	/** Whether authored weather draws at all, mirroring retail's `LScape::weather_enabled`. */
	readonly weatherEnabled: boolean;
	/** Scene-space origin of the frame anchor, subtracted from every light position at bind. */
	readonly anchorOrigin: LightAnchorOrigin;
	/** How much of an authored outdoor lamp survives the frame's daylight, in [0, 1]. */
	readonly authoredLightResponse: number;
	/** Frame-global dynamic lights; they reach every draw regardless of role. */
	readonly dynamicLights: readonly RuntimeLight[];
	/**
	 * Authored outdoor lights reaching one landblock with their terrain cell masks, memoized
	 * across frames by the index. Objects consume only the lights; terrain also uploads the masks.
	 */
	readonly staticLights: (landblockId: LandblockId) => LandblockLights;
	/** Lighting per draw role, derived once per frame so draw loops stay allocation-free. */
	readonly lighting: SceneLightingByRole;
}

/**
 * Shading for the browser-harness portal execution probe, which renders outside any
 * resolved frame environment. Fog stays disabled exactly as this probe path always had it.
 */
const PROBE_SHADING: SceneShading = {
	ambientOcclusion: { kind: "disabled" },
	fog: null,
	// Probe views measure world draws only; the sky contributes no depth and no selection.
	sky: null,
	weatherEnabled: false,
	// No lights, so neither the rebasing origin nor the daylight response is observable.
	anchorOrigin: { x: 0, z: 0 },
	authoredLightResponse: 0,
	dynamicLights: [],
	staticLights: () => EMPTY_LANDBLOCK_LIGHTS,
	lighting: resolveSceneLightingByRole(UNAUTHORED_SCENE_LIGHTING),
};

const ORIGIN = { x: 0, y: 0, z: 0 } as const;
const EMPTY_LIGHTS: readonly RuntimeLight[] = [];
/** Synthetic single render domain used by the deliberately unpartitioned flat debug mode. */
const FLAT_PARTICLE_DOMAIN = "particle-render-domain:flat";
const FLAT_SKY_PARTICLE_DOMAIN = "particle-render-domain:flat-sky";
/** Unlit result for draws that resolve no landblock lights at all. */
const EMPTY_LANDBLOCK_LIGHTS: LandblockLights = {
	lights: EMPTY_LIGHTS,
	cellMasks: new Uint32Array(TERRAIN_LIGHT_MASK_LENGTH),
};

interface TerrainFrameInput {
	/** Logical geometry and texture identities for one landblock's terrain. */
	readonly drawUnit: TerrainDrawUnit;
	/** Device resources resolved by this renderer for the terrain shader contract. */
	readonly program: TerrainProgramInput;
}

/** View-constant uniforms shared by the near and sampler-free far terrain programs. */
interface TerrainGroupUniforms
	extends WebGL2FogUniforms, WebGL2DirectionalLightingUniforms {
	readonly cameraPosition: WebGLUniformLocation;
	readonly clipTransform: WebGLUniformLocation;
	readonly landblockOffset: WebGLUniformLocation;
	readonly localToLandblock: WebGLUniformLocation;
	readonly projection: WebGLUniformLocation;
	readonly view: WebGLUniformLocation;
}

/** One opaque or alpha-test static-object range paired with its resolved node placement. */
interface ObjectFrameInput {
	readonly source:
		| "outdoor"
		| "generated"
		| "env-cell-shell"
		| "env-cell-resident"
		| "dynamic";
	/** Canonical authored scope; an instance run must never cross this atlas-routing boundary. */
	readonly renderScopeKey: string;
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
	/** Landblock-space ordering facts; the brand holds every producer to that frame. */
	readonly transparentSort: {
		readonly stableId: string;
		readonly center: LandblockVec3;
	} | null;
}

type PreparedObjectDrawCompatibility = PreparedStaticObjectDrawCompatibility<
	WebGL2GeometryBinding,
	WebGLTexture,
	WebGLSampler
>;

/**
 * One object contribution paired with every renderer-resolved fact consumed at submission.
 *
 * `compiled` is shared by reference with every frame that submits this draw unit, so a frame
 * never copies compiled facts to use them. Nothing anchor-relative is stored: the offset is
 * looked up per frame by `landblockId`, which is what lets a static submission itself be cached
 * across re-anchoring.
 */
interface PreparedObjectFrameInput extends ObjectFrameInput {
	/**
	 * Compiled facts held directly rather than behind their cache entry.
	 *
	 * Run formation compares these for every adjacent submission pair, so the hot loop reads them
	 * without a second dereference. Both values are owned by the cache entry and shared by
	 * reference; nothing is copied to place them here.
	 */
	readonly blendPolicy: ObjectBlendPolicy;
	readonly compatibility: PreparedObjectDrawCompatibility;
}

/**
 * Build one submission with a fixed field order, from every producer.
 *
 * Run formation reads these fields for every adjacent pair in the frame, so all submissions are
 * constructed here rather than by per-site spreads: one construction site means one object shape,
 * and the hot comparison stays monomorphic instead of degrading as producers are added.
 */
function createObjectSubmission(
	object: ObjectFrameInput,
	compiled: CompiledObjectDraw<PreparedObjectDrawCompatibility>,
): PreparedObjectFrameInput {
	return {
		blendPolicy: compiled.blendPolicy,
		compatibility: compiled.compatibility,
		cullFaceOverride: object.cullFaceOverride,
		drawKind: object.drawKind,
		geometry: object.geometry,
		indexCount: object.indexCount,
		indexStart: object.indexStart,
		instances: object.instances,
		landblockId: object.landblockId,
		localToLandblock: object.localToLandblock,
		material: object.material,
		ordering: object.ordering,
		renderScopeKey: object.renderScopeKey,
		source: object.source,
		transparentSort: object.transparentSort,
	};
}

/** The facts one draw's compiled constants are derived from; deliberately no per-frame state. */
type CompiledObjectDrawInput = Pick<
	ObjectFrameInput,
	| "cullFaceOverride"
	| "geometry"
	| "indexCount"
	| "indexStart"
	| "material"
	| "ordering"
>;

/** Anchor-relative landblock offset, resolved once per visible landblock per frame. */
type LandblockRenderOffset = readonly [number, number, number];

/**
 * One static publication's complete submission set plus the node-level facts a frame reports.
 *
 * Cached whole against the publication, so a visible node performs one lookup per frame instead
 * of rebuilding a submission, a scope key, and a layer key for every draw unit it owns.
 */
interface CompiledStaticNodeSubmissions {
	readonly objects: readonly PreparedObjectFrameInput[];
	readonly landblockId: string;
	readonly source: ObjectFrameInput["source"];
	/** Key this publication contributes to the visible-layer census. */
	readonly visibleLayerKey: string;
	/** Cell scope this publication occupies, or null for outdoor publications. */
	readonly envCellScopeKey: string | null;
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
	/** Camera whose projection this view derives, retained so the sky can extend its far plane. */
	readonly camera: Camera;
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
	/**
	 * Anchor-relative offset per visible landblock for this frame.
	 *
	 * The only anchor-relative fact in a submission, held here rather than on each object so
	 * submissions survive re-anchoring and can be cached with their publication.
	 */
	readonly landblockOffsets: ReadonlyMap<string, LandblockRenderOffset>;
	/** Final contribution-local batches, recoalesced after particle owner routing. */
	readonly particles: readonly ParticleDrawRange[];
	/** Sky-attached particle batches drawn before the landscape. */
	readonly skyParticles: readonly ParticleDrawRange[];
}

/** Anchor-relative matrices and content reused by all passes for one view. */
interface PreparedView
	extends PreparedViewGeometry, PreparedSceneContributions {}

/** Whether one contribution owns exterior-global passes such as sky and weather. */
type SceneRenderDomain = "exterior" | "indoor";

/** Explicit production-geometry evidence for the public scope-atlas path. */
export interface PortalExecutionProbeResult {
	readonly crossingCount: number;
	readonly objectSubmissionCount: number;
	readonly planningDurationMs: number;
	readonly scopeCount: number;
	readonly selectionMetrics: FrameSelectionMetrics;
	readonly targetBytes: number;
	readonly terrainSubmissionCount: number;
	readonly traversalDepth: number;
}

/** Mutable backing state copied only when Explorer samples renderer diagnostics. */
interface MutableFrameSelectionMetrics {
	ambientOcclusion: {
		activeBytes: number;
		allocatedGenerationCount: number;
		disposedGenerationCount: number;
		effectiveDistanceFade: {
			disabledAt: number;
			fullStrengthUntil: number;
		} | null;
	};
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
	portalSelectedScopeCount: number;
	portalSelectedCrossingCount: number;
	portalCompletedCullDepth: number;
	portalPropagationDrawCount: number;
	portalProjectionPrimitiveCount: number;
	portalAtlasTilePixelCount: number;
	portalFrontierRetreatCount: number;
	portalTruncatedViewCount: number;
	portalFramebufferCount: number;
	portalTargetBytes: number;
	flatSceneFramebufferCount: number;
	flatSceneTargetBytes: number;
	flatSceneAllocatedGenerationCount: number;
	flatSceneDisposedGenerationCount: number;
	submittedStaticObjectDrawCount: number;
	submittedStaticObjectTriangleCount: number;
	submittedBakedStaticObjectDrawCount: number;
	submittedBakedStaticObjectTriangleCount: number;
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
	submittedParticleBatchCount: number;
	submittedParticleInstanceCount: number;
	unresolvedParticleBatchCount: number;
	/** Record-texture rows uploaded this frame; near the store height means a degenerate span. */
	uploadedParticleRecordRowCount: number;
	frameInstanceCapacity: number;
	frameInstanceGrowthCount: number;
	frameInstanceViewHighWaterMark: number;
	droppedLights: number;
	staticLightBinds: number;
	/** Per-landblock terrain mask uploads; unlit landblocks skip theirs entirely. */
	terrainLightMaskUploads: number;
	farTerrainDraws: number;
	farTerrainPaletteUploads: number;
	farTerrainCutoffLandblocks: number | null;
	objectLightingBinds: number;
	objectProgramChanges: number;
	objectTextureBinds: number;
}

export class WebGL2Renderer implements Renderer {
	/** Explicit diagnostic capability, separated from the production draw methods. */
	readonly frameDiagnostics: RendererFrameDiagnostics;
	static readonly #identityMatrix = Mat4.identity();

	readonly #matrixScratch = new Float32Array(16);
	/** Reusable sky matrices; the pass runs every frame and must not allocate in it. */
	readonly #skyMatrixScratch = new Float32Array(16);
	readonly #skyProjectionScratch = new Float32Array(16);
	readonly #skyViewScratch = new Float32Array(16);
	#skyPass: WebGL2SkyPass | null = null;
	#particleResidency: ParticleMeshResidency | null = null;
	#particlePass: WebGL2ParticlePass | null = null;
	/** This frame's owner-local sources, replaced every submission rather than retained. */
	#particleSources: readonly ParticleSourceRange[] = [];
	/** Record storage published with the ranges that index into it. */
	#particleRecords: ParticleRecordFrame = EMPTY_PARTICLE_RECORDS;
	/** Persistent scratch for owner routing and final contribution-local batch coalescing. */
	readonly #particleBatcher = new ParticleRenderBatcher();
	/** Reusable particle matrices; the pass runs every frame and must not allocate in it. */
	readonly #particleProjectionScratch = new Float32Array(16);
	readonly #particleViewScratch = new Float32Array(16);
	#skyProgram: WebGL2SkyProgram | null = null;
	/** Lazy sky variant routing celestial and weather geometry into the packed outdoor tile. */
	#portalAtlasSkyProgram: WebGL2SkyProgram | null = null;
	/** Shared clock seconds for the current frame, driving derived texture-velocity phase. */
	#skyClockSeconds = 0;
	readonly #offsetScratch = new Vec3(0, 0, 0);
	/**
	 * Draw facts compiled once per draw unit instead of once per frame.
	 *
	 * Keyed by the artifact draw units and templates themselves, so entries become collectable
	 * with the publication that owns them; the named flushes cover the events that invalidate
	 * every entry at once.
	 */
	readonly #compiledDraws = new CompiledObjectDrawStore<
		CompiledStaticNodeSubmissions,
		PreparedObjectDrawCompatibility
	>();
	/** Last landblock offset uploaded, memoizing the per-draw lookup across a run. */
	#lastDrawnLandblockId: string | null = null;
	#lastDrawnLandblockOffset: LandblockRenderOffset = [0, 0, 0];
	/** Terrain programs resolved once per realized landblock; see #resolveTerrainFrameInput. */
	readonly #terrainFrameInputs = new WeakMap<
		TerrainDrawUnit,
		TerrainFrameInput
	>();
	/** Frame settings that select compiled facts, retained to detect a change between frames. */
	#compiledTextureFiltering: TextureFilteringPolicy | null = null;
	#compiledEnvCellRenderMode: FrameSettings["envCellRenderMode"] | null = null;
	/** Reused while deriving transparent range distances before sorting a view. */
	readonly #transparentCenterScratch = new Vec3(0, 0, 0);
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #resources: WebGL2ResourceManager;
	readonly #textureSamplers: WebGL2TextureSamplerCatalog;
	/** Device-wide guard preventing draws through any stale handle after context loss. */
	readonly #assertDeviceReady: () => void;
	readonly #frameInstances: FrameInstanceStreamArena;
	/** Reusable dynamic-light upload staging; renderer-owned to keep draw loops allocation-free. */
	readonly #dynamicLightScratch: ReturnType<typeof createDynamicLightScratch>;
	readonly #terrainLightMask: WebGL2TerrainLightMaskTexture;
	/** Reuses one generated-stream selection across all material partitions in a view. */
	/** Exact state mirror scoped to independently invalidated object phases. */
	readonly #objectState: WebGL2ObjectStateApplicator;
	/** Portal owner created lazily when the first portal frame needs GPU resources. */
	#portalScopeAtlasPipeline: WebGL2PortalScopeAtlasPipeline | null = null;
	/** Unconditional flat-scene attachments, allocated lazily on the first flat frame. */
	#flatSceneTarget: WebGL2FlatSceneTarget | null = null;
	/** Flat color/depth presenter, compiled lazily with the first flat frame. */
	#flatScenePresentation: WebGL2FlatScenePresentation | null = null;
	/** Optional SAO programs and scratch ownership, created only by the first enabled frame. */
	#saoPass: WebGL2SaoPass | null = null;
	/** Harness-only category view; production never enables synchronous depth census work. */
	#saoCoverageVisualizationEnabled = false;
	readonly #visibleStaticLayers = new Set<string>();
	readonly #visibleEnvCellScopes = new Set<string>();
	/** Dynamic roots selected in any view of the frame, retained as production feedback. */
	readonly #selectedDynamicNodeIds = new Set<SceneNodeId>();
	/** Read-only runtime gateway used to collect this renderer's frame submissions. */
	readonly #world: RenderWorld;
	readonly #nearTerrainProgram: WebGL2NearTerrainProgram;
	readonly #farTerrainProgram: WebGL2FarTerrainProgram;
	readonly #objectProgram: WebGL2FogObjectProgram;
	readonly #instancedObjectProgram: WebGL2FogInstancedObjectProgram;
	/** Transparent and additive materials deliberately use a shader with no fog uniforms. */
	readonly #blendedObjectProgram: WebGL2ObjectProgram;
	readonly #blendedInstancedObjectProgram: WebGL2InstancedObjectProgram;
	/** Lazy scope-envelope variants; flat and legacy portal frames never compile them. */
	#portalBlendedObjectProgram: WebGL2ObjectProgram | null = null;
	#portalBlendedInstancedObjectProgram: WebGL2InstancedObjectProgram | null =
		null;
	/** Complete float-compatible fallback for every statically active object sampler. */
	readonly #objectFallbackBinding: PreparedObjectTextureBinding<
		WebGLTexture,
		WebGLSampler
	>;
	/** Requested quality captured at frame entry and consumed by every nested draw path. */
	#frameTextureFiltering: TextureFilteringPolicy =
		FRONTEND_TUNING.rendering.frameDefaults.textureFiltering;
	/** Portal footprint cutoff resolved to drawing-buffer pixels once at frame entry. */
	#minimumPortalFootprintDevicePixelArea = 0;
	/** Object-presentation footprint cutoff resolved to drawing-buffer pixels at frame entry. */
	#minimumObjectFootprintDevicePixelArea = 0;
	/** Sampling density the drawing buffer is currently sized for, retained for resize alone. */
	#renderScale: number = FRONTEND_TUNING.rendering.frameDefaults.renderScale;
	/** This frame's presentation grade, snapshotted once and consumed at present time. */
	#frameColorGrade: ColorGradeSettings = DEFAULT_FRAME_SETTINGS.colorGrade;
	/** Explicit session; null avoids clocks, extension probes, and GPU query resources. */
	#frameProfiler: WebGL2FrameProfiler | null = null;
	/** Reused metrics record for the frame's effective AO distance interval. */
	readonly #ambientOcclusionDistanceFadeMetrics = {
		disabledAt: 0,
		fullStrengthUntil: 0,
	};
	/** Reused per-frame diagnostics; cold reads return a copied snapshot. */
	readonly #frameSelectionMetrics: MutableFrameSelectionMetrics = {
		ambientOcclusion: {
			activeBytes: 0,
			allocatedGenerationCount: 0,
			disposedGenerationCount: 0,
			effectiveDistanceFade: null,
		},
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
		portalSelectedScopeCount: 0,
		portalSelectedCrossingCount: 0,
		portalCompletedCullDepth: 0,
		portalPropagationDrawCount: 0,
		portalProjectionPrimitiveCount: 0,
		portalAtlasTilePixelCount: 0,
		portalFrontierRetreatCount: 0,
		portalTruncatedViewCount: 0,
		portalFramebufferCount: 0,
		portalTargetBytes: 0,
		flatSceneFramebufferCount: 0,
		flatSceneTargetBytes: 0,
		flatSceneAllocatedGenerationCount: 0,
		flatSceneDisposedGenerationCount: 0,
		visibleSceneEntries: 0,
		visibleStaticLayerCount: 0,
		visibleStaticNodeCount: 0,
		submittedStaticObjectDrawCount: 0,
		submittedStaticObjectTriangleCount: 0,
		submittedBakedStaticObjectDrawCount: 0,
		submittedBakedStaticObjectTriangleCount: 0,
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
		submittedParticleBatchCount: 0,
		submittedParticleInstanceCount: 0,
		unresolvedParticleBatchCount: 0,
		uploadedParticleRecordRowCount: 0,
		frameInstanceCapacity: 0,
		frameInstanceGrowthCount: 0,
		frameInstanceViewHighWaterMark: 0,
		droppedLights: 0,
		staticLightBinds: 0,
		terrainLightMaskUploads: 0,
		farTerrainDraws: 0,
		farTerrainPaletteUploads: 0,
		farTerrainCutoffLandblocks: null,
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
		this.#dynamicLightScratch = createDynamicLightScratch();
		this.#terrainLightMask = createWebGL2TerrainLightMaskTexture(gl);
		this.#objectState = new WebGL2ObjectStateApplicator(gl);
		this.#world = world;
		this.#nearTerrainProgram = createWebGL2NearTerrainProgram(gl);
		this.#farTerrainProgram = createWebGL2FarTerrainProgram(gl);
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
				compiledObjectDraws: this.#compiledDraws.getDiagnostics(),
				profile: this.#frameProfiler?.getProfile() ?? null,
				profilingEnabled: this.#frameProfiler !== null,
				selectionMetrics: {
					...this.#frameSelectionMetrics,
					ambientOcclusion: {
						...this.#frameSelectionMetrics.ambientOcclusion,
						effectiveDistanceFade: this.#frameSelectionMetrics.ambientOcclusion
							.effectiveDistanceFade
							? {
									...this.#frameSelectionMetrics.ambientOcclusion
										.effectiveDistanceFade,
								}
							: null,
					},
				},
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

	/**
	 * Drop compiled draw facts because a runtime event invalidated them.
	 *
	 * Implements the shared renderer contract: the events that move atlas placements or replace
	 * active-region detail are owned by the runtime and cannot be observed from inside a frame.
	 */
	invalidateResolvedResources(reason: ResolvedResourceInvalidation): void {
		this.#compiledDraws.flush(reason);
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

	#drawFrameContent(
		input: FrameInput,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		const setupStartedAt = profile?.beginCpuPhase();
		// Offsets are anchor-relative and rebuilt every frame, so last frame's memo would be a
		// stale value for the same landblock after the anchor moves.
		this.#lastDrawnLandblockId = null;
		this.#frameTextureFiltering = input.frameSettings.quality.textureFiltering;
		// Compiled facts embed the samplers filtering selects and the cull-face override the
		// env-cell mode selects, so a change to either invalidates every compiled entry. Both
		// arrive as frame settings, which is the only place the renderer can observe them change.
		if (this.#compiledTextureFiltering !== this.#frameTextureFiltering) {
			if (this.#compiledTextureFiltering !== null) {
				this.#compiledDraws.flush("texture-filtering");
			}
			this.#compiledTextureFiltering = this.#frameTextureFiltering;
		}
		if (
			this.#compiledEnvCellRenderMode !== input.frameSettings.envCellRenderMode
		) {
			if (this.#compiledEnvCellRenderMode !== null) {
				this.#compiledDraws.flush("env-cell-render-mode");
			}
			this.#compiledEnvCellRenderMode = input.frameSettings.envCellRenderMode;
		}
		this.#skyClockSeconds = input.timeSeconds;
		// Snapshotted here because the flat schedule never receives frame settings, and both
		// schedules reach presentation through the same shared helper.
		this.#frameColorGrade = input.frameSettings.colorGrade;
		const quality = input.frameSettings.quality;
		validateRenderScale(quality.renderScale, "Frame settings");
		this.#renderScale = quality.renderScale;
		// Cutoffs are authored in CSS pixels so a density change stays a sampling decision. The
		// conversion happens once here; the projection math downstream is drawing-buffer only.
		this.#minimumPortalFootprintDevicePixelArea = devicePixelArea(
			quality.minimumPortalFootprintCssPixelArea,
			this.#renderScale,
		);
		this.#minimumObjectFootprintDevicePixelArea = devicePixelArea(
			quality.minimumObjectFootprintCssPixelArea,
			this.#renderScale,
		);
		this.#resizeCanvasForRenderScale();
		this.#resetFrameSelectionMetrics(
			input.views.length,
			input.frameSettings.envCellRenderMode,
		);
		const fog = input.frameSettings.distanceFogEnabled
			? input.environment.distanceFog
			: null;
		// RETAIL DIVERGENCE: Retail draws before-landscape sky, opaque landblocks, then the
		// after-landscape weather overlay and deferred alpha work with no screen-space obscurance
		// stage (acclient.c:296701-296729, 297381-297434, 441096). This default-on
		// presentation adds near-field grounding before weather; removing it as a retail
		// "correction" loses that enabled visual benefit, while moving it later would incorrectly
		// attenuate weather/transparency. The retained DA55 portal census measured 102,140 opaque
		// committed tile pixels: 204 (0.2%) full/fading and 101,936 neutral after distance policy,
		// plus 819,696 clear pixels excluded from the denominator. The fixed 128-unit cutoff bounds the
		// divergence independently of authored time-of-day fog; minor overlap with fog is an accepted
		// first-version concession.
		const ambientOcclusion = resolveEffectiveAmbientOcclusionPolicy(
			input.frameSettings.ambientOcclusion,
			AMBIENT_OCCLUSION_DISTANCE_FADE,
		);
		if (ambientOcclusion.kind === "disabled") this.#saoPass?.disable();
		if (ambientOcclusion.kind === "enabled") {
			this.#ambientOcclusionDistanceFadeMetrics.disabledAt =
				ambientOcclusion.distanceFade.disabledAt;
			this.#ambientOcclusionDistanceFadeMetrics.fullStrengthUntil =
				ambientOcclusion.distanceFade.fullStrengthUntil;
			this.#frameSelectionMetrics.ambientOcclusion.effectiveDistanceFade =
				this.#ambientOcclusionDistanceFadeMetrics;
		} else {
			this.#frameSelectionMetrics.ambientOcclusion.effectiveDistanceFade = null;
		}
		// Dynamic lights are frame-global and reach every draw, so they are assembled once here
		// rather than per role. Positions stay in canonical scene space; the bind rebases them.
		const camera = input.views[0]?.camera.placement.position ?? null;
		const dynamicCandidates: RuntimeLight[] = [...input.dynamicLights];
		if (camera && input.frameSettings.viewerLightEnabled) {
			// Retail attaches the viewer light at the camera itself when no character carries it
			// (`SmartBox::set_viewer`, acclient.c:137890).
			dynamicCandidates.push({
				position: camera,
				color: VIEWER_LIGHT.color,
				range: VIEWER_LIGHT.range,
				intensity: VIEWER_LIGHT.intensity,
			});
		}
		const selectedDynamic = selectNearestLights(
			dynamicCandidates,
			camera ?? ORIGIN,
			MAX_DYNAMIC_LIGHTS,
		);
		this.#frameSelectionMetrics.droppedLights += selectedDynamic.dropped;
		const shading: SceneShading = {
			ambientOcclusion,
			fog,
			sky: input.environment.sky,
			weatherEnabled: input.frameSettings.weatherEnabled,
			anchorOrigin: createLandblockWorldOrigin(input.anchorLandblockId),
			authoredLightResponse: resolveAuthoredLightResponse(
				input.environment.lighting,
			),
			dynamicLights: selectedDynamic.lights,
			staticLights: (landblockId) =>
				this.#resolveStaticLights(input, landblockId, camera ?? ORIGIN),
			lighting: resolveSceneLightingByRole(
				input.environment.lighting,
				input.views.some((view) => view.cameraInsideSealedCell),
			),
		};
		this.#beginFrame(input.environment, shading);
		if (profile && setupStartedAt !== undefined) {
			profile.finishCpuPhase("setup", setupStartedAt);
		}
		if (input.frameSettings.envCellRenderMode === "flat") {
			for (const view of input.views) {
				const preparationStartedAt = profile?.beginCpuPhase();
				const geometry = this.#prepareViewGeometry(
					input.anchorLandblockId,
					view,
				);
				if (profile && preparationStartedAt !== undefined) {
					profile.finishCpuPhase("viewPreparation", preparationStartedAt);
				}
				const contributions = this.#collectScene(
					geometry,
					input.frameSettings,
					profile,
				);
				this.#drawFlatView(
					{ ...geometry, ...contributions },
					shading,
					"exterior",
					profile,
				);
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
				this.#drawPortalView(
					prepared,
					view,
					clearColor,
					shading,
					input.frameSettings,
					profile,
				);
			}
		}
		const finalizationStartedAt = profile?.beginCpuPhase();
		this.#updateRenderTargetMetrics();
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
		frameSettings: FrameSettings,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		const placement = viewInput.camera.placement;
		const rootScope = scopeFor(placement.landblockId, placement.envCellId);
		const pipeline = (this.#portalScopeAtlasPipeline ??=
			new WebGL2PortalScopeAtlasPipeline(this.#gl));
		const planningStartedAt = profile?.beginCpuPhase();
		const frame = pipeline.prepare(
			this.#world.getPortalTopologyView(),
			this.#createPortalScopeWindowCullInput(prepared, viewInput, rootScope),
			prepared.anchorCoordinates,
			prepared.clipFromAnchor,
			this.#frameWidth,
			this.#frameHeight,
		);
		if (profile && planningStartedAt !== undefined) {
			profile.finishCpuPhase("portalPlanning", planningStartedAt);
		}
		this.#accumulatePortalScopeAtlasMetrics(frame);
		this.#executePortalScopeAtlasFrame(
			prepared,
			frame,
			clearColor,
			shading,
			frameSettings,
			profile,
			pipeline,
		);
	}

	/** Aggregate one independent view's scope-atlas plan into the frame snapshot. */
	#accumulatePortalScopeAtlasMetrics(frame: WebGL2PortalScopeAtlasFrame): void {
		const atlas = frame.atlas;
		const visibility = atlas.visibility;
		const metrics = this.#frameSelectionMetrics;
		metrics.portalSelectedScopeCount += visibility.selectedScopeCount;
		metrics.portalSelectedCrossingCount += visibility.selectedCrossingCount;
		metrics.portalCompletedCullDepth += visibility.completedDepth;
		metrics.portalPropagationDrawCount +=
			atlas.commands.maskPropagationCommandCount;
		metrics.portalProjectionPrimitiveCount +=
			visibility.trace.projectionPrimitiveCount;
		metrics.portalAtlasTilePixelCount += atlas.trace.tilePixelCount;
		metrics.portalFrontierRetreatCount += atlas.trace.frontierRetreatCount;
		if (visibility.status === "truncated")
			metrics.portalTruncatedViewCount += 1;
	}

	/** Copy renderer-lifetime target ownership into the current diagnostics snapshot. */
	#updateRenderTargetMetrics(): void {
		const diagnostics =
			this.#portalScopeAtlasPipeline?.getDiagnostics() ?? null;
		this.#frameSelectionMetrics.portalFramebufferCount =
			diagnostics?.activeFramebufferCount ?? 0;
		this.#frameSelectionMetrics.portalTargetBytes =
			diagnostics?.activeBytes ?? 0;
		const flatTarget = this.#flatSceneTarget;
		this.#frameSelectionMetrics.flatSceneFramebufferCount =
			flatTarget?.activeFramebufferCount ?? 0;
		this.#frameSelectionMetrics.flatSceneTargetBytes =
			flatTarget?.activeBytes ?? 0;
		this.#frameSelectionMetrics.flatSceneAllocatedGenerationCount =
			flatTarget?.allocatedGenerationCount ?? 0;
		this.#frameSelectionMetrics.flatSceneDisposedGenerationCount =
			flatTarget?.disposedGenerationCount ?? 0;
		const saoPass = this.#saoPass;
		const ambientOcclusionMetrics =
			this.#frameSelectionMetrics.ambientOcclusion;
		ambientOcclusionMetrics.activeBytes = saoPass?.activeBytes ?? 0;
		ambientOcclusionMetrics.allocatedGenerationCount =
			saoPass?.allocatedGenerationCount ?? 0;
		ambientOcclusionMetrics.disposedGenerationCount =
			saoPass?.disposedGenerationCount ?? 0;
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
	): PortalExecutionProbeResult {
		this.#assertDeviceReady();
		this.#resizeCanvasForRenderScale();
		const prepared = this.#prepareViewGeometry(anchorLandblockId, viewInput);
		const pipeline = (this.#portalScopeAtlasPipeline ??=
			new WebGL2PortalScopeAtlasPipeline(this.#gl));
		const planningStartedAt = performance.now();
		const frame = pipeline.prepare(
			this.#world.getPortalTopologyView(),
			this.#createPortalScopeWindowCullInput(prepared, viewInput, rootScope),
			prepared.anchorCoordinates,
			prepared.clipFromAnchor,
			this.#frameWidth,
			this.#frameHeight,
		);
		const planningDurationMs = performance.now() - planningStartedAt;
		this.#resetFrameSelectionMetrics(1, "portal");
		this.#accumulatePortalScopeAtlasMetrics(frame);
		this.#executePortalScopeAtlasFrame(
			prepared,
			frame,
			[
				FRONTEND_TUNING.rendering.clearColor.red,
				FRONTEND_TUNING.rendering.clearColor.green,
				FRONTEND_TUNING.rendering.clearColor.blue,
				FRONTEND_TUNING.rendering.clearColor.alpha,
			],
			PROBE_SHADING,
			DEFAULT_FRAME_SETTINGS,
			null,
			pipeline,
		);
		this.#updateRenderTargetMetrics();
		this.#finishFrameSelectionMetrics();
		return {
			crossingCount: frame.atlas.visibility.selectedCrossingCount,
			objectSubmissionCount: frame.opaqueRouting.trace.objectSubmissionCount,
			planningDurationMs,
			scopeCount: frame.count,
			selectionMetrics: { ...this.#frameSelectionMetrics },
			targetBytes: this.#frameSelectionMetrics.portalTargetBytes,
			terrainSubmissionCount: frame.opaqueRouting.trace.terrainSubmissionCount,
			traversalDepth: frame.atlas.commands.traversalDepth,
		};
	}

	/**
	 * Execute one already-planned scope-atlas frame without reconstructing visibility or draw order.
	 *
	 * This is the single public compositor schedule shared by continuous rendering and its explicit
	 * probe. Keeping it unified prevents diagnostics from exercising a subtly different order.
	 */
	#executePortalScopeAtlasFrame(
		prepared: PreparedViewGeometry,
		frame: WebGL2PortalScopeAtlasFrame,
		clearColor: readonly [number, number, number, number],
		shading: SceneShading,
		frameSettings: FrameSettings,
		profile: WebGL2FrameProfileCapture | null,
		pipeline: WebGL2PortalScopeAtlasPipeline,
	): void {
		const queryStartedAt = profile?.beginCpuPhase();
		const visible = this.#world.queryScopeSelectionScene(
			prepared.frustum,
			prepared.anchorLandblockId,
			frame,
			renderCullingGroupFilter(frameSettings.layerVisibility),
		);
		if (profile && queryStartedAt !== undefined) {
			profile.finishCpuPhase("sceneQuery", queryStartedAt);
		}
		const contributions = this.#resolveSceneContributions(
			prepared,
			visible.entries,
			frameSettings,
			profile,
			frame.atlas.visibility,
		);
		const particlesByScope = this.#particleBatcher.route(
			`scope-atlas:${frame.atlas.visibility.topologyRevision}`,
			this.#particleSources,
			(owner) => {
				if (owner === SKY_PARTICLE_RENDER_OWNER) return "sky";
				const renderScopeKey =
					owner === EXTERIOR_PARTICLE_RENDER_OWNER
						? "outdoor"
						: this.#world.getRenderScopeKey(owner);
				if (renderScopeKey === null) return null;
				return frame.atlas.visibility.selectedScopeOrdinal(renderScopeKey) ===
					null
					? null
					: renderScopeKey;
			},
		);
		const gl = this.#gl;
		const target = this.#acquireFlatSceneTarget();
		const setupGpu = profile?.beginGpuPhase("portalComposition") ?? null;
		const setupStartedAt = profile?.beginCpuPhase();
		try {
			// Explicit rather than inherited from `#beginFrame`, because the harness probe seam
			// reaches this schedule without one.
			gl.clearColor(...clearColor);
			this.#beginFlatOpaqueScene(target);
			pipeline.beginOpaqueScene(clearColor);
		} finally {
			if (profile && setupStartedAt !== undefined) {
				profile.finishCpuPhase("portalComposition", setupStartedAt);
			}
			setupGpu?.finish();
		}
		const view = { ...prepared, ...contributions };
		const objectPhases = this.#createObjectSubmissionPhases(view, profile);
		const hasOutdoorScope =
			frame.atlas.visibility.selectedScopeOrdinal("outdoor") !== null;
		if (hasOutdoorScope) {
			this.#submitSkyPhase(view, shading, "before-world", profile, pipeline);
			const skyBatches = particlesByScope.get("sky");
			if (
				skyBatches &&
				skyBatches.length > 0 &&
				FRONTEND_TUNING.rendering.skyParticles.opacityScale > 0
			) {
				this.#drawParticleBatches(
					view,
					skyBatches,
					profile,
					this.#skyClockSeconds *
						FRONTEND_TUNING.rendering.skyParticles.speedMultiplier,
					FRONTEND_TUNING.rendering.skyParticles.opacityScale,
				);
			}
		}
		this.#submitTerrainPhase(view, shading, profile, pipeline);
		this.#submitOpaquePhase(
			view,
			objectPhases.opaque,
			shading,
			profile,
			pipeline,
		);
		if (shading.ambientOcclusion.kind === "enabled") {
			const ambientOcclusionGpu =
				profile?.beginGpuPhase("ambientOcclusion") ?? null;
			try {
				this.#getSaoPass().applyPortal(
					frame.targets.scene,
					frame.targets.extents.atlas,
					frame.targets.extents.drawingBuffer,
					frame.atlas,
					view.camera,
					view.projection,
					shading.ambientOcclusion,
				);
				pipeline.invalidateOpaqueTileState();
			} finally {
				ambientOcclusionGpu?.finish();
			}
		}
		if (hasOutdoorScope) {
			this.#submitSkyPhase(view, shading, "after-landscape", profile, pipeline);
		}
		const compositionGpu = profile?.beginGpuPhase("portalComposition") ?? null;
		const compositionStartedAt = profile?.beginCpuPhase();
		try {
			pipeline.execute(target.framebuffer);
			pipeline.beginDeferredScene(target.framebuffer);
		} finally {
			if (profile && compositionStartedAt !== undefined) {
				profile.finishCpuPhase("portalComposition", compositionStartedAt);
			}
			compositionGpu?.finish();
		}
		this.#submitBlendedPhase(view, objectPhases, shading, profile, pipeline);
		this.#drawScopedParticles(view, particlesByScope, pipeline, profile);
		this.#presentFlatScene(target, profile);
	}

	async destroy(): Promise<void> {
		this.#frameProfiler?.destroy();
		this.#frameProfiler = null;
		this.#textureSamplers.destroy();
		destroyWebGL2TerrainLightMaskTexture(this.#gl, this.#terrainLightMask);
		this.#portalScopeAtlasPipeline?.destroy();
		this.#portalScopeAtlasPipeline = null;
		this.#flatSceneTarget?.destroy();
		this.#flatSceneTarget = null;
		this.#flatScenePresentation?.destroy();
		this.#flatScenePresentation = null;
		this.#saoPass?.destroy();
		this.#saoPass = null;
		this.#skyPass?.destroy();
		this.#skyPass = null;
		if (this.#skyProgram) this.#gl.deleteProgram(this.#skyProgram.program);
		this.#skyProgram = null;
		if (this.#portalAtlasSkyProgram) {
			this.#gl.deleteProgram(this.#portalAtlasSkyProgram.program);
		}
		this.#portalAtlasSkyProgram = null;
		this.#gl.deleteProgram(this.#nearTerrainProgram.program);
		this.#gl.deleteProgram(this.#farTerrainProgram.program);
		this.#gl.deleteProgram(this.#objectProgram.program);
		this.#gl.deleteProgram(this.#instancedObjectProgram.program);
		this.#gl.deleteProgram(this.#blendedObjectProgram.program);
		this.#gl.deleteProgram(this.#blendedInstancedObjectProgram.program);
		if (this.#portalBlendedObjectProgram) {
			this.#gl.deleteProgram(this.#portalBlendedObjectProgram.program);
		}
		this.#portalBlendedObjectProgram = null;
		if (this.#portalBlendedInstancedObjectProgram) {
			this.#gl.deleteProgram(this.#portalBlendedInstancedObjectProgram.program);
		}
		this.#portalBlendedInstancedObjectProgram = null;
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

	#prepareViewGeometry(
		anchorLandblockId: FrameInput["anchorLandblockId"],
		input: FrameViewInput,
	): PreparedViewGeometry {
		const camera = input.camera;
		const anchorCoordinates = getLandblockCoordinates(anchorLandblockId);
		const cameraPosition = anchorRelativePosition(
			camera.placement.position,
			anchorLandblockId,
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
			camera,
			cameraPosition,
			clipFromAnchor,
			frustum: createFrustumFromClipMatrix(clipFromAnchor, cameraPosition),
			projection,
			view,
		};
	}

	#createPortalScopeWindowCullInput(
		prepared: PreparedViewGeometry,
		viewInput: FrameViewInput,
		rootScope: SceneScope,
	): PortalScopeWindowCullInput {
		const aspectRatio = this.#frameWidth / Math.max(1, this.#frameHeight);
		return {
			...prepared,
			nearClipVolume: createCameraNearClipVolume(
				viewInput.camera,
				// Anchor-relative, matching the view matrix this volume is compared against.
				{
					position: prepared.cameraPosition,
					rotation: viewInput.camera.placement.rotation,
				},
				aspectRatio,
			),
			portalFootprint: {
				drawingBuffer: {
					height: this.#frameHeight,
					width: this.#frameWidth,
				},
				minimumPixelArea: this.#minimumPortalFootprintDevicePixelArea,
			},
			rootScope,
		};
	}

	#collectScene(
		prepared: PreparedViewGeometry,
		frameSettings: FrameSettings,
		profile: WebGL2FrameProfileCapture | null,
	): PreparedSceneContributions {
		const queryStartedAt = profile?.beginCpuPhase();
		const visible = this.#world.queryFlatScene(
			prepared.frustum,
			prepared.anchorLandblockId,
			renderCullingGroupFilter(frameSettings.layerVisibility),
		);
		if (profile && queryStartedAt !== undefined) {
			profile.finishCpuPhase("sceneQuery", queryStartedAt);
		}
		const contributions = this.#resolveSceneContributions(
			prepared,
			visible.entries,
			frameSettings,
			profile,
			null,
		);
		const routed = this.#particleBatcher.route(
			FLAT_PARTICLE_DOMAIN,
			this.#particleSources,
			(owner) =>
				owner === SKY_PARTICLE_RENDER_OWNER
					? FLAT_SKY_PARTICLE_DOMAIN
					: FLAT_PARTICLE_DOMAIN,
		);
		return {
			...contributions,
			particles: routed.get(FLAT_PARTICLE_DOMAIN) ?? [],
			skyParticles: routed.get(FLAT_SKY_PARTICLE_DOMAIN) ?? [],
		};
	}

	/**
	 * Resolve already-selected scene identities without importing flat or portal topology policy.
	 *
	 * Callers must consume a SceneGraph query's reused entry buffer before issuing another query.
	 */
	#resolveSceneContributions(
		prepared: PreparedViewGeometry,
		visibleEntries: readonly SceneNodeId[],
		frameSettings: FrameSettings,
		profile: WebGL2FrameProfileCapture | null,
		portalVisibility: DynamicRenderDomainSelection | null,
	): PreparedSceneContributions {
		const resolutionStartedAt = profile?.beginCpuPhase();
		const terrain: TerrainFrameInput[] = [];
		const objects: PreparedObjectFrameInput[] = [];
		let staticObjectCount = 0;
		// One offset per visible landblock, not one per object: it is the same value for every
		// object in a landblock. Submissions carry only their landblock id, so a cached static
		// submission stays valid across re-anchoring and the frame never rewrites it.
		const landblockOffsets = new Map<string, LandblockRenderOffset>();
		const retainOffset = (landblockId: string): void => {
			if (landblockOffsets.has(landblockId)) return;
			const offset = createLandblockOffset(
				getLandblockCoordinates(landblockId),
				prepared.anchorCoordinates,
			);
			landblockOffsets.set(landblockId, [offset.x, offset.y, offset.z]);
		};
		this.#frameSelectionMetrics.visibleSceneEntries += visibleEntries.length;
		for (const nodeId of visibleEntries) {
			const contribution = this.#world.getRenderContributionDescriptor(nodeId);
			if (!contribution) continue;
			if (contribution.kind === "static-object") {
				if (!this.#retainsObjectFootprint(contribution.footprint, prepared)) {
					continue;
				}
				// A static publication has exactly one submission set; its culling group is fixed
				// for the renderable's lifetime and serves as the variant name.
				const compiled = this.#compiledDraws.resolveNodeSubmissions(
					contribution.renderable,
					contribution.cullingGroup,
					() => this.#compileStaticNodeSubmissions(nodeId, contribution),
				);
				this.#frameSelectionMetrics.visibleStaticNodeCount += 1;
				if (compiled.source === "env-cell-resident") {
					this.#frameSelectionMetrics.visibleEnvCellResidentNodes += 1;
				}
				this.#visibleStaticLayers.add(compiled.visibleLayerKey);
				if (compiled.envCellScopeKey !== null) {
					this.#visibleEnvCellScopes.add(compiled.envCellScopeKey);
				}
				retainOffset(compiled.landblockId);
				staticObjectCount += compiled.objects.length;
				for (const object of compiled.objects) objects.push(object);
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
					const {
						drawUnit,
						instance,
						landblockId,
						ordering,
						renderScopes,
						transparentSort,
					} = resolved.drawUnit;
					retainOffset(landblockId);
					const compiled = this.#compiledDraws.resolveDraw(
						drawUnit,
						ordering,
						() =>
							this.#compileObjectDraw({
								cullFaceOverride: null,
								geometry: resolved.geometry,
								indexCount: drawUnit.indexCount,
								indexStart: drawUnit.indexStart,
								material: drawUnit.material,
								ordering,
							}),
					);
					const renderScopeKeys = selectedDynamicRenderScopeKeys(
						renderScopes,
						portalVisibility,
					);
					for (const renderScopeKey of renderScopeKeys) {
						objects.push(
							createObjectSubmission(
								{
									cullFaceOverride: null,
									drawKind: "instanced",
									geometry: resolved.geometry,
									indexCount: drawUnit.indexCount,
									indexStart: drawUnit.indexStart,
									instances: {
										cohortKey: `${landblockId}/${renderScopeKey}/${drawUnit.batchKey}`,
										instance,
										kind: "frame-template",
									},
									landblockId,
									localToLandblock: instance.sourceToLandblock,
									material: drawUnit.material,
									ordering,
									renderScopeKey,
									source: "dynamic",
									transparentSort,
								},
								compiled,
							),
						);
					}
				}
				continue;
			}
			if (contribution.kind === "env-cell") {
				this.#frameSelectionMetrics.visibleEnvCellShells += 1;
				const compiled = this.#compiledDraws.resolveNodeSubmissions(
					contribution.renderable,
					frameSettings.envCellRenderMode,
					() =>
						this.#compileShellNodeSubmissions(
							nodeId,
							contribution,
							frameSettings.envCellRenderMode,
						),
				);
				if (compiled.envCellScopeKey !== null) {
					this.#visibleEnvCellScopes.add(compiled.envCellScopeKey);
				}
				this.#visibleStaticLayers.add(compiled.visibleLayerKey);
				retainOffset(compiled.landblockId);
				staticObjectCount += compiled.objects.length;
				for (const object of compiled.objects) objects.push(object);
				continue;
			}
			terrain.push(this.#resolveTerrainFrameInput(contribution.drawUnit));
			this.#frameSelectionMetrics.terrainFrameInputs += 1;
		}
		if (profile && resolutionStartedAt !== undefined) {
			profile.finishCpuPhase(
				"sceneContributionResolution",
				resolutionStartedAt,
			);
		}
		if (profile) {
			profile.recordObjectPreparation(
				staticObjectCount,
				objects.length - staticObjectCount,
			);
		}
		return {
			landblockOffsets,
			objects,
			particles: [],
			skyParticles: [],
			terrain,
		};
	}

	#retainsObjectFootprint(
		footprint: ObjectPresentationFootprint,
		prepared: PreparedViewGeometry,
	): boolean {
		if (footprint.kind === "ineligible")
			return retainsProjectedObjectFootprint(
				null,
				this.#minimumObjectFootprintDevicePixelArea,
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
			this.#minimumObjectFootprintDevicePixelArea,
		);
		if (this.#minimumObjectFootprintDevicePixelArea > 0) {
			this.#frameSelectionMetrics.testedObjectPresentationCount += 1;
			if (retained)
				this.#frameSelectionMetrics.retainedObjectPresentationCount += 1;
			else this.#frameSelectionMetrics.rejectedObjectPresentationCount += 1;
		}
		return retained;
	}

	/**
	 * Resolve one landblock's terrain program once, against the draw unit that owns it.
	 *
	 * Terrain draw units are built when their landblock realizes and live until it is removed, and
	 * every resource they name is immutable for its key: texture arrays are created once per key
	 * and generated surfaces once per source. There is therefore no invalidation event to ride —
	 * an entry simply becomes collectable with the installation that produced its draw unit.
	 */
	#resolveTerrainFrameInput(drawUnit: TerrainDrawUnit): TerrainFrameInput {
		const existing = this.#terrainFrameInputs.get(drawUnit);
		if (existing !== undefined) return existing;
		const resolved: TerrainFrameInput = {
			drawUnit,
			program: {
				geometry: this.#world.resolveGeometry(drawUnit.geometry),
				composition: this.#world.resolveTexture2D(drawUnit.composition),
				surfaceField: this.#world.resolveTexture2D(drawUnit.surfaceField),
				textures: {
					blendMasks: this.#world.resolveTextureArray(
						drawUnit.textures.blendMasks,
					),
					colors: this.#world.resolveTerrainColorTextureArray(
						drawUnit.textures.colors,
					),
					detail: this.#world.resolveTexture2D(drawUnit.textures.detail),
					roadMasks: this.#world.resolveTextureArray(
						drawUnit.textures.roadMasks,
					),
				},
			},
		};
		this.#terrainFrameInputs.set(drawUnit, resolved);
		return resolved;
	}

	/**
	 * Build one shell publication's submission set for one env-cell render mode, once per mode.
	 *
	 * Like static publications, shell submissions hold nothing frame-variant; the render mode is
	 * part of the cache variant because it selects the cull-face override.
	 */
	#compileShellNodeSubmissions(
		nodeId: SceneNodeId,
		contribution: Extract<RenderContribution, { kind: "env-cell" }>,
		envCellRenderMode: FrameSettings["envCellRenderMode"],
	): CompiledStaticNodeSubmissions {
		const objects: PreparedObjectFrameInput[] = [];

		const node = this.#world.resolveEnvCellNode(
			nodeId,
			contribution.renderable,
		);
		if (node.placement.scope.kind !== "env-cell") {
			throw new Error(`EnvCell shell ${nodeId} has outdoor residency.`);
		}
		const scope = node.placement.scope;
		for (const resolved of node.drawUnits) {
			objects.push(
				this.#compileStaticSubmission(resolved.drawUnit, {
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
					renderScopeKey: scopeKey(scope),
					source: "env-cell-shell",
					transparentSort: resolved.drawUnit.transparentSort,
				}),
			);
		}
		const envCellScopeKey = `${scope.landblockId}/${scope.envCellId}`;
		return {
			envCellScopeKey,
			landblockId: node.placement.landblockId,
			objects,
			source: "env-cell-shell",
			visibleLayerKey: `${envCellScopeKey}/env-cell-shell`,
		};
	}

	/**
	 * Build one static publication's complete submission set, once for its lifetime.
	 *
	 * Static submissions hold nothing that varies between frames: placement, geometry, material,
	 * ordering and sort facts are all fixed when the publication commits, and the one
	 * anchor-relative fact is looked up per frame from the landblock offsets instead of stored
	 * here. A visible node therefore costs one cache lookup and an array append per frame.
	 */
	#compileStaticNodeSubmissions(
		nodeId: SceneNodeId,
		contribution: Extract<RenderContribution, { kind: "static-object" }>,
	): CompiledStaticNodeSubmissions {
		const objects: PreparedObjectFrameInput[] = [];
		const source =
			contribution.cullingGroup === "env-cell-static-residents"
				? "env-cell-resident"
				: contribution.cullingGroup === LandblockLayerKind.Generated
					? "generated"
					: "outdoor";
		const node = this.#world.resolveStaticObjectNode(
			nodeId,
			contribution.renderable,
			contribution.footprint,
		);
		const scope = node.placement.scope;
		const renderScopeKey = scopeKey(scope);
		for (const resolved of node.drawUnits) {
			const { drawUnit } = resolved;
			objects.push(
				this.#compileStaticSubmission(drawUnit, {
					cullFaceOverride: null,
					drawKind: "baked",
					geometry: resolved.geometry,
					indexCount: drawUnit.indexCount,
					indexStart: drawUnit.indexStart,
					instances: null,
					landblockId: node.placement.landblockId,
					localToLandblock: node.placement.localToLandblock,
					material: drawUnit.material,
					ordering: drawUnit.ordering,
					renderScopeKey,
					source,
					transparentSort: drawUnit.transparentSort,
				}),
			);
		}
		for (const resolved of node.frameStreamedInstances) {
			const { template } = resolved;
			objects.push(
				this.#compileStaticSubmission(template, {
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
					renderScopeKey,
					source,
					transparentSort: template.transparentSort,
				}),
			);
		}
		return {
			envCellScopeKey:
				scope.kind === "env-cell"
					? `${scope.landblockId}/${scope.envCellId}`
					: null,
			landblockId: node.placement.landblockId,
			objects,
			source,
			visibleLayerKey:
				scope.kind === "outdoor"
					? `outdoor/${contribution.cullingGroup}`
					: `${scope.landblockId}/${scope.envCellId}/${contribution.cullingGroup}`,
		};
	}

	/** Pair one static contribution with its compiled draw facts, both retained for its lifetime. */
	#compileStaticSubmission(
		key: object,
		object: ObjectFrameInput,
	): PreparedObjectFrameInput {
		const compiled = this.#compiledDraws.resolveDraw(key, object.ordering, () =>
			this.#compileObjectDraw(object),
		);
		return createObjectSubmission(object, compiled);
	}

	/**
	 * Compile every draw-consumed constant for one draw unit, once for its whole lifetime.
	 *
	 * Nothing resolved here varies with the camera or the anchor, so the result is cached against
	 * the draw unit that owns it and shared by every later frame. The anchor-relative offset is
	 * assembled per frame by the caller instead.
	 */
	#compileObjectDraw(
		object: CompiledObjectDrawInput,
	): CompiledObjectDraw<PreparedObjectDrawCompatibility> {
		const geometry = this.#resources.getGeometry(object.geometry);
		validateDrawRange(geometry, object.indexStart, object.indexCount);
		const { material } = object;
		const opacity = sourceOpacity(material.source.translucency);
		// RETAIL DIVERGENCE: Authored CSurface.diffuse (e.g. 0.2734 on 0x080006E4, the celtic knot
		// entrance plaque on building 0x01000F69) is a legacy of the 1999 software rasterizer.
		// Retail's Direct3D pipeline (acclient.c:437169 SetCurrentMaterial) renders static objects with
		// default white material diffuse (1.0, 1.0, 1.0, 1.0) and never modulates textured or solid
		// surfaces by CSurface.diffuse. Multiplying by it artificially darkens authored surfaces.
		let preparedMaterial: PreparedObjectMaterial<WebGLTexture, WebGLSampler>;
		if (material.source.kind === "solid-color") {
			const [red, green, blue, alpha] = material.source.color;
			preparedMaterial = {
				color: [red, green, blue, alpha * opacity],
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
			const color = [1.0, 1.0, 1.0, opacity] as const;
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
		metrics.ambientOcclusion.activeBytes = 0;
		metrics.ambientOcclusion.allocatedGenerationCount = 0;
		metrics.ambientOcclusion.disposedGenerationCount = 0;
		metrics.ambientOcclusion.effectiveDistanceFade = null;
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
		metrics.portalSelectedScopeCount = 0;
		metrics.portalSelectedCrossingCount = 0;
		metrics.portalCompletedCullDepth = 0;
		metrics.portalPropagationDrawCount = 0;
		metrics.portalProjectionPrimitiveCount = 0;
		metrics.portalAtlasTilePixelCount = 0;
		metrics.portalFrontierRetreatCount = 0;
		metrics.portalTruncatedViewCount = 0;
		metrics.portalFramebufferCount = 0;
		metrics.portalTargetBytes = 0;
		metrics.flatSceneFramebufferCount = 0;
		metrics.flatSceneTargetBytes = 0;
		metrics.flatSceneAllocatedGenerationCount = 0;
		metrics.flatSceneDisposedGenerationCount = 0;
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
		metrics.submittedParticleBatchCount = 0;
		metrics.submittedParticleInstanceCount = 0;
		metrics.unresolvedParticleBatchCount = 0;
		metrics.uploadedParticleRecordRowCount = 0;
		metrics.frameInstanceCapacity = 0;
		metrics.frameInstanceGrowthCount = 0;
		metrics.frameInstanceViewHighWaterMark = 0;
		metrics.droppedLights = 0;
		metrics.staticLightBinds = 0;
		metrics.terrainLightMaskUploads = 0;
		metrics.farTerrainDraws = 0;
		metrics.farTerrainPaletteUploads = 0;
		metrics.farTerrainCutoffLandblocks = null;
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

	/**
	 * Region-scoped celestial sky residency.
	 *
	 * Installed once per region load; the resource set is fixed for that region's lifetime, so
	 * there is no incremental path and no per-frame residency work.
	 */
	/**
	 * Authored particle residency and per-frame source submission.
	 *
	 * Meshes accumulate across batches rather than being replaced, because one script closure names
	 * a few emitters and different residents keep naming the same meshes.
	 */
	readonly particles: RendererParticleCapability = {
		clear: () => {
			this.#particleResidency?.destroy();
			this.#particleResidency = null;
			this.#particlePass?.destroy();
			this.#particlePass = null;
			this.#particleSources = [];
			this.#particleRecords = EMPTY_PARTICLE_RECORDS;
			this.#particleBatcher.clear();
		},
		install: async (source, preparer) => {
			const residency = (this.#particleResidency ??= new ParticleMeshResidency(
				this.#resources,
			));
			await residency.install(source, preparer);
			// Linked on first residency rather than at construction: a scene with no authored
			// particles never pays for a program it cannot draw with.
			this.#particlePass ??= new WebGL2ParticlePass(
				(hwGfxObjId) => this.#particleResidency?.resolve(hwGfxObjId) ?? null,
			);
		},
		submit: (sources, records) => {
			this.#particleSources = sources;
			this.#particleRecords = records;
		},
	};

	readonly sky: RendererSkyCapability = {
		clear: () => {
			this.#skyPass?.destroy();
			this.#skyPass = null;
		},
		install: async (source, preparer) => {
			const pass = await WebGL2SkyPass.prepare(
				this.#resources,
				preparer,
				source,
			);
			this.#skyPass?.destroy();
			this.#skyPass = pass;
			// Linked on first use rather than at construction: a region without authored sky
			// objects never pays for a program it cannot draw with.
			this.#skyProgram ??= createWebGL2SkyProgram(this.#gl);
		},
	};

	/**
	 * Draw one of the sky's two passes.
	 *
	 * The before pass runs into an untouched depth buffer with depth-always and depth writes off, so
	 * the world pass that follows simply paints over it wherever geometry exists. That ordering is
	 * why the sky needs no visibility test of its own, indoors or out.
	 *
	 * The after pass carries the authored weather that retail draws once the landscape is down
	 * (`LScape::draw`, acclient.c:296725), under the same depth-always state — which is what keeps
	 * terrain from occluding rain. It is gated outdoors here rather than inside the pass, because
	 * whether the viewer is outside is a property of the view, not of the sky.
	 */
	#drawSky(
		view: PreparedView,
		shading: SceneShading,
		skyPass: SkyDrawPass,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		const pass = this.#skyPass;
		const sky = shading.sky;
		if (!pass || !sky || !this.#skyProgram) return;
		// `SmartBox::is_player_outside` (acclient.c:137135) tests only that the viewer's cell is a
		// landcell rather than an EnvCell. Deliberately not our sealed-cell test: retail suppresses
		// the after pass from inside any EnvCell, including one that can see outdoors.
		if (
			skyPass === "after-landscape" &&
			view.camera.placement.envCellId !== null
		) {
			return;
		}
		const program = portalPipeline
			? (this.#portalAtlasSkyProgram ??= createWebGL2SkyProgram(this.#gl, {
					portalAtlas: true,
				}))
			: this.#skyProgram;
		// Program selection lives here because atlas routing writes a uniform owned by that variant.
		// Uploading the tile before binding its program is INVALID_OPERATION and leaves the transform
		// zeroed, collapsing every sky vertex without making the subsequent draw itself fail.
		this.#gl.useProgram(program.program);
		if (portalPipeline) {
			const clipTransform = program.clipTransformUniform;
			if (!clipTransform) {
				throw new Error(
					"Portal sky draw selected a program without an atlas transform.",
				);
			}
			portalPipeline.routeOutdoorOpaqueSubmission(clipTransform);
		}
		pass.draw(
			{
				clockSeconds: this.#skyClockSeconds,
				gl: this.#gl,
				matrixScratch: this.#skyMatrixScratch,
				program,
				// The frame anchor translates horizontally only, so this render-frame height is
				// already the absolute AC height the authored weather clamp is expressed in.
				viewerHeight: view.cameraPosition.y,
				weatherEnabled: shading.weatherEnabled,
				// Retail rebuilds the projection with `zfar * 4` for the pass and restores it after
				// (`GameSky::Draw`, acclient.c:297399); the world pass never sees this matrix.
				projection: mat4ToFloat32Array(
					createPerspectiveMat4(
						view.camera.fov,
						this.#frameWidth / Math.max(1, this.#frameHeight),
						view.camera.near,
						SKY_FAR_PLANE,
					),
					this.#skyProjectionScratch,
				),
				samplers: this.#textureSamplers,
				textureFiltering: this.#frameTextureFiltering,
				view: skyViewMatrix(view.view, this.#skyViewScratch),
			},
			sky,
			skyPass,
		);
	}

	#createParticleDrawContext(
		view: PreparedView,
		clockSeconds: number,
		opacityScale: number,
	): ParticleDrawContext {
		// The view names its own anchor landblock, so the origin records re-anchor against comes
		// from the same place the view transform did.
		const anchor = createLandblockWorldOrigin(view.anchorLandblockId);
		return {
			anchorOrigin: [anchor.x, anchor.y, anchor.z],
			records: this.#particleRecords,
			cameraPosition: [
				view.cameraPosition.x,
				view.cameraPosition.y,
				view.cameraPosition.z,
			],
			clockSeconds,
			gl: this.#gl,
			opacityScale,
			projection: mat4ToFloat32Array(
				view.projection,
				this.#particleProjectionScratch,
			),
			samplers: this.#textureSamplers,
			textureFiltering: this.#frameTextureFiltering,
			view: mat4ToFloat32Array(view.view, this.#particleViewScratch),
		};
	}

	#executeParticlePass(
		profile: WebGL2FrameProfileCapture | null,
		execute: (pass: WebGL2ParticlePass) => void,
	): void {
		const pass = this.#particlePass;
		if (!pass) return;
		const gpuPhase = profile?.beginGpuPhase("particle") ?? null;
		const startedAt = profile?.beginCpuPhase();
		try {
			execute(pass);
			const diagnostics = pass.getDiagnostics();
			this.#frameSelectionMetrics.submittedParticleBatchCount +=
				diagnostics.drawnBatchCount;
			this.#frameSelectionMetrics.submittedParticleInstanceCount +=
				diagnostics.drawnParticleCount;
			this.#frameSelectionMetrics.unresolvedParticleBatchCount +=
				diagnostics.unresolvedBatchCount;
			this.#frameSelectionMetrics.uploadedParticleRecordRowCount +=
				diagnostics.uploadedRecordRowCount;
		} finally {
			if (startedAt !== undefined) {
				profile?.finishCpuPhase("particleSubmission", startedAt);
			}
			gpuPhase?.finish();
		}
	}

	#drawParticleBatches(
		view: PreparedView,
		batches: readonly ParticleDrawRange[],
		profile: WebGL2FrameProfileCapture | null,
		clockSeconds: number,
		opacityScale: number,
	): void {
		if (batches.length === 0 || opacityScale <= 0) return;
		this.#executeParticlePass(profile, (pass) => {
			const context = this.#createParticleDrawContext(
				view,
				clockSeconds,
				opacityScale,
			);
			pass.draw(context, batches);
		});
	}

	#drawScopedParticles(
		view: PreparedView,
		particlesByScope: ReadonlyMap<string, readonly ParticleDrawRange[]>,
		portalPipeline: WebGL2PortalScopeAtlasPipeline,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		this.#executeParticlePass(profile, (pass) => {
			const context = this.#createParticleDrawContext(
				view,
				this.#skyClockSeconds,
				1.0,
			);
			pass.drawScoped(context, particlesByScope, portalPipeline);
		});
	}

	/** Draw one flat view through the single nullable-profile physical schedule. */
	#drawFlatView(
		view: PreparedView,
		shading: SceneShading,
		domain: SceneRenderDomain,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		const target = this.#acquireFlatSceneTarget();
		this.#beginFlatOpaqueScene(target);
		const objectPhases = this.#createObjectSubmissionPhases(view, profile);
		if (domain === "exterior") {
			this.#submitSkyPhase(view, shading, "before-world", profile, null);
			if (
				view.skyParticles.length > 0 &&
				FRONTEND_TUNING.rendering.skyParticles.opacityScale > 0
			) {
				this.#drawParticleBatches(
					view,
					view.skyParticles,
					profile,
					this.#skyClockSeconds *
						FRONTEND_TUNING.rendering.skyParticles.speedMultiplier,
					FRONTEND_TUNING.rendering.skyParticles.opacityScale,
				);
			}
		}
		this.#submitTerrainPhase(view, shading, profile, null);
		this.#submitOpaquePhase(view, objectPhases.opaque, shading, profile, null);
		if (shading.ambientOcclusion.kind === "enabled") {
			const ambientOcclusionGpu =
				profile?.beginGpuPhase("ambientOcclusion") ?? null;
			try {
				this.#getSaoPass().applyFlat(
					target,
					view.camera,
					view.projection,
					shading.ambientOcclusion,
				);
			} finally {
				ambientOcclusionGpu?.finish();
			}
		}
		// Retail's after-landscape weather: drawn once the landblock loop is down but before the
		// deferred translucent flush, which is legitimately allowed to cover it (acclient.c:296725,
		// 441068).
		if (domain === "exterior") {
			this.#submitSkyPhase(view, shading, "after-landscape", profile, null);
		}
		this.#submitBlendedPhase(view, objectPhases, shading, profile, null);
		// After the blended pass: particles are transparent and must not occlude the geometry they
		// sort against.
		this.#drawParticleBatches(
			view,
			view.particles,
			profile,
			this.#skyClockSeconds,
			1.0,
		);
		this.#gl.bindVertexArray(null);
		this.#presentFlatScene(target, profile);
	}

	/**
	 * Reuse this frame's scene target, allocating it on the first frame that needs one.
	 *
	 * Both schedules render into the same target: the flat one because it always has, and the
	 * portal one because its composite must land somewhere samplable before presentation grades
	 * it. The default framebuffer cannot be sampled, so an offscreen target is what makes a
	 * whole-frame transform possible at all.
	 */
	#acquireFlatSceneTarget(): WebGL2FlatSceneTargetSet {
		const owner = (this.#flatSceneTarget ??= new WebGL2FlatSceneTarget(
			this.#gl,
		));
		return owner.resizeDimensions(this.#frameWidth, this.#frameHeight);
	}

	/**
	 * Write one finished scene target to the default framebuffer.
	 *
	 * Both physical schedules end here, and this is the frame's only default-framebuffer write.
	 * That is a deliberate invariant rather than an incidental one: it is what lets a whole-frame
	 * presentation transform see every fragment — opaque, portal-composited, blended, and
	 * particle — exactly once. Anything drawn after this call would escape that transform.
	 */
	#presentFlatScene(
		target: WebGL2FlatSceneTargetSet,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		const presentationGpu = profile?.beginGpuPhase("presentation") ?? null;
		try {
			(this.#flatScenePresentation ??= new WebGL2FlatScenePresentation(
				this.#gl,
			)).present(target, this.#frameColorGrade);
		} finally {
			presentationGpu?.finish();
		}
		// Presentation changes program and texture bindings outside the object-state mirror.
		this.#beginObjectPhase();
	}

	/** Bind and clear one complete flat-scene target before any world submission. */
	#beginFlatOpaqueScene(target: WebGL2FlatSceneTargetSet): void {
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
		gl.viewport(0, 0, target.extent.width, target.extent.height);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	}

	#getSaoPass(): WebGL2SaoPass {
		if (this.#saoPass) return this.#saoPass;
		const pass = new WebGL2SaoPass(this.#gl);
		pass.setCoverageVisualizationEnabled(this.#saoCoverageVisualizationEnabled);
		this.#saoPass = pass;
		return pass;
	}

	/** Submit one sky pass while preserving the caller's portal routing and optional GPU span. */
	#submitSkyPhase(
		view: PreparedView,
		shading: SceneShading,
		phase: "before-world" | "after-landscape",
		profile: WebGL2FrameProfileCapture | null,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		const gpu = profile?.beginGpuPhase("sky") ?? null;
		try {
			this.#drawSky(view, shading, phase, portalPipeline);
		} finally {
			gpu?.finish();
		}
	}

	/** Submit terrain through shared flat/portal profiling ownership. */
	#submitTerrainPhase(
		view: PreparedView,
		shading: SceneShading,
		profile: WebGL2FrameProfileCapture | null,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		const startedAt = profile?.beginCpuPhase();
		try {
			this.#drawTerrain(view, shading, profile, portalPipeline);
		} finally {
			if (profile && startedAt !== undefined) {
				profile.finishCpuPhase("terrainSubmission", startedAt);
			}
		}
	}

	/** Submit physical opaque batches once through shared flat/portal GPU attribution. */
	#submitOpaquePhase(
		view: PreparedView,
		opaque: ObjectSubmissionPhases<PreparedObjectFrameInput>["opaque"],
		shading: SceneShading,
		profile: WebGL2FrameProfileCapture | null,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		const gpu = profile?.beginGpuPhase("opaque") ?? null;
		try {
			this.#drawOpaqueObjects(view, opaque, shading, profile, portalPipeline);
		} finally {
			gpu?.finish();
		}
	}

	/** Submit deferred objects through shared flat/portal GPU attribution. */
	#submitBlendedPhase(
		view: PreparedView,
		phases: ObjectSubmissionPhases<PreparedObjectFrameInput>,
		shading: SceneShading,
		profile: WebGL2FrameProfileCapture | null,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		const gpu = profile?.beginGpuPhase("blended") ?? null;
		try {
			this.#drawBlendedObjects(view, phases, shading, profile, portalPipeline);
		} finally {
			gpu?.finish();
		}
	}

	#drawTerrain(
		view: PreparedView,
		shading: SceneShading,
		profile: WebGL2FrameProfileCapture | null,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		const [passResources] = view.terrain;
		if (!passResources) {
			portalPipeline?.routeTerrainPass(
				0,
				this.#nearTerrainProgram.uniforms.clipTransform,
			);
			return;
		}
		const farCutoff = farTerrainCutoffLandblocks(shading.fog);
		this.#frameSelectionMetrics.farTerrainCutoffLandblocks = farCutoff;
		let nearCount = 0;
		let farCount = 0;
		for (const terrain of view.terrain) {
			assertSharedTerrainRegion(
				passResources.program,
				terrain.program,
				terrain.drawUnit.landblockId,
			);
			if (this.#isFarTerrain(terrain, view, farCutoff)) farCount += 1;
			else nearCount += 1;
		}
		const gl = this.#gl;
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.enable(gl.POLYGON_OFFSET_FILL);
		gl.polygonOffset(TERRAIN_DEPTH_OFFSET.factor, TERRAIN_DEPTH_OFFSET.units);
		let routedTerrainPass = false;
		if (nearCount > 0) {
			const gpu = profile?.beginGpuPhase("nearTerrain") ?? null;
			try {
				this.#beginNearTerrainGroup(
					view,
					shading,
					passResources,
					portalPipeline,
					view.terrain.length,
				);
				routedTerrainPass = true;
				this.#drawNearTerrainGroup(view, shading, farCutoff);
			} finally {
				gpu?.finish();
			}
		}
		if (farCount > 0) {
			const gpu = profile?.beginGpuPhase("farTerrain") ?? null;
			try {
				this.#beginFarTerrainGroup(
					view,
					shading,
					passResources,
					portalPipeline,
					routedTerrainPass ? null : view.terrain.length,
				);
				this.#drawFarTerrainGroup(view, farCutoff);
			} finally {
				gpu?.finish();
			}
		}
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.POLYGON_OFFSET_FILL);
	}

	#beginTerrainGroup(
		view: PreparedView,
		shading: SceneShading,
		program: WebGLProgram,
		uniforms: TerrainGroupUniforms,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
		routeSubmissionCount: number | null,
	): void {
		const gl = this.#gl;
		gl.useProgram(program);
		gl.uniform4f(uniforms.clipTransform, 1, 1, 0, 0);
		if (portalPipeline) {
			if (routeSubmissionCount === null) {
				portalPipeline.routeOutdoorOpaqueSubmission(uniforms.clipTransform);
			} else {
				portalPipeline.routeTerrainPass(
					routeSubmissionCount,
					uniforms.clipTransform,
				);
			}
		}
		gl.uniformMatrix4fv(
			uniforms.projection,
			false,
			mat4ToFloat32Array(view.projection, this.#matrixScratch),
		);
		gl.uniform3f(
			uniforms.cameraPosition,
			view.cameraPosition.x,
			view.cameraPosition.y,
			view.cameraPosition.z,
		);
		gl.uniformMatrix4fv(
			uniforms.view,
			false,
			mat4ToFloat32Array(view.view, this.#matrixScratch),
		);
		gl.uniformMatrix4fv(
			uniforms.localToLandblock,
			false,
			mat4ToFloat32Array(WebGL2Renderer.#identityMatrix),
		);
		bindWebGL2DistanceFog(gl, uniforms, shading.fog);
		bindWebGL2SceneLighting(gl, uniforms, shading.lighting.terrain);
	}

	#beginNearTerrainGroup(
		view: PreparedView,
		shading: SceneShading,
		passResources: TerrainFrameInput,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
		routeSubmissionCount: number,
	): void {
		const { program, uniforms } = this.#nearTerrainProgram;
		this.#beginTerrainGroup(
			view,
			shading,
			program,
			uniforms,
			portalPipeline,
			routeSubmissionCount,
		);
		const gl = this.#gl;
		gl.uniform1f(
			uniforms.detailFadeNear,
			FRONTEND_TUNING.rendering.terrainDetailFade.near,
		);
		gl.uniform1f(
			uniforms.detailFadeFar,
			FRONTEND_TUNING.rendering.terrainDetailFade.far,
		);
		bindWebGL2DynamicLights(
			gl,
			uniforms,
			shading.dynamicLights,
			shading.anchorOrigin,
			this.#dynamicLightScratch,
		);
		this.#beginTerrainLightMasks();
		this.#beginTerrainPassResources(passResources);
	}

	#beginFarTerrainGroup(
		view: PreparedView,
		shading: SceneShading,
		passResources: TerrainFrameInput,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
		routeSubmissionCount: number | null,
	): void {
		const { program, uniforms } = this.#farTerrainProgram;
		this.#beginTerrainGroup(
			view,
			shading,
			program,
			uniforms,
			portalPipeline,
			routeSubmissionCount,
		);
		this.#gl.uniform3fv(
			uniforms.palette,
			passResources.program.textures.colors.palette.colors,
		);
		this.#frameSelectionMetrics.farTerrainPaletteUploads += 1;
	}

	#drawNearTerrainGroup(
		view: PreparedView,
		shading: SceneShading,
		farCutoff: number | null,
	): void {
		for (const terrain of view.terrain) {
			if (this.#isFarTerrain(terrain, view, farCutoff)) continue;
			const landblockOffset = createLandblockOffset(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
				this.#offsetScratch,
			);
			this.#bindTerrainSurfaceField(terrain);
			const landblockLights = shading.staticLights(
				terrain.drawUnit.landblockId,
			);
			bindWebGL2StaticLights(
				this.#gl,
				this.#nearTerrainProgram.uniforms,
				landblockLights.lights,
				shading.anchorOrigin,
				shading.authoredLightResponse,
				this.#dynamicLightScratch,
			);
			this.#uploadTerrainLightMask(landblockLights);
			this.#frameSelectionMetrics.staticLightBinds += 1;
			this.#drawTerrainGeometry(
				terrain.program.geometry,
				this.#nearTerrainProgram.uniforms.landblockOffset,
				landblockOffset,
			);
		}
	}

	#drawFarTerrainGroup(view: PreparedView, farCutoff: number | null): void {
		for (const terrain of view.terrain) {
			if (!this.#isFarTerrain(terrain, view, farCutoff)) continue;
			const landblockOffset = createLandblockOffset(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
				this.#offsetScratch,
			);
			this.#drawTerrainGeometry(
				terrain.program.geometry,
				this.#farTerrainProgram.uniforms.landblockOffset,
				landblockOffset,
			);
			this.#frameSelectionMetrics.farTerrainDraws += 1;
		}
	}

	#isFarTerrain(
		terrain: TerrainFrameInput,
		view: PreparedView,
		farCutoff: number | null,
	): boolean {
		return (
			farCutoff !== null &&
			landblockChebyshevDistance(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
			) >= farCutoff
		);
	}

	/**
	 * Bind every region-constant terrain texture once for the whole pass.
	 *
	 * `composition`, `colors`, `blendMasks`, `roadMasks`, and `detail` are all keyed on
	 * `activeRegionKey`, which takes no landblock input, and exactly one `ActiveRegionSource` is
	 * live per content source. They are therefore identical for every landblock in the pass, and
	 * rebinding them per landblock was pure waste. `assertSharedTerrainRegion` keeps that true.
	 *
	 * Bound per pass rather than once at program build because other passes own these texture
	 * units between terrain passes.
	 */
	#beginTerrainPassResources(input: TerrainFrameInput): void {
		const { textures } = input.program;
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
			1,
			composition,
			this.#nearTerrainProgram.uniforms.composition,
			"exact",
			TextureWrapMode.Clamp,
		);
		this.#bindTextureArray(
			2,
			colors,
			this.#nearTerrainProgram.uniforms.colors,
			"filterable",
			TextureWrapMode.Repeat,
		);
		// Both mask arrays are addressed with cell-local UVs that reach exactly 0 and 1 at a cell
		// boundary, and each cell's mask is independent of its neighbor's. Repeat wrapping would
		// make the boundary texel blend against the opposite edge of the same mask, bleeding an
		// unrelated corner's alpha into a half-texel band along every cell edge.
		this.#bindTextureArray(
			3,
			blendMasks,
			this.#nearTerrainProgram.uniforms.blendMasks,
			"filterable",
			TextureWrapMode.Clamp,
		);
		this.#bindTextureArray(
			4,
			roadMasks,
			this.#nearTerrainProgram.uniforms.roadMasks,
			"filterable",
			TextureWrapMode.Clamp,
		);
		this.#bindTexture2D(
			5,
			detail,
			this.#nearTerrainProgram.uniforms.detail,
			"filterable",
			TextureWrapMode.Repeat,
		);
		gl.activeTexture(gl.TEXTURE0);
	}

	/**
	 * Bind the one genuinely per-landblock terrain texture.
	 *
	 * Everything else the terrain shader samples is region-constant and already bound for the pass
	 * by `#beginTerrainPassResources`.
	 */
	#bindTerrainSurfaceField(input: TerrainFrameInput): void {
		const surfaceField = this.#resources.getTexture2D(
			input.program.surfaceField,
		);
		const gl = this.#gl;
		this.#bindTexture2D(
			0,
			surfaceField,
			this.#nearTerrainProgram.uniforms.surfaceField,
			"exact",
			TextureWrapMode.Clamp,
		);
		gl.activeTexture(gl.TEXTURE0);
	}

	/**
	 * Bind the shared mask texture for the terrain pass.
	 *
	 * Uses an `exact` sampler because integer textures are not filterable. Bound once per pass so
	 * each landblock pays only its table upload, and only when it has lights to name.
	 */
	#beginTerrainLightMasks(): void {
		const gl = this.#gl;
		gl.activeTexture(gl.TEXTURE0 + TERRAIN_LIGHT_MASK_TEXTURE_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, this.#terrainLightMask.texture);
		this.#textureSamplers.bind(TERRAIN_LIGHT_MASK_TEXTURE_UNIT, {
			mipLevels: 1,
			policy: this.#frameTextureFiltering,
			samplingClass: "exact",
			wrap: TextureWrapMode.Clamp,
		});
		gl.uniform1i(
			this.#nearTerrainProgram.uniforms.staticLightMask,
			TERRAIN_LIGHT_MASK_TEXTURE_UNIT,
		);
		gl.activeTexture(gl.TEXTURE0);
	}

	/**
	 * Upload one landblock's mask table, unless it has no lights for the mask to name.
	 *
	 * An unlit landblock leaves whatever the previous one uploaded in place. That cannot leak
	 * light: the masked loop bounds every index by the live light count, which is zero here, so it
	 * exits before reading any light slot. Skipping the upload is what keeps tiling free on the
	 * majority of landblocks, only 629 of 5346 of which carry an authored light at all.
	 */
	#uploadTerrainLightMask(landblockLights: LandblockLights): void {
		if (landblockLights.lights.length === 0) return;
		const gl = this.#gl;
		gl.activeTexture(gl.TEXTURE0 + TERRAIN_LIGHT_MASK_TEXTURE_UNIT);
		uploadWebGL2TerrainLightMask(gl, landblockLights.cellMasks);
		gl.activeTexture(gl.TEXTURE0);
		this.#frameSelectionMetrics.terrainLightMaskUploads += 1;
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

	/** Draw one landblock's whole terrain mesh; a landblock has exactly one. */
	#drawTerrainGeometry(
		geometryKey: GeometryResourceKey,
		landblockOffsetUniform: WebGLUniformLocation,
		landblockOffset: Vec3,
	): void {
		const binding = this.#resources.getGeometry(geometryKey);
		const gl = this.#gl;
		gl.uniform3f(
			landblockOffsetUniform,
			landblockOffset.x,
			landblockOffset.y,
			landblockOffset.z,
		);
		gl.bindVertexArray(binding.vertexArray);
		gl.drawElements(gl.TRIANGLES, binding.indexCount, binding.indexType, 0);
	}

	/** Partition one prepared physical object population for both opaque and deferred consumers. */
	#createObjectSubmissionPhases(
		view: PreparedView,
		profile: WebGL2FrameProfileCapture | null,
	): ObjectSubmissionPhases<PreparedObjectFrameInput> {
		const orderingStartedAt = profile?.beginCpuPhase();
		try {
			const phases = createObjectSubmissionPhases(
				view.objects,
				(object) => this.#transparentRange(object, view),
				(object) =>
					object.instances?.kind === "frame-template"
						? object.instances.cohortKey
						: null,
				(object) => this.#transparentCameraDepth(object, view),
			);
			this.#frameSelectionMetrics.transparentObjectCandidateCount +=
				phases.transparent.far.length + phases.transparent.near.length;
			this.#frameSelectionMetrics.farTransparentObjectCandidateCount +=
				phases.transparent.far.length;
			this.#frameSelectionMetrics.nearTransparentObjectCandidateCount +=
				phases.transparent.near.length;
			return phases;
		} finally {
			if (profile && orderingStartedAt !== undefined) {
				profile.finishCpuPhase("blendedOrdering", orderingStartedAt);
			}
		}
	}

	/**
	 * Classify one transparent range against the camera, without deriving its camera depth.
	 *
	 * Every producer publishes its sort center in landblock space, so placing it in the view's
	 * anchored frame is one offset add: no per-candidate matrix work survives here.
	 */
	#transparentRange(
		object: PreparedObjectFrameInput,
		view: PreparedViewGeometry,
	): TransparentObjectRange<PreparedObjectFrameInput> {
		const facts = object.transparentSort;
		if (!facts) {
			throw new Error(
				"Transparent static-object contribution lacks sort facts.",
			);
		}
		const offset = createLandblockOffset(
			getLandblockCoordinates(object.landblockId),
			view.anchorCoordinates,
			this.#offsetScratch,
		);
		const x = facts.center.x + offset.x - view.cameraPosition.x;
		const y = facts.center.y + offset.y - view.cameraPosition.y;
		const z = facts.center.z + offset.z - view.cameraPosition.z;
		return {
			distanceSquared: x * x + y * y + z * z,
			range: object,
			stableId: facts.stableId,
		};
	}

	/** Project one near candidate's center onto the camera's forward axis for exact ordering. */
	#transparentCameraDepth(
		object: PreparedObjectFrameInput,
		view: PreparedViewGeometry,
	): number {
		const facts = object.transparentSort;
		if (!facts) {
			throw new Error(
				"Transparent static-object contribution lacks sort facts.",
			);
		}
		const offset = createLandblockOffset(
			getLandblockCoordinates(object.landblockId),
			view.anchorCoordinates,
			this.#offsetScratch,
		);
		this.#transparentCenterScratch.x = facts.center.x + offset.x;
		this.#transparentCenterScratch.y = facts.center.y + offset.y;
		this.#transparentCenterScratch.z = facts.center.z + offset.z;
		transformPoint3(
			view.view,
			this.#transparentCenterScratch,
			this.#transparentCenterScratch,
		);
		// The renderer's right-handed view matrix maps forward to negative view-space Z.
		return -this.#transparentCenterScratch.z;
	}

	#drawOpaqueObjects(
		view: PreparedView,
		candidates: readonly PreparedObjectFrameInput[],
		shading: SceneShading,
		profile: WebGL2FrameProfileCapture | null,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		if (candidates.length === 0) return;
		const objects = this.#prepareFrameInstanceRuns([candidates], profile, [
			"grouped",
		]).objects;
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
				const programChanged = this.#objectState.applyProgram(program.program);
				if (programChanged) {
					this.#activateObjectProgram(program, view, shading);
				}
				this.#applyObjectLighting(program, object, shading);
				portalPipeline?.routeObjectSubmission(
					object.renderScopeKey,
					program.uniforms.clipTransform,
					programChanged,
				);
				this.#drawObjectRange(program, object, view.landblockOffsets);
			}
		} finally {
			if (profile && submissionStartedAt !== undefined) {
				profile.finishCpuPhase("opaqueSubmission", submissionStartedAt);
			}
		}
	}

	#drawBlendedObjects(
		view: PreparedView,
		phases: ObjectSubmissionPhases<PreparedObjectFrameInput>,
		shading: SceneShading,
		profile: WebGL2FrameProfileCapture | null,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		const sortedBlended = this.#prepareFrameBlendedRuns(
			{
				additive: phases.additive,
				far: phases.transparent.far,
				near: phases.transparent.near,
			},
			profile,
		);
		if (sortedBlended.length === 0) return;
		const submissionStartedAt = profile?.beginCpuPhase();
		const gl = this.#gl;
		try {
			// Primes every object sampler unit, not just the cache, exactly as the opaque pass does.
			// `invalidate()` alone was not enough: it makes issued binds re-apply, but a material
			// that *skips* a bind — direct colour skips the palette, solid colour skips both — keeps
			// whatever the frame last left on that unit. Terrain leaves integer `usampler2D`
			// textures on units 0 and 1, and the opaque pass returns before priming them when a view
			// has no opaque candidates, so a view of purely transparent objects reached this loop
			// with an integer texture bound under a float sampler and every draw failed validation.
			this.#beginObjectPhase();
			gl.depthMask(false);
			const portalPrograms = portalPipeline
				? this.#requirePortalBlendedObjectPrograms()
				: null;
			for (const object of sortedBlended) {
				const program =
					object.drawKind === "instanced"
						? (portalPrograms?.instanced ?? this.#blendedInstancedObjectProgram)
						: (portalPrograms?.baked ?? this.#blendedObjectProgram);
				if (this.#objectState.applyProgram(program.program)) {
					this.#activateObjectProgram(program, view, shading);
				}
				if (portalPipeline) {
					const uniforms = program.portalVisibilityUniforms;
					if (!uniforms) {
						throw new Error(
							"Portal deferred object draw selected a program without scope-envelope visibility.",
						);
					}
					portalPipeline.routeDeferredSubmission(
						object.renderScopeKey,
						uniforms,
					);
				}
				this.#applyObjectLighting(program, object, shading);
				this.#objectState.applyBlend(object.blendPolicy);
				this.#drawObjectRange(program, object, view.landblockOffsets);
			}
		} finally {
			if (profile && submissionStartedAt !== undefined) {
				profile.finishCpuPhase("blendedSubmission", submissionStartedAt);
			}
		}
	}

	/** Compile the two portal-only material variants on the first replacement-compositor frame. */
	#requirePortalBlendedObjectPrograms(): {
		readonly baked: WebGL2ObjectProgram;
		readonly instanced: WebGL2InstancedObjectProgram;
	} {
		this.#portalBlendedObjectProgram ??= createWebGL2ObjectProgram(this.#gl, {
			distanceFog: false,
			portalVisibility: true,
		});
		this.#portalBlendedInstancedObjectProgram ??= createWebGL2ObjectProgram(
			this.#gl,
			{
				distanceFog: false,
				portalVisibility: true,
				transformSource: "instanced",
			},
		);
		return {
			baked: this.#portalBlendedObjectProgram,
			instanced: this.#portalBlendedInstancedObjectProgram,
		};
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
	): {
		readonly objects: readonly PreparedObjectFrameInput[];
		readonly runCounts: readonly number[];
	} {
		const orderedInstances: ObjectInstanceData[] = [];
		const objects: PreparedObjectFrameInput[] = [];
		const runCounts: number[] = [];
		const preparationStartedAt = profile?.beginCpuPhase();
		for (const [phaseIndex, phase] of phases.entries()) {
			const grouping = groupings[phaseIndex];
			if (!grouping) {
				throw new Error(
					`Object instance phase ${phaseIndex} has no grouping policy.`,
				);
			}
			const isFrameInstance = (object: PreparedObjectFrameInput): boolean =>
				object.instances?.kind === "frame-template";
			const isCompatible = (
				left: PreparedObjectFrameInput,
				right: PreparedObjectFrameInput,
			): boolean =>
				// One offset per landblock this frame, so equal landblocks mean equal offsets:
				// this replaces the component comparison the compatibility value used to carry.
				left.landblockId === right.landblockId &&
				areStaticObjectDrawsCompatible(
					left.compatibility,
					right.compatibility,
				) &&
				left.instances?.kind === "frame-template" &&
				right.instances?.kind === "frame-template" &&
				frameTemplateBatchIdentityEquals(left, right);
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
					if (adjacent.instances?.kind !== "frame-template") {
						throw new Error(
							"Object instance run contains prepared range state.",
						);
					}
					orderedInstances.push(adjacent.instances.instance);
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
		landblockOffsets: PreparedSceneContributions["landblockOffsets"],
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
		// Submissions are drawn in run order, so consecutive draws usually share a landblock.
		if (object.landblockId !== this.#lastDrawnLandblockId) {
			const offset = landblockOffsets.get(object.landblockId);
			if (offset === undefined) {
				throw new Error(
					`Submitted object in landblock ${object.landblockId} has no frame offset.`,
				);
			}
			this.#lastDrawnLandblockId = object.landblockId;
			this.#lastDrawnLandblockOffset = offset;
		}
		gl.uniform3f(
			program.uniforms.landblockOffset,
			this.#lastDrawnLandblockOffset[0],
			this.#lastDrawnLandblockOffset[1],
			this.#lastDrawnLandblockOffset[2],
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
			if (object.instances.kind === "frame-template") {
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
		gl.uniform4f(program.uniforms.clipTransform, 1, 1, 0, 0);
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
		bindWebGL2DynamicLights(
			gl,
			program.uniforms,
			shading.dynamicLights,
			shading.anchorOrigin,
			this.#dynamicLightScratch,
		);
		if ("fogUniforms" in program) {
			gl.uniform3f(
				program.fogUniforms.cameraPosition,
				view.cameraPosition.x,
				view.cameraPosition.y,
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
		if (this.#objectState.applyLightingRole(role)) {
			bindWebGL2SceneLighting(
				this.#gl,
				program.uniforms,
				shading.lighting[role],
			);
			this.#frameSelectionMetrics.objectLightingBinds += 1;
		}
		// Interior geometry already carries its static lighting in baked vertex colours, so it
		// binds an empty set rather than the landblock's outdoor lamps.
		const scope = role === "interior-object" ? null : object.landblockId;
		if (!this.#objectState.applyStaticLightScope(scope)) return;
		bindWebGL2StaticLights(
			this.#gl,
			program.uniforms,
			scope === null ? EMPTY_LIGHTS : shading.staticLights(scope).lights,
			shading.anchorOrigin,
			shading.authoredLightResponse,
			this.#dynamicLightScratch,
		);
		this.#frameSelectionMetrics.staticLightBinds += 1;
	}

	/**
	 * Resolve and budget one landblock's authored lights.
	 *
	 * The index memoizes the gather across frames, so the per-frame cost is a map read plus a
	 * selection pass that is a pass-through whenever the set fits, which it almost always does.
	 */
	#resolveStaticLights(
		input: FrameInput,
		landblockId: LandblockId,
		viewpoint: { readonly x: number; readonly y: number; readonly z: number },
	): LandblockLights {
		if (!input.frameSettings.staticLightsEnabled) {
			return EMPTY_LANDBLOCK_LIGHTS;
		}
		if (input.outdoorLights.isEmpty) return EMPTY_LANDBLOCK_LIGHTS;
		const reaching = input.outdoorLights.resolve(landblockId);
		if (reaching.lights.length <= MAX_STATIC_LIGHTS) return reaching;
		const selected = selectNearestLights(
			reaching.lights,
			viewpoint,
			MAX_STATIC_LIGHTS,
		);
		this.#frameSelectionMetrics.droppedLights += selected.dropped;
		// Selection reorders by distance from the camera, so the memoized masks no longer name
		// these slots. Fall back to admitting every light rather than binding a stale table; the
		// shader still bounds iteration by the live count, so the result is identical and only
		// the tiling saving is lost. Unreachable on retail content, whose worst landblock carries
		// 51 lights against a cap of 64.
		return { lights: selected.lights, cellMasks: TERRAIN_LIGHT_MASK_ALL };
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

	#resizeCanvasForRenderScale(): void {
		const scale = this.#renderScale;
		const width = Math.max(1, Math.floor(this.#canvas.clientWidth * scale));
		const height = Math.max(1, Math.floor(this.#canvas.clientHeight * scale));
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
		left.renderScopeKey === right.renderScopeKey &&
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
	if (instances?.kind !== "frame-template") {
		throw new Error(
			"Opaque instance grouping received a non-frame instance input.",
		);
	}
	return `${object.ordering}\0${object.source}\0${object.renderScopeKey}\0${object.landblockId}\0${instances.cohortKey}\0${object.geometry}\0${object.indexStart}\0${object.indexCount}`;
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
