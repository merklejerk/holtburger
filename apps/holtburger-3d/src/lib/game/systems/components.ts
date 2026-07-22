import type { EnvCellId } from "../game-types";
import type { GeometryKey, ObjectGeometryKey } from "../geometry/types";
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

/** Persistent shell render contribution attached to one env-cell root node. */
export interface EnvCellRenderable {
	/** Logical shell draw units remain domain-owned until renderer policy is implemented. */
	readonly drawUnits: readonly EnvCellDrawUnit[];
}

/** One logical env-cell shell draw range. */
export interface EnvCellDrawUnit {
	/** Source geometry selected by the cell structure baker. */
	readonly geometry: ObjectGeometryKey;
	/** First index selected from the source geometry. */
	readonly indexStart: number;
	/** Number of selected geometry indices. */
	readonly indexCount: number;
	/** Renderer-neutral material source selected for this draw. */
	readonly materialId: string;
}

/** Portal draw contribution addressed by topology rather than a scene node. */
export interface PortalDrawUnit {
	/** Portal aperture whose topology traversal selected this contribution. */
	readonly apertureId: `portal-aperture:${string}`;
	/** Geometry retained by the env-cell system and resolved by renderer policy. */
	readonly geometry: GeometryKey;
	readonly indexStart: number;
	readonly indexCount: number;
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
