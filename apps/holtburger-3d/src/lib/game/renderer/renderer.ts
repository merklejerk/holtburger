import type { LandblockId } from "../game-types";
import type { SceneNodeId } from "../scene";
import type { Camera } from "../runtime/types";
import type { ResolvedSceneEnvironment } from "../environment/scene-environment";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import type { TextureFilteringPolicy } from "./texture-filtering-policy";

/** Environment-cell visibility scheduler selected without rebuilding resident content. */
export type EnvCellRenderMode = "flat" | "portal";

/** Dynamic renderer quality choices independent from content and resource identity. */
interface RenderQualitySettings {
	/** Independently optional object presentations below this physical pixel area are omitted. */
	readonly minimumObjectFootprintPixelArea: number;
	/** Non-near-plane portal windows smaller than this physical pixel area are omitted. */
	readonly minimumPortalFootprintPixelArea: number;
	/** Global draw-time policy for filterable normalized textures. */
	readonly textureFiltering: TextureFilteringPolicy;
}

/** Dynamic display choices applied to a frame without changing world data or GPU setup. */
export interface FrameSettings {
	/** Whether render passes apply the effective region-authored distance fog. */
	readonly distanceFogEnabled: boolean;
	/** Retail's viewer headlamp, which makes interiors without authored lights navigable. */
	readonly viewerLightEnabled: boolean;
	/** Environment-cell visibility and presentation policy for this frame. */
	readonly envCellRenderMode: EnvCellRenderMode;
	/** Quality policy snapshotted once for every rendered frame. */
	readonly quality: RenderQualitySettings;
}

/** Default dynamic display choices matching the region-authored presentation. */
export const DEFAULT_FRAME_SETTINGS: FrameSettings = {
	distanceFogEnabled:
		FRONTEND_TUNING.rendering.frameDefaults.distanceFogEnabled,
	viewerLightEnabled:
		FRONTEND_TUNING.rendering.frameDefaults.viewerLightEnabled,
	envCellRenderMode: FRONTEND_TUNING.rendering.frameDefaults.envCellRenderMode,
	quality: {
		minimumObjectFootprintPixelArea:
			FRONTEND_TUNING.rendering.frameDefaults.minimumObjectFootprintPixelArea,
		minimumPortalFootprintPixelArea:
			FRONTEND_TUNING.rendering.frameDefaults.minimumPortalFootprintPixelArea,
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
	/** Dynamic display choices applied to this frame. */
	readonly frameSettings: FrameSettings;
	readonly views: readonly FrameViewInput[];
}

/** Latest renderer-side selection counts, aggregated across every view in one frame. */
export interface FrameSelectionMetrics {
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
	/** Flat mode must keep all later portal-rendering work at zero. */
	readonly submittedPortalApertureDrawCount: number;
	readonly portalMaskEdgeCount: number;
	readonly portalNearPlaneSeedCount: number;
	readonly portalRejectedFacingCrossingCount: number;
	/** Non-near-plane crossings omitted below the configured projected footprint. */
	readonly portalRejectedFootprintCount: number;
	/** Mask boundaries omitted because both endpoints share one render domain. */
	readonly portalSameDomainBoundaryCrossingCount: number;
	/** Novel scope-local portal windows admitted by the bounded planner. */
	readonly portalAdmittedScopeWindowStateCount: number;
	readonly portalRenderLayerCount: number;
	readonly portalRenderNodeCount: number;
	readonly portalSubmittedRenderNodeCount: number;
	readonly portalExteriorRenderCount: number;
	readonly sceneDomainTargetCount: number;
	/** Retained color plus depth-stencil attachment bytes owned by portal targets. */
	readonly sceneDomainTargetBytes: number;
	/** All static-object draw calls submitted to the backend this frame. */
	readonly submittedStaticObjectDrawCount: number;
	/** Triangles submitted by all static-object draws, including instance multiplication. */
	readonly submittedStaticObjectTriangleCount: number;
	/** Baked static-object draw calls submitted this frame. */
	readonly submittedBakedStaticObjectDrawCount: number;
	/** Triangles submitted by baked static-object draws. */
	readonly submittedBakedStaticObjectTriangleCount: number;
	/** Visible generated-scenery fragments selected before post-culling compaction. */
	readonly selectedGeneratedInstanceFragmentCount: number;
	/** Generated-scenery instances selected before post-culling compaction. */
	readonly selectedGeneratedInstanceCount: number;
	/** Generated candidates projected once per immutable stream in each rendered view. */
	readonly testedGeneratedInstanceCount: number;
	/** Stream-unique, per-view projected candidates retained across material partitions. */
	readonly retainedGeneratedInstanceCount: number;
	/** Stream-unique, per-view candidates omitted as proven-small or outside the view. */
	readonly rejectedGeneratedInstanceCount: number;
	/** Compacted generated-scenery draw calls submitted this frame. */
	readonly submittedCompactedGeneratedDrawCount: number;
	/** Generated-scenery instances submitted through compacted frame ranges. */
	readonly submittedCompactedGeneratedInstanceCount: number;
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
	/** Current reusable object frame-arena capacity in instances. */
	readonly frameInstanceCapacity: number;
	/** Lifetime geometric growth count for the reusable frame arena. */
	readonly frameInstanceGrowthCount: number;
	/** Lifetime largest per-view object instance population. */
	readonly frameInstanceViewHighWaterMark: number;
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
	/** CPU wall time spent concatenating multi-node portal contribution arrays. */
	readonly contributionMergeMs: number;
	/** CPU wall time spent finalizing renderer diagnostics. */
	readonly finalizationMs: number;
	/** CPU wall time spent projecting and selecting generated-instance envelopes. */
	readonly generatedInstanceCullingMs: number;
	/** CPU wall time spent encoding and uploading frame-local object instances. */
	readonly instanceUploadMs: number;
	/** CPU wall time spent forming compatible frame-instance submission runs. */
	readonly instanceRunPreparationMs: number;
	/** CPU wall time spent compiling draw-consumed object state. */
	readonly objectPreparationMs: number;
	/** CPU wall time spent submitting opaque object work. */
	readonly opaqueSubmissionMs: number;
	/** Renderer work outside the named spans, including portal masks and orchestration. */
	readonly otherMs: number;
	/** CPU wall time spent planning portal visibility and execution topology. */
	readonly portalGraphPlanningMs: number;
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
	/** Portal contribution callbacks that combined more than one prepared node. */
	readonly multiNodeMergeCount: number;
	/** Dynamic object inputs compiled into frame-current draw state. */
	readonly dynamicObjectPreparationCount: number;
	/** Non-dynamic object inputs compiled from retained scene contributions. */
	readonly staticObjectPreparationCount: number;
	/** Unique portal contribution node sets consumed by executor callbacks. */
	readonly portalContributionSetCount: number;
	/** Portal contribution node-set callback invocations. */
	readonly portalContributionSetUseCount: number;
	/** Portal nodes prepared before executor callbacks begin. */
	readonly portalNodePreparationCount: number;
	/** Prepared portal-node uses after the first use in the same frame. */
	readonly repeatedPortalNodeUseCount: number;
	/** Portal contribution node-set uses after the first identical set use. */
	readonly repeatedPortalContributionSetUseCount: number;
	/** Prepared portal nodes consumed by executor callbacks. */
	readonly portalNodeUseCount: number;
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
			/** GPU timestamp span covering blended object commands. */
			readonly blendedMs: number;
			/** Renderer frame identifier associated with this delayed result. */
			readonly frameNumber: number;
			readonly kind: "available";
			/** GPU timestamp span covering opaque object commands. */
			readonly opaqueMs: number;
			/** GPU command span outside the named phases. */
			readonly otherMs: number;
			/** Submitted GPU frames whose timestamp results are not yet readable. */
			readonly pendingFrameCount: number;
			/** GPU timestamp span covering terrain commands. */
			readonly terrainMs: number;
			/** GPU timestamp span from the first to last command in the frame. */
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

export interface Renderer {
	/** Backend-specific diagnostics; absent renderers remain valid production implementations. */
	readonly frameDiagnostics?: RendererFrameDiagnostics;
	drawFrame(input: FrameInput): RendererFrameFeedback;
	destroy(): Promise<void>;
}
