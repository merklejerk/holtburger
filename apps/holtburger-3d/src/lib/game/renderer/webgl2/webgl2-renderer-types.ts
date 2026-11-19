import {
	createLandblockWorldOrigin,
	normalizeLandblockOwner,
} from "../../landblocks";
import { Quat, Vec3, type Mat4 } from "../../math/types";
import type { Frustum } from "../../math/frustum";
import type { SceneNodeId } from "../../scene";
import type { TerrainSurfaceDrawUnit } from "../../terrain/types";
import type {
	ObjectMaterialBinding,
	StaticObjectDrawUnit,
} from "../../commit/artifacts";
import type { ObjectMaterialOrdering } from "../../resolution/object-material-planner";
import type { RetailGeometryVisibility } from "../../resolution/presentation";
import { UNAUTHORED_SCENE_LIGHTING } from "../../environment/scene-environment";
import {
	type FrameInput,
	type FrameSelectionMetrics,
	type PortalTransitionFrame,
} from "../renderer";
import { type PortalTransitionPresentationReceipt } from "../../../client/portal-transition-presentation";
import { sceneVec3, type LandblockVec3 } from "../../../assets/ac-frame";
import type { GeometryResourceKey } from "../resource-manager";
import type { ObjectInstanceData } from "../../systems/static-resources";
import type { TerrainProgramInput } from "./terrain-program-input";
import type { WebGL2GeometryBinding } from "./webgl2-resource-manager";
import type {
	WebGL2DynamicObjectProgram,
	WebGL2FogDynamicObjectProgram,
	WebGL2FogInstancedObjectProgram,
	WebGL2FogObjectProgram,
	WebGL2FogStaticTableObjectProgram,
	WebGL2InstancedObjectProgram,
	WebGL2ObjectProgram,
	WebGL2StaticTableObjectProgram,
} from "./webgl2-object-program";
import type { LandblockOwnerId } from "../../game-types";
import type { RuntimeLight } from "../../environment/runtime-lights";
import type { LandblockLights } from "../../environment/outdoor-light-index";
import { TERRAIN_LIGHT_MASK_LENGTH } from "../../environment/terrain-light-mask";
import {
	resolveSceneLightingByRole,
	type SceneLightingByRole,
} from "../../environment/scene-lighting";
import type { WebGL2FogUniforms } from "../passes/webgl2-fog";
import type {
	LightAnchorOrigin,
	WebGL2DirectionalLightingUniforms,
} from "../passes/webgl2-lighting";
import type {
	ObjectBlendPolicy,
	ObjectSubmissionBuckets,
} from "./object-rendering-policy";
import type { CompiledObjectDraw } from "./compiled-object-draws";
import type { PreparedPortalProjection } from "../portal/portal-view-window";
import { SHARED_FRONTEND_TUNING } from "../../../frontend-tuning";
import { normalizedRgbaColor } from "../../../frontend-color";
import type { Camera } from "../../runtime/types";
import type { ParticleRecordFrame } from "../passes/webgl2-particle-pass";
import type { ParticleDrawRange } from "../passes/particle-render-routing";
import type { ViewSubmissionStorage } from "../view-submission-storage";
import type { WebGL2PreparedObjectDrawCompatibility } from "./webgl2-object-draw-compiler";
import type { PreparedDynamicAppearance } from "./webgl2-dynamic-appearances";
import type { DynamicBatchedRanges } from "./dynamic-batched-ranges";
import type { WebGL2PortalScopeAtlasFrame } from "../portal/webgl2-portal-scope-atlas-pipeline";
import type { WebGL2OutdoorPssmPass } from "../shadows/webgl2-outdoor-pssm-pass";
import type { ResolvedOutdoorShadowProjection } from "../shadows/outdoor-pssm";
import type {
	EntityGroundingSelection,
	EntityShadowCasterShape,
	OutdoorDirectionalShadowSelection,
} from "../overlays/entity-grounding";
import type { EntityShadowSettings } from "../shadows/entity-shadow-policy";
import type {
	EntityOverlayDrawInstance,
	EntityOverlayScopedDrawInstance,
} from "../overlays/webgl2-entity-overlay-pass";
import type { NameplateTextureBinding } from "../overlays/webgl2-nameplate-texture-cache";
import type { ComposedEntityOverlay } from "../overlays/entity-overlay-selection";
import type {
	EntityOverlayLookup,
	EntityOverlayPriority,
	EntityOverlaySettings,
	HealthBarSettings,
} from "../overlays/entity-overlay-policy";
import type { NameplateVisual } from "../overlays/nameplate-policy";
import type { EffectiveAmbientOcclusionPolicy } from "../passes/ambient-occlusion-policy";

/**
 * Texture unit for the terrain light mask, after the six the terrain shader samples: unit 0 is the
 * per-landblock surface field, units 1-5 the region-constant pass textures.
 * Object programs bind only units 0-2, so nothing contends for it.
 */
export const TERRAIN_LIGHT_MASK_TEXTURE_UNIT = 6;

/** Frontend-authored fallback decoded once for every clear path owned by this renderer. */
export const FRONTEND_CLEAR_COLOR = normalizedRgbaColor(
	SHARED_FRONTEND_TUNING.rendering.clearColor,
);

/** Opaque background for sealed interiors and the isolated portal tunnel. */
export const BLACK_SCENE_CLEAR_COLOR = [0, 0, 0, 1] as const;

/** Stand-in before any emitter has published records, so the context is never partially built. */
export const EMPTY_PARTICLE_RECORDS: ParticleRecordFrame = {
	data: new Float32Array(0),
	dirtyRows: null,
};

/** Keep terrain behind authored outdoor geometry at near-coplanar depth intersections. */
export const TERRAIN_DEPTH_OFFSET = { factor: 1, units: 1 } as const;

/**
 * Convert a canonical scene position into the frame's anchor-relative render frame.
 *
 * Shaders receive landblock-local positions offset by `uLandblockOffset`, which is relative to
 * the frame anchor rather than the scene origin. Anything compared against a vertex position must
 * be converted the same way.
 */
export function anchorRelativePosition(
	position: Vec3,
	anchorLandblockId: LandblockOwnerId,
): Vec3 {
	const origin = createLandblockWorldOrigin(anchorLandblockId);
	return new Vec3(position.x - origin.x, position.y, position.z - origin.z);
}

export interface SceneShading {
	/** Environment/fog clear color shared by views that can see outdoors. */
	readonly clearColor: readonly [number, number, number, number];
	/** Effective optional near-field presentation policy resolved once for this frame. */
	readonly ambientOcclusion: EffectiveAmbientOcclusionPolicy;
	readonly fog: FrameInput["environment"]["distanceFog"];
	/** Resolved sky for this frame, celestial and weather, or null when the region authors none. */
	readonly sky: FrameInput["environment"]["sky"];
	/** Whether authored weather draws at all, mirroring retail weather admission. */
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

/** Ranking position used before any view has been committed. */
export const ORIGIN = sceneVec3(Vec3.zero());
export const EMPTY_LIGHTS: readonly RuntimeLight[] = [];

/** Synthetic single render domain used by the deliberately unpartitioned flat debug mode. */
export const FLAT_PARTICLE_DOMAIN = "particle-render-domain:flat";
export const FLAT_SKY_PARTICLE_DOMAIN = "particle-render-domain:flat-sky";
/** Unlit result for draws that resolve no landblock lights at all. */
export const EMPTY_LANDBLOCK_LIGHTS: LandblockLights = {
	lights: EMPTY_LIGHTS,
	cellMasks: new Uint32Array(TERRAIN_LIGHT_MASK_LENGTH),
};

/**
 * Shading for the browser-harness portal execution probe, which renders outside any
 * resolved frame environment. Fog stays disabled exactly as this probe path always had it.
 */
export const PROBE_SHADING: SceneShading = {
	clearColor: [
		FRONTEND_CLEAR_COLOR.red,
		FRONTEND_CLEAR_COLOR.green,
		FRONTEND_CLEAR_COLOR.blue,
		FRONTEND_CLEAR_COLOR.alpha,
	],
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
	lighting: resolveSceneLightingByRole(UNAUTHORED_SCENE_LIGHTING, null),
};

/** Retail portal room lighting: one distant light and a modest ambient floor. */
export const PORTAL_TRANSITION_LIGHTING = {
	ambientLevel: 0.3,
	ambientColor: { red: 1, green: 1, blue: 1, alpha: 1 },
	sunVector: new Vec3(-0.3, 1.9, -0.65),
	sunColor: { red: 1, green: 1, blue: 1, alpha: 1 },
} as const;
export const PORTAL_TRANSITION_SCOPE = "portal-transition";
export const PORTAL_TRANSITION_ANCHOR = normalizeLandblockOwner("0x0000ffff");
export const PORTAL_TRANSITION_CAMERA: Camera = {
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

export interface TerrainFrameInput {
	/** Logical resources and placement for authored terrain or an ocean backdrop tile. */
	readonly drawUnit: TerrainSurfaceDrawUnit;
	/** Device resources resolved by this renderer for the terrain shader contract. */
	readonly program: TerrainProgramInput;
}

/** View-constant uniforms shared by the near and sampler-free far terrain programs. */
export interface TerrainGroupUniforms
	extends WebGL2FogUniforms, WebGL2DirectionalLightingUniforms {
	readonly cameraPosition: WebGLUniformLocation;
	readonly clipTransform: WebGLUniformLocation;
	readonly landblockOffset: WebGLUniformLocation;
	readonly localToLandblock: WebGLUniformLocation;
	readonly projection: WebGLUniformLocation;
	readonly view: WebGLUniformLocation;
}

/** One opaque or alpha-test static-object range paired with its resolved node placement. */
export interface ObjectFrameInput {
	readonly source:
		| "outdoor"
		| "generated"
		| "env-cell-shell"
		| "env-cell-resident"
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
				readonly instance: ObjectInstanceData;
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

export type PreparedObjectDrawCompatibility =
	WebGL2PreparedObjectDrawCompatibility;

/**
 * One object contribution paired with every renderer-resolved fact consumed at submission.
 *
 * `compiled` is shared by reference with every frame that submits this draw unit, so a frame
 * never copies compiled facts to use them. Nothing anchor-relative is stored: the offset is
 * looked up per frame by `landblockId`, which is what lets a static submission itself be cached
 * across re-anchoring.
 */
export interface PreparedObjectFrameInput extends ObjectFrameInput {
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
export interface FrameInstancePhasePolicy {
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
export function createObjectSubmission(
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

/** Anchor-relative landblock offset, resolved once per visible landblock per frame. */
export type LandblockRenderOffset = readonly [number, number, number];

/**
 * One static publication's complete submission set plus the node-level facts a frame reports.
 *
 * Cached whole against the publication, so a visible node performs one lookup per frame instead
 * of rebuilding a submission, a scope key, and a layer key for every draw unit it owns.
 */
export interface CompiledStaticNodeSubmissions {
	readonly objectBuckets: ObjectSubmissionBuckets<PreparedObjectFrameInput>;
	readonly landblockId: LandblockOwnerId;
	readonly source: ObjectFrameInput["source"];
	/** Key this publication contributes to the visible-layer census. */
	readonly visibleLayerKey: string;
	/** Cell scope this publication occupies, or null for outdoor publications. */
	readonly envCellScopeKey: string | null;
}

export type AnyObjectProgram =
	| WebGL2StaticTableObjectProgram
	| WebGL2FogStaticTableObjectProgram
	| WebGL2ObjectProgram
	| WebGL2FogObjectProgram
	| WebGL2InstancedObjectProgram
	| WebGL2FogInstancedObjectProgram;

/** Shared activation/lighting accepts table-backed programs without legacy material uniforms. */
export type LitObjectProgram =
	AnyObjectProgram | WebGL2DynamicObjectProgram | WebGL2FogDynamicObjectProgram;

/** One admitted merged root per view; color ranges use composed scene depth. */
export interface PreparedDynamicColor {
	/** Existing dynamic lighting role, independent of the selected portal domain. */
	readonly source: "dynamic";
	/** Whole-entity pose-page identity. */
	readonly nodeId: SceneNodeId;
	/** Placement owner for rebasing and lighting, independent of portal domains. */
	readonly landblockId: LandblockOwnerId;
	/** Resolved merged vertex allocation and appearance index/material generation. */
	readonly geometry: WebGL2GeometryBinding;
	readonly appearance: Extract<PreparedDynamicAppearance, { kind: "drawable" }>;
}

/** Opaque color shares contiguous spans across views of the same current entity pose. */
export interface PreparedDynamicOpaque extends PreparedDynamicColor {
	/** Eligible physical spans borrowed until the frame's final view finishes. */
	readonly ranges: ReturnType<DynamicBatchedRanges["prepare"]>;
}

/** One transparent range or additive span in the shared far/near/additive submission sequence. */
export interface PreparedDynamicBlended extends PreparedDynamicColor {
	/** Ordinary merged draw discriminator; never admitted into instance runs. */
	readonly drawKind: "merged";
	/** Physical range and state already compiled for this appearance generation. */
	readonly range: PreparedDynamicOpaque["appearance"]["plan"]["ranges"][number];
	/** Frame-effective phase, including opaque material promoted by a part fade. */
	readonly ordering: "transparent" | "additive";
	/** Selected contiguous index elements; transparent ranges retain their original extent. */
	readonly indexCount: number;
	/** Existing source cohort and tie-break/center facts for the bounded transparency sorter. */
	readonly transparentCohortKey: string;
	readonly transparentSort: ObjectFrameInput["transparentSort"];
	/** Prepared variant; construction never occurs during execution. */
	readonly program: WebGL2DynamicObjectProgram | WebGL2FogDynamicObjectProgram;
}

/** Physical mesh submissions share ordering without sharing incompatible GPU input contracts. */
export type ObjectColorSubmission =
	PreparedObjectFrameInput | PreparedDynamicBlended;

/** Anchor-relative matrices and content reused by all passes for one view. */
export interface PreparedViewGeometry extends PreparedPortalProjection {
	/** Runtime-owned cell classification selecting this view's uncovered background. */
	readonly cameraInsideSealedCell: boolean;
	/** Independent retained outputs for this camera, shared by its color and auxiliary passes. */
	readonly submissionStorage: ViewSubmissionStorage;
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

/** Depth and portal route shared by both components of one entity's overlay. */
type PreparedOverlayRoute =
	| {
			/** Selected and hovered entities draw once as overlays. */ readonly kind: "overlay";
	  }
	| {
			/** Other entities test depth within their admitted domains. */ readonly kind: "scene";
			readonly renderScopeKeys: readonly string[];
	  };

export const OVERLAY_ROUTE: PreparedOverlayRoute = { kind: "overlay" };

/** Renderer state before its first frame; every drawn frame replaces it from `FrameInput`. */
export const NO_ENTITY_OVERLAYS: EntityOverlayLookup = {
	presentation: () => null,
};

/** One entity's shared overlay anchor; its components reference it by identity for composition. */
export interface PreparedOverlayEntity {
	readonly anchor: Vec3;
	readonly distanceSquared: number;
	readonly identity: string;
	readonly route: PreparedOverlayRoute;
}

/** One independently admitted overlay component before its own legibility and budget cut. */
interface PreparedOverlayComponent {
	readonly entity: PreparedOverlayEntity;
	readonly anchor: Vec3;
	readonly distanceSquared: number;
	readonly identity: string;
	readonly priority: EntityOverlayPriority;
}

export interface PreparedLabelComponent extends PreparedOverlayComponent {
	readonly label: NameplateVisual;
}

export interface PreparedBarComponent extends PreparedOverlayComponent {
	readonly fraction: number;
}

export type PreparedEntityOverlay = ComposedEntityOverlay<
	PreparedOverlayEntity,
	NameplateVisual
>;

export interface MutableEntityOverlayDrawInstance extends EntityOverlayDrawInstance {
	depthTest: boolean;
	anchor: Vec3;
	binding: NameplateTextureBinding | null;
	healthFraction: number | null;
}

export interface MutableEntityOverlayScopedDrawInstance extends EntityOverlayScopedDrawInstance {
	depthTest: boolean;
	anchor: Vec3;
	binding: NameplateTextureBinding | null;
	healthFraction: number | null;
	renderScopeKey: string;
}

export interface PreparedSceneContributions {
	/** Opaque/alpha-test dynamic meshes submitted without per-range instance expansion. */
	readonly dynamicOpaque: readonly PreparedDynamicOpaque[];
	/** Terrain selected by this renderer from its RenderWorld. */
	readonly terrain: readonly TerrainFrameInput[];
	/** Ordered phase populations assembled from compiled static and dynamic sources. */
	readonly objectBuckets: ObjectSubmissionBuckets<ObjectColorSubmission>;
	/**
	 * Anchor-relative offset per visible landblock for this frame.
	 *
	 * The only anchor-relative fact in a submission, held here rather than on each object so
	 * submissions survive re-anchoring and can be cached with their publication.
	 */
	readonly landblockOffsets: ReadonlyMap<string, LandblockRenderOffset>;
	/** Final view-owned draw ranges after particle owner routing. */
	readonly particles: readonly ParticleDrawRange[];
	/** Sky-attached particle batches drawn before the landscape. */
	readonly skyParticles: readonly ParticleDrawRange[];
	/** Fixed per-receiver analytic-shadow records produced from the same visible-entry walk. */
	readonly entityAnalyticShadows: PreparedEntityAnalyticShadows | null;
	/** Composed admitted labels and bars, in back-to-front blend order. */
	readonly entityOverlays: readonly PreparedEntityOverlay[];
	/** Shared perspective scale applied by the overlay pass for this prepared view. */
	readonly entityOverlaySettings: EntityOverlaySettings;
	/** Health bar geometry and colors for this prepared view. */
	readonly healthBars: HealthBarSettings;
}

/** Anchor-relative matrices and content reused by all passes for one view. */
export interface PreparedView
	extends PreparedViewGeometry, PreparedSceneContributions {}

/** CPU shadow decisions retained independently of whichever view last used the GPU targets. */
export interface PreparedOutdoorShadowView {
	/** Selected mapped casters and cascades, or null for the simple analytic policy. */
	readonly maps: ReturnType<WebGL2OutdoorPssmPass["prepare"]>;
	/** Projection shared by mapped and analytic consumers of this view. */
	readonly projection: ResolvedOutdoorShadowProjection;
	/** Whole-root analytic tier chosen during mapped caster preparation. */
	readonly analyticCasters: readonly EntityShadowCasterShape[];
}

/** Complete CPU inputs retained until this portal camera's sequential GPU execution. */
export interface PreparedPortalView {
	/** Color contributions and camera matrices belonging to this view. */
	readonly view: PreparedView;
	/** Independent portal visibility, tiles, and propagation streams. */
	readonly frame: WebGL2PortalScopeAtlasFrame;
	/** Particle ranges routed against this view's selected scopes. */
	readonly particlesByScope: ReadonlyMap<string, readonly ParticleDrawRange[]>;
	/** Outdoor caster decisions when this view selects an outdoor scope. */
	readonly shadows: PreparedOutdoorShadowView | null;
}

/** Whether one contribution owns exterior-global passes such as sky and weather. */
export type SceneRenderDomain = "exterior" | "indoor";

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
export interface MutableFrameSelectionMetrics {
	ambientOcclusion: {
		activeBytes: number;
		allocatedGenerationCount: number;
		pixelCount: number;
		applicationCount: number;
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
	visibleDynamicSourceRangeCount: number;
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

export function portalTransitionPresentationReceipt(
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
