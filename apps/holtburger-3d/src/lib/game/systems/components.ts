import type { EnvCellId, LandblockId } from "../game-types";
import type { ObjectGeometryKey } from "../geometry/types";
import type { Mat4, Vec3 } from "../math/types";
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

/** Residency boundary within which visible object instances may share one draw submission. */
export interface ObjectRenderDomain {
	readonly key: string;
	readonly landblockId: LandblockId;
	readonly scope: SceneScope;
}

/** Renderer-neutral visible rigid-part instance emitted from one selected dynamic root. */
export interface VisibleRigidPartContribution {
	readonly domain: ObjectRenderDomain;
	readonly drawUnit: RigidPartDrawUnit;
	/** Final part transform and per-entity modifiers consumed by shared object instancing. */
	readonly instance: ObjectInstanceData;
	/** Stable geometry-local ordering facts required only for transparent ranges. */
	readonly transparentSort: {
		readonly center: Vec3;
		readonly stableId: string;
	} | null;
}

/** Current object-local transforms sampled for every rigid setup part. */
export interface ArticulatedPose {
	/** Transforms indexed by authored setup part index. */
	readonly partToObjectTransforms: readonly Mat4[];
}

/** Complete active state for one rigid setup part. */
export interface ActiveDynamicPart {
	/** Setup-authored geometry scale composed independently from rigid animation poses. */
	readonly defaultScale: Vec3;
	/** Material, geometry, and ordering facts selected once by reusable visual preparation. */
	readonly drawUnits: readonly ActiveDynamicDrawUnit[];
	/** Transform-only scene node carrying the current rigid-part pose. */
	readonly nodeId: SceneNodeId;
	/** Authored setup part addressed by animation frame tables. */
	readonly partIndex: number;
}

/** One active draw range with its ordering-dependent sort contract made explicit. */
export type ActiveDynamicDrawUnit =
	| {
			readonly drawUnit: RigidPartDrawUnit & {
				readonly ordering: "transparent";
			};
			readonly transparentSortCenter: Vec3;
	  }
	| {
			readonly drawUnit: RigidPartDrawUnit & {
				readonly ordering: Exclude<ObjectMaterialOrdering, "transparent">;
			};
			readonly transparentSortCenter: null;
	  };

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
