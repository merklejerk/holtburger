import type { AABB3 } from "../math/types";
import { Vec3 } from "../math/types";

/** Static shape class derived once from one resolved visual-template appearance. */
export type SelectionGeometryMorphology = "planar-carrier" | "volumetric";

/** Object-local sphere shared by exact hit testing and the selected-entity mask. */
export interface LocalSelectionSphere {
	readonly center: Vec3;
	readonly radius: number;
}

/**
 * Classify one rigid carrier by dimensionality, independent of its pose and later object scale.
 *
 * GfxObj vertices on authored planes share an exact coordinate. The relative machine-epsilon
 * allowance only absorbs decoded-coordinate noise; it does not turn merely thin volumetric objects
 * into planar carriers.
 */
export function classifySelectionGeometryMorphology(
	bounds: AABB3,
): SelectionGeometryMorphology {
	const extents = [
		bounds.max.x - bounds.min.x,
		bounds.max.y - bounds.min.y,
		bounds.max.z - bounds.min.z,
	];
	if (!extents.every(Number.isFinite) || extents.some((extent) => extent < 0))
		throw new Error("Selection morphology requires finite ordered bounds.");
	const maximumExtent = Math.max(...extents);
	if (maximumExtent <= 0) return "volumetric";
	return Math.min(...extents) <= maximumExtent * Number.EPSILON * 16
		? "planar-carrier"
		: "volumetric";
}

/** Use a round interaction proxy only when a planar rigid carrier presents live particles. */
export function usesSelectionSphereProxy(
	morphology: SelectionGeometryMorphology,
	hasEmitterOwner: boolean,
): boolean {
	return morphology === "planar-carrier" && hasEmitterOwner;
}

/** Derive the intentionally non-conservative sphere whose diameter is the bounds' longest edge. */
export function selectionSphereFromBounds(bounds: AABB3): LocalSelectionSphere {
	const radius =
		Math.max(
			bounds.max.x - bounds.min.x,
			bounds.max.y - bounds.min.y,
			bounds.max.z - bounds.min.z,
		) * 0.5;
	if (!Number.isFinite(radius) || radius <= 0)
		throw new Error("Selection sphere requires finite, non-degenerate bounds.");
	return {
		center: new Vec3(
			(bounds.min.x + bounds.max.x) * 0.5,
			(bounds.min.y + bounds.max.y) * 0.5,
			(bounds.min.z + bounds.max.z) * 0.5,
		),
		radius,
	};
}
