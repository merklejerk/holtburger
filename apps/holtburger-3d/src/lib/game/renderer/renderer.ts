import type { LandblockId } from "../game-types";
import type { Camera } from "../runtime/types";
import type { ResolvedSceneEnvironment } from "../environment/scene-environment";

/** Environment-cell visibility scheduler selected without rebuilding resident content. */
export type EnvCellRenderMode = "flat" | "portal";

/** Dynamic display choices applied to a frame without changing world data or GPU setup. */
export interface FrameSettings {
	/** Whether render passes apply the effective region-authored distance fog. */
	readonly distanceFogEnabled: boolean;
	/** Environment-cell visibility and presentation policy for this frame. */
	readonly envCellRenderMode: EnvCellRenderMode;
}

/** Default dynamic display choices matching the region-authored presentation. */
export const DEFAULT_FRAME_SETTINGS: FrameSettings = {
	distanceFogEnabled: true,
	envCellRenderMode: "portal",
};

/** Camera state for one camera or portal view. The renderer collects scene content itself. */
export interface FrameViewInput {
	/** Camera pose and projection used for this view. */
	readonly camera: Camera;
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
	/** Visible dynamic contributions selected before their draw path is implemented. */
	readonly visibleDynamics: number;
	/** Visible environment-cell shell contributions selected before their draw path is implemented. */
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
	/** Mask boundaries omitted because both endpoints share one render domain. */
	readonly portalSameDomainBoundaryCrossingCount: number;
	readonly portalRenderLayerCount: number;
	readonly portalRenderNodeCount: number;
	readonly portalSubmittedRenderNodeCount: number;
	readonly portalExteriorRenderCount: number;
	readonly portalPlanningDurationMs: number;
	readonly portalExecutionDurationMs: number;
	readonly sceneDomainTargetCount: number;
	/** Retained color plus depth-stencil attachment bytes owned by portal targets. */
	readonly sceneDomainTargetBytes: number;
	/** Exterior scene-domain contributions rendered directly into portal targets. */
	readonly portalExteriorContributionCount: number;
	/** All static-object draw calls submitted to the backend this frame. */
	readonly submittedStaticObjectDrawCount: number;
	/** Triangles submitted by all static-object draws, including instance multiplication. */
	readonly submittedStaticObjectTriangleCount: number;
	/** Baked static-object draw calls submitted this frame. */
	readonly submittedBakedStaticObjectDrawCount: number;
	/** Triangles submitted by baked static-object draws. */
	readonly submittedBakedStaticObjectTriangleCount: number;
	/** Persistent instanced draw calls submitted this frame. */
	readonly submittedPersistentInstancedDrawCount: number;
	/** Persistent instances submitted this frame. */
	readonly submittedPersistentInstanceCount: number;
	/** Source triangles referenced by instanced draws before instance multiplication. */
	readonly submittedInstancedSourceTriangleCount: number;
	/** Transparent baked ranges and instance templates classified for view submission. */
	readonly transparentStaticCandidateCount: number;
	/** Transparent candidates outside the near-sort radius and eligible for cohort batching. */
	readonly farTransparentStaticCandidateCount: number;
	/** Transparent candidates inside the near-sort radius and ordered back-to-front. */
	readonly nearTransparentStaticCandidateCount: number;
	/** Adjacent compatible transparent instance runs emitted after global ordering. */
	readonly transparentFrameRunCount: number;
	/** Cohort-batched transparent instance runs emitted outside the near-sort radius. */
	readonly farTransparentFrameRunCount: number;
	/** Adjacent transparent instance runs emitted after near back-to-front ordering. */
	readonly nearTransparentFrameRunCount: number;
	/** Per-view transparent instance uploads with a non-empty population. */
	readonly transparentFrameUploadCount: number;
	/** Numeric bytes uploaded for transparent instances across all views. */
	readonly transparentFrameUploadBytes: number;
	/** Transparent static-object draw calls submitted after sorting. */
	readonly submittedTransparentStaticDrawCount: number;
	/** Frame-streamed transparent instances submitted after sorting. */
	readonly submittedTransparentInstanceCount: number;
	/** Additive static-object draw calls submitted in their deterministic phase. */
	readonly submittedAdditiveStaticDrawCount: number;
	/** Current reusable transparent frame-arena capacity in instances. */
	readonly frameInstanceCapacity: number;
	/** Lifetime geometric growth count for the reusable frame arena. */
	readonly frameInstanceGrowthCount: number;
	/** Lifetime largest per-view transparent instance population. */
	readonly frameInstanceViewHighWaterMark: number;
	/** Object-program activation count across every rendered view. */
	readonly objectProgramChanges: number;
	/** Object atlas/detail texture binds performed across every rendered view. */
	readonly objectTexturePageBinds: number;
}

export interface Renderer {
	drawFrame(input: FrameInput): void;
	destroy(): Promise<void>;
	/** Return a cold diagnostic snapshot when this backend exposes frame selection metrics. */
	getFrameSelectionMetrics?(): FrameSelectionMetrics;
}
