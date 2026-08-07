import { Mat4, Quat, Vec3 } from "../game/math/types";

/** One AC-authored position/orientation frame before render-axis conversion. */
export interface AcFrame {
	readonly origin: readonly [number, number, number];
	readonly orientation: readonly [number, number, number, number];
}

/** Convert one AC frame and authored scale into the app's canonical render coordinate frame. */
declare const renderSpace: unique symbol;

/**
 * A three-component vector **already converted into the app's render axes**.
 *
 * Positions of this type are **anchor-relative**: the anchor is the camera's landblock, so it moves
 * whenever the camera crosses a boundary, and an anchored position is valid only for the frame that
 * produced it. Retain a {@link StableVector3} instead and convert at the point of use.
 *
 * That restriction is about positions, not about the type. The same brand carries displacements and
 * directions — a hook offset, a listener's right-hand axis, a sun vector — which are invariant under
 * the anchor's pure translation and are safe to retain. Splitting the two apart is worth doing if a
 * defect ever turns on the difference; today the distinction is documented rather than typed.
 *
 * Deliberately a distinct type from a plain tuple, because AC is Z-up and the renderer is Y-up and
 * the two are otherwise indistinguishable. An authored `(0, 0, 1)` means *up*; the same tuple read
 * as a render vector points sideways. That mistake has shipped more than once, produced no type
 * error, and was only ever caught by looking at the screen.
 *
 * {@link acVectorToRender} is the only way to produce one, so a consumer that declares
 * `RenderVector3` cannot be handed raw authored data by accident.
 */
export type RenderVector3 = readonly [number, number, number] & {
	readonly [renderSpace]: true;
};

declare const acSpace: unique symbol;

/**
 * A three-component vector still in **AC's authored axes**, which are Z-up with +Y north.
 *
 * Retained as a distinct type because some authored maths cannot simply be converted componentwise
 * on the way in. A formula that treats its components asymmetrically — a sine on one axis, an extra
 * term on another — carries AC's axis meaning in the component *index*, so evaluating it against
 * converted vectors silently applies each rule to the wrong axis. Such formulas must be evaluated in
 * this space and their result converted once, which is only safe if the space is visible in the type.
 */
export type AcVector3 = readonly [number, number, number] & {
	readonly [acSpace]: true;
};

/**
 * Assert that a vector is still in AC's authored axes.
 *
 * For values read straight out of the DAT, before any conversion.
 */
export function acVector3(
	vector: readonly [number, number, number],
): AcVector3 {
	return vector as AcVector3;
}

/**
 * Convert one authored AC vector into the app's render axes.
 *
 * The mapping is `(x, z, -y)`, identical to the rotation conversion in {@link acFrameTransform}.
 * Every authored direction, offset, velocity, or acceleration goes through this.
 */
export function acVectorToRender(vector: AcVector3): RenderVector3 {
	return [vector[0], vector[2], -vector[1]] as unknown as RenderVector3;
}

/**
 * Assert that a vector is already in render axes.
 *
 * For values the renderer itself produced — a scene-graph translation, a camera position — which
 * never passed through AC space. Every call is a claim that needs justifying at the call site;
 * reach for {@link acVectorToRender} instead whenever the value came from authored content.
 */
export function renderVector3(
	vector: readonly [number, number, number],
): RenderVector3 {
	return vector as RenderVector3;
}

declare const stableSpace: unique symbol;

/**
 * A render-axis position in the app's fixed scene frame, which no camera movement can invalidate.
 *
 * This is the only frame a position may be **retained** in. {@link RenderVector3} is anchor-relative
 * and is valid only for the frame that produced it, so storing one is a defect that surfaces as
 * geometry jumping by a landblock multiple the moment the camera crosses a boundary. The two brands
 * are deliberately disjoint so that mistake cannot type-check.
 */
export type StableVector3 = readonly [number, number, number] & {
	readonly [stableSpace]: true;
};

/**
 * Assert that a vector is in the fixed scene frame.
 *
 * As with {@link renderVector3}, every call is a claim to justify at the call site.
 */
export function stableVector3(
	vector: readonly [number, number, number],
): StableVector3 {
	return vector as StableVector3;
}

export function acFrameTransform(
	input: AcFrame,
	scale: readonly [number, number, number],
): Mat4 {
	const [w, x, y, z] = input.orientation;
	const rotation = new Quat(w, x, z, -y);
	const magnitude = Math.hypot(rotation.w, rotation.x, rotation.y, rotation.z);
	if (magnitude === 0) throw new Error("AC frame contains a zero orientation.");
	const qw = rotation.w / magnitude;
	const qx = rotation.x / magnitude;
	const qy = rotation.y / magnitude;
	const qz = rotation.z / magnitude;
	const transformedScale = renderScale(scale);
	return new Mat4(
		(1 - 2 * (qy * qy + qz * qz)) * transformedScale.x,
		2 * (qx * qy + qw * qz) * transformedScale.x,
		2 * (qx * qz - qw * qy) * transformedScale.x,
		0,
		2 * (qx * qy - qw * qz) * transformedScale.y,
		(1 - 2 * (qx * qx + qz * qz)) * transformedScale.y,
		2 * (qy * qz + qw * qx) * transformedScale.y,
		0,
		2 * (qx * qz + qw * qy) * transformedScale.z,
		2 * (qy * qz - qw * qx) * transformedScale.z,
		(1 - 2 * (qx * qx + qy * qy)) * transformedScale.z,
		0,
		input.origin[0],
		input.origin[2],
		-input.origin[1],
		1,
	);
}

/** Convert one AC-authored scale vector into render-axis order. */
export function renderScale(scale: readonly [number, number, number]): Vec3 {
	return new Vec3(scale[0], scale[2], scale[1]);
}

/**
 * Convert one AC-authored direction or position into render axes.
 *
 * AC authors Z-up with +Y north; the app renders Y-up with -Z north. This is the same
 * axis mapping `acFrameTransform` applies to a frame origin, exposed for callers that
 * carry a bare vector rather than a full frame.
 */
export function renderVector(x: number, y: number, z: number): Vec3 {
	return new Vec3(x, z, -y);
}
