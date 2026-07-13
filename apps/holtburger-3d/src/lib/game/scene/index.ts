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

/** Atomic transform and residency update for the root of a transform tree. */
export interface ScenePlacement extends SceneResidency {
	/** Root transform expressed in landblock-local coordinates. */
	readonly localTransform: Mat4;
}

/** Residency and flattened transform for any node in a transform tree. */
export interface ResolvedScenePlacement extends SceneResidency {
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

/** Result of the stub visibility pass. Transform flattening is a later query concern. */
export interface VisibleScene {
	readonly nodeIds: readonly SceneNodeId[];
}

export { SceneGraph } from "./scene-graph";
