import type { DatAssetId } from "../game-types";
import { multiplyMat4, transformAABB3 } from "../math/matrices";
import { type AABB3, type Mat4, type Vec3 } from "../math/types";

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

/** One part in a setup-backed presentation hierarchy. */
export interface ResolvedObjectPart {
	readonly partIndex: number;
	readonly parentPartIndex: number | null;
	readonly geometry: ResolvedGeometry;
	readonly defaultScale: Vec3;
	readonly materials: readonly ResolvedMaterial[];
}

/**
 * Order a presentation hierarchy so every parent appears before its descendants.
 *
 * Both static baking and dynamic node installation consume this order; keeping hierarchy
 * validation here prevents their parent-before-child rules from drifting apart.
 */
export function orderResolvedObjectParts(
	parts: readonly ResolvedObjectPart[],
): readonly ResolvedObjectPart[] {
	const pending = new Map<number, ResolvedObjectPart>();
	for (const part of parts) {
		if (pending.has(part.partIndex)) {
			throw new Error(
				`Presentation contains duplicate part index ${part.partIndex}.`,
			);
		}
		pending.set(part.partIndex, part);
	}
	for (const part of pending.values()) {
		if (part.parentPartIndex !== null && !pending.has(part.parentPartIndex)) {
			throw new Error(
				`Part ${part.partIndex} references missing parent ${part.parentPartIndex}.`,
			);
		}
	}
	const ordered: ResolvedObjectPart[] = [];
	const resolved = new Set<number>();
	while (pending.size > 0) {
		let progressed = false;
		for (const [partIndex, part] of pending) {
			if (part.parentPartIndex !== null && !resolved.has(part.parentPartIndex))
				continue;
			ordered.push(part);
			resolved.add(partIndex);
			pending.delete(partIndex);
			progressed = true;
		}
		if (!progressed) {
			throw new Error("Presentation contains a cyclic part hierarchy.");
		}
	}
	return ordered;
}

/**
 * Compose one local transform per part into object-local space.
 *
 * Geometry preparation and presentation bounds share this path so hierarchy semantics cannot
 * drift between what is rendered and what is culled.
 */
export function resolveObjectPartTransforms(
	parts: readonly ResolvedObjectPart[],
	localTransforms: readonly Mat4[],
): ReadonlyMap<number, Mat4> {
	const transforms = new Map<number, Mat4>();
	for (const part of orderResolvedObjectParts(parts)) {
		const localTransform = localTransforms[part.partIndex];
		if (!localTransform) {
			throw new Error(
				`Presentation has no local transform for part ${part.partIndex}.`,
			);
		}
		const parentTransform =
			part.parentPartIndex === null
				? null
				: transforms.get(part.parentPartIndex);
		if (part.parentPartIndex !== null && !parentTransform) {
			throw new Error(
				`Presentation has no transform for parent part ${part.parentPartIndex}.`,
			);
		}
		transforms.set(
			part.partIndex,
			parentTransform
				? multiplyMat4(parentTransform, localTransform)
				: localTransform,
		);
	}
	return transforms;
}

/** Derive conservative object-local bounds from the exact transforms used for rendering. */
export function resolveObjectPresentationBounds(
	parts: readonly ResolvedObjectPart[],
	localTransforms: readonly Mat4[],
): AABB3 | null {
	const transforms = resolveObjectPartTransforms(parts, localTransforms);
	let bounds: AABB3 | null = null;
	for (const part of parts) {
		if (part.geometry.bounds === null) continue;
		const transform = transforms.get(part.partIndex);
		if (!transform) {
			throw new Error(
				`Presentation has no transform for part ${part.partIndex}.`,
			);
		}
		const partBounds = transformAABB3(transform, part.geometry.bounds);
		if (bounds === null) bounds = partBounds;
		else bounds.union(partBounds);
	}
	return bounds;
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
