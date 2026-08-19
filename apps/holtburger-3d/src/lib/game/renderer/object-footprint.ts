import type { AABB3, Mat4 } from "../math/types";

/** Conservative screen-space classification for one transformed object envelope. */
type ObjectFootprintVisibility =
	| "visible"
	| "near-plane-or-ambiguous"
	| "below-threshold"
	| "outside-view";

/** Complete physical-pixel projection input for one object-local envelope. */
interface ObjectFootprintProjectionInput {
	readonly bounds: AABB3;
	readonly clipFromAnchor: Mat4;
	readonly localToLandblock: Mat4;
	readonly landblockOffsetX: number;
	readonly landblockOffsetY: number;
	readonly landblockOffsetZ: number;
	readonly viewportWidth: number;
	readonly viewportHeight: number;
	readonly minimumPixelArea: number;
}

/** Projection facts excluding the shared product cutoff applied by the caller. */
export type ObjectFootprintEnvelope = Omit<
	ObjectFootprintProjectionInput,
	"minimumPixelArea"
>;

const CLIP_EPSILON = 1e-7;

/**
 * Project every envelope corner and reject only objects proven outside or below the cutoff.
 * Near-plane intersections and non-finite intermediates remain visible conservatively.
 */
function classifyObjectFootprint(
	input: ObjectFootprintProjectionInput,
): ObjectFootprintVisibility {
	if (
		!Number.isFinite(input.minimumPixelArea) ||
		input.minimumPixelArea < 0 ||
		!Number.isFinite(input.viewportWidth) ||
		input.viewportWidth <= 0 ||
		!Number.isFinite(input.viewportHeight) ||
		input.viewportHeight <= 0
	) {
		throw new Error("Object-footprint projection dimensions are invalid.");
	}

	const bounds = input.bounds;
	const local = input.localToLandblock;
	const clip = input.clipFromAnchor;
	let minimumNdcX = Number.POSITIVE_INFINITY;
	let minimumNdcY = Number.POSITIVE_INFINITY;
	let maximumNdcX = Number.NEGATIVE_INFINITY;
	let maximumNdcY = Number.NEGATIVE_INFINITY;
	let allOutsideLeft = true;
	let allOutsideRight = true;
	let allOutsideBottom = true;
	let allOutsideTop = true;
	let allOutsideFar = true;
	let nearPlaneOrAmbiguous = false;

	for (let corner = 0; corner < 8; corner += 1) {
		const localX = (corner & 1) === 0 ? bounds.min.x : bounds.max.x;
		const localY = (corner & 2) === 0 ? bounds.min.y : bounds.max.y;
		const localZ = (corner & 4) === 0 ? bounds.min.z : bounds.max.z;
		const anchorX =
			local.m11 * localX +
			local.m21 * localY +
			local.m31 * localZ +
			local.m41 +
			input.landblockOffsetX;
		const anchorY =
			local.m12 * localX +
			local.m22 * localY +
			local.m32 * localZ +
			local.m42 +
			input.landblockOffsetY;
		const anchorZ =
			local.m13 * localX +
			local.m23 * localY +
			local.m33 * localZ +
			local.m43 +
			input.landblockOffsetZ;
		const clipX =
			clip.m11 * anchorX + clip.m21 * anchorY + clip.m31 * anchorZ + clip.m41;
		const clipY =
			clip.m12 * anchorX + clip.m22 * anchorY + clip.m32 * anchorZ + clip.m42;
		const clipZ =
			clip.m13 * anchorX + clip.m23 * anchorY + clip.m33 * anchorZ + clip.m43;
		const clipW =
			clip.m14 * anchorX + clip.m24 * anchorY + clip.m34 * anchorZ + clip.m44;
		if (
			!Number.isFinite(clipX) ||
			!Number.isFinite(clipY) ||
			!Number.isFinite(clipZ) ||
			!Number.isFinite(clipW)
		) {
			return "near-plane-or-ambiguous";
		}
		allOutsideLeft &&= clipX < -clipW;
		allOutsideRight &&= clipX > clipW;
		allOutsideBottom &&= clipY < -clipW;
		allOutsideTop &&= clipY > clipW;
		allOutsideFar &&= clipZ > clipW;
		if (clipW <= CLIP_EPSILON || clipZ + clipW <= CLIP_EPSILON) {
			nearPlaneOrAmbiguous = true;
			continue;
		}
		const inverseW = 1 / clipW;
		const ndcX = clipX * inverseW;
		const ndcY = clipY * inverseW;
		minimumNdcX = Math.min(minimumNdcX, ndcX);
		minimumNdcY = Math.min(minimumNdcY, ndcY);
		maximumNdcX = Math.max(maximumNdcX, ndcX);
		maximumNdcY = Math.max(maximumNdcY, ndcY);
	}

	if (nearPlaneOrAmbiguous) return "near-plane-or-ambiguous";
	if (
		allOutsideLeft ||
		allOutsideRight ||
		allOutsideBottom ||
		allOutsideTop ||
		allOutsideFar
	) {
		return "outside-view";
	}

	const visibleNdcWidth = Math.min(1, maximumNdcX) - Math.max(-1, minimumNdcX);
	const visibleNdcHeight = Math.min(1, maximumNdcY) - Math.max(-1, minimumNdcY);
	if (visibleNdcWidth <= 0 || visibleNdcHeight <= 0) return "outside-view";
	const pixelArea =
		visibleNdcWidth *
		(input.viewportWidth / 2) *
		visibleNdcHeight *
		(input.viewportHeight / 2);
	return pixelArea < input.minimumPixelArea ? "below-threshold" : "visible";
}

/** Apply the zero-disabled product policy while retaining explicitly exempt presentations. */
export function retainsProjectedObjectFootprint(
	envelope: ObjectFootprintEnvelope | null,
	minimumPixelArea: number,
): boolean {
	if (!Number.isFinite(minimumPixelArea) || minimumPixelArea < 0) {
		throw new Error("Minimum object-footprint pixel area is invalid.");
	}
	if (envelope === null || minimumPixelArea === 0) return true;
	const visibility = classifyObjectFootprint({ ...envelope, minimumPixelArea });
	return visibility === "visible" || visibility === "near-plane-or-ambiguous";
}
