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

/**
 * Convert one authored AC vector into the app's render axes.
 *
 * The mapping is `(x, z, -y)`, identical to the rotation conversion in {@link acFrameTransform}.
 * Every authored direction, offset, velocity, or acceleration goes through this.
 */
export function acVectorToRender(
	vector: readonly [number, number, number],
): RenderVector3 {
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
