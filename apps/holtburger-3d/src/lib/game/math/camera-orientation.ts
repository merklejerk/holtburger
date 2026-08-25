import { Quat, Vec3 } from "./types";
import { crossVec3, normalizeVec3 } from "./vector-utils";

/** The orthonormal world-space basis derived from an Explorer camera's yaw and pitch. */
export interface CameraAxes {
	/** Direction seen through the center of the camera view. */
	readonly forward: Vec3;
	/** Camera-local right direction in world space. */
	readonly right: Vec3;
	/** Camera-local up direction in world space. */
	readonly up: Vec3;
}

/** Renderer yaw/pitch that aims one world-space camera position at a distinct target. */
export interface CameraLookAngles {
	readonly yawRadians: number;
	readonly pitchRadians: number;
}

/** AC-authored entity orientation as received by the dynamic-entity feed. */
export interface AcEntityRotation {
	readonly w: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/**
 * Derive the renderer yaw for a camera looking from behind an AC entity.
 *
 * AC's local forward axis is +Y and its quaternion is Z-up. The returned renderer yaw points in
 * that same forward direction, which places the camera behind the entity while preserving the
 * camera's independent pitch. This is intentionally a horizontal projection: an entity's pitch
 * or roll must not make the third-person camera orbit vertically.
 */
export function createEntityFacingCameraYaw(
	rotation: AcEntityRotation,
): number {
	const magnitude = Math.hypot(rotation.w, rotation.x, rotation.y, rotation.z);
	if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) {
		throw new Error("Entity orientation must be finite and non-zero.");
	}
	const w = rotation.w / magnitude;
	const x = rotation.x / magnitude;
	const y = rotation.y / magnitude;
	const z = rotation.z / magnitude;
	// Rotate AC's local +Y forward vector by the same quaternion convention as the host.
	const forwardX = 2 * (x * y - w * z);
	const forwardY = 1 - 2 * (x * x + z * z);
	const planarMagnitude = Math.hypot(forwardX, forwardY);
	if (!Number.isFinite(planarMagnitude) || planarMagnitude <= Number.EPSILON) {
		throw new Error("Entity orientation has no horizontal facing direction.");
	}
	return Math.atan2(forwardX / planarMagnitude, forwardY / planarMagnitude);
}

/**
 * Look angles from a camera/target pair, or null when the pair carries no direction.
 *
 * A coincident pair is a legal state rather than a fault: the host boom seats its camera on the
 * possessed body's own collision sphere while it seeds a generation and whenever it recovers one,
 * so for those ticks the camera is inside the thing it is looking at and no direction exists.
 * Callers that can name a fallback orientation read this; callers for which a coincident pair
 * would be a bug read `createCameraLookAtAngles`, which rejects it.
 */
export function resolveCameraLookAtAngles(
	position: Vec3,
	target: Vec3,
): CameraLookAngles | null {
	const lookX = target.x - position.x;
	const lookY = target.y - position.y;
	const lookZ = target.z - position.z;
	const length = Math.hypot(lookX, lookY, lookZ);
	if (!Number.isFinite(length) || length <= Number.EPSILON) return null;
	return {
		pitchRadians: Math.asin(lookY / length),
		yawRadians: Math.atan2(lookX, -lookZ),
	};
}

/** Derive the renderer's canonical look angles from an exact camera/target pair. */
export function createCameraLookAtAngles(
	position: Vec3,
	target: Vec3,
): CameraLookAngles {
	const angles = resolveCameraLookAtAngles(position, target);
	if (angles === null) {
		throw new Error("Camera look-at target must be finite and distinct.");
	}
	return angles;
}

/** Derive the legacy-compatible world-space axes for yaw and pitch in radians. */
export function createCameraAxesRadians(
	yaw: number,
	pitch: number,
): CameraAxes {
	assertFiniteCameraAngles(yaw, pitch);
	const cosPitch = Math.cos(pitch);
	const forward = normalizeVec3(
		new Vec3(
			Math.sin(yaw) * cosPitch,
			Math.sin(pitch),
			-Math.cos(yaw) * cosPitch,
		),
	);
	const right = normalizeVec3(crossVec3(forward, new Vec3(0, 1, 0)));
	return { forward, right, up: crossVec3(right, forward) };
}

/** Convert Explorer/renderer yaw and pitch radians into the canonical camera orientation. */
export function createCameraRotationRadians(yaw: number, pitch: number): Quat {
	assertFiniteCameraAngles(yaw, pitch);
	const halfYaw = yaw / 2;
	const halfPitch = pitch / 2;
	const cosYaw = Math.cos(halfYaw);
	const sinYaw = Math.sin(halfYaw);
	const cosPitch = Math.cos(halfPitch);
	const sinPitch = Math.sin(halfPitch);
	// `createViewMat4` consumes this renderer's camera-to-world convention, whose
	// positive yaw is the inverse of the mathematical quaternion Y-axis sign.
	const y = -sinYaw * cosPitch;
	const z = sinYaw * sinPitch;
	return new Quat(
		cosYaw * cosPitch,
		cosYaw * sinPitch,
		Object.is(y, -0) ? 0 : y,
		Object.is(z, -0) ? 0 : z,
	);
}

/** Convert degree-based Explorer settings into the canonical camera orientation. */
export function createCameraRotation(
	yawDegrees: number,
	pitchDegrees: number,
): Quat {
	assertFiniteCameraAngles(yawDegrees, pitchDegrees);
	return createCameraRotationRadians(
		(yawDegrees * Math.PI) / 180,
		(pitchDegrees * Math.PI) / 180,
	);
}

function assertFiniteCameraAngles(yaw: number, pitch: number): void {
	if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
		throw new Error("Camera yaw and pitch must be finite.");
	}
}
