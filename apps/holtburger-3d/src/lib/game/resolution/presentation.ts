import type { LandblockVec3 } from "../../assets/ac-frame";
import type { DatAssetId } from "../game-types";
import { transformAABB3 } from "../math/matrices";
import { type AABB3, type Mat4, Vec3 } from "../math/types";
import { composeObjectPartTransform } from "./object-part-transform";

/** Stable identity for one reusable resident presentation definition. */
export type ResolvedPresentationId = `presentation:${string}`;

/** Stable identity for canonical geometry prepared by the host. */
export type ResolvedGeometryId = `geometry:${string}`;

/** Stable identity for one normalized material source. */
export type ResolvedMaterialId = `material:${string}`;

/** Selected source encoding that determines object texture preparation. */
export type ResolvedObjectTextureEncoding =
	| "direct-color"
	| "index8"
	| "index16";

/** Geometry buffers shared by object parts and embedded structures. */
export interface ResolvedGeometry {
	readonly id: ResolvedGeometryId;
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly textureCoordinates: Float32Array;
	readonly indices: Uint32Array;
	readonly materialSlotIndices: Uint16Array;
	/** One repeat (1) or clamp (0) sampler fact for every prepared triangle material slot. */
	readonly materialWrapModes: Uint8Array;
	/** One source polygon-side identity for every prepared triangle material slot. */
	readonly materialSideKinds: Uint8Array;
	/** One authored polygon culling mode for every prepared triangle material slot. */
	readonly materialSideTypes: Uint8Array;
	/** One raw authored stippling bitfield for every prepared triangle material slot. */
	readonly materialStippling: Uint8Array;
	/** Source geometry rejected without silently discarding its authored provenance. */
	readonly sourceDiagnostics: {
		readonly rejectedDegenerateTriangles: readonly {
			readonly polygonId: number;
			readonly sideKind: "positive" | "positive-reversed" | "negative";
			readonly fanTriangleIndex: number;
		}[];
	};
	readonly bounds: AABB3 | null;
}

/** Lossless DAT surface facts preserved independently from renderer pass policy. */
export interface ResolvedMaterialFacts {
	readonly rawSurfaceFlags: number;
	readonly translucency: number;
	readonly luminosity: number;
	readonly diffuseScale: number;
}

/** Material source before texture placement is assigned. */
export type ResolvedMaterial = ResolvedMaterialFacts &
	(
		| {
				readonly id: ResolvedMaterialId;
				readonly kind: "solid-color";
				readonly color: readonly [number, number, number, number];
		  }
		| {
				readonly id: ResolvedMaterialId;
				readonly kind: "texture";
				readonly colorTextureId: DatAssetId;
				/** Concrete source level selected by the closed host material dependency. */
				readonly renderSurfaceId: DatAssetId;
				readonly paletteTextureId: DatAssetId | null;
				/** Source encoding selected by the closed host dependency manifest. */
				readonly textureEncoding: ResolvedObjectTextureEncoding;
		  }
	);

/**
 * One part of a setup-backed presentation.
 *
 * Retail composes every part directly against the object frame, so parts are siblings with no
 * transform relationship to each other. Hierarchy exists only between objects, never within one.
 */
export interface ResolvedObjectPart {
	readonly partIndex: number;
	readonly geometry: ResolvedGeometry;
	readonly defaultScale: Vec3;
	readonly materials: readonly ResolvedMaterial[];
}

/** Derive conservative object-local bounds from rigid poses at unit object source scale. */
export function resolveObjectPresentationBounds(
	parts: readonly ResolvedObjectPart[],
	partTransforms: readonly Mat4[],
	sourceScale: Vec3,
): AABB3 | null {
	let bounds: AABB3 | null = null;
	for (const part of parts) {
		if (part.geometry.bounds === null) continue;
		const transform = partTransforms[part.partIndex];
		if (!transform) {
			throw new Error(
				`Presentation has no transform for part ${part.partIndex}.`,
			);
		}
		const partBounds = transformAABB3(
			composeObjectPartTransform(transform, sourceScale, part.defaultScale),
			part.geometry.bounds,
		);
		if (bounds === null) bounds = partBounds;
		else bounds.union(partBounds);
	}
	return bounds;
}

/**
 * Named attach point a parent object offers to child objects.
 *
 * Mirrors `ParentLocation` in `holtburger-common`, which mirrors ACE's enum of the same name.
 */
export type ParentLocation =
	| "none"
	| "right-hand"
	| "left-hand"
	| "shield"
	| "belt"
	| "quiver"
	| "heraldry"
	| "mouth"
	| "left-weapon"
	| "left-unarmed";

/**
 * One resolved attach point: the part that carries it and the offset frame on that part.
 *
 * Retail composes an attached child's frame as `parts[partIndex].frame ⊗ offset`
 * (`CPhysicsObj::UpdateChild`, `acclient.c:308302`). `offsetTransform` is that second term.
 */
export interface ResolvedAttachPoint {
	readonly location: ParentLocation;
	readonly partIndex: number;
	readonly offsetTransform: Mat4;
}

/** Named setup placement containing a local transform for every part. */
export interface ResolvedPlacementPose {
	readonly placementId: number;
	/** Rigid part-to-object transforms; setup and object source scale are composed at use time. */
	readonly partTransforms: readonly Mat4[];
}

/**
 * One authored light emitted by an object, in that object's local space.
 *
 * Only point lights occur in EoR content, so no light type is retained here; the decoder
 * rejects anything else rather than silently treating it as a point light.
 */
export interface ResolvedObjectLight {
	/** Light position in object-local render axes. */
	readonly offset: Vec3;
	readonly color: {
		readonly red: number;
		readonly green: number;
		readonly blue: number;
	};
	readonly intensity: number;
	/** Authored radius; retail scales it by `static_light_factor` when baking. */
	readonly falloff: number;
}

/**
 * One authored light composed into landblock space, ready to light any geometry near it.
 *
 * Positions are plain components because these cross a worker boundary, where structured clone
 * drops class prototypes.
 */
export interface PlacedStaticLight {
	/** Landblock-local, unlike `RuntimeLight`, which is canonical. */
	readonly position: LandblockVec3;
	readonly color: {
		readonly red: number;
		readonly green: number;
		readonly blue: number;
	};
	readonly intensity: number;
	/** Authored radius; retail scales it by `static_light_factor` when baking. */
	readonly falloff: number;
}

/** Immutable shared definition for a setup- or gfx-backed resident. */
export interface ResolvedObjectPresentation {
	readonly id: ResolvedPresentationId;
	/** Canonical host-resolved setup/ObjDesc selection identity. */
	readonly appearanceKey: string;
	readonly sourceAssetId: DatAssetId;
	readonly parts: readonly ResolvedObjectPart[];
	/**
	 * Authored lights this object emits, in its own local space, empty for most setups.
	 *
	 * Retail registers these into the containing cell (`CPartArray::AddLightsToCell`); interior
	 * materialization composes them with each resident's placement to bake cell lighting.
	 */
	readonly lights: readonly ResolvedObjectLight[];
	/** Attach points this object offers to children, empty when its setup authors none. */
	readonly holdingLocations: ReadonlyMap<ParentLocation, ResolvedAttachPoint>;
	readonly placementPoses: ReadonlyMap<number, ResolvedPlacementPose>;
	readonly selectionBounds: AABB3 | null;
	readonly sortingBounds: AABB3 | null;
}
