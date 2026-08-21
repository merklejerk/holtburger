import type { LandblockId } from "../game-types";
import type { SceneNodeId } from "../scene";
import type { Camera } from "../runtime/types";
import type { ResolvedSceneEnvironment } from "../environment/scene-environment";
import type { LandblockLights } from "../environment/outdoor-light-index";
import type { RuntimeLight } from "../environment/runtime-lights";
import { LandblockLayerKind } from "../runtime/scene-interest";

/** Minimal read side of the outdoor light index the renderer depends on. */
export interface OutdoorLightLookup {
	readonly isEmpty: boolean;
	resolve(landblockId: LandblockId): LandblockLights;
}
import { FRONTEND_TUNING } from "../../frontend-tuning";
import type { TextureFilteringPolicy } from "./texture-filtering-policy";
import type { SkySourcePresentations } from "../../assets/decode-sky-record";
import type { ParticleMeshPresentations } from "../../assets/decode-particle-mesh-record";
import type { ParticleSourceRange } from "../systems/particle-system";
import type { ParticleRecordFrame } from "./webgl2-particle-pass";
import type { TexturePreparer } from "../textures/texture-preparer";
import {
	DEFAULT_AMBIENT_OCCLUSION_PARAMETERS,
	type AmbientOcclusionSettings,
} from "./ambient-occlusion-policy";
import {
	DEFAULT_COLOR_GRADE_PARAMETERS,
	type ColorGradeSettings,
} from "./color-grade-policy";

/** Environment-cell visibility scheduler selected without rebuilding resident content. */
export type EnvCellRenderMode = "flat" | "portal";

/** Per-layer draw selection, independent from scene interest and resident resources. */
export type RenderLayerVisibility = Readonly<
	Record<LandblockLayerKind, boolean>
>;

/** Dynamic renderer quality choices independent from content and resource identity. */
interface RenderQualitySettings {
	/** Independently optional object presentations below this CSS pixel area are omitted. */
	readonly minimumObjectFootprintCssPixelArea: number;
	/** Non-near-plane portal windows smaller than this CSS pixel area are omitted. */
	readonly minimumPortalFootprintCssPixelArea: number;
	/** Device pixels rendered per CSS pixel, and the renderer's only anti-aliasing control. */
	readonly renderScale: number;
	/** Global draw-time policy for filterable normalized textures. */
	readonly textureFiltering: TextureFilteringPolicy;
}

/** Dynamic display choices applied to a frame without changing world data or GPU setup. */
export interface FrameSettings {
	/** Materialized landblock layers that may contribute work and draws to this frame. */
	readonly layerVisibility: RenderLayerVisibility;
	/** Optional nearby opaque-geometry occlusion and its runtime-adjustable presentation values. */
	readonly ambientOcclusion: AmbientOcclusionSettings;
	/**
	 * Optional presentation color grade applied once to the finished scene.
	 *
	 * Purely a look: it runs after every pass has contributed and changes no world data. Retail
	 * presents ungraded, so disabling this reproduces retail's presentation bit-exactly; the
	 * shipped look itself is frontend tuning rather than a renderer decision.
	 */
	readonly colorGrade: ColorGradeSettings;
	/** Whether render passes apply the effective region-authored distance fog. */
	readonly distanceFogEnabled: boolean;
	/** Retail's viewer headlamp, which makes interiors without authored lights navigable. */
	readonly viewerLightEnabled: boolean;
	/**
	 * Whether authored weather draws, mirroring retail's `LScape::weather_enabled`
	 * (acclient.c:44269).
	 *
	 * Retail drives it from the character option `DisableMostWeatherEffects` via
	 * `SmartBox::EnableWeather` (acclient.c:137097), so this is a player-facing presentation choice
	 * rather than a debug switch. Disabling it suppresses every weather object in both sky passes
	 * and leaves celestial rendering untouched.
	 */
	readonly weatherEnabled: boolean;
	/**
	 * Authored outdoor lamps evaluated at draw time.
	 *
	 * Exists so their cost can be measured against the same scene and camera with them absent.
	 * Attributing a shader loop by comparing two different scenes is not attribution.
	 */
	readonly staticLightsEnabled: boolean;
	/** Environment-cell visibility and presentation policy for this frame. */
	readonly envCellRenderMode: EnvCellRenderMode;
	/** Quality policy snapshotted once for every rendered frame. */
	readonly quality: RenderQualitySettings;
}

/** Default dynamic display choices matching the region-authored presentation. */
export const DEFAULT_FRAME_SETTINGS: FrameSettings = {
	layerVisibility: {
		[LandblockLayerKind.Terrain]: true,
		[LandblockLayerKind.Buildings]: true,
		[LandblockLayerKind.Objects]: true,
		[LandblockLayerKind.Generated]: true,
		[LandblockLayerKind.EnvCells]: true,
	},
	ambientOcclusion: {
		enabled: FRONTEND_TUNING.rendering.ambientOcclusion.enabledByDefault,
		parameters: DEFAULT_AMBIENT_OCCLUSION_PARAMETERS,
	},
	colorGrade: {
		enabled: FRONTEND_TUNING.rendering.colorGrade.enabledByDefault,
		parameters: DEFAULT_COLOR_GRADE_PARAMETERS,
	},
	distanceFogEnabled:
		FRONTEND_TUNING.rendering.frameDefaults.distanceFogEnabled,
	viewerLightEnabled:
		FRONTEND_TUNING.rendering.frameDefaults.viewerLightEnabled,
	weatherEnabled: FRONTEND_TUNING.rendering.frameDefaults.weatherEnabled,
	staticLightsEnabled:
		FRONTEND_TUNING.rendering.frameDefaults.staticLightsEnabled,
	envCellRenderMode: FRONTEND_TUNING.rendering.frameDefaults.envCellRenderMode,
	quality: {
		minimumObjectFootprintCssPixelArea:
			FRONTEND_TUNING.rendering.frameDefaults
				.minimumObjectFootprintCssPixelArea,
		minimumPortalFootprintCssPixelArea:
			FRONTEND_TUNING.rendering.frameDefaults
				.minimumPortalFootprintCssPixelArea,
		renderScale: FRONTEND_TUNING.rendering.frameDefaults.renderScale,
		textureFiltering: FRONTEND_TUNING.rendering.frameDefaults.textureFiltering,
	},
};

/** Camera state for one camera or portal view. The renderer collects scene content itself. */
export interface FrameViewInput {
	/** Camera pose and projection used for this view. */
	readonly camera: Camera;
	/**
	 * True when this view's camera occupies an EnvCell that does not author SeenOutside.
	 *
	 * Retail forces a flat interior ambient in that case (acclient.c:140480); a camera in a
	 * cell that can see outdoors keeps the regional ambient.
	 */
	readonly cameraInsideSealedCell: boolean;
}

/** Immutable renderer input carrying frame state rather than preassembled draw submissions. */
export interface FrameInput {
	/** Landblock whose origin is the floating render-world origin. */
	readonly anchorLandblockId: LandblockId;
	readonly timeSeconds: number;
	/** Effective regional presentation shared by all renderer passes. */
	readonly environment: ResolvedSceneEnvironment;
	/**
	 * Resolves the authored outdoor lights reaching a landblock.
	 *
	 * Supplied as a lookup rather than a materialized list because the renderer only needs the
	 * landblocks it actually draws, and the index memoizes across frames.
	 */
	readonly outdoorLights: OutdoorLightLookup;
	/** Current entity-owned point lights already composed into canonical scene space. */
	readonly dynamicLights: readonly RuntimeLight[];
	/** Dynamic display choices applied to this frame. */
	readonly frameSettings: FrameSettings;
	readonly views: readonly FrameViewInput[];
}

/** Latest renderer-side selection counts, aggregated across every view in one frame. */
export interface FrameSelectionMetrics {
	/** Optional near-field AO policy and scratch-target facts for this frame. */
	readonly ambientOcclusion: {
		/** Live bytes owned by the two R8 scratch textures. */
		readonly activeBytes: number;
		/** Scratch generations allocated over this renderer lifetime. */
		readonly allocatedGenerationCount: number;
		/** Replaced, disabled, or destroyed scratch generations released. */
		readonly disposedGenerationCount: number;
		/** Renderer-owned distance fade when AO is enabled for the frame. */
		readonly effectiveDistanceFade: {
			readonly disabledAt: number;
			readonly fullStrengthUntil: number;
		} | null;
	};
	readonly envCellRenderMode: EnvCellRenderMode;
	/** Number of camera or portal views rendered into this frame. */
	readonly viewCount: number;
	/** Scene nodes selected by scope traversal and node-level frustum culling. */
	readonly visibleSceneEntries: number;
	/** Visible terrain contributions converted into concrete frame inputs. */
	readonly terrainFrameInputs: number;
	/** Distinct producer culling groups contributing visible static nodes. */
	readonly visibleStaticLayerCount: number;
	/** Visible static scene nodes selected after node-level frustum culling. */
	readonly visibleStaticNodeCount: number;
	/** Dynamic entity roots contributing visible rigid parts. */
	readonly visibleDynamicEntityCount: number;
	/** Visible rigid-part material ranges emitted by dynamic entities. */
	readonly visibleDynamicPartCount: number;
	/** Eligible static or dynamic presentation roots projected under the active cutoff. */
	readonly testedObjectPresentationCount: number;
	/** Projected presentation roots retained for contribution expansion. */
	readonly retainedObjectPresentationCount: number;
	/** Projected presentation roots rejected before contribution expansion. */
	readonly rejectedObjectPresentationCount: number;
	/** Visible environment-cell shell contributions selected for the current view. */
	readonly visibleEnvCellShells: number;
	readonly visibleEnvCellScopeCount: number;
	readonly visibleEnvCellResidentNodes: number;
	readonly submittedEnvCellShellDrawCount: number;
	readonly submittedEnvCellShellTriangleCount: number;
	readonly submittedEnvCellResidentDrawCount: number;
	readonly submittedEnvCellResidentTriangleCount: number;
	readonly envCellShellCullOverrideCount: number;
	/** Physical authored scopes packed across all portal views in this frame. */
	readonly portalSelectedScopeCount: number;
	/** Directed crossings assigned arrival states across all portal views. */
	readonly portalSelectedCrossingCount: number;
	/** Deepest complete CPU culling frontiers summed across portal views. */
	readonly portalCompletedCullDepth: number;
	/** Instanced crossing-propagation draws submitted across portal views. */
	readonly portalPropagationDrawCount: number;
	/** Checked projection/admission primitives charged during portal culling. */
	readonly portalProjectionPrimitiveCount: number;
	/** Committed scope-tile pixels excluding atlas packing gaps. */
	readonly portalAtlasTilePixelCount: number;
	/** Whole-frontier retreats caused by fixed GPU resource capacity. */
	readonly portalFrontierRetreatCount: number;
	/** Portal views stopped at any explicit CPU or GPU capacity. */
	readonly portalTruncatedViewCount: number;
	/** Live framebuffers owned by the current portal target generation. */
	readonly portalFramebufferCount: number;
	/** Exact live bytes owned by the current portal target generation. */
	readonly portalTargetBytes: number;
	/** Live framebuffer owned by the unconditional flat-scene target generation. */
	readonly flatSceneFramebufferCount: number;
	/** Exact live color/depth texture bytes owned by the flat-scene target generation. */
	readonly flatSceneTargetBytes: number;
	/** Complete flat-scene target generations allocated over this renderer lifetime. */
	readonly flatSceneAllocatedGenerationCount: number;
	/** Replaced or destroyed flat-scene target generations released over this renderer lifetime. */
	readonly flatSceneDisposedGenerationCount: number;
	/** All static-object draw calls submitted to the backend this frame. */
	readonly submittedStaticObjectDrawCount: number;
	/** Triangles submitted by all static-object draws, including instance multiplication. */
	readonly submittedStaticObjectTriangleCount: number;
	/** Baked static-object draw calls submitted this frame. */
	readonly submittedBakedStaticObjectDrawCount: number;
	/** Triangles submitted by baked static-object draws. */
	readonly submittedBakedStaticObjectTriangleCount: number;
	/** Source triangles referenced by instanced draws before instance multiplication. */
	readonly submittedInstancedSourceTriangleCount: number;
	/** Transparent baked ranges and instance templates classified for view submission. */
	readonly transparentObjectCandidateCount: number;
	/** Transparent candidates outside the near-policy radius and eligible for cohort batching. */
	readonly farTransparentObjectCandidateCount: number;
	/** Transparent candidates inside the near-policy radius and ordered by coarse depth bands. */
	readonly nearTransparentObjectCandidateCount: number;
	/** Adjacent compatible transparent instance runs emitted after global ordering. */
	readonly transparentFrameRunCount: number;
	/** Cohort-batched transparent instance runs emitted outside the near-policy radius. */
	readonly farTransparentFrameRunCount: number;
	/** Adjacent transparent instance runs emitted after near depth-band ordering. */
	readonly nearTransparentFrameRunCount: number;
	/** Per-view object-instance uploads with a non-empty population. */
	readonly frameInstanceUploadCount: number;
	/** Numeric bytes uploaded for frame-streamed object instances across all views. */
	readonly frameInstanceUploadBytes: number;
	/** Transparent object draw calls submitted after transparent phase ordering. */
	readonly submittedTransparentObjectDrawCount: number;
	/** Frame-streamed transparent instances submitted after transparent phase ordering. */
	readonly submittedTransparentInstanceCount: number;
	/** Additive object draw calls submitted in their deterministic phase. */
	readonly submittedAdditiveObjectDrawCount: number;
	/** Dynamic compatible runs submitted through shared frame instancing. */
	readonly submittedDynamicDrawCount: number;
	/** Dynamic rigid-part instances submitted through shared frame instancing. */
	readonly submittedDynamicInstanceCount: number;
	/** Particle batches that resolved to one physical instanced draw. */
	readonly submittedParticleBatchCount: number;
	/** Particle sprite instances submitted by resolved batches. */
	readonly submittedParticleInstanceCount: number;
	/** Live particle batches skipped because their mesh was not resident. */
	readonly unresolvedParticleBatchCount: number;
	/** Current reusable object frame-arena capacity in instances. */
	readonly frameInstanceCapacity: number;
	/** Lifetime geometric growth count for the reusable frame arena. */
	readonly frameInstanceGrowthCount: number;
	/** Lifetime largest per-view object instance population. */
	readonly frameInstanceViewHighWaterMark: number;
	/**
	 * Lights that did not fit their budget and were dropped.
	 *
	 * Dropping is normal operation rather than an error, so this exists to make the budget
	 * observable across a frame.
	 */
	readonly droppedLights: number;
	/**
	 * Static light array binds. Compared against visible lit landblocks this shows whether draw
	 * order is landblock-coherent enough for per-landblock binding.
	 */
	readonly staticLightBinds: number;
	/** Per-landblock terrain light-mask uploads; unlit landblocks skip theirs entirely. */
	readonly terrainLightMaskUploads: number;
	/** Terrain landblocks drawn by the sampler-free far vertex-color program. */
	readonly farTerrainDraws: number;
	/** Complete 32-color palette uploads, one for each non-empty far terrain state group. */
	readonly farTerrainPaletteUploads: number;
	/**
	 * Landblock ring at which terrain switches to far vertex colors, or null when fog leaves it near.
	 *
	 * Exposed because the ring is derived from the frame's fog rather than configured directly, so
	 * this is the only way to see where a given `farTerrainFogCoverage` actually landed.
	 */
	readonly farTerrainCutoffLandblocks: number | null;
	/** Lighting-uniform binds caused by a draw changing its retail lighting role. */
	readonly objectLightingBinds: number;
	/** Object-program activation count across every rendered view. */
	readonly objectProgramChanges: number;
	/** Physical two-dimensional object texture binds performed across every rendered view. */
	readonly objectTextureBinds: number;
}

/** Non-overlapping renderer CPU wall-time phases aggregated from profiled frames. */
export interface RendererCpuFrameTimings {
	/** CPU wall time spent deriving distance and phase order for blended objects. */
	readonly blendedOrderingMs: number;
	/** CPU wall time spent submitting blended object work. */
	readonly blendedSubmissionMs: number;
	/** CPU wall time spent finalizing renderer diagnostics. */
	readonly finalizationMs: number;
	/** CPU wall time spent projecting and selecting generated-instance envelopes. */
	/** CPU wall time spent encoding and uploading frame-local object instances. */
	readonly instanceUploadMs: number;
	/** CPU wall time spent forming compatible frame-instance submission runs. */
	readonly instanceRunPreparationMs: number;
	/** CPU wall time spent submitting opaque object work. */
	readonly opaqueSubmissionMs: number;
	/** CPU cost of routing sources and uploading particle batches, separate from blended work. */
	readonly particleSubmissionMs: number;
	/** Renderer work outside the named spans. */
	readonly otherMs: number;
	/** CPU wall time spent clearing, propagating, reducing, and resolving portal targets. */
	readonly portalCompositionMs: number;
	/** CPU wall time spent planning portal visibility and packing its atlas. */
	readonly portalPlanningMs: number;
	/** CPU wall time spent querying visible scene identities. */
	readonly sceneQueryMs: number;
	/** CPU wall time spent resolving selected scene identities into raw frame inputs. */
	readonly sceneContributionResolutionMs: number;
	/** CPU wall time spent preparing frame-global renderer state. */
	readonly setupMs: number;
	/** CPU wall time spent submitting terrain work. */
	readonly terrainSubmissionMs: number;
	/** CPU wall time spanning the complete renderer frame call. */
	readonly totalMs: number;
	/** CPU wall time spent deriving camera, projection, and frustum state. */
	readonly viewPreparationMs: number;
}

/** Per-frame contribution work recorded only by an explicitly active renderer profile. */
export interface RendererContributionFrameMetrics {
	/** Dynamic object inputs compiled into frame-current draw state. */
	readonly dynamicObjectPreparationCount: number;
	/** Non-dynamic object inputs compiled from retained scene contributions. */
	readonly staticObjectPreparationCount: number;
}

/** Renderer CPU timings for one explicitly profiled frame. */
export interface RendererCpuFrameProfile extends RendererCpuFrameTimings {
	/** Contribution work counters for this profiled frame. */
	readonly contribution: RendererContributionFrameMetrics;
	/** Monotonic renderer-local frame identifier. */
	readonly frameNumber: number;
}

/** Short rolling CPU profile that exposes both attribution and frame-time variance. */
export interface RendererCpuFrameProfileWindow {
	/** Latest and arithmetic-mean contribution work across this profile window. */
	readonly contribution: {
		readonly latest: RendererContributionFrameMetrics;
		readonly mean: RendererContributionFrameMetrics;
	};
	/** Frame identifier of the most recently captured sample. */
	readonly latestFrameNumber: number;
	/** Total CPU wall time of the most recently captured sample. */
	readonly latestTotalMs: number;
	/** Per-phase arithmetic mean across the retained sample window. */
	readonly mean: RendererCpuFrameTimings;
	/** Nearest-rank 95th percentile of total CPU frame time. */
	readonly p95TotalMs: number;
	/** Number of frames represented by this profile window. */
	readonly sampleCount: number;
}

/** Latest asynchronous GPU timing outcome for an explicitly enabled profiling session. */
export type RendererGpuFrameProfile =
	| { readonly kind: "unsupported" }
	| {
			readonly kind: "pending";
			/** Submitted GPU frames whose timestamp results are not yet readable. */
			readonly pendingFrameCount: number;
	  }
	| {
			readonly kind: "disjoint";
			/** New GPU frames submitted since invalid timing queries were discarded. */
			readonly pendingFrameCount: number;
	  }
	| {
			/** GPU elapsed-time span covering evaluation, filtering, and AO composition. */
			readonly ambientOcclusionMs: number;
			/** GPU elapsed-time span covering blended object commands. */
			readonly blendedMs: number;
			/** GPU elapsed-time span covering sampler-free far-terrain groups. */
			readonly farTerrainMs: number;
			/** Renderer frame identifier associated with this delayed result. */
			readonly frameNumber: number;
			readonly kind: "available";
			/** GPU elapsed-time span covering opaque object commands. */
			readonly opaqueMs: number;
			/**
			 * GPU elapsed-time span covering particle commands.
			 *
			 * Separate from `blendedMs` so a per-batch upload stall is attributable: every batch
			 * writes into one buffer immediately before its own draw, and the driver must either
			 * rename the buffer or wait.
			 */
			readonly particleMs: number;
			/** GPU elapsed-time span covering flat color/depth presentation. */
			readonly presentationMs: number;
			/** GPU elapsed-time spans covering portal target setup and composition commands. */
			readonly portalCompositionMs: number;
			/** Submitted GPU frames whose timing results are not yet readable. */
			readonly pendingFrameCount: number;
			/**
			 * GPU elapsed-time span covering both sky passes.
			 *
			 * One figure rather than two: the before-world and after-landscape passes are the same
			 * cost to reason about, and elapsed queries cannot nest, so they are measured
			 * sequentially and summed.
			 */
			readonly skyMs: number;
			/** GPU elapsed-time span covering composed near-terrain groups. */
			readonly nearTerrainMs: number;
			/** GPU elapsed-time span covering terrain commands. */
			readonly terrainMs: number;
			/**
			 * Sum of the measured phase spans, **not** wall-clock across the frame.
			 *
			 * Elapsed-time queries cannot nest, so no query can wrap the frame while phase queries
			 * run inside it, and GPU work between phases is unmeasurable. There is deliberately no
			 * `otherMs`: reporting an unmeasured gap as zero would read as "no unattributed work"
			 * rather than "not measured".
			 */
			readonly totalMs: number;
	  };

/** Latest CPU frame and delayed GPU result from an explicitly enabled profiling session. */
export interface RendererFrameProfile {
	/** Synchronous CPU measurements summarized across the recent frame window. */
	readonly cpu: RendererCpuFrameProfileWindow;
	/** Most recently resolved asynchronous GPU measurement state. */
	readonly gpu: RendererGpuFrameProfile;
}

/** One cold read of the renderer diagnostics that must describe the same session state. */
export interface RendererFrameDiagnosticsSnapshot {
	/** Latest completed profile, or null before the first sample and while profiling is disabled. */
	readonly profile: RendererFrameProfile | null;
	readonly profilingEnabled: boolean;
	readonly selectionMetrics: FrameSelectionMetrics;
	/**
	 * Renderer-cached draw compilation, or null on backends that cache none.
	 *
	 * Occupancy tracks resident draw units, so growth across relocations means entries outlived
	 * their publication; lifetime compilations and per-reason flush counts make recompilation
	 * attributable instead of appearing as unexplained frame cost.
	 */
	readonly compiledObjectDraws: CompiledObjectDrawDiagnostics | null;
}

/** Draw-compilation occupancy and churn reported by a renderer that caches compiled draws. */
export interface CompiledObjectDrawDiagnostics {
	readonly compiledEntryCount: number;
	readonly totalCompilationCount: number;
	readonly flushCounts: Readonly<Record<string, number>>;
}

/** Optional diagnostic capability kept separate from the renderer's production draw contract. */
export interface RendererFrameDiagnostics {
	/** Read all interdependent frame facts through one consistent snapshot. */
	snapshot(): RendererFrameDiagnosticsSnapshot;
	/** Create or tear down the explicit timing session and its GPU query resources. */
	setProfilingEnabled(enabled: boolean): void;
}

/** Production control feedback from one fully completed renderer frame. */
export interface RendererFrameFeedback {
	/** Dynamic roots selected in at least one view, deduplicated across the frame. */
	readonly selectedDynamicNodeIds: readonly SceneNodeId[];
}

/**
 * Optional celestial-sky residency, kept off the draw contract because a backend without one is
 * still a valid renderer.
 *
 * Neutral by construction: the resource set and the pixel-preparation port are frontend types, so
 * a backend's private pass representation never reaches this boundary.
 */
export interface RendererSkyCapability {
	/** Make one region's celestial resource set resident, replacing any previous one. */
	install(
		source: SkySourcePresentations,
		preparer: TexturePreparer,
	): Promise<void>;
	/** Release the resident sky, for a region change that authors none. */
	clear(): void;
}

/**
 * Particle mesh residency and per-frame owner-local source submission.
 *
 * Separate from the object path because particle meshes are not landblock residents: they are named
 * by `CreateParticle` and arrive in batches with their own lifetime.
 */
export interface RendererParticleCapability {
	/** Make one batch of particle meshes resident; already-resident meshes are skipped. */
	install(
		source: ParticleMeshPresentations,
		preparer: TexturePreparer,
	): Promise<void>;
	/**
	 * Submit this frame's visible owner-local sources.
	 *
	 * Called before `drawFrame`, because sources come from a system the renderer does not own and
	 * are rebuilt every frame rather than retained.
	 */
	/**
	 * Publish this frame's visible ranges together with the record storage they index into.
	 *
	 * Records and ranges travel together because a range is only meaningful against the mirror that
	 * holds its slots; splitting them would let a stale mirror be drawn with fresh ranges.
	 */
	submit(
		sources: readonly ParticleSourceRange[],
		records: ParticleRecordFrame,
	): void;
	clear(): void;
}

/**
 * World-resource changes a renderer cannot observe from inside a frame, announced by the runtime.
 *
 * A renderer that derives cached state from world resources must drop it when one of these
 * arrives: `atlas-publication` because a published layout can move a placement a cached binding
 * resolved, and `region-static-detail` because the active region's detail bindings were replaced.
 */
export type ResolvedResourceInvalidation =
	"atlas-publication" | "region-static-detail";

export interface Renderer {
	/** Backend-specific diagnostics; absent renderers remain valid production implementations. */
	readonly frameDiagnostics?: RendererFrameDiagnostics;
	/** Celestial-sky residency, absent on backends that cannot draw one. */
	readonly sky?: RendererSkyCapability;
	/** Authored particle residency and submission, absent on backends that cannot draw them. */
	readonly particles?: RendererParticleCapability;
	drawFrame(input: FrameInput): RendererFrameFeedback;
	/** Drop cached derivations of world resources; absent on backends that cache none. */
	invalidateResolvedResources?(reason: ResolvedResourceInvalidation): void;
	destroy(): Promise<void>;
}
