import type { EnvCellId } from "../game-types";
import type { ObjectGeometryKey } from "../geometry/types";
import type { Mat4 } from "../math/types";
import type { SceneNodeId } from "../scene";

/** Persistent material and geometry selection for one rigid setup part. */
export interface RigidPartDrawUnit {
	/** Authored setup part addressed by animation frames and hooks. */
	readonly partIndex: number;
	/** Reusable object geometry selected for the part. */
	readonly geometry: ObjectGeometryKey;
	/** Renderer-neutral source material identity selected for the part. */
	readonly materialId: string;
}

/** Current object-local transforms sampled for every rigid setup part. */
export interface ArticulatedPose {
	/** Transforms indexed by authored setup part index. */
	readonly partToObjectTransforms: readonly Mat4[];
}

/** Persistent dynamic presentation attached to one entity root node. */
export interface DynamicEntityRenderable {
	/** Rigid draw units selected from the reusable presentation and appearance. */
	readonly parts: readonly RigidPartDrawUnit[];
	/** Transform-only child nodes keyed by the authored setup part. */
	readonly partNodes: ReadonlyMap<number, SceneNodeId>;
}

/** Animation state attached to one dynamic entity root. */
export interface AnimationComponent {
	/** Current rigid-part pose to apply before spatial queries. */
	readonly pose: ArticulatedPose;
}

/** Stable terrain attachment retained for one terrain scene root. */
export interface TerrainNodeAttachment {
	/** Landblock whose terrain source and local coordinate frame own this root. */
	readonly landblockId: string;
}

/** Explicit env-cell residency retained by components that need the domain identity. */
export interface EnvCellResidentComponent {
	/** Environment cell whose scope contains the resident root. */
	readonly envCellId: EnvCellId;
}
