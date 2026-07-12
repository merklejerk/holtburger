import type { DatAssetId } from "../game-types";
import type { AABB3, Mat4, Vec3 } from "../math/types";

/** Stable identity for one reusable resident presentation definition. */
export type ResolvedPresentationId = `presentation:${string}`;

/** Stable identity for canonical geometry prepared by the host. */
export type ResolvedGeometryId = `geometry:${string}`;

/** Stable identity for one normalized material source. */
export type ResolvedMaterialId = `material:${string}`;

/** Geometry buffers shared by object parts and embedded structures. */
export interface ResolvedGeometry {
	readonly id: ResolvedGeometryId;
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly textureCoordinates: Float32Array;
	readonly indices: Uint32Array;
	readonly materialSlotIndices: Uint16Array;
	readonly bounds: AABB3 | null;
}

/** Material source before texture atlas placement is assigned. */
export type ResolvedMaterial =
	| {
			readonly id: ResolvedMaterialId;
			readonly kind: "solid-color";
			readonly color: readonly [number, number, number, number];
	  }
	| {
			readonly id: ResolvedMaterialId;
			readonly kind: "texture";
			readonly colorTextureId: DatAssetId;
			readonly paletteTextureId: DatAssetId | null;
			readonly detailTextureId: DatAssetId | null;
	  };

/** One part in a setup-backed presentation hierarchy. */
export interface ResolvedObjectPart {
	readonly partIndex: number;
	readonly parentPartIndex: number | null;
	readonly geometry: ResolvedGeometry;
	readonly defaultScale: Vec3;
	readonly materials: readonly ResolvedMaterial[];
}

/** Named setup placement containing a local transform for every part. */
export interface ResolvedPlacementPose {
	readonly placementId: number;
	readonly partTransforms: readonly Mat4[];
}

/** Demand-loadable animation slice referenced by a motion graph. */
export interface ResolvedMotionClipRef {
	readonly animationId: DatAssetId;
	readonly firstFrame: number;
	readonly lastFrame: number | null;
	readonly frameRate: number;
}

/** Motion sequence plus authored root linear/angular velocity. */
export interface ResolvedMotionSequence {
	readonly key: string;
	readonly clips: readonly ResolvedMotionClipRef[];
	readonly velocity: Vec3 | null;
	readonly angularVelocity: Vec3 | null;
}

/** Normalized motion-table graph shared by dynamic residents. */
export interface ResolvedMotionGraph {
	readonly motionTableId: DatAssetId;
	readonly defaultStyle: number;
	readonly styleDefaults: ReadonlyMap<number, number>;
	readonly cycles: ReadonlyMap<string, ResolvedMotionSequence>;
	readonly modifiers: ReadonlyMap<string, ResolvedMotionSequence>;
	readonly transitions: ReadonlyMap<string, ResolvedMotionSequence>;
}

/** Setup defaults used by animation, audio, and effect systems. */
export interface ResolvedObjectEffectDefaults {
	readonly animationId: DatAssetId | null;
	readonly physicsScriptId: DatAssetId | null;
	readonly physicsScriptTableId: DatAssetId | null;
	readonly soundTableId: DatAssetId | null;
}

/** Immutable shared definition for a setup- or gfx-backed resident. */
export interface ResolvedObjectPresentation {
	readonly id: ResolvedPresentationId;
	readonly sourceAssetId: DatAssetId;
	readonly parts: readonly ResolvedObjectPart[];
	readonly placementPoses: ReadonlyMap<number, ResolvedPlacementPose>;
	readonly motion: ResolvedMotionGraph | null;
	readonly effects: ResolvedObjectEffectDefaults;
	readonly selectionBounds: AABB3 | null;
	readonly sortingBounds: AABB3 | null;
}

/** Per-resident palette, texture, and part substitutions. */
export interface ResolvedObjectAppearance {
	readonly paletteId: DatAssetId | null;
	readonly subPalettes: readonly {
		readonly paletteId: DatAssetId;
		readonly firstIndex: number;
		readonly indexCount: number;
	}[];
	readonly textureChanges: readonly {
		readonly partIndex: number;
		readonly oldTextureId: DatAssetId;
		readonly newTextureId: DatAssetId;
	}[];
	readonly partChanges: readonly {
		readonly partIndex: number;
		readonly geometryId: ResolvedGeometryId;
	}[];
}
