import { Mat4, Vec3 } from "../math/types";

/**
 * Compose one retail-style part transform from a rigid pose and independent geometry scales.
 *
 * `Frame::combine` scales the pose origin by the object source scale without scaling its
 * orientation. `CPhysicsPart::Draw` applies setup-default and source scale to the geometry itself.
 */
export function composeObjectPartTransform(
	rigidPose: Mat4,
	sourceScale: Vec3,
	defaultGeometryScale: Vec3,
	targetMatrix?: Mat4,
): Mat4 {
	const target = targetMatrix ?? Mat4.zero();
	const scaleX = defaultGeometryScale.x * sourceScale.x;
	const scaleY = defaultGeometryScale.y * sourceScale.y;
	const scaleZ = defaultGeometryScale.z * sourceScale.z;
	// `scaledPose * scaleMatrix` scales the three basis columns while preserving the separately
	// source-scaled translation. Writing that product directly avoids three temporary objects in
	// the animation-hot path and remains safe when `target` aliases `rigidPose`.
	target.m11 = rigidPose.m11 * scaleX;
	target.m12 = rigidPose.m12 * scaleX;
	target.m13 = rigidPose.m13 * scaleX;
	target.m14 = rigidPose.m14 * scaleX;
	target.m21 = rigidPose.m21 * scaleY;
	target.m22 = rigidPose.m22 * scaleY;
	target.m23 = rigidPose.m23 * scaleY;
	target.m24 = rigidPose.m24 * scaleY;
	target.m31 = rigidPose.m31 * scaleZ;
	target.m32 = rigidPose.m32 * scaleZ;
	target.m33 = rigidPose.m33 * scaleZ;
	target.m34 = rigidPose.m34 * scaleZ;
	target.m41 = rigidPose.m41 * sourceScale.x;
	target.m42 = rigidPose.m42 * sourceScale.y;
	target.m43 = rigidPose.m43 * sourceScale.z;
	target.m44 = rigidPose.m44;
	return target;
}
