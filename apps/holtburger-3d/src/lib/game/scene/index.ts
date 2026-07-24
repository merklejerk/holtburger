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
	| {
			/** All resident outdoor nodes share one connected visibility scope. */
			readonly kind: "outdoor";
	  }
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
		/** Landblock frame containing the aperture geometry and bounds. */
		readonly landblockId: LandblockId;
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
	/** Bounded node IDs selected by the spatial query. Contents are overwritten by the next query. */
	readonly entries: readonly SceneNodeId[];
	/** Directed portal selections accepted during scoped traversal. Contents are overwritten by the next query. */
	readonly crossings: readonly VisiblePortalCrossing[];
}

/** Primitive portal selection emitted by a frame-scoped spatial query. */
export interface VisiblePortalCrossing {
	readonly id: PortalCrossingId;
	readonly apertureId: ScenePortalCrossingInput["aperture"]["id"];
}

export { SceneGraph } from "./scene-graph";
