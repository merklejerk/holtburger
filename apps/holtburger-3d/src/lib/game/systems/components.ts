import type { EnvCellId, LandblockOwnerId } from "../game-types";
import type { ObjectGeometryKey } from "../geometry/types";
import type { AABB3, Mat4, Vec3 } from "../math/types";
import type { SceneNodeId, SceneScope } from "../scene";
import type { ObjectMaterialBinding } from "../commit/artifacts";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type { RetailGeometryVisibility } from "../resolution/presentation";
import type { ObjectInstanceData } from "./static-resources";
import type { ObjectGeometryData } from "../renderer/geometry";
import type { DynamicLayout } from "../geometry/dynamic-layout";
import type { DynamicAppearance } from "./dynamic-appearance";

declare const partVisualTemplateKeyBrand: unique symbol;
declare const objectVisualTemplateKeyBrand: unique symbol;

/** Canonical immutable identity of one host-resolved setup appearance. */
export type ObjectVisualTemplateKey = `object-visual-template:${string}` & {
	readonly [objectVisualTemplateKeyBrand]: true;
};

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

/** Persistent dynamic presentation attached to one entity root node. */
export type DynamicEntityRenderable = {
	/** Complete rigid parts; consumers never rejoin parallel part-indexed structures. */
	readonly parts: readonly ActiveDynamicPart[];
} & (
	| {
			/** Part targets exist during preparation, but no merged visual is installed yet. */ readonly kind: "preparing";
	  }
	| {
			/** Geometry and appearance are published atomically after resource staging succeeds. */
			readonly kind: "ready";
			/** Shared immutable source-local geometry and selector identities. */
			readonly layout: DynamicLayout;
			/** Replaceable logical material and range records for this installed layout. */
			readonly appearance: DynamicAppearance;
	  }
);

/** Compact current entity input; borrowed part payloads remain valid until its next publication. */
export interface VisibleDynamicPresentation {
	/** Stable source identity used to break transparent ordering ties across entities. */
	readonly identity: string;
	/** Installed layout/appearance; ready parts are in dense selector order, without range expansion. */
	readonly visual: Extract<DynamicEntityRenderable, { kind: "ready" }>;
	/** Landblock coordinate frame of every current part payload. */
	readonly landblockId: LandblockOwnerId;
	/** All source-domain scopes; the renderer selects applicable portal views. */
	readonly renderScopes: readonly SceneScope[];
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
