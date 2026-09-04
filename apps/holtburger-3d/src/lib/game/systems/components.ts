import type { EnvCellId, LandblockOwnerId } from "../game-types";
import type { ObjectGeometryKey } from "../geometry/types";
import type { AABB3, Mat4, Vec3 } from "../math/types";
import type { LandblockVec3 } from "../../assets/ac-frame";
import type { SceneNodeId, SceneScope } from "../scene";
import type { ObjectMaterialBinding } from "../commit/artifacts";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type { RetailGeometryVisibility } from "../resolution/presentation";
import type { ObjectInstanceData } from "./static-resources";
import type { ObjectGeometryData } from "../renderer/geometry";

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
	/** Retail draw eligibility inherited from the GfxObj-backed setup part. */
	readonly retailVisibility: RetailGeometryVisibility;
	/** Shared immutable part template; entity identity never enters batching compatibility. */
	readonly templatePartKey: PartVisualTemplateKey;
}

/** Persistent material-independent depth range for one rigid setup part. */
export interface RigidPartDepthDrawUnit {
	/** Effective authored face rejection; every other material fact is intentionally absent. */
	readonly cullFace: "back" | "front";
	/** Reusable object geometry selected for the part. */
	readonly geometry: ObjectGeometryKey;
	/** Maximal contiguous authored triangle range sharing the effective cull mode. */
	readonly indexStart: number;
	readonly indexCount: number;
	/** Retail draw eligibility inherited from the GfxObj-backed setup part. */
	readonly retailVisibility: RetailGeometryVisibility;
}

/** Renderer-neutral visible rigid-part instance emitted from one selected dynamic root. */
export interface VisibleRigidPartContribution {
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

/** Renderer-neutral rigid-part instance emitted for material-independent depth rendering. */
export interface VisibleRigidDepthContribution {
	/** Stable depth range compiled once with the shared visual template. */
	readonly drawUnit: RigidPartDepthDrawUnit;
	/** Final part transform and per-entity modifiers shared with material rendering. */
	readonly instance: ObjectInstanceData;
}

/** One producer expansion shared by material and material-independent renderer consumers. */
export type VisibleDynamicContributions =
	| {
			/** No draw-visible contribution exists under the entity's current presentation state. */
			readonly kind: "hidden";
			readonly depth: readonly VisibleRigidDepthContribution[];
			readonly material: readonly VisibleRigidPartContribution[];
	  }
	| {
			readonly kind: "visible";
			/** Landblock coordinate frame containing every emitted instance transform. */
			readonly landblockId: LandblockOwnerId;
			/** Source-domain scopes shared by every contribution from this visual root. */
			readonly renderScopes: readonly SceneScope[];
			readonly depth: readonly VisibleRigidDepthContribution[];
			readonly material: readonly VisibleRigidPartContribution[];
	  };

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
	/** Material-independent depth ranges selected once by reusable visual preparation. */
	readonly depthDrawUnits: readonly RigidPartDepthDrawUnit[];
	/** Geometry-local envelope retained for publication-time pose bounds. */
	readonly localBounds: AABB3;
	/** Shared immutable CPU mesh used by exact selection without copying renderer geometry. */
	readonly geometryData: ObjectGeometryData | null;
	/** Current composed setup scale and rigid pose, relative to the entity's visual root. */
	readonly localToVisualRoot: Mat4;
	/** Reusable renderer-neutral instance payload rewritten from the current placement and effects. */
	readonly frameInstance: ObjectInstanceData;
	/** Transform-only scene node carrying the current rigid-part pose. */
	readonly nodeId: SceneNodeId;
	/** Authored setup part addressed by animation frame tables. */
	readonly partIndex: number;
	/** Current effect state, updated in place with the retained part record after sample validation. */
	renderState: PartRenderState;
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
