import type { EnvCellId, LandblockId } from "../game-types";
import type { ObjectGeometryKey } from "../geometry/types";
import type { AABB3, Mat4, Vec3 } from "../math/types";
import type { LandblockVec3 } from "../../assets/ac-frame";
import type { SceneNodeId, SceneScope } from "../scene";
import type { ObjectMaterialBinding } from "../commit/artifacts";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type { ObjectInstanceData } from "./static-resources";

declare const partVisualTemplateKeyBrand: unique symbol;

/** Canonical immutable identity of one rigid part inside a visual template. */
export type PartVisualTemplateKey = `part-visual-template:${string}` & {
	readonly [partVisualTemplateKeyBrand]: true;
};

/** Persistent material and geometry selection for one rigid setup part. */
export interface RigidPartDrawUnit {
	/** Complete immutable part/range compatibility identity used before render-domain qualification. */
	readonly batchKey: string;
	/** Authored setup part addressed by animation frames and hooks. */
	readonly partIndex: number;
	/** Reusable object geometry selected for the part. */
	readonly geometry: ObjectGeometryKey;
	/** Contiguous authored triangle range sharing one complete material/polygon binding. */
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: ObjectMaterialBinding;
	readonly ordering: ObjectMaterialOrdering;
	/** Shared immutable part template; entity identity never enters batching compatibility. */
	readonly templatePartKey: PartVisualTemplateKey;
}

/** Renderer-neutral visible rigid-part instance emitted from one selected dynamic root. */
export interface VisibleRigidPartContribution {
	/** Landblock coordinate frame containing `instance.sourceToLandblock`. */
	readonly landblockId: LandblockId;
	/** Source-domain scopes reached by the owning entity's accepted spatial geometry. */
	readonly renderScopes: readonly SceneScope[];
	/** Stable authored draw unit; its identity is a cache key, so it is never cloned per frame. */
	readonly drawUnit: RigidPartDrawUnit;
	/**
	 * Effective ordering for this frame, which is the draw unit's own class unless a translucency
	 * effect promotes an opaque part into the transparent phase.
	 */
	readonly ordering: RigidPartDrawUnit["ordering"];
	/** Final part transform and per-entity modifiers consumed by shared object instancing. */
	readonly instance: ObjectInstanceData;
	/**
	 * Stable ordering facts required only for transparent ranges.
	 *
	 * `center` is in landblock space, matching every other transparent contribution the renderer
	 * orders. Unlike static contributions it is resolved per frame, because the pose that places
	 * it is animation-variant.
	 */
	readonly transparentSort: {
		readonly center: LandblockVec3;
		readonly stableId: string;
	} | null;
}

/** Current object-local transforms sampled for every rigid setup part. */
export interface ArticulatedPose {
	/** Transforms indexed by authored setup part index. */
	readonly partToObjectTransforms: readonly Mat4[];
	/**
	 * Authored root frame for this pose, or `null` when the clip authors none.
	 *
	 * Applied to the *visual* root only. See `sampleAuthoredRootTransform` for why that differs
	 * from retail and why no shipped content can observe the difference.
	 */
	readonly authoredRootTransform: Mat4 | null;
}

/** Effect-owned render state for one authored rigid part. */
export interface PartRenderState {
	/** Retail translucency: zero is unchanged and one suppresses the part entirely. */
	readonly translucency: number;
}

/** Complete active state for one rigid setup part. */
export interface ActiveDynamicPart {
	/** Setup-authored geometry scale composed independently from rigid animation poses. */
	readonly defaultScale: Vec3;
	/** Material, geometry, and ordering facts selected once by reusable visual preparation. */
	readonly drawUnits: readonly ActiveDynamicDrawUnit[];
	/** Geometry-local envelope retained for publication-time pose bounds. */
	readonly localBounds: AABB3;
	/** Transform-only scene node carrying the current rigid-part pose. */
	readonly nodeId: SceneNodeId;
	/** Authored setup part addressed by animation frame tables. */
	readonly partIndex: number;
	/** Current effect state sampled atomically with this part's pose. */
	readonly renderState: PartRenderState;
}

/** One active draw range with the sort center needed by authored or effect-driven transparency. */
export interface ActiveDynamicDrawUnit {
	readonly drawUnit: RigidPartDrawUnit;
	/** Geometry-local center; the pose that places it into landblock space is per frame. */
	readonly transparentSortCenter: Vec3;
}

/** Persistent dynamic presentation attached to one entity root node. */
export interface DynamicEntityRenderable {
	/** Complete rigid parts; consumers never rejoin parallel part-indexed structures. */
	readonly parts: readonly ActiveDynamicPart[];
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
