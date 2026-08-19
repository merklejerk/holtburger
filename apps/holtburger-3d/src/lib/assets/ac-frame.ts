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
 * produced it. Retain a {@link SceneVector3} instead and convert at the point of use.
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
 * Convert one render-axis vector back into AC's authored axes.
 *
 * The exact inverse of {@link acVectorToRender}. Needed because some authored maths must be
 * evaluated in AC axes against a rotation the scene only holds in render axes: the vector goes out
 * to render space, is rotated there, and comes back.
 */
export function renderVectorToAc(vector: RenderVector3): AcVector3 {
	return [vector[0], -vector[2], vector[1]] as unknown as AcVector3;
}

/**
 * A rotation expressed in AC's authored axes, as the images of AC's three basis vectors.
 *
 * Stored as its columns rather than as a matrix type so it cannot be confused with the render-space
 * transforms the scene graph holds; the component vectors carry the frame in their own brand, so
 * this needs no brand of its own.
 */
export interface AcRotation {
	/** Images of AC's x, y and z basis vectors, in that order. */
	readonly columns: readonly [AcVector3, AcVector3, AcVector3];
}

/** AC's basis vectors, whose images under a render rotation define {@link AcRotation}. */
const AC_BASIS: readonly [AcVector3, AcVector3, AcVector3] = [
	acVector3([1, 0, 0]),
	acVector3([0, 1, 0]),
	acVector3([0, 0, 1]),
];

/**
 * Extract an object's rotation from its resolved render transform, expressed in AC's authored axes.
 *
 * Retail rotates particle spawn constants by the owner's **current** frame at spawn
 * (`Frame::localtoglobalvec`, acclient.c:317743), and those constants then feed formulas whose
 * component indices carry AC's axis meaning. So the rotation has to be available in AC axes, while
 * the only live copy of it is the render-space transform the scene graph resolves.
 *
 * Derived by sending each AC basis vector out to render space, rotating it, and bringing it back,
 * rather than by hand-solving the conjugation. The signs are then a consequence of
 * {@link acVectorToRender} and {@link renderVectorToAc} instead of a separate thing to get right.
 *
 * Scale is divided out per basis row: retail's `Frame` carries an origin and a quaternion and has no
 * scale, so a scaled owner must not scale the velocities it emits. Shear is not represented in a
 * TRS transform and is not accounted for.
 */
export function acRotationFromRenderTransform(transform: Mat4): AcRotation {
	// Images of the render basis vectors, normalized so authored scale does not reach the result.
	const rows: readonly [number, number, number][] = [
		[transform.m11, transform.m12, transform.m13],
		[transform.m21, transform.m22, transform.m23],
		[transform.m31, transform.m32, transform.m33],
	].map((row) => {
		const [x, y, z] = row as [number, number, number];
		const magnitude = Math.hypot(x, y, z);
		if (magnitude === 0)
			throw new Error("Transform basis is degenerate; it carries no rotation.");
		return [x / magnitude, y / magnitude, z / magnitude];
	}) as readonly [number, number, number][];
	const rotateRender = (vector: RenderVector3): RenderVector3 =>
		renderVector3([
			rows[0]![0] * vector[0] +
				rows[1]![0] * vector[1] +
				rows[2]![0] * vector[2],
			rows[0]![1] * vector[0] +
				rows[1]![1] * vector[1] +
				rows[2]![1] * vector[2],
			rows[0]![2] * vector[0] +
				rows[1]![2] * vector[1] +
				rows[2]![2] * vector[2],
		]);
	const [x, y, z] = AC_BASIS.map((basis) =>
		renderVectorToAc(rotateRender(acVectorToRender(basis))),
	) as [AcVector3, AcVector3, AcVector3];
	return { columns: [x, y, z] };
}

/** Rotate one AC-axis vector by an AC-axis rotation, preserving its magnitude. */
export function rotateAcVector(
	rotation: AcRotation,
	vector: AcVector3,
): AcVector3 {
	const [x, y, z] = rotation.columns;
	return acVector3([
		x[0] * vector[0] + y[0] * vector[1] + z[0] * vector[2],
		x[1] * vector[0] + y[1] * vector[1] + z[1] * vector[2],
		x[2] * vector[0] + y[2] * vector[1] + z[2] * vector[2],
	]);
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

declare const sceneSpace: unique symbol;

/**
 * A render-axis position in **canonical scene space**: one origin for the whole world, at landblock
 * (0, 0), which no camera movement can invalidate.
 *
 * This is the frame the camera and residency queries have always used, and the only one a position
 * may be **retained** in. {@link RenderVector3} measures from the camera's own landblock, so a
 * stored one silently denotes a different world point once the camera crosses a boundary — the value
 * is unchanged, its origin moved. That surfaces as geometry jumping by a landblock multiple. The two
 * brands are deliberately disjoint so the mistake cannot type-check.
 *
 * The pair exists because the two requirements conflict: anchor-relative keeps shader coordinates
 * small enough for f32, and scene space keeps stored coordinates meaningful over time. Converting is
 * a single subtraction of the anchor's world origin, done in double precision on the CPU.
 */
export type SceneVector3 = readonly [number, number, number] & {
	readonly [sceneSpace]: true;
};

/**
 * Assert that a vector is in canonical scene space.
 *
 * As with {@link renderVector3}, every call is a claim to justify at the call site.
 */
export function sceneVector3(
	vector: readonly [number, number, number],
): SceneVector3 {
	return vector as SceneVector3;
}

declare const landblockSpace: unique symbol;

/**
 * A {@link Vec3}-shaped position in canonical scene space.
 *
 * The `Vector3` brands above are tuples, which suits assets, particles, and audio. Camera, matrix,
 * and scene code works in `Vec3`, so these brand the same frames without changing representation:
 * consumers keep reading `.x`/`.y`/`.z`, and only declarations and construction sites move.
 *
 * Reserved for **positions** in retained or cross-system contracts. A scale, a size, a direction, or
 * a local maths parameter has no origin and no frame to get wrong, and stays a plain `Vec3`.
 */
export type SceneVec3 = Vec3 & { readonly [sceneSpace]: true };

/** Assert that a `Vec3` is in canonical scene space. */
export function sceneVec3(vector: Vec3): SceneVec3 {
	return vector as SceneVec3;
}

/**
 * A {@link Vec3}-shaped position in one landblock's local frame.
 *
 * Distinct from {@link SceneVec3} because the two are the same shape and are both called "light
 * position" one file apart: baked interior lights are landblock-local while runtime lights are
 * canonical. A landblock-local position is meaningless without the landblock it belongs to.
 */
export type LandblockVec3 = Vec3 & { readonly [landblockSpace]: true };

/**
 * A landblock-local position in tuple form, for the asset and particle paths that work in tuples.
 *
 * The tuple counterpart to {@link LandblockVec3}. Safe to retain, unlike {@link RenderVector3}:
 * its origin is the landblock's own corner, which no camera movement can move.
 */
export type LandblockVector3 = readonly [number, number, number] & {
	readonly [landblockSpace]: true;
};

/** Assert that a tuple is measured from its landblock's corner. */
export function landblockVector3(
	vector: readonly [number, number, number],
): LandblockVector3 {
	return vector as LandblockVector3;
}

/** Assert that a `Vec3` is in one landblock's local frame. */
export function landblockVec3(vector: Vec3): LandblockVec3 {
	return vector as LandblockVec3;
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
