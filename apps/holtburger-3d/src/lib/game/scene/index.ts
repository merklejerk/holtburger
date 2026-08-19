import type { EnvCellId, LandblockId } from "../game-types";
import type { AABB3, Mat4, Vec3 } from "../math/types";

/** Opaque identity assigned by SceneGraph to one canonical scene node. */
export type SceneNodeId = `scene-node:${number}`;

/** Landblock and optional environment-cell residency of a transform tree. */
export interface SceneResidency {
	/** Landblock whose local coordinate frame contains the complete tree. */
	readonly landblockId: LandblockId;
	/** Optional environment cell occupied by this root within its landblock. */
	readonly envCellId: EnvCellId | null;
}

/** Visibility and spatial-query scope derived from a root's residency. */
export type SceneScope =
	| {
			/** All resident outdoor nodes share one connected visibility scope. */
			readonly kind: "outdoor";
	  }
	| {
			readonly kind: "env-cell";
			readonly landblockId: LandblockId;
			readonly envCellId: EnvCellId;
	  };

/** Indexed scope source for hot-path queries that cannot materialize a temporary array. */
export interface SceneScopeSelection {
	readonly count: number;
	scopeAt(ordinal: number): SceneScope;
}

/** Canonical env-cell scope data projected from prepared host topology. */
export interface SceneEnvCellScopeInput {
	readonly scope: Extract<SceneScope, { readonly kind: "env-cell" }>;
	/** Conservative extent already expressed in the containing landblock frame. */
	readonly landblockBounds: AABB3 | null;
	/** Positive-child Cell BSP plane chain encoded as normalized [nx, ny, nz, d] tuples. */
	readonly containmentPlanes: Float32Array;
	/** Cell structure-local transform into the containing landblock frame. */
	readonly structureToLandblock: Mat4;
	/** Render-scheduling component joined only through proven depth-continuous seams. */
	readonly visibilityIslandId: SceneVisibilityIslandId;
	/** Source PVS provenance retained for preload and offline policy evaluation. */
	readonly potentiallyVisibleEnvCellIds: ReadonlySet<EnvCellId>;
	/**
	 * Authored SeenOutside flag (EnvCell flag 0x01).
	 *
	 * Retail forces a flat interior ambient whenever the camera occupies a cell without it
	 * (cell transition, acclient.c:140480).
	 */
	readonly seenOutside: boolean;
}

/** One AABB-selected EnvCell plus its exact retail containment verdict. */
interface SceneEnvCellPointCandidate extends SceneResidency {
	readonly envCellId: EnvCellId;
	readonly containsPoint: boolean;
}

/** Every currently resident scene-scope candidate for one canonical world point. */
export interface ScenePointResidencyCandidates {
	/** Explicit outdoor fallback for the point's canonical landblock. */
	readonly outdoor: SceneResidency & { readonly envCellId: null };
	/** Stable diagnostic ordering only; callers must not use order as selection policy. */
	readonly envCells: readonly SceneEnvCellPointCandidate[];
}

/** Stable identity for one directed portal-topology crossing. */
export type PortalCrossingId = `portal-crossing:${string}`;
/** Stable identity for one proof-backed indoor visibility island. */
type SceneVisibilityIslandId = `env-cell-island:${string}`;

/** One material-free planar aperture expressed in an owning landblock frame. */
interface ScenePortalAperture {
	readonly id: `portal-aperture:${string}`;
	readonly landblockId: LandblockId;
	readonly landblockBounds: AABB3;
	readonly vertices: Float32Array;
	readonly indices: Uint32Array;
	readonly plane: {
		readonly normal: Vec3;
		readonly d: number;
	};
}

/** Directed aperture crossing retained for renderer portal planning. */
export interface ScenePortalCrossingInput {
	readonly id: PortalCrossingId;
	readonly source: SceneScope;
	readonly target: SceneScope;
	/** Authored half-space from which this directed aperture may be traversed. */
	readonly acceptedSide: "positive" | "negative";
	/** Whether the source portal asserted an exact polygon match. */
	readonly exactMatch: boolean;
	/** Equal-depth mask ownership resolved from the authored source portal surface. */
	readonly maskDepthPolicy: "allow-equal-depth" | "reject-equal-depth";
	/**
	 * Host-proven coincident-junction identity shared by every crossing on one coplanar
	 * overlapping footprint, or null. Equal ids license the compositor's equal-depth advance.
	 */
	readonly junctionGroupId: number | null;
	/** Stable reciprocal crossing, when the host proved one. */
	readonly reciprocalCrossingId: PortalCrossingId | null;
	/** Host-classified seam semantics retained for later rendering policy. */
	readonly spatialRelationship:
		| {
				readonly kind: "indoor-depth-continuous";
				readonly reciprocalApertureId: `portal-aperture:${string}`;
		  }
		| {
				readonly kind: "indoor-topology-boundary";
				readonly reason: string;
		  }
		| {
				readonly kind: "exterior-transition";
				readonly exteriorLandblockId: LandblockId;
		  };
	/** Authored directed geometry used for entry-side, junction, and topology decisions. */
	readonly sourceAperture: ScenePortalAperture;
	/** Host-resolved geometry used exclusively by render planning and material-free masks. */
	readonly visibilityAperture: ScenePortalAperture;
}

/** Atomic transform and residency update for the root of a transform tree. */
export interface ScenePlacement extends SceneResidency {
	/** Root transform expressed in landblock-local coordinates. */
	readonly localTransform: Mat4;
}

/** Residency and flattened transform for any node in a transform tree. */
export interface ResolvedScenePlacement extends SceneResidency {
	/** Query scope derived from the root residency. */
	readonly scope: SceneScope;
	/** Node transform composed through its parents into landblock-local coordinates. */
	readonly localToLandblock: Mat4;
}

/**
 * Residency and flattened *origin* for any node in a transform tree.
 *
 * The translation-only companion to {@link ResolvedScenePlacement}, for frame-rate consumers that
 * ask "where is this node" rather than "what is its transform". Resolving it walks a point through
 * the parent chain instead of composing matrices, so it neither multiplies nor copies transforms.
 */
export interface ResolvedSceneOrigin extends SceneResidency {
	/** Query scope derived from the root residency. */
	readonly scope: SceneScope;
	/** Node origin composed through its parents into landblock-local coordinates. */
	readonly landblockOrigin: Vec3;
}

/** One bounded scene node's colocated local envelope and resolved render placement. */
export interface ResolvedSceneBounds {
	/** Bounds retained in the selected node's own local coordinate frame. */
	readonly localBounds: AABB3;
	/** Flattened placement that transforms the local envelope into its landblock frame. */
	readonly placement: ResolvedScenePlacement;
}

interface SceneNodeFields {
	/** Opaque broad-phase grouping supplied by the owning system. */
	readonly cullingGroup?: string;
	/** Bounds in this node's local coordinate frame, or null for transform-only nodes. */
	readonly localBounds: AABB3 | null;
	/** Transform expressed in the parent node or root landblock coordinate frame. */
	readonly localTransform: Mat4;
}

/** Canonical node shape; children inherit landblock/env-cell placement from their root. */
export type SceneNode = SceneNodeFields & { readonly id: SceneNodeId } & (
		| (SceneResidency & {
				readonly parentId: null;
		  })
		| {
				readonly parentId: SceneNodeId;
		  }
	);

/** Input for graph-assigned node creation. */
export type SceneNodeInput = SceneNodeFields &
	(
		| (SceneResidency & {
				readonly parentId: null;
		  })
		| {
				readonly parentId: SceneNodeId;
		  }
	);

/** Result of a frame-scoped spatial query against explicitly selected scene scopes. */
export interface VisibleScene {
	/** Bounded node IDs selected by the spatial query. Contents are overwritten by the next query. */
	readonly entries: readonly SceneNodeId[];
}

/** Frame-scoped producer-group predicate applied before broad-phase bounds work. */
export type SceneCullingGroupFilter = (cullingGroup: string) => boolean;

/** Explicit unfiltered selection policy for callers outside renderer presentation. */
export const INCLUDE_ALL_SCENE_CULLING_GROUPS: SceneCullingGroupFilter = () =>
	true;

/** One scope retained by the renderer-facing topology view. */
export interface SceneTopologyScope {
	readonly scope: SceneScope;
	/** Outdoor has no indoor depth-continuity island. */
	readonly visibilityIslandId: SceneVisibilityIslandId | null;
	/** Source PVS provenance retained for preload policy, never traversal rejection. */
	readonly potentiallyVisibleEnvCellIds: ReadonlySet<EnvCellId>;
}

/**
 * Retained immutable topology facts for one scene revision.
 *
 * The view is rebuilt lazily after scope/crossing publication and reused until the next topology
 * mutation. Consumers own render scheduling; this view contains no traversal or stencil policy.
 */
export interface SceneTopologyView {
	readonly revision: number;
	readonly scopes: readonly SceneTopologyScope[];
	readonly crossings: readonly ScenePortalCrossingInput[];
	outgoing(scope: SceneScope): readonly ScenePortalCrossingInput[];
}

export { SceneGraph } from "./scene-graph";
