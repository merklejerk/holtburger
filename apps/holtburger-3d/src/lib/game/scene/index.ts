import type { EnvCellId, LandblockId } from "../game-types";
import type { AABB3, Mat4 } from "../math/types";

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
	| { readonly kind: "outdoor"; readonly landblockId: LandblockId }
	| {
			readonly kind: "env-cell";
			readonly landblockId: LandblockId;
			readonly envCellId: EnvCellId;
	  };

/** Canonical env-cell scope data projected from prepared host topology. */
export interface SceneEnvCellScopeInput {
	readonly scope: Extract<SceneScope, { readonly kind: "env-cell" }>;
	/** Conservative extent already expressed in the containing landblock frame. */
	readonly landblockBounds: AABB3 | null;
	/** Source-provided coarse visibility set used to prune later portal traversal. */
	readonly potentiallyVisibleEnvCellIds: ReadonlySet<EnvCellId>;
}

/** Stable identity for one directed query crossing. */
export type PortalCrossingId = `portal-crossing:${string}`;

/** Directed aperture crossing used by scoped spatial queries. */
export interface ScenePortalCrossingInput {
	readonly id: PortalCrossingId;
	readonly source: SceneScope;
	readonly target: SceneScope;
	readonly aperture: {
		readonly id: `portal-aperture:${string}`;
		readonly landblockBounds: AABB3;
		readonly vertices: Float32Array;
		readonly indices: Uint32Array;
		readonly visibleSide: "positive" | "negative" | "both";
	};
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

interface SceneNodeFields {
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

/** Result of a spatial query against the canonical scene graph. */
export interface VisibleScene {
	/** Bounded nodes selected by the spatial query with their indexed placement snapshot. */
	readonly entries: readonly VisibleSceneEntry[];
	/** Directed crossings accepted during a future scoped traversal. */
	readonly crossings: readonly ScenePortalCrossingInput[];
}

/** One bounded node selected by a spatial query. */
export interface VisibleSceneEntry {
	readonly nodeId: SceneNodeId;
	/** Inherited residency and transform already used to place this entry in its index. */
	readonly placement: ResolvedScenePlacement;
}

export { SceneGraph } from "./scene-graph";
