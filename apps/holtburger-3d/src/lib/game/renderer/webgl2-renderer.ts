import {
	createLandblockOffset,
	createLandblockWorldOrigin,
	getLandblockCoordinates,
	landblockChebyshevDistance,
	normalizeLandblockOwner,
} from "../landblocks";
import { farTerrainCutoffLandblocks } from "../environment/terrain-fog";
import {
	createPerspectiveMat4,
	createViewMat4,
	createRotationMat4,
	mat4ToFloat32Array,
	multiplyMat4,
	transformPoint3,
} from "../math/matrices";
import { createFrustumFromClipMatrix, type Frustum } from "../math/frustum";
import { Mat4, Quat, Vec3 } from "../math/types";
import {
	type SceneNodeId,
	type SceneScope,
	type SceneVisibilityIslandId,
} from "../scene";
import { scopeFor, scopeKey } from "../scene/scope";
import { createCameraNearClipVolume } from "./portal-near-plane";
import type { TerrainDrawUnit } from "../terrain/types";
import type {
	ObjectMaterialBinding,
	StaticObjectDrawUnit,
} from "../commit/artifacts";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type { RetailGeometryVisibility } from "../resolution/presentation";
import { retainsRetailGeometry } from "./retail-geometry-visibility";
import { TextureWrapMode } from "../textures/types";
import {
	DEFAULT_COLOR_GRADE_PARAMETERS,
	type ColorGradeSettings,
} from "./color-grade-policy";
import {
	createEntityShadowSettings,
	isOutdoorPssmReceiverFootprint,
	type EntityShadowSettings,
} from "./entity-shadow-policy";
import {
	type FrameInput,
	type FrameSelectionMetrics,
	type FrameSettings,
	type EntitySelectionTarget,
	type RendererFrameDiagnostics,
	type RendererFrameFeedback,
	type FrameViewInput,
	type PortalTransitionFrame,
	type PortalTransitionOnlyFrameInput,
	type PortalTransitionVisual,
	type Renderer,
	type ResolvedResourceInvalidation,
	type WorldIndicatorInput,
	type WorldMarkerInput,
} from "./renderer";
import { portalTunnelRollRadians } from "../../client/portal-transition-visual";
import {
	type PortalTransitionPresentationReceipt,
	validatePortalTransitionPresentationPlan,
} from "../../client/portal-transition-presentation";
import { renderCullingGroupFilter } from "./render-layer-visibility";
import {
	landblockVec3,
	sceneVec3,
	type LandblockVec3,
	type SceneVec3,
} from "../../assets/ac-frame";
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
import type { VisibleDynamicContributions } from "../systems/components";
import { WebGL2WorldMarkerPass } from "./webgl2-world-marker-pass";
import { WebGL2WorldTrajectoryPass } from "./webgl2-world-trajectory-pass";
import {
	WebGL2EntitySelectionPass,
	type WebGL2EntitySelectionMask,
} from "./webgl2-entity-selection-pass";
import {
	type NameplateDrawInstance,
	type NameplateScopedDrawInstance,
	WebGL2NameplatePass,
} from "./webgl2-nameplate-pass";
import {
	type NameplateTextureBinding,
	WebGL2NameplateTextureCache,
} from "./webgl2-nameplate-texture-cache";
import { resolveNameplateAnchor } from "./nameplate-anchor";
import {
	retainLegibleNameplates,
	retainNearestNameplates,
} from "./nameplate-selection";
import {
	resolveNameplateCategory,
	type NameplateAppearance,
	type NameplateVisual,
} from "./nameplate-policy";
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
	WebGL2OutdoorPssmPass,
	type ActiveOutdoorPssmFrame,
	type WebGL2OutdoorPssmPassProfileMetrics,
} from "./webgl2-outdoor-pssm-pass";
import {
	hasOutdoorShadowLight,
	resolveOutdoorShadowProjection,
	terrainLandblockIntersectsShadowDistance,
	type ResolvedOutdoorShadowProjection,
} from "./outdoor-pssm";
import {
	bindWebGL2OutdoorPssmUniforms,
	createWebGL2OutdoorPssmUniformScratch,
	OUTDOOR_PSSM_TEXTURE_UNIT,
} from "./webgl2-pssm-receiver";
import { WebGL2OutdoorPssmReceiverPrograms } from "./webgl2-pssm-receiver-programs";
import { WebGL2EntityGroundingPrograms } from "./webgl2-entity-grounding-programs";
import {
	applyWebGL2EntityGroundingUniforms,
	entityGroundingUniformAttemptCount,
} from "./webgl2-entity-grounding";
import {
	createEntityGroundingSelection,
	createEntityGroundingSelectionScratch,
	createIndoorGroundingCell,
	createOutdoorDirectionalShadowCaster,
	createOutdoorDirectionalShadowSelection,
	createOutdoorDirectionalShadowSelectionScratch,
	createOutdoorDirectionalShadowTerrain,
	indexIndoorVisibilityIslands,
	resolveEntityShadowCaster,
	selectIndoorGroundingCasters,
	selectOutdoorDirectionalShadowCasters,
	type EntityGroundingCaster,
	type EntityGroundingSelection,
	type IndoorGroundingCell,
	type OutdoorDirectionalShadowCaster,
	type OutdoorDirectionalShadowSelection,
} from "./entity-grounding";
import { bindWebGL2OutdoorDirectionalShadowUniforms } from "./webgl2-outdoor-directional-shadow";
import {
	createWebGL2ObjectProgram,
	OBJECT_TEXTURE_UNITS,
	type WebGL2FogObjectProgram,
	type WebGL2FogInstancedObjectProgram,
	type WebGL2InstancedObjectProgram,
	type WebGL2ObjectProgram,
} from "./webgl2-object-program";
import { bindWebGL2ObjectInstanceRange } from "./webgl2-instance-buffer";
import type { LandblockOwnerId } from "../game-types";
import { UNAUTHORED_SCENE_LIGHTING } from "../environment/scene-environment";
import { VIEWER_LIGHT } from "../environment/viewer-light";
import {
	MAX_DYNAMIC_LIGHTS,
	MAX_STATIC_LIGHTS,
	type RuntimeLight,
	fitLightsToBudget,
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
	type ObjectFrameSubmission,
	type ObjectSubmissionPhases,
	type PreparedObjectAtlasBinding,
	type PreparedObjectMaterial,
	type PreparedObjectTextureBinding,
	type PreparedStaticObjectDrawCompatibility,
	type TransparentObjectRange,
} from "./object-rendering-policy";
import {
	BakedDrawMergeCensusCollector,
	type BakedDrawMergeCensus,
} from "./baked-draw-merge-census";
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
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import { normalizedRgbaColor } from "../../frontend-color";
import {
	WebGL2TextureSamplerCatalog,
	type TextureSamplingClass,
} from "./webgl2-texture-sampler-catalog";
import { devicePixelArea, validateRenderScale } from "./render-scale";
import { type RenderExtent, validateRenderExtent } from "./render-extent";
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
import { WebGL2DeviceStateApplicator } from "./webgl2-device-state-applicator";
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
import {
	WebGL2FlatScenePresentation,
	type FlatScenePresentationInput,
} from "./webgl2-flat-scene-presentation";
import type { PortalWarpDriveTuning } from "./portal-warp-drive-tuning";
import {
	DEFAULT_ENTITY_SELECTION_OUTLINE_SETTINGS,
	type EntitySelectionOutlineSettings,
} from "./entity-selection-outline-policy";
import { resolvePortalTransitionComposition } from "./portal-transition-composition";
import { WebGL2TransitionSnapshot } from "./webgl2-transition-snapshot";
import {
	AMBIENT_OCCLUSION_DISTANCE_FADE,
	resolveEffectiveAmbientOcclusionPolicy,
	type EffectiveAmbientOcclusionPolicy,
} from "./ambient-occlusion-policy";
import { WebGL2SaoPass, type WebGL2SaoCoverageCensus } from "./webgl2-sao-pass";
import { composeObjectPartTransform } from "../resolution/object-part-transform";
import {
	playingClip,
	sampleAnimationPose,
	type PlayingClip,
} from "../animation/animation-playback";

/**
 * Texture unit for the terrain light mask, after the six the terrain shader samples: unit 0 is the
 * per-landblock surface field, units 1-5 the region-constant pass textures.
 * Object programs bind only units 0-2, so nothing contends for it.
 */
const TERRAIN_LIGHT_MASK_TEXTURE_UNIT = 6;

/** Frontend-authored fallback decoded once for every clear path owned by this renderer. */
const FRONTEND_CLEAR_COLOR = normalizedRgbaColor(
	SHARED_FRONTEND_TUNING.rendering.clearColor,
);

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
	anchorLandblockId: LandblockOwnerId,
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
	readonly staticLights: (landblockId: LandblockOwnerId) => LandblockLights;
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

/** Ranking position used before any view has been committed. */
const ORIGIN = sceneVec3(Vec3.zero());
const EMPTY_LIGHTS: readonly RuntimeLight[] = [];

/** Allocate explanatory shadow counters only for an explicitly profiled frame. */
function createEmptyOutdoorShadowMapProfileMetrics(): WebGL2OutdoorPssmPassProfileMetrics {
	return {
		analyticRootCount: 0,
		candidateRootCount: 0,
		cascadeCandidateMembershipCount: 0,
		cascadeQueryCount: 0,
		compatibleDepthRunCount: 0,
		emptyMappedViewCount: 0,
		instanceUploadBytes: 0,
		instanceUploadCount: 0,
		mappedRootCount: 0,
		rejectedRootCount: 0,
		selectedRootCount: 0,
		selectedCasterPartCount: 0,
	};
}
/** Synthetic single render domain used by the deliberately unpartitioned flat debug mode. */
const FLAT_PARTICLE_DOMAIN = "particle-render-domain:flat";
const FLAT_SKY_PARTICLE_DOMAIN = "particle-render-domain:flat-sky";
/** Unlit result for draws that resolve no landblock lights at all. */
const EMPTY_LANDBLOCK_LIGHTS: LandblockLights = {
	lights: EMPTY_LIGHTS,
	cellMasks: new Uint32Array(TERRAIN_LIGHT_MASK_LENGTH),
};

/** Retail portal room lighting: one distant light and a modest ambient floor. */
const PORTAL_TRANSITION_LIGHTING = {
	ambientLevel: 0.3,
	ambientColor: { red: 1, green: 1, blue: 1, alpha: 1 },
	sunVector: new Vec3(-0.3, 1.9, -0.65),
	sunColor: { red: 1, green: 1, blue: 1, alpha: 1 },
} as const;
const PORTAL_TRANSITION_SCOPE = "portal-transition";
const PORTAL_TRANSITION_ANCHOR = normalizeLandblockOwner("0x0000ffff");
const PORTAL_TRANSITION_CAMERA: Camera = {
	far: 100,
	fov: 75,
	near: 0.01,
	placement: {
		envCellId: null,
		landblockId: PORTAL_TRANSITION_ANCHOR,
		position: sceneVec3(Vec3.zero()),
		rotation: Quat.identity(),
	},
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
		| "dynamic"
		| "portal-transition";
	/** Canonical authored scope; an instance run must never cross this atlas-routing boundary. */
	readonly renderScopeKey: string;
	readonly cullFaceOverride:
		StaticObjectDrawUnit["material"]["polygon"]["cullFace"] | null;
	/** Which GL call form this submission takes; must match the program's transform source. */
	readonly drawKind: "single" | "instanced";
	readonly geometry: GeometryResourceKey;
	readonly indexCount: number;
	readonly indexStart: number;
	readonly instances:
		| null
		| {
				/** Stable grouping identity, absent when the submission phase ignores authored cohorts. */
				readonly transparentCohortKey: string | null;
				readonly instance: import("../systems/static-resources").ObjectInstanceData;
				readonly kind: "frame-template";
		  }
		| {
				readonly firstInstance: number;
				readonly instanceCount: number;
				readonly kind: "frame-range";
		  };
	readonly landblockId: LandblockOwnerId;
	readonly localToLandblock: Mat4;
	readonly material: ObjectMaterialBinding;
	readonly ordering: ObjectMaterialOrdering;
	/** Retail draw eligibility retained through compilation for frame-time filtering. */
	readonly retailVisibility: RetailGeometryVisibility;
	/** Buildings provenance projected once; no draw consumer reconstructs it from source labels. */
	readonly receivesOutdoorPssm: boolean;
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
	/** Compiled coarse partition; exact prepared compatibility remains authoritative. */
	readonly batchKey: string;
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

/** One ordered phase's scheduling semantics; cohort identity is explicit instead of incidental. */
interface FrameInstancePhasePolicy {
	readonly grouping: "adjacent" | "grouped";
	readonly cohort: "ignore" | "require";
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
		batchKey: compiled.batchKey,
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
		retailVisibility: object.retailVisibility,
		receivesOutdoorPssm: object.receivesOutdoorPssm,
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
	readonly landblockId: LandblockOwnerId;
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
interface PreparedEntityAnalyticShadows {
	readonly indoorByScopeKey: ReadonlyMap<string, EntityGroundingSelection>;
	readonly outdoorByLandblockId: ReadonlyMap<
		LandblockOwnerId,
		OutdoorDirectionalShadowSelection
	>;
	readonly outdoorEnabled: boolean;
	readonly indoorSettings: EntityShadowSettings["indoorGrounding"];
	readonly outdoorSettings: EntityShadowSettings["outdoorDirectional"];
}

interface PreparedNameplateCandidate {
	readonly anchor: Vec3;
	readonly distanceSquared: number;
	readonly identity: string;
	readonly renderScopeKeys: readonly string[];
	readonly visual: NameplateVisual;
}

interface MutableNameplateDrawInstance extends NameplateDrawInstance {
	anchor: Vec3;
	binding: NameplateTextureBinding;
}

interface MutableNameplateScopedDrawInstance extends NameplateScopedDrawInstance {
	anchor: Vec3;
	binding: NameplateTextureBinding;
	renderScopeKey: string;
}

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
	/** Fixed per-receiver analytic-shadow records produced from the same visible-entry walk. */
	readonly entityAnalyticShadows: PreparedEntityAnalyticShadows | null;
	/** Budgeted candidates collected only from already-selected visible dynamic entities. */
	readonly nameplates: readonly PreparedNameplateCandidate[];
	/** Perspective scale applied by the nameplate pass for this prepared view. */
	readonly nameplateReferenceDistance: number;
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
		pixelCount: number;
		tileCount: number;
		disposedGenerationCount: number;
		effectiveDistanceFade: {
			disabledAt: number;
			fullStrengthUntil: number;
		} | null;
	};
	entitySelection: {
		activeMaskBytes: number;
		allocatedTargetGenerationCount: number;
		compositeDrawCount: number;
		disposedTargetGenerationCount: number;
		maskDrawCount: number;
		selectedSphereProxyCount: number;
		selectedPartCount: number;
		selectedTriangleCount: number;
		skippedReason: "no-target" | "hidden-or-empty" | null;
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
	portalTransitionSnapshotBytes: number;
	portalTransitionOriginCaptured: boolean;
	portalTransitionSnapshotAllocatedGenerationCount: number;
	portalTransitionSnapshotDisposedGenerationCount: number;
	portalTransitionFramebufferCount: number;
	portalTransitionTargetBytes: number;
	submittedPortalTransitionDrawCount: number;
	portalTransitionVisualInstalled: boolean;
	portalTransitionGeneration: number | null;
	portalTransitionKind: PortalTransitionFrame["kind"] | null;
	portalTransitionOnlyFramePresented: boolean;
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
	objectDrawCalls: number;
	objectUniformUploads: number;
	objectSuppressedUniformUploads: number;
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
	readonly #worldMarkerPass: WebGL2WorldMarkerPass;
	readonly #worldTrajectoryPass: WebGL2WorldTrajectoryPass;
	readonly #nameplatePass: WebGL2NameplatePass;
	readonly #nameplateTextureCache: WebGL2NameplateTextureCache;
	readonly #nameplateDrawScratch: MutableNameplateDrawInstance[] = [];
	readonly #scopedNameplateDrawScratch: MutableNameplateScopedDrawInstance[] =
		[];
	readonly #nameplatePopulationScratch: NameplateVisual[] = [];
	#reconciledNameplateAppearance: NameplateAppearance | null = null;
	#reconciledNameplatePopulationRevision = -1;
	#reconciledNameplateDensity = Number.NaN;
	#reconciledNameplateViewerIdentity: string | null | undefined = undefined;
	#eligibleNameplateCandidateCount = 0;
	#budgetRejectedNameplateCandidateCount = 0;
	#submittedNameplateInstanceCount = 0;
	#submittedNameplateDrawCount = 0;
	#frameWorldIndicator: WorldIndicatorInput | null = null;
	/** Current realized selected root, resolved by the runtime rather than retained by the renderer. */
	#frameSelectionTarget: EntitySelectionTarget | null = null;
	#frameViewerEntityIdentity: string | null = null;
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
	/** Frontend-selected portal look consumed only by the lazy fullscreen presenter. */
	readonly #portalWarpDriveTuning: PortalWarpDriveTuning;
	/** Device-wide guard preventing draws through any stale handle after context loss. */
	readonly #assertDeviceReady: () => void;
	readonly #frameInstances: FrameInstanceStreamArena;
	/** Lazy-resource outdoor actor depth schedule sharing the ordinary frame instance arena. */
	readonly #outdoorPssmPass: WebGL2OutdoorPssmPass;
	readonly #outdoorPssmReceiverPrograms: WebGL2OutdoorPssmReceiverPrograms;
	readonly #entityGroundingPrograms: WebGL2EntityGroundingPrograms;
	readonly #outdoorPssmUniformScratch = createWebGL2OutdoorPssmUniformScratch();
	/** Current sequential view's receiver state; null prevents every inactive sample path. */
	#activeOutdoorPssmFrame: ActiveOutdoorPssmFrame | null = null;
	/** Projection shared by the current view's mapped and directional analytic tiers. */
	#activeOutdoorShadowProjection: ResolvedOutdoorShadowProjection | null = null;
	/** Reused frame-hot storage for analytic candidate collection and receiver selection. */
	readonly #entityGroundingCasters: EntityGroundingCaster[] = [];
	readonly #outdoorDirectionalCasters: OutdoorDirectionalShadowCaster[] = [];
	readonly #indoorGroundingCells = new Map<string, IndoorGroundingCell>();
	readonly #indoorGroundingByScopeKey = new Map<
		string,
		EntityGroundingSelection
	>();
	readonly #outdoorDirectionalByLandblockId = new Map<
		LandblockOwnerId,
		OutdoorDirectionalShadowSelection
	>();
	readonly #entityGroundingSelectionPool: EntityGroundingSelection[] = [];
	readonly #entityGroundingSelectionScratch =
		createEntityGroundingSelectionScratch();
	readonly #outdoorDirectionalSelectionPool: OutdoorDirectionalShadowSelection[] =
		[];
	readonly #outdoorDirectionalSelectionScratch =
		createOutdoorDirectionalShadowSelectionScratch();
	readonly #indoorVisibilityIslands = new Map<
		string,
		SceneVisibilityIslandId
	>();
	/** Reusable dynamic-light upload staging; renderer-owned to keep draw loops allocation-free. */
	readonly #dynamicLightScratch: ReturnType<typeof createDynamicLightScratch>;
	readonly #terrainLightMask: WebGL2TerrainLightMaskTexture;
	/** Exact state mirror scoped to independently invalidated object phases. */
	readonly #deviceState: WebGL2DeviceStateApplicator;
	/** Portal owner created lazily when the first portal frame needs GPU resources. */
	#portalScopeAtlasPipeline: WebGL2PortalScopeAtlasPipeline | null = null;
	/** Unconditional flat-scene attachments, allocated lazily on the first flat frame. */
	#flatSceneTarget: WebGL2FlatSceneTarget | null = null;
	/** Flat color/depth presenter, compiled lazily with the first flat frame. */
	#flatScenePresentation: WebGL2FlatScenePresentation | null = null;
	/** Lazy material-free selected-entity mask owner. */
	#entitySelectionPass: WebGL2EntitySelectionPass | null = null;
	/** Outgoing world color retained only while a transition compositor needs it. */
	#transitionSnapshot: WebGL2TransitionSnapshot | null = null;
	#transitionSnapshotGeneration: number | null = null;
	#activeTransition: PortalTransitionFrame | null = null;
	/** Prepared setup visual retained for the transition-only tunnel target. */
	#portalTransitionVisual: PortalTransitionVisual | null = null;
	#portalTransitionClip: PlayingClip | null = null;
	/** Transition-only authored tunnel color/depth target; ordinary frames never allocate it. */
	#portalTransitionTarget: WebGL2FlatSceneTarget | null = null;
	/** Optional SAO programs and scratch ownership, created only by the first enabled frame. */
	#saoPass: WebGL2SaoPass | null = null;
	/** Harness-only category view; production never enables synchronous depth census work. */
	#saoCoverageVisualizationEnabled = false;
	/**
	 * One-frame baked-draw merge census in flight, or null on an ordinary frame.
	 *
	 * Collector and waiter are held together because neither is meaningful alone: the census
	 * spans exactly the frame between installation and the next frame finish.
	 */
	#mergeCensusRequest: {
		readonly collector: BakedDrawMergeCensusCollector;
		readonly resolve: (census: BakedDrawMergeCensus) => void;
	} | null = null;
	readonly #visibleStaticLayers = new Set<string>();
	readonly #visibleEnvCellScopes = new Set<string>();
	/** Frame-owned expansion cache shared by PSSM and ordinary view selection. */
	readonly #dynamicContributions = new Map<
		SceneNodeId,
		{
			readonly contributions: VisibleDynamicContributions;
			readonly includesDepth: boolean;
		}
	>();
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
		SHARED_FRONTEND_TUNING.rendering.frameDefaults.textureFiltering;
	/** Portal footprint cutoff resolved to drawing-buffer pixels once at frame entry. */
	#minimumPortalFootprintDevicePixelArea = 0;
	/** Object-presentation footprint cutoff resolved to drawing-buffer pixels at frame entry. */
	#minimumObjectFootprintDevicePixelArea = 0;
	/** Sampling density the drawing buffer is currently sized for, retained for resize alone. */
	#renderScale: number =
		SHARED_FRONTEND_TUNING.rendering.frameDefaults.renderScale;
	/** This frame's presentation grade, snapshotted once and consumed at present time. */
	#frameColorGrade: ColorGradeSettings = {
		enabled: false,
		parameters: DEFAULT_COLOR_GRADE_PARAMETERS,
	};
	/** This frame's depth-independent selection edge appearance. */
	#frameEntitySelectionOutline: EntitySelectionOutlineSettings =
		DEFAULT_ENTITY_SELECTION_OUTLINE_SETTINGS;
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
			pixelCount: 0,
			tileCount: 0,
			disposedGenerationCount: 0,
			effectiveDistanceFade: null,
		},
		entitySelection: {
			activeMaskBytes: 0,
			allocatedTargetGenerationCount: 0,
			compositeDrawCount: 0,
			disposedTargetGenerationCount: 0,
			maskDrawCount: 0,
			selectedSphereProxyCount: 0,
			selectedPartCount: 0,
			selectedTriangleCount: 0,
			skippedReason: "no-target",
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
		portalTransitionSnapshotBytes: 0,
		portalTransitionOriginCaptured: false,
		portalTransitionSnapshotAllocatedGenerationCount: 0,
		portalTransitionSnapshotDisposedGenerationCount: 0,
		portalTransitionFramebufferCount: 0,
		portalTransitionTargetBytes: 0,
		submittedPortalTransitionDrawCount: 0,
		portalTransitionVisualInstalled: false,
		portalTransitionGeneration: null,
		portalTransitionKind: null,
		portalTransitionOnlyFramePresented: false,
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
		objectDrawCalls: 0,
		objectUniformUploads: 0,
		objectSuppressedUniformUploads: 0,
	};
	#frameWidth = 0;
	#frameHeight = 0;

	public static async build(
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
		this.#canvas = canvas;
		this.#gl = gl;
		this.#resources = resources;
		this.#world = world;
		this.#assertDeviceReady = assertDeviceReady;
		this.#portalWarpDriveTuning = portalWarpDriveTuning;
		this.#worldMarkerPass = new WebGL2WorldMarkerPass(gl);
		this.#worldTrajectoryPass = new WebGL2WorldTrajectoryPass(gl);
		this.#textureSamplers = new WebGL2TextureSamplerCatalog(
			gl,
			textureFilteringSupport,
		);
		this.#nameplatePass = new WebGL2NameplatePass(
			gl,
			this.#textureSamplers.getSampler({
				mipLevels: 1,
				policy: "linear",
				samplingClass: "filterable",
				wrap: TextureWrapMode.Clamp,
			}),
		);
		this.#nameplateTextureCache = new WebGL2NameplateTextureCache(gl);
		this.#frameInstances = new FrameInstanceStreamArena(gl);
		this.#outdoorPssmPass = new WebGL2OutdoorPssmPass(
			gl,
			resources,
			{
				expandDynamicContributions: (nodeId, includeDepth) =>
					this.#expandDynamicContributions(nodeId, includeDepth),
				getRenderContributionDescriptor: (nodeId) =>
					world.getRenderContributionDescriptor(nodeId),
				getEntityShadowDynamicFacts: (nodeId) =>
					world.getEntityShadowDynamicFacts(nodeId),
				queryScopesScene: (...args) => world.queryScopesScene(...args),
				resolveGeometry: (key) => world.resolveGeometry(key),
			},
			this.#frameInstances,
		);
		this.#outdoorPssmReceiverPrograms = new WebGL2OutdoorPssmReceiverPrograms(
			gl,
		);
		this.#entityGroundingPrograms = new WebGL2EntityGroundingPrograms(gl);
		this.#dynamicLightScratch = createDynamicLightScratch();
		this.#terrainLightMask = createWebGL2TerrainLightMaskTexture(gl);
		this.#deviceState = new WebGL2DeviceStateApplicator(gl);
		this.#nearTerrainProgram = createWebGL2NearTerrainProgram(gl);
		this.#farTerrainProgram = createWebGL2FarTerrainProgram(gl);
		this.#objectProgram = createWebGL2ObjectProgram(gl);
		this.#instancedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: true,
			transformSource: "attribute",
		});
		this.#blendedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: false,
		});
		this.#blendedInstancedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: false,
			transformSource: "attribute",
		});
		this.#objectFallbackBinding = {
			sampler: this.#textureSamplers.getSampler({
				mipLevels: 1,
				policy: SHARED_FRONTEND_TUNING.rendering.frameDefaults.textureFiltering,
				samplingClass: "exact",
				wrap: TextureWrapMode.Clamp,
			}),
			texture: createObjectFallbackTexture(gl),
		};
		this.frameDiagnostics = {
			snapshot: () => ({
				compiledObjectDraws: this.#compiledDraws.getDiagnostics(),
				entityShadows: {
					outdoorTargets: this.#outdoorPssmPass.getDiagnostics(),
				},
				nameplates: {
					budgetRejectedCandidateCount:
						this.#budgetRejectedNameplateCandidateCount,
					cache: this.#nameplateTextureCache.diagnostics(),
					eligibleCandidateCount: this.#eligibleNameplateCandidateCount,
					submittedDrawCount: this.#submittedNameplateDrawCount,
					submittedInstanceCount: this.#submittedNameplateInstanceCount,
				},
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
					entitySelection: {
						...this.#frameSelectionMetrics.entitySelection,
					},
				},
			}),
			setProfilingEnabled: (enabled) => this.#setFrameProfilingEnabled(enabled),
			resetProfile: () => this.#frameProfiler?.reset(),
			captureBakedDrawMergeCensus: () =>
				new Promise<BakedDrawMergeCensus>((resolve) => {
					if (this.#mergeCensusRequest !== null) {
						throw new Error("A baked draw merge census is already in flight.");
					}
					this.#mergeCensusRequest = {
						collector: new BakedDrawMergeCensusCollector(),
						resolve,
					};
				}),
		};
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
		const profile = this.#frameProfiler?.beginFrame() ?? null;
		try {
			this.#drawFrameContent(input, profile);
			return Object.freeze({
				portalTransitionReceipt: portalTransitionPresentationReceipt(
					input.portalTransition,
				),
				selectedDynamicNodeIds: Object.freeze([
					...this.#selectedDynamicNodeIds,
				]),
			});
		} finally {
			profile?.finish();
		}
	}

	/** Present the authored portal room without querying or advancing the render world. */
	drawPortalTransitionFrame(
		input: PortalTransitionOnlyFrameInput,
	): PortalTransitionPresentationReceipt | null {
		this.#assertDeviceReady();
		const profile = this.#frameProfiler?.beginFrame() ?? null;
		try {
			this.#drawPortalTransitionFrameContent(input, profile);
			return portalTransitionPresentationReceipt(input.portalTransition);
		} finally {
			profile?.finish();
		}
	}

	clearPresentation(): void {
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
		this.#frameSelectionMetrics.portalTransitionOnlyFramePresented = false;
		this.#updateRenderTargetMetrics();
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
		gl.viewport(0, 0, this.#frameWidth, this.#frameHeight);
		gl.clearColor(0, 0, 0, 1);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.stencilMask(0xff);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
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
		const entityShadows = createEntityShadowSettings(
			input.frameSettings.entityShadows,
		);
		if (entityShadows.mode !== "shadow-maps") this.#outdoorPssmPass.disable();
		this.#activeOutdoorPssmFrame = null;
		this.#activeOutdoorShadowProjection = null;
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
		this.#frameWorldIndicator = input.worldIndicator ?? null;
		this.#frameSelectionTarget = input.selectionTarget;
		this.#frameViewerEntityIdentity = input.viewerEntityIdentity;
		// Snapshotted here because the flat schedule never receives frame settings, and both
		// schedules reach presentation through the same shared helper.
		this.#frameColorGrade = input.frameSettings.colorGrade;
		this.#frameEntitySelectionOutline =
			input.frameSettings.entitySelectionOutline;
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
		// Capture before resizing the scene target: if a transition begins on the same frame as a
		// drawing-buffer resize, the outgoing image is still the last completed native-sized frame.
		this.#prepareTransitionSnapshot(input.portalTransition);
		this.#applyRenderExtent(input.extent);
		this.#activeTransition = input.portalTransition ?? null;
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
		// presentation adds ambient occlusion before weather; removing it as a retail
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
		const sceneCameraPosition =
			input.views[0]?.camera.placement.position ?? ORIGIN;
		const dynamicCandidates: RuntimeLight[] = [...input.dynamicLights];
		if (input.frameSettings.viewerLightEnabled) {
			// Where the light hangs — on the body being driven, or on the camera when nothing is —
			// is the frontend's call (`SmartBox::set_viewer`, acclient.c:137879-137897); this only
			// admits it as one more candidate for the dynamic budget.
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
		this.#frameSelectionMetrics.droppedLights += fittedDynamic.dropped;
		const shading: SceneShading = {
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
				this.#resolveStaticLights(input, landblockId, sceneCameraPosition),
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
				this.#renderOutdoorPssm(
					geometry,
					entityShadows,
					input.frameSettings.showRetailHiddenGeometry,
					shading,
					profile,
				);
				const contributions = this.#collectScene(
					geometry,
					input.frameSettings,
					profile,
				);
				this.#drawFlatView(
					{ ...geometry, ...contributions },
					shading,
					"exterior",
					input.frameSettings.showRetailHiddenGeometry,
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
					entityShadows,
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

	#drawPortalTransitionFrameContent(
		input: PortalTransitionOnlyFrameInput,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		const setupStartedAt = profile?.beginCpuPhase();
		this.#frameTextureFiltering = input.frameSettings.quality.textureFiltering;
		if (this.#compiledTextureFiltering !== this.#frameTextureFiltering) {
			if (this.#compiledTextureFiltering !== null) {
				this.#compiledDraws.flush("texture-filtering");
			}
			this.#compiledTextureFiltering = this.#frameTextureFiltering;
		}
		this.#frameColorGrade = input.frameSettings.colorGrade;
		this.#frameEntitySelectionOutline =
			input.frameSettings.entitySelectionOutline;
		validateRenderScale(
			input.frameSettings.quality.renderScale,
			"Frame settings",
		);
		this.#renderScale = input.frameSettings.quality.renderScale;
		this.#prepareTransitionSnapshot(input.portalTransition);
		this.#applyRenderExtent(input.extent);
		this.#activeTransition = input.portalTransition;
		this.#resetFrameSelectionMetrics(0, input.frameSettings.envCellRenderMode);
		this.#frameSelectionMetrics.portalTransitionOnlyFramePresented = true;
		if (profile && setupStartedAt !== undefined) {
			profile.finishCpuPhase("setup", setupStartedAt);
		}

		const target = this.#acquireFlatSceneTarget();
		this.#beginFlatOpaqueScene(target);
		this.#drawPortalTransitionTunnel(
			target,
			input.frameSettings.showRetailHiddenGeometry,
			profile,
		);
		this.#presentFlatScene(target, profile);
		this.#updateRenderTargetMetrics();
		this.#finishFrameSelectionMetrics();
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
		entityShadows: EntityShadowSettings,
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
		this.#activeOutdoorPssmFrame = null;
		this.#activeOutdoorShadowProjection = null;
		if (frame.atlas.visibility.selectedScopeOrdinal("outdoor") !== null) {
			this.#renderOutdoorPssm(
				prepared,
				entityShadows,
				frameSettings.showRetailHiddenGeometry,
				shading,
				profile,
			);
		}
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
		const transitionSnapshot = this.#transitionSnapshot?.getDiagnostics();
		this.#frameSelectionMetrics.portalTransitionSnapshotBytes =
			transitionSnapshot?.activeBytes ?? 0;
		this.#frameSelectionMetrics.portalTransitionOriginCaptured =
			(transitionSnapshot?.activeBytes ?? 0) > 0;
		this.#frameSelectionMetrics.portalTransitionSnapshotAllocatedGenerationCount =
			transitionSnapshot?.allocatedGenerationCount ?? 0;
		this.#frameSelectionMetrics.portalTransitionSnapshotDisposedGenerationCount =
			transitionSnapshot?.disposedGenerationCount ?? 0;
		const transitionTarget = this.#portalTransitionTarget;
		this.#frameSelectionMetrics.portalTransitionFramebufferCount =
			transitionTarget?.activeFramebufferCount ?? 0;
		this.#frameSelectionMetrics.portalTransitionTargetBytes =
			transitionTarget?.activeBytes ?? 0;
		this.#frameSelectionMetrics.portalTransitionVisualInstalled =
			this.#portalTransitionVisual !== null;
		this.#frameSelectionMetrics.portalTransitionGeneration =
			this.#activeTransition?.generation ?? null;
		this.#frameSelectionMetrics.portalTransitionKind =
			this.#activeTransition?.kind ?? null;
		const flatTarget = this.#flatSceneTarget;
		this.#frameSelectionMetrics.flatSceneFramebufferCount =
			flatTarget?.activeFramebufferCount ?? 0;
		this.#frameSelectionMetrics.flatSceneTargetBytes =
			flatTarget?.activeBytes ?? 0;
		this.#frameSelectionMetrics.flatSceneAllocatedGenerationCount =
			flatTarget?.allocatedGenerationCount ?? 0;
		this.#frameSelectionMetrics.flatSceneDisposedGenerationCount =
			flatTarget?.disposedGenerationCount ?? 0;
		const selectionDiagnostics = this.#entitySelectionPass?.getDiagnostics();
		this.#frameSelectionMetrics.entitySelection.activeMaskBytes =
			selectionDiagnostics?.activeMaskBytes ?? 0;
		this.#frameSelectionMetrics.entitySelection.allocatedTargetGenerationCount =
			selectionDiagnostics?.allocatedTargetGenerationCount ?? 0;
		this.#frameSelectionMetrics.entitySelection.disposedTargetGenerationCount =
			selectionDiagnostics?.disposedTargetGenerationCount ?? 0;
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
		extent: RenderExtent,
		frameSettings: FrameSettings,
	): PortalExecutionProbeResult {
		this.#assertDeviceReady();
		this.#applyRenderExtent(extent);
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
				FRONTEND_CLEAR_COLOR.red,
				FRONTEND_CLEAR_COLOR.green,
				FRONTEND_CLEAR_COLOR.blue,
				FRONTEND_CLEAR_COLOR.alpha,
			],
			PROBE_SHADING,
			frameSettings,
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
				SHARED_FRONTEND_TUNING.rendering.skyParticles.opacityScale > 0
			) {
				this.#drawParticleBatches(
					view,
					skyBatches,
					profile,
					this.#skyClockSeconds *
						SHARED_FRONTEND_TUNING.rendering.skyParticles.speedMultiplier,
					SHARED_FRONTEND_TUNING.rendering.skyParticles.opacityScale,
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
				this.#recordAmbientOcclusionWork(
					frame.atlas.tileCount,
					frame.atlas.trace.tilePixelCount,
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
		this.#drawNameplates(view, pipeline);
		const indicator = this.#frameWorldIndicator;
		if (indicator?.trajectory) {
			this.#drawWorldTrajectory(view, indicator.trajectory, {
				visibility: frame.atlas.visibility,
				routing: pipeline,
			});
		}
		if (
			indicator !== null &&
			frame.atlas.visibility.selectedScopeOrdinal(
				indicator.marker.renderScopeKey,
			) !== null
		) {
			this.#drawWorldMarker(view, indicator.marker, {
				key: indicator.marker.renderScopeKey,
				routing: pipeline,
			});
		}
		this.#drawPortalTransitionTunnel(
			target,
			frameSettings.showRetailHiddenGeometry,
			profile,
		);
		this.#presentFlatScene(
			target,
			profile,
			this.#drawEntitySelectionMask(
				view,
				frameSettings.showRetailHiddenGeometry,
			),
		);
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
		this.#entitySelectionPass?.destroy();
		this.#entitySelectionPass = null;
		this.#saoPass?.destroy();
		this.#saoPass = null;
		this.#skyPass?.destroy();
		this.#skyPass = null;
		this.#worldMarkerPass.destroy();
		this.#worldTrajectoryPass.destroy();
		this.#nameplatePass.destroy();
		this.#nameplateTextureCache.destroy();
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
		this.#outdoorPssmReceiverPrograms.destroy();
		this.#entityGroundingPrograms.destroy();
		this.#outdoorPssmPass.destroy();
		this.#frameInstances.destroy();
	}

	/** Expand one dynamic root at most once per frame across ordinary and shadow consumers. */
	#expandDynamicContributions(
		nodeId: SceneNodeId,
		includeDepth: boolean,
	): VisibleDynamicContributions {
		const existing = this.#dynamicContributions.get(nodeId);
		if (existing !== undefined && (!includeDepth || existing.includesDepth))
			return existing.contributions;
		const contributions = this.#world.expandDynamicContributions(
			nodeId,
			includeDepth,
		);
		this.#dynamicContributions.set(nodeId, {
			contributions,
			includesDepth: includeDepth,
		});
		return contributions;
	}

	/** Submit one view's outdoor maps before any scene query reuses its selection storage. */
	#renderOutdoorPssm(
		prepared: PreparedViewGeometry,
		entityShadows: EntityShadowSettings,
		showRetailHiddenGeometry: boolean,
		shading: SceneShading,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		this.#activeOutdoorPssmFrame = null;
		this.#activeOutdoorShadowProjection = null;
		if (entityShadows.mode === "none") return;
		if (entityShadows.mode === "simple") {
			if (!hasOutdoorShadowLight(shading.lighting.terrain.sunVector)) return;
			this.#activeOutdoorShadowProjection = resolveOutdoorShadowProjection(
				shading.lighting.terrain.sunVector,
				entityShadows.projection,
			);
			return;
		}
		const profileMetrics: WebGL2OutdoorPssmPassProfileMetrics | null = profile
			? createEmptyOutdoorShadowMapProfileMetrics()
			: null;
		const cpuStartedAt = profile?.beginCpuPhase();
		const gpuPhase = profile ? profile.beginGpuPhase("outdoorShadowMap") : null;
		try {
			this.#activeOutdoorPssmFrame = this.#outdoorPssmPass.render(
				{
					anchorCoordinates: prepared.anchorCoordinates,
					anchorLandblockId: prepared.anchorLandblockId,
					aspectRatio: this.#frameWidth / Math.max(1, this.#frameHeight),
					camera: {
						far: prepared.camera.far,
						near: prepared.camera.near,
						position: prepared.cameraPosition,
						rotation: prepared.camera.placement.rotation,
						verticalFovDegrees: prepared.camera.fov,
					},
					cameraFrustum: prepared.frustum,
					casterBudget: entityShadows.casterBudget,
					frameHeight: this.#frameHeight,
					frameWidth: this.#frameWidth,
					selectedDynamicNodeIds: this.#selectedDynamicNodeIds,
					showRetailHiddenGeometry,
					projectionSettings: entityShadows.projection,
					settings: entityShadows.pssm,
					sunVector: shading.lighting.terrain.sunVector,
				},
				profileMetrics,
			);
		} finally {
			gpuPhase?.finish();
			if (profile && cpuStartedAt !== undefined) {
				profile.finishCpuPhase("outdoorShadowMap", cpuStartedAt);
			}
		}
		if (profile && profileMetrics) {
			profile.recordOutdoorShadowMap(profileMetrics);
		}
		this.#activeOutdoorShadowProjection =
			this.#outdoorPssmPass.getResolvedProjection();
		if (this.#activeOutdoorPssmFrame) {
			this.#frameSelectionMetrics.frameInstanceUploadCount +=
				this.#activeOutdoorPssmFrame.instanceUploads.count;
			this.#frameSelectionMetrics.frameInstanceUploadBytes +=
				this.#activeOutdoorPssmFrame.instanceUploads.bytes;
			this.#deviceState.invalidate();
		}
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
		this.#reconcileNameplateTextureCache(
			frameSettings.nameplates.appearance,
			frameSettings.quality.renderScale,
			this.#frameViewerEntityIdentity,
		);
		const terrain: TerrainFrameInput[] = [];
		const objects: PreparedObjectFrameInput[] = [];
		const nameplates: PreparedNameplateCandidate[] = [];
		const entityShadowsEnabled = frameSettings.entityShadows.mode !== "none";
		const simpleOutdoorShadows = frameSettings.entityShadows.mode === "simple";
		this.#entityGroundingCasters.length = 0;
		this.#outdoorDirectionalCasters.length = 0;
		this.#indoorGroundingCells.clear();
		this.#indoorGroundingByScopeKey.clear();
		this.#outdoorDirectionalByLandblockId.clear();
		if (entityShadowsEnabled) {
			indexIndoorVisibilityIslands(
				this.#world.getPortalTopologyView(),
				this.#indoorVisibilityIslands,
			);
		}
		let staticObjectCount = 0;
		// One offset per visible landblock, not one per object: it is the same value for every
		// object in a landblock. Submissions carry only their landblock id, so a cached static
		// submission stays valid across re-anchoring and the frame never rewrites it.
		const landblockOffsets = new Map<LandblockOwnerId, LandblockRenderOffset>();
		const retainOffset = (landblockId: LandblockOwnerId): void => {
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
				for (const object of compiled.objects) {
					if (
						!retainsRetailGeometry(
							object.retailVisibility,
							frameSettings.showRetailHiddenGeometry,
						)
					)
						continue;
					staticObjectCount += 1;
					objects.push(object);
				}
				continue;
			}
			if (contribution.kind === "dynamic") {
				if (!this.#retainsObjectFootprint(contribution.footprint, prepared)) {
					continue;
				}
				const expandedDynamic = this.#expandDynamicContributions(nodeId, false);
				const dynamicContributions = expandedDynamic.material;
				const renderTarget =
					expandedDynamic.kind === "hidden"
						? null
						: {
								landblockId: expandedDynamic.landblockId,
								renderScopeKeys: selectedDynamicRenderScopeKeys(
									expandedDynamic.renderScopes,
									portalVisibility,
								),
							};
				if (renderTarget !== null) retainOffset(renderTarget.landblockId);
				let retainedDynamicContributionCount = 0;
				for (const contribution of dynamicContributions) {
					const { drawUnit, instance, ordering, transparentSort } =
						contribution;
					if (
						!retainsRetailGeometry(
							drawUnit.retailVisibility,
							frameSettings.showRetailHiddenGeometry,
						)
					)
						continue;
					retainedDynamicContributionCount += 1;
					if (renderTarget === null) continue;
					const { landblockId, renderScopeKeys } = renderTarget;
					const geometry = this.#world.resolveGeometry(drawUnit.geometry);
					const compiled = this.#compiledDraws.resolveDraw(
						drawUnit,
						ordering,
						() =>
							this.#compileObjectDraw({
								cullFaceOverride: null,
								geometry,
								indexCount: drawUnit.indexCount,
								indexStart: drawUnit.indexStart,
								material: drawUnit.material,
								ordering,
							}),
					);
					for (const renderScopeKey of renderScopeKeys) {
						objects.push(
							createObjectSubmission(
								{
									cullFaceOverride: null,
									drawKind: "instanced",
									geometry,
									indexCount: drawUnit.indexCount,
									indexStart: drawUnit.indexStart,
									instances: {
										transparentCohortKey:
											ordering === "opaque" || ordering === "alpha-test"
												? null
												: `${landblockId}/${renderScopeKey}/${drawUnit.batchKey}`,
										instance,
										kind: "frame-template",
									},
									landblockId,
									localToLandblock: instance.sourceToLandblock,
									material: drawUnit.material,
									ordering,
									receivesOutdoorPssm: false,
									retailVisibility: drawUnit.retailVisibility,
									renderScopeKey,
									source: "dynamic",
									transparentSort,
								},
								compiled,
							),
						);
					}
				}
				if (entityShadowsEnabled && retainedDynamicContributionCount > 0) {
					const facts = this.#world.getEntityShadowDynamicFacts(nodeId);
					const reachesIndoor = facts.spatialMembership.scopes.some(
						(scope) => scope.kind === "env-cell",
					);
					const reachesOutdoors = facts.spatialMembership.scopes.some(
						(scope) => scope.kind === "outdoor",
					);
					const caster =
						reachesIndoor || (simpleOutdoorShadows && reachesOutdoors)
							? resolveEntityShadowCaster(
									{
										entityClass: contribution.entityClass,
										identity: facts.identity,
										rigidBounds: facts.rigidBounds,
										placement: contribution.footprint.placement,
										spatialMembership: facts.spatialMembership,
									},
									this.#indoorVisibilityIslands,
									frameSettings.entityShadows.indoorGrounding,
								)
							: null;
					if (caster?.indoorGrounding) {
						this.#entityGroundingCasters.push(caster.indoorGrounding);
					}
					if (caster?.reachesOutdoors && this.#activeOutdoorShadowProjection) {
						this.#outdoorDirectionalCasters.push(
							createOutdoorDirectionalShadowCaster(
								caster.shape,
								this.#activeOutdoorShadowProjection,
								frameSettings.entityShadows.outdoorDirectional,
							),
						);
					}
				}
				if (
					renderTarget !== null &&
					renderTarget.renderScopeKeys.length > 0 &&
					retainedDynamicContributionCount > 0 &&
					frameSettings.nameplates.maximumVisible > 0
				) {
					const facts = this.#world.getEntityNameplateFacts(nodeId);
					if (facts !== null) {
						const category = resolveNameplateCategory(
							contribution.entityClass,
							facts.identity,
							this.#frameViewerEntityIdentity,
						);
						if (frameSettings.nameplates.categoryVisibility[category]) {
							const landblockOffset = createLandblockOffset(
								getLandblockCoordinates(renderTarget.landblockId),
								prepared.anchorCoordinates,
							);
							const { anchor, distanceSquared } = resolveNameplateAnchor(
								facts.rigidBounds,
								contribution.footprint.placement.localToLandblock,
								landblockOffset,
								prepared.cameraPosition,
								frameSettings.nameplates.anchorPaddingWorldUnits,
							);
							nameplates.push({
								anchor,
								distanceSquared,
								identity: facts.identity,
								renderScopeKeys: renderTarget.renderScopeKeys,
								visual: {
									category,
									content: facts.content,
								},
							});
						}
					}
				}
				this.#selectedDynamicNodeIds.add(nodeId);
				this.#frameSelectionMetrics.visibleDynamicEntityCount += 1;
				this.#frameSelectionMetrics.visibleDynamicPartCount +=
					retainedDynamicContributionCount;
				continue;
			}
			if (contribution.kind === "env-cell") {
				if (entityShadowsEnabled) {
					const facts = this.#world.getIndoorGroundingEnvCellFacts(nodeId);
					const cell = createIndoorGroundingCell(
						facts.scope,
						facts.bounds,
						this.#indoorVisibilityIslands,
					);
					this.#indoorGroundingCells.set(cell.scopeKey, cell);
				}
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
		let outdoorDirectionalEnabled = false;
		if (entityShadowsEnabled) {
			const cameraPosition = new Vec3(
				prepared.camera.placement.position.x,
				prepared.camera.placement.position.y,
				prepared.camera.placement.position.z,
			);
			const anchorOrigin = createLandblockWorldOrigin(
				prepared.anchorLandblockId,
			);
			let selectionIndex = 0;
			for (const cell of this.#indoorGroundingCells.values()) {
				const selection = (this.#entityGroundingSelectionPool[
					selectionIndex
				] ??= createEntityGroundingSelection());
				selectIndoorGroundingCasters(
					cell,
					this.#entityGroundingCasters,
					cameraPosition,
					anchorOrigin,
					selection,
					this.#entityGroundingSelectionScratch,
				);
				this.#indoorGroundingByScopeKey.set(cell.scopeKey, selection);
				selectionIndex += 1;
			}
			const outdoorShapes = simpleOutdoorShadows
				? []
				: this.#outdoorPssmPass.getAnalyticCasters();
			const projection = this.#activeOutdoorShadowProjection;
			if (projection) {
				for (const shape of outdoorShapes) {
					this.#outdoorDirectionalCasters.push(
						createOutdoorDirectionalShadowCaster(
							shape,
							projection,
							frameSettings.entityShadows.outdoorDirectional,
						),
					);
				}
			}
			if (this.#outdoorDirectionalCasters.length > 0) {
				let outdoorSelectionIndex = 0;
				for (const terrainInput of terrain) {
					const landblock = createOutdoorDirectionalShadowTerrain(
						terrainInput.drawUnit.landblockId,
					);
					const selection = (this.#outdoorDirectionalSelectionPool[
						outdoorSelectionIndex
					] ??= createOutdoorDirectionalShadowSelection());
					selectOutdoorDirectionalShadowCasters(
						landblock,
						this.#outdoorDirectionalCasters,
						cameraPosition,
						anchorOrigin,
						selection,
						this.#outdoorDirectionalSelectionScratch,
					);
					this.#outdoorDirectionalByLandblockId.set(
						landblock.landblockId,
						selection,
					);
					outdoorDirectionalEnabled ||= selection.count > 0;
					outdoorSelectionIndex += 1;
				}
			}
		}
		if (profile && resolutionStartedAt !== undefined) {
			profile.finishCpuPhase(
				"sceneContributionResolution",
				resolutionStartedAt,
			);
		}
		retainLegibleNameplates(
			nameplates,
			prepared.clipFromAnchor,
			frameSettings.nameplates,
		);
		const eligibleNameplateCandidateCount = nameplates.length;
		retainNearestNameplates(
			nameplates,
			frameSettings.nameplates.maximumVisible,
		);
		this.#eligibleNameplateCandidateCount += eligibleNameplateCandidateCount;
		this.#budgetRejectedNameplateCandidateCount +=
			eligibleNameplateCandidateCount - nameplates.length;
		if (profile) {
			profile.recordObjectPreparation(
				staticObjectCount,
				objects.length - staticObjectCount,
			);
		}
		return {
			entityAnalyticShadows: entityShadowsEnabled
				? {
						indoorByScopeKey: this.#indoorGroundingByScopeKey,
						outdoorByLandblockId: this.#outdoorDirectionalByLandblockId,
						outdoorEnabled: outdoorDirectionalEnabled,
						outdoorSettings: frameSettings.entityShadows.outdoorDirectional,
						indoorSettings: frameSettings.entityShadows.indoorGrounding,
					}
				: null,
			landblockOffsets,
			nameplates,
			nameplateReferenceDistance: frameSettings.nameplates.referenceDistance,
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
					drawKind: "single",
					geometry: resolved.geometry,
					indexCount: resolved.drawUnit.indexCount,
					indexStart: resolved.drawUnit.indexStart,
					instances: null,
					landblockId: node.placement.landblockId,
					localToLandblock: node.placement.localToLandblock,
					material: resolved.drawUnit.material,
					ordering: resolved.drawUnit.ordering,
					receivesOutdoorPssm: false,
					retailVisibility: "normally-visible",
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
		const receivesOutdoorPssm = isOutdoorPssmReceiverFootprint(
			contribution.footprint,
		);
		for (const resolved of node.drawUnits) {
			const { drawUnit } = resolved;
			objects.push(
				this.#compileStaticSubmission(drawUnit, {
					cullFaceOverride: null,
					drawKind: "single",
					geometry: resolved.geometry,
					indexCount: drawUnit.indexCount,
					indexStart: drawUnit.indexStart,
					instances: null,
					landblockId: node.placement.landblockId,
					localToLandblock: node.placement.localToLandblock,
					material: drawUnit.material,
					ordering: drawUnit.ordering,
					receivesOutdoorPssm,
					retailVisibility: drawUnit.retailVisibility,
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
						transparentCohortKey: template.cohortKey,
						instance: template.instance,
						kind: "frame-template",
					},
					landblockId: node.placement.landblockId,
					localToLandblock: node.placement.localToLandblock,
					material: template.material,
					ordering: "transparent",
					receivesOutdoorPssm,
					retailVisibility: template.retailVisibility,
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
		const compatibility: PreparedObjectDrawCompatibility = {
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
		};
		return {
			batchKey: `${object.ordering}\0${object.geometry}\0${object.indexStart}\0${object.indexCount}`,
			blendPolicy: objectBlendPolicy(material.source.rawSurfaceFlags),
			compatibility,
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
		this.#eligibleNameplateCandidateCount = 0;
		this.#budgetRejectedNameplateCandidateCount = 0;
		this.#submittedNameplateInstanceCount = 0;
		this.#submittedNameplateDrawCount = 0;
		metrics.ambientOcclusion.activeBytes = 0;
		metrics.ambientOcclusion.allocatedGenerationCount = 0;
		metrics.ambientOcclusion.pixelCount = 0;
		metrics.ambientOcclusion.tileCount = 0;
		metrics.ambientOcclusion.disposedGenerationCount = 0;
		metrics.ambientOcclusion.effectiveDistanceFade = null;
		metrics.entitySelection.compositeDrawCount = 0;
		metrics.entitySelection.maskDrawCount = 0;
		metrics.entitySelection.selectedSphereProxyCount = 0;
		metrics.entitySelection.selectedPartCount = 0;
		metrics.entitySelection.selectedTriangleCount = 0;
		metrics.entitySelection.skippedReason = "no-target";
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
		metrics.portalTransitionSnapshotBytes = 0;
		metrics.portalTransitionOriginCaptured = false;
		metrics.portalTransitionSnapshotAllocatedGenerationCount = 0;
		metrics.portalTransitionSnapshotDisposedGenerationCount = 0;
		metrics.portalTransitionFramebufferCount = 0;
		metrics.portalTransitionTargetBytes = 0;
		metrics.submittedPortalTransitionDrawCount = 0;
		metrics.portalTransitionVisualInstalled = false;
		metrics.portalTransitionGeneration = null;
		metrics.portalTransitionKind = null;
		metrics.portalTransitionOnlyFramePresented = false;
		metrics.flatSceneFramebufferCount = 0;
		metrics.flatSceneTargetBytes = 0;
		metrics.flatSceneAllocatedGenerationCount = 0;
		metrics.flatSceneDisposedGenerationCount = 0;
		metrics.visibleSceneEntries = 0;
		this.#visibleStaticLayers.clear();
		this.#visibleEnvCellScopes.clear();
		this.#dynamicContributions.clear();
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
		metrics.objectDrawCalls = 0;
		metrics.objectUniformUploads = 0;
		metrics.objectSuppressedUniformUploads = 0;
	}

	/** Finish counters shared by ordinary frames and explicit portal execution probes. */
	#finishFrameSelectionMetrics(): void {
		const census = this.#mergeCensusRequest;
		if (census !== null) {
			this.#mergeCensusRequest = null;
			census.resolve(census.collector.summarize());
		}
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
		view: PreparedViewGeometry,
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
			state: this.#deviceState,
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
		showRetailHiddenGeometry: boolean,
		profile: WebGL2FrameProfileCapture | null,
	): void {
		const target = this.#acquireFlatSceneTarget();
		this.#beginFlatOpaqueScene(target);
		const objectPhases = this.#createObjectSubmissionPhases(view, profile);
		if (domain === "exterior") {
			this.#submitSkyPhase(view, shading, "before-world", profile, null);
			if (
				view.skyParticles.length > 0 &&
				SHARED_FRONTEND_TUNING.rendering.skyParticles.opacityScale > 0
			) {
				this.#drawParticleBatches(
					view,
					view.skyParticles,
					profile,
					this.#skyClockSeconds *
						SHARED_FRONTEND_TUNING.rendering.skyParticles.speedMultiplier,
					SHARED_FRONTEND_TUNING.rendering.skyParticles.opacityScale,
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
				this.#recordAmbientOcclusionWork(
					1,
					target.extent.width * target.extent.height,
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
		this.#drawNameplates(view, null);
		const indicator = this.#frameWorldIndicator;
		if (indicator?.trajectory)
			this.#drawWorldTrajectory(view, indicator.trajectory, null);
		if (indicator !== null) this.#drawWorldMarker(view, indicator.marker, null);
		this.#gl.bindVertexArray(null);
		this.#drawPortalTransitionTunnel(target, showRetailHiddenGeometry, profile);
		this.#presentFlatScene(
			target,
			profile,
			this.#drawEntitySelectionMask(view, showRetailHiddenGeometry),
		);
	}

	#reconcileNameplateTextureCache(
		appearance: NameplateAppearance,
		density: number,
		viewerEntityIdentity: string | null,
	): void {
		const revision = this.#world.getNameplatePopulationRevision();
		if (
			revision === this.#reconciledNameplatePopulationRevision &&
			appearance === this.#reconciledNameplateAppearance &&
			density === this.#reconciledNameplateDensity &&
			viewerEntityIdentity === this.#reconciledNameplateViewerIdentity
		)
			return;
		this.#nameplatePopulationScratch.length = 0;
		this.#world.forEachNameplateVisual((identity, visual) => {
			this.#nameplatePopulationScratch.push({
				...visual,
				category: resolveNameplateCategory(
					visual.entityClass,
					identity,
					viewerEntityIdentity,
				),
			});
		});
		this.#nameplateTextureCache.reconcile(
			this.#nameplatePopulationScratch,
			appearance,
			density,
		);
		this.#reconciledNameplatePopulationRevision = revision;
		this.#reconciledNameplateAppearance = appearance;
		this.#reconciledNameplateDensity = density;
		this.#reconciledNameplateViewerIdentity = viewerEntityIdentity;
	}

	#drawNameplates(
		view: PreparedView,
		portalRouting: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		const context = {
			clipFromAnchor: mat4ToFloat32Array(
				view.clipFromAnchor,
				this.#matrixScratch,
			),
			referenceDistance: view.nameplateReferenceDistance,
			viewportHeight: this.#frameHeight,
			viewportWidth: this.#frameWidth,
		};
		if (view.nameplates.length === 0) {
			if (portalRouting)
				this.#nameplatePass.drawScoped(context, [], portalRouting);
			else this.#nameplatePass.draw(context, []);
			return;
		}
		if (portalRouting) {
			let instanceCount = 0;
			for (const candidate of view.nameplates) {
				const binding = this.#nameplateTextureCache.acquire(candidate.visual);
				for (const renderScopeKey of candidate.renderScopeKeys) {
					const instance = this.#scopedNameplateDrawScratch[instanceCount];
					if (instance === undefined) {
						this.#scopedNameplateDrawScratch.push({
							anchor: candidate.anchor,
							binding,
							renderScopeKey,
						});
					} else {
						instance.anchor = candidate.anchor;
						instance.binding = binding;
						instance.renderScopeKey = renderScopeKey;
					}
					instanceCount += 1;
				}
			}
			this.#scopedNameplateDrawScratch.length = instanceCount;
			this.#nameplatePass.drawScoped(
				context,
				this.#scopedNameplateDrawScratch,
				portalRouting,
			);
		} else {
			let instanceCount = 0;
			for (const candidate of view.nameplates) {
				const binding = this.#nameplateTextureCache.acquire(candidate.visual);
				const instance = this.#nameplateDrawScratch[instanceCount];
				if (instance === undefined) {
					this.#nameplateDrawScratch.push({
						anchor: candidate.anchor,
						binding,
					});
				} else {
					instance.anchor = candidate.anchor;
					instance.binding = binding;
				}
				instanceCount += 1;
			}
			this.#nameplateDrawScratch.length = instanceCount;
			this.#nameplatePass.draw(context, this.#nameplateDrawScratch);
		}
		const diagnostics = this.#nameplatePass.diagnostics();
		this.#submittedNameplateDrawCount += diagnostics.drawCount;
		this.#submittedNameplateInstanceCount += diagnostics.instanceCount;
	}

	#drawWorldMarker(
		view: PreparedViewGeometry,
		marker: WorldMarkerInput,
		portal: Parameters<WebGL2WorldMarkerPass["draw"]>[1],
	): void {
		const center = anchorRelativePosition(
			marker.position,
			view.anchorLandblockId,
		);
		const cameraDistance = Math.sqrt(
			center.distanceSquaredTo(view.cameraPosition),
		);
		this.#worldMarkerPass.draw(
			{
				center,
				clipFromAnchor: view.clipFromAnchor,
				color: marker.color,
				normal: marker.normal,
				radius: Math.min(2.4, Math.max(marker.radius, cameraDistance * 0.012)),
			},
			portal,
		);
	}

	#drawWorldTrajectory(
		view: PreparedViewGeometry,
		trajectory: NonNullable<WorldIndicatorInput["trajectory"]>,
		portal: Parameters<WebGL2WorldTrajectoryPass["draw"]>[2],
	): void {
		this.#worldTrajectoryPass.draw(
			trajectory,
			{
				anchorOrigin: createLandblockWorldOrigin(view.anchorLandblockId),
				clipFromAnchor: view.clipFromAnchor,
				color: trajectory.color,
				viewportHeight: this.#frameHeight,
				viewportWidth: this.#frameWidth,
			},
			portal,
		);
	}

	/**
	 * Render the authored portal setup into a transition-only target before final presentation.
	 *
	 * The setup is placed in a virtual camera room using the retail camera facts rather than added
	 * to the world scene. That keeps world authority and culling untouched while still exercising
	 * the same compiled geometry, atlas bindings, material partitions, and animation sampler used
	 * by ordinary setup visuals.
	 */
	#drawPortalTransitionTunnel(
		sceneTarget: WebGL2FlatSceneTargetSet,
		showRetailHiddenGeometry: boolean,
		profile: WebGL2FrameProfileCapture | null,
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
		const startedAt = profile?.beginCpuPhase();
		try {
			this.#beginPortalTransitionTarget(target);
			const view = this.#prepareViewGeometry(PORTAL_TRANSITION_ANCHOR, {
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
			const objects: PreparedObjectFrameInput[] = [];
			for (const part of visual.template.parts) {
				const pose = partPoses[part.partIndex];
				if (!pose) {
					throw new Error(
						`Portal animation has no pose for setup part ${part.partIndex}.`,
					);
				}
				const localToLandblock = multiplyMat4(
					portalCameraWorld,
					composeObjectPartTransform(
						pose,
						new Vec3(1, 1, 1),
						part.defaultScale,
					),
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
					const geometry = this.#world.resolveGeometry(drawUnit.geometry);
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
						renderScopeKey: PORTAL_TRANSITION_SCOPE,
						source: "portal-transition",
						transparentSort: {
							center: transparentCenter,
							stableId: `portal-transition/${part.partIndex}/${drawUnit.batchKey}`,
						},
					};
					const compiled = this.#compiledDraws.resolveDraw(
						drawUnit,
						drawUnit.ordering,
						() => this.#compileObjectDraw(object),
					);
					objects.push(createObjectSubmission(object, compiled));
				}
			}
			const portalViewInput: PreparedView = {
				...view,
				landblockOffsets: new Map([[view.anchorLandblockId, [0, 0, 0]]]),
				// Portal space is a presentation-only authored setup, never a dynamic-entity view.
				nameplates: [],
				nameplateReferenceDistance:
					SHARED_FRONTEND_TUNING.rendering.nameplates.referenceDistance,
				objects,
				particles: [],
				skyParticles: [],
				terrain: [],
				entityAnalyticShadows: null,
			};
			const portalShading: SceneShading = {
				authoredLightResponse: 0,
				ambientOcclusion: { kind: "disabled" },
				anchorOrigin: { x: 0, z: 0 },
				dynamicLights: [],
				fog: null,
				sky: null,
				staticLights: () => EMPTY_LANDBLOCK_LIGHTS,
				weatherEnabled: false,
				lighting: resolveSceneLightingByRole(PORTAL_TRANSITION_LIGHTING),
			};
			const phases = this.#createObjectSubmissionPhases(
				portalViewInput,
				profile,
			);
			this.#drawOpaqueObjects(
				portalViewInput,
				phases.opaque,
				portalShading,
				profile,
				null,
			);
			this.#drawBlendedObjects(
				portalViewInput,
				phases,
				portalShading,
				profile,
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
			if (profile && startedAt !== undefined) {
				profile.finishCpuPhase("portalComposition", startedAt);
			}
		}
	}

	/** Clear a tunnel target with transparent color so only authored pixels cover the world. */
	#beginPortalTransitionTarget(target: WebGL2FlatSceneTargetSet): void {
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
		gl.viewport(0, 0, target.extent.width, target.extent.height);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.clearColor(0, 0, 0, 0);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
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

	/** Draw the selected current pose outside ordinary visibility and scene-depth policy. */
	#drawEntitySelectionMask(
		view: PreparedViewGeometry,
		showRetailHiddenGeometry: boolean,
	): WebGL2EntitySelectionMask | null {
		const target = this.#frameSelectionTarget;
		if (target === null) {
			this.#frameSelectionMetrics.entitySelection.skippedReason = "no-target";
			return null;
		}
		const nodeId = target.nodeId;
		const contributions = this.#expandDynamicContributions(nodeId, true);
		const rendered = (this.#entitySelectionPass ??=
			new WebGL2EntitySelectionPass(this.#gl, {
				getGeometry: (key) =>
					this.#resources.getGeometry(this.#world.resolveGeometry(key)),
			})).render({
			anchorCoordinates: view.anchorCoordinates,
			clipFromAnchor: view.clipFromAnchor,
			contributions,
			height: this.#frameHeight,
			nodeId,
			shape: target.shape,
			showRetailHiddenGeometry,
			width: this.#frameWidth,
		});
		if (rendered === null) {
			this.#frameSelectionMetrics.entitySelection.skippedReason =
				"hidden-or-empty";
			return null;
		}
		const metrics = this.#frameSelectionMetrics.entitySelection;
		metrics.compositeDrawCount += 1;
		metrics.maskDrawCount += rendered.work.maskDrawCount;
		metrics.selectedSphereProxyCount += rendered.work.selectedSphereProxyCount;
		metrics.selectedPartCount += rendered.work.selectedPartCount;
		metrics.selectedTriangleCount += rendered.work.selectedTriangleCount;
		metrics.skippedReason = null;
		return rendered.mask;
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
		selectionMask: WebGL2EntitySelectionMask | null = null,
	): void {
		const presentationGpu = profile?.beginGpuPhase("presentation") ?? null;
		try {
			const transition = this.#transitionPresentationInput();
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
			);
		} finally {
			presentationGpu?.finish();
		}
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
		this.#beginObjectPhase();
	}

	/** Capture or retire transition-only resources at frame entry, before the scene target is drawn. */
	#prepareTransitionSnapshot(transition: FrameInput["portalTransition"]): void {
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
	#transitionPresentationInput(): FlatScenePresentationInput {
		const transition = this.#activeTransition;
		const snapshot = this.#transitionSnapshot?.getCurrentTarget();
		const tunnel = this.#portalTransitionTarget?.getCurrentTarget();
		return resolvePortalTransitionComposition(transition ?? undefined, {
			origin: snapshot?.texture ?? null,
			tunnel: tunnel?.color ?? null,
		});
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

	/** Account for the exact full-resolution workload of one successful SAO invocation. */
	#recordAmbientOcclusionWork(tileCount: number, pixelCount: number): void {
		const metrics = this.#frameSelectionMetrics.ambientOcclusion;
		metrics.tileCount += tileCount;
		metrics.pixelCount += pixelCount;
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
		let directionalCount = 0;
		let farCount = 0;
		for (const terrain of view.terrain) {
			assertSharedTerrainRegion(
				passResources.program,
				terrain.program,
				terrain.drawUnit.landblockId,
			);
			if (this.#isFarTerrain(terrain, view, farCutoff)) farCount += 1;
			else {
				nearCount += 1;
				if (this.#hasTerrainDirectionalShadow(terrain, view)) {
					directionalCount += 1;
				}
			}
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
				for (const directional of [false, true]) {
					const count = directional
						? directionalCount
						: nearCount - directionalCount;
					if (count === 0) continue;
					const nearProgram = this.#beginNearTerrainGroup(
						view,
						shading,
						passResources,
						portalPipeline,
						routedTerrainPass ? null : view.terrain.length,
						directional,
					);
					routedTerrainPass = true;
					this.#drawNearTerrainGroup(
						view,
						shading,
						farCutoff,
						nearProgram,
						directional,
					);
				}
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
		routeSubmissionCount: number | null,
		directional: boolean,
	): WebGL2NearTerrainProgram {
		const mapped = this.#activeOutdoorPssmFrame !== null;
		const selected = mapped
			? directional
				? this.#outdoorPssmReceiverPrograms.hybridTerrain()
				: this.#outdoorPssmReceiverPrograms.terrain()
			: directional
				? this.#outdoorPssmReceiverPrograms.directionalTerrain()
				: this.#nearTerrainProgram;
		const { program, uniforms } = selected;
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
			SHARED_FRONTEND_TUNING.rendering.terrainDetailFade.near,
		);
		gl.uniform1f(
			uniforms.detailFadeFar,
			SHARED_FRONTEND_TUNING.rendering.terrainDetailFade.far,
		);
		bindWebGL2DynamicLights(
			gl,
			uniforms,
			shading.dynamicLights,
			shading.anchorOrigin,
			this.#dynamicLightScratch,
		);
		const outdoorPssm = this.#activeOutdoorPssmFrame;
		if (outdoorPssm) {
			const pssmUniforms = selected.outdoorPssmUniforms;
			if (!pssmUniforms) {
				throw new Error("Active outdoor PSSM selected plain terrain program.");
			}
			bindWebGL2OutdoorPssmUniforms(
				gl,
				pssmUniforms,
				outdoorPssm,
				this.#outdoorPssmUniformScratch,
			);
			gl.activeTexture(gl.TEXTURE0 + OUTDOOR_PSSM_TEXTURE_UNIT);
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, outdoorPssm.targets.depth);
			gl.bindSampler(OUTDOOR_PSSM_TEXTURE_UNIT, null);
			gl.activeTexture(gl.TEXTURE0);
		}
		this.#beginTerrainLightMasks(selected);
		this.#beginTerrainPassResources(passResources, selected);
		return selected;
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
		program: WebGL2NearTerrainProgram,
		directional: boolean,
	): void {
		for (const terrain of view.terrain) {
			if (this.#isFarTerrain(terrain, view, farCutoff)) continue;
			if (this.#hasTerrainDirectionalShadow(terrain, view) !== directional)
				continue;
			const landblockOffset = createLandblockOffset(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
				this.#offsetScratch,
			);
			this.#bindTerrainSurfaceField(terrain, program);
			const landblockLights = shading.staticLights(
				terrain.drawUnit.landblockId,
			);
			bindWebGL2StaticLights(
				this.#gl,
				program.uniforms,
				landblockLights.lights,
				shading.anchorOrigin,
				shading.authoredLightResponse,
				this.#dynamicLightScratch,
			);
			this.#uploadTerrainLightMask(landblockLights);
			this.#frameSelectionMetrics.staticLightBinds += 1;
			if (directional) {
				this.#applyTerrainDirectionalShadow(program, terrain, view);
			}
			this.#drawTerrainGeometry(
				terrain.program.geometry,
				program.uniforms.landblockOffset,
				landblockOffset,
			);
		}
	}

	#hasTerrainDirectionalShadow(
		terrain: TerrainFrameInput,
		view: PreparedView,
	): boolean {
		return (
			(view.entityAnalyticShadows?.outdoorByLandblockId.get(
				terrain.drawUnit.landblockId,
			)?.count ?? 0) > 0
		);
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
		const outdoorDirectional =
			view.entityAnalyticShadows?.outdoorByLandblockId.get(
				terrain.drawUnit.landblockId,
			);
		if (outdoorDirectional && outdoorDirectional.count > 0) return false;
		if (
			this.#activeOutdoorPssmFrame &&
			terrainLandblockIntersectsShadowDistance(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
				view.cameraPosition,
				this.#activeOutdoorPssmFrame.settings.maximumDistance,
			)
		) {
			return false;
		}
		return (
			farCutoff !== null &&
			landblockChebyshevDistance(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
			) >= farCutoff
		);
	}

	/** Bind one terrain landblock's directional analytic records before its existing draw. */
	#applyTerrainDirectionalShadow(
		program: WebGL2NearTerrainProgram,
		terrain: TerrainFrameInput,
		view: PreparedView,
	): void {
		const uniforms = program.outdoorDirectionalShadowUniforms;
		const active = view.entityAnalyticShadows;
		const selection = active?.outdoorByLandblockId.get(
			terrain.drawUnit.landblockId,
		);
		if (!uniforms) {
			if (active?.outdoorEnabled && selection !== undefined) {
				throw new Error(
					"Active directional-shadow draw selected an ordinary terrain program.",
				);
			}
			return;
		}
		if (!active?.outdoorEnabled || selection === undefined) {
			throw new Error(
				"Directional-shadow program selected without an active landblock record set.",
			);
		}
		bindWebGL2OutdoorDirectionalShadowUniforms(
			this.#gl,
			uniforms,
			selection,
			active.outdoorSettings,
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
	#beginTerrainPassResources(
		input: TerrainFrameInput,
		program: WebGL2NearTerrainProgram,
	): void {
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
			program.uniforms.composition,
			"exact",
			TextureWrapMode.Clamp,
		);
		this.#bindTextureArray(
			2,
			colors,
			program.uniforms.colors,
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
			program.uniforms.blendMasks,
			"filterable",
			TextureWrapMode.Clamp,
		);
		this.#bindTextureArray(
			4,
			roadMasks,
			program.uniforms.roadMasks,
			"filterable",
			TextureWrapMode.Clamp,
		);
		this.#bindTexture2D(
			5,
			detail,
			program.uniforms.detail,
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
	#bindTerrainSurfaceField(
		input: TerrainFrameInput,
		program: WebGL2NearTerrainProgram,
	): void {
		const surfaceField = this.#resources.getTexture2D(
			input.program.surfaceField,
		);
		const gl = this.#gl;
		this.#bindTexture2D(
			0,
			surfaceField,
			program.uniforms.surfaceField,
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
	#beginTerrainLightMasks(program: WebGL2NearTerrainProgram): void {
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
			program.uniforms.staticLightMask,
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
						? object.instances.transparentCohortKey
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
			{ cohort: "ignore", grouping: "grouped" },
		]).objects;
		const submissionStartedAt = profile?.beginCpuPhase();
		const gl = this.#gl;
		try {
			this.#beginObjectPhase();
			gl.depthMask(true);
			this.#deviceState.applyBlend(null);
			for (const object of objects) {
				const receivesIndoorGrounding =
					object.source === "env-cell-shell" &&
					view.entityAnalyticShadows?.indoorByScopeKey.has(
						object.renderScopeKey,
					) === true;
				const receivesOutdoorPssm =
					this.#activeOutdoorPssmFrame !== null && object.receivesOutdoorPssm;
				const program = receivesIndoorGrounding
					? this.#entityGroundingPrograms.fogged()
					: receivesOutdoorPssm
						? object.drawKind === "instanced"
							? this.#outdoorPssmReceiverPrograms.foggedInstanced()
							: this.#outdoorPssmReceiverPrograms.foggedBaked()
						: object.drawKind === "instanced"
							? this.#instancedObjectProgram
							: this.#objectProgram;
				const programChanged = this.#deviceState.applyProgram(program.program);
				if (programChanged) {
					this.#activateObjectProgram(program, view, shading);
				}
				this.#applyObjectLighting(program, object, shading);
				this.#applyObjectGrounding(program, object, view);
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
			let portalPrograms: {
				readonly baked: WebGL2ObjectProgram;
				readonly instanced: WebGL2InstancedObjectProgram;
			} | null = null;
			for (const object of sortedBlended) {
				const receivesIndoorGrounding =
					object.source === "env-cell-shell" &&
					view.entityAnalyticShadows?.indoorByScopeKey.has(
						object.renderScopeKey,
					) === true;
				const receivesOutdoorPssm =
					this.#activeOutdoorPssmFrame !== null && object.receivesOutdoorPssm;
				let program: AnyObjectProgram;
				if (receivesIndoorGrounding) {
					program = this.#entityGroundingPrograms.blended(
						portalPipeline !== null,
					);
				} else if (receivesOutdoorPssm) {
					program =
						object.drawKind === "instanced"
							? this.#outdoorPssmReceiverPrograms.blendedInstanced(
									portalPipeline !== null,
								)
							: this.#outdoorPssmReceiverPrograms.blendedBaked(
									portalPipeline !== null,
								);
				} else {
					if (portalPipeline) {
						portalPrograms ??= this.#requirePortalBlendedObjectPrograms();
					}
					program =
						object.drawKind === "instanced"
							? (portalPrograms?.instanced ??
								this.#blendedInstancedObjectProgram)
							: (portalPrograms?.baked ?? this.#blendedObjectProgram);
				}
				if (this.#deviceState.applyProgram(program.program)) {
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
				this.#applyObjectGrounding(program, object, view);
				this.#deviceState.applyBlend(object.blendPolicy);
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
				transformSource: "attribute",
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
			[
				{
					cohort: "require",
					grouping: "adjacent",
				},
				{
					cohort: "require",
					grouping: "adjacent",
				},
				{
					cohort: "require",
					grouping: "grouped",
				},
			],
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
		policies: readonly FrameInstancePhasePolicy[],
	): {
		readonly objects: readonly PreparedObjectFrameInput[];
		readonly runCounts: readonly number[];
	} {
		const orderedInstances: ObjectInstanceData[] = [];
		const objects: PreparedObjectFrameInput[] = [];
		const runCounts: number[] = [];
		const preparationStartedAt = profile?.beginCpuPhase();
		for (const [phaseIndex, phase] of phases.entries()) {
			const policy = policies[phaseIndex];
			if (!policy) {
				throw new Error(
					`Object instance phase ${phaseIndex} has no grouping policy.`,
				);
			}
			const scheduled = scheduleFrameInstanceRuns(phase, policy);
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

	/**
	 * Account for one per-draw uniform write.
	 *
	 * Issued and suppressed are counted separately rather than derived from each other, because
	 * their sum is the uniform set a draw would send without filtering, and the ratio between them
	 * is what the filtering actually saves. A method rather than a closure so the submission path
	 * allocates nothing per draw.
	 */
	#countUniformWrite(issued: boolean): void {
		const metrics = this.#frameSelectionMetrics;
		if (issued) metrics.objectUniformUploads += 1;
		else metrics.objectSuppressedUniformUploads += 1;
	}

	#drawObjectRange(
		program: AnyObjectProgram,
		object: PreparedObjectFrameInput,
		landblockOffsets: PreparedSceneContributions["landblockOffsets"],
	): void {
		if (
			(object.drawKind === "single") !==
			(program.transformSource === "uniform")
		) {
			throw new Error(
				`${object.drawKind} draw cannot use ${program.transformSource} object program.`,
			);
		}
		const { compatibility } = object;
		const gl = this.#gl;
		const state = this.#deviceState;
		state.applyCullFace(compatibility.cullFace);
		if (program.transformSource === "uniform") {
			this.#countUniformWrite(
				state.applyUniformMatrix4fv(
					program.uniforms.localToLandblock,
					mat4ToFloat32Array(object.localToLandblock, this.#matrixScratch),
				),
			);
		}
		const landblockOffset = landblockOffsets.get(object.landblockId);
		if (landblockOffset === undefined) {
			throw new Error(
				`Submitted object in landblock ${object.landblockId} has no frame offset.`,
			);
		}
		this.#countUniformWrite(
			state.applyUniform3f(
				program.uniforms.landblockOffset,
				landblockOffset[0],
				landblockOffset[1],
				landblockOffset[2],
			),
		);
		this.#countUniformWrite(
			state.applyUniform1i(
				program.uniforms.wrapRepeat,
				compatibility.wrapRepeat ? 1 : 0,
			),
		);
		this.#countUniformWrite(
			state.applyUniform1i(
				program.uniforms.palettedClipMap,
				compatibility.palettedClipMap ? 1 : 0,
			),
		);
		this.#countUniformWrite(
			state.applyUniform1f(program.uniforms.alphaTest, compatibility.alphaTest),
		);
		const preparedMaterial = compatibility.material;
		if (preparedMaterial.kind === "solid-color") {
			this.#countUniformWrite(
				state.applyUniform1i(program.uniforms.materialKind, 0),
			);
			this.#countUniformWrite(
				state.applyUniform4f(
					program.uniforms.materialColor,
					...preparedMaterial.color,
				),
			);
		} else {
			this.#bindPreparedObjectTexture(
				OBJECT_TEXTURE_UNITS.base,
				preparedMaterial.base,
			);
			this.#countUniformWrite(
				state.applyUniform4f(
					program.uniforms.baseRect,
					...preparedMaterial.base.rect,
				),
			);
			this.#countUniformWrite(
				state.applyUniform1i(
					program.uniforms.materialKind,
					preparedMaterial.kind === "direct-color"
						? 1
						: preparedMaterial.kind === "index8"
							? 2
							: 3,
				),
			);
			this.#countUniformWrite(
				state.applyUniform4f(
					program.uniforms.materialColor,
					...preparedMaterial.color,
				),
			);
			if (preparedMaterial.kind !== "direct-color") {
				this.#bindPreparedObjectTexture(
					OBJECT_TEXTURE_UNITS.palette,
					preparedMaterial.palette,
				);
				this.#countUniformWrite(
					state.applyUniform4f(
						program.uniforms.paletteRect,
						...preparedMaterial.palette.rect,
					),
				);
			}
		}
		const { detail } = compatibility;
		if (detail) {
			this.#bindPreparedObjectTexture(OBJECT_TEXTURE_UNITS.detail, detail);
			this.#countUniformWrite(
				state.applyUniform4f(program.uniforms.detailRect, ...detail.rect),
			);
			this.#countUniformWrite(
				state.applyUniform1f(program.uniforms.detailTiling, detail.tiling),
			);
			this.#countUniformWrite(
				state.applyUniform1i(program.uniforms.useDetail, 1),
			);
		} else {
			this.#countUniformWrite(
				state.applyUniform1i(program.uniforms.useDetail, 0),
			);
		}
		this.#countUniformWrite(
			state.applyUniform1f(
				program.uniforms.luminosity,
				compatibility.luminosity,
			),
		);
		this.#frameSelectionMetrics.objectDrawCalls += 1;
		const geometry = compatibility.geometry;
		state.applyVertexArray(geometry.vertexArray);
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
		} else if (object.source === "portal-transition") {
			this.#frameSelectionMetrics.submittedPortalTransitionDrawCount += 1;
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
		if (
			object.drawKind === "single" &&
			object.source !== "dynamic" &&
			object.source !== "portal-transition"
		) {
			this.#frameSelectionMetrics.submittedBakedStaticObjectDrawCount += 1;
			this.#frameSelectionMetrics.submittedBakedStaticObjectTriangleCount +=
				sourceTriangleCount;
			this.#mergeCensusRequest?.collector.record(
				object.landblockId,
				object.localToLandblock,
				compatibility,
			);
		} else if (object.source !== "portal-transition") {
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
		const pssmUniforms = program.outdoorPssmUniforms;
		if (pssmUniforms) {
			const active = this.#activeOutdoorPssmFrame;
			if (!active) {
				throw new Error("Outdoor PSSM receiver program has no active frame.");
			}
			bindWebGL2OutdoorPssmUniforms(
				gl,
				pssmUniforms,
				active,
				this.#outdoorPssmUniformScratch,
			);
			this.#deviceState.applyTextureArrayUnit(
				OUTDOOR_PSSM_TEXTURE_UNIT,
				active.targets.depth,
			);
		}
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
		if (this.#deviceState.applyLightingRole(role)) {
			bindWebGL2SceneLighting(
				this.#gl,
				program.uniforms,
				shading.lighting[role],
			);
			this.#frameSelectionMetrics.objectLightingBinds += 1;
		}
		// Interior geometry already carries its static lighting in baked vertex colours, so it
		// binds an empty set rather than the landblock's outdoor lamps.
		const scope =
			role === "interior-object" || object.source === "portal-transition"
				? null
				: object.landblockId;
		if (!this.#deviceState.applyStaticLightScope(scope)) return;
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

	/** Bind one shell scope's fixed analytic-grounding set through the object uniform cache. */
	#applyObjectGrounding(
		program: AnyObjectProgram,
		object: ObjectFrameInput,
		view: PreparedView,
	): void {
		const uniforms = program.entityGroundingUniforms;
		const active = view.entityAnalyticShadows;
		const selection = active?.indoorByScopeKey.get(object.renderScopeKey);
		if (!uniforms) {
			if (object.source === "env-cell-shell" && selection !== undefined) {
				throw new Error(
					"Active EnvCell grounding draw selected an ordinary object program.",
				);
			}
			return;
		}
		if (
			object.source !== "env-cell-shell" ||
			active === null ||
			selection === undefined
		) {
			throw new Error(
				"Indoor grounding program selected without an active EnvCell record set.",
			);
		}
		const attempted = entityGroundingUniformAttemptCount(selection);
		const issued = applyWebGL2EntityGroundingUniforms(
			this.#deviceState,
			uniforms,
			selection,
			active.indoorSettings,
		);
		this.#frameSelectionMetrics.objectUniformUploads += issued;
		this.#frameSelectionMetrics.objectSuppressedUniformUploads +=
			attempted - issued;
	}

	/**
	 * Resolve and budget one landblock's authored lights.
	 *
	 * The index memoizes the gather across frames, so the per-frame cost is a map read plus a
	 * budget fit that is a pass-through whenever the set fits, which it almost always does.
	 */
	#resolveStaticLights(
		input: FrameInput,
		landblockId: LandblockOwnerId,
		sceneCameraPosition: SceneVec3,
	): LandblockLights {
		if (!input.frameSettings.staticLightsEnabled) {
			return EMPTY_LANDBLOCK_LIGHTS;
		}
		if (input.outdoorLights.isEmpty) return EMPTY_LANDBLOCK_LIGHTS;
		const reaching = input.outdoorLights.resolve(landblockId);
		if (reaching.lights.length <= MAX_STATIC_LIGHTS) return reaching;
		const fitted = fitLightsToBudget(
			reaching.lights,
			sceneCameraPosition,
			MAX_STATIC_LIGHTS,
		);
		this.#frameSelectionMetrics.droppedLights += fitted.dropped;
		// The fit reorders by distance from the camera, so the memoized masks no longer name these
		// slots. Fall back to admitting every light rather than binding a stale table; the shader
		// still bounds iteration by the live count, so the result is identical and only the tiling
		// saving is lost. Unreachable on retail content, whose worst landblock carries 51 lights
		// against a cap of 64.
		return { lights: fitted.lights, cellMasks: TERRAIN_LIGHT_MASK_ALL };
	}

	/** Start one object-owned phase with complete bindings for every active sampler. */
	#beginObjectPhase(): void {
		this.#deviceState.invalidate();
		for (const unit of Object.values(OBJECT_TEXTURE_UNITS)) {
			this.#bindPreparedObjectTexture(unit, this.#objectFallbackBinding);
		}
	}

	#bindPreparedObjectTexture(
		unit: number,
		binding: PreparedObjectTextureBinding<WebGLTexture, WebGLSampler>,
	): void {
		if (this.#deviceState.applyTextureUnit(unit, binding)) {
			this.#frameSelectionMetrics.objectTextureBinds += 1;
		}
	}

	#applyRenderExtent(extent: RenderExtent): void {
		validateRenderExtent(extent, "WebGL2 frame");
		const { height, width } = extent;
		if (
			width === this.#frameWidth &&
			height === this.#frameHeight &&
			this.#canvas.width === width &&
			this.#canvas.height === height
		)
			return;

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

/** Schedule one phase under its explicit ordering and cohort semantics. */
function scheduleFrameInstanceRuns(
	ordered: readonly PreparedObjectFrameInput[],
	policy: FrameInstancePhasePolicy,
): readonly ObjectFrameSubmission<PreparedObjectFrameInput>[] {
	const isFrameInstance = (object: PreparedObjectFrameInput): boolean =>
		object.instances?.kind === "frame-template";
	const isCompatible = (
		left: PreparedObjectFrameInput,
		right: PreparedObjectFrameInput,
	): boolean =>
		frameTemplateDrawIdentityEquals(left, right) &&
		(policy.cohort === "ignore" || frameTemplateCohortEquals(left, right));
	return policy.grouping === "grouped"
		? formGroupedObjectInstanceRuns(
				ordered,
				isFrameInstance,
				(object) => objectInstanceBatchKey(object, policy.cohort),
				isCompatible,
			)
		: formAdjacentObjectInstanceRuns(ordered, isFrameInstance, isCompatible);
}

/** Check every non-cohort identity required in addition to prepared draw compatibility. */
function frameTemplateDrawIdentityEquals(
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
		// One offset per landblock this frame, so equal landblocks mean equal offsets. This replaces
		// the component comparison the compatibility value used to carry.
		left.landblockId === right.landblockId &&
		areStaticObjectDrawsCompatible(left.compatibility, right.compatibility) &&
		left.source === right.source &&
		left.receivesOutdoorPssm === right.receivesOutdoorPssm &&
		left.renderScopeKey === right.renderScopeKey &&
		left.geometry === right.geometry &&
		left.landblockId === right.landblockId &&
		left.indexStart === right.indexStart &&
		left.indexCount === right.indexCount
	);
}

/** Preserve order-sensitive template identity only for phases that explicitly require it. */
function frameTemplateCohortEquals(
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
			"Frame-template cohort identity requires two frame templates.",
		);
	}
	return (
		leftInstances.transparentCohortKey === rightInstances.transparentCohortKey
	);
}

/** Stable semantic partition used to narrow exact instance compatibility checks. */
function objectInstanceBatchKey(
	object: PreparedObjectFrameInput,
	cohort: FrameInstancePhasePolicy["cohort"],
): string {
	const instances = object.instances;
	if (instances?.kind !== "frame-template") {
		throw new Error(
			"Object instance grouping received a non-frame instance input.",
		);
	}
	if (cohort === "ignore") return object.batchKey;
	return `${object.ordering}\0${object.source}\0${object.receivesOutdoorPssm ? "pssm" : "plain"}\0${object.renderScopeKey}\0${object.landblockId}\0${object.geometry}\0${object.indexStart}\0${object.indexCount}\0${instances.transparentCohortKey}`;
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

function portalTransitionPresentationReceipt(
	transition: PortalTransitionFrame | undefined,
): PortalTransitionPresentationReceipt | null {
	if (
		transition?.kind === "tunnel-only" ||
		transition?.kind === "destination-only-awaiting-handoff"
	) {
		return { kind: transition.kind, generation: transition.generation };
	}
	return null;
}
