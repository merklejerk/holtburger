import { createScaleMat4, multiplyMat4 } from "../math/matrices";
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
): Mat4 {
	// Worker structured cloning preserves matrix fields but not the `Mat4` prototype.
	const scaledPose = Mat4.zero().copy(rigidPose);
	scaledPose.m41 *= sourceScale.x;
	scaledPose.m42 *= sourceScale.y;
	scaledPose.m43 *= sourceScale.z;
	const geometryScale = new Vec3(
		defaultGeometryScale.x * sourceScale.x,
		defaultGeometryScale.y * sourceScale.y,
		defaultGeometryScale.z * sourceScale.z,
	);
	return multiplyMat4(scaledPose, createScaleMat4(geometryScale));
}
