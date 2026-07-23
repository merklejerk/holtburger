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

/** Derive the legacy-compatible world-space axes for yaw and pitch in radians. */
export function createCameraAxesRadians(yaw: number, pitch: number): CameraAxes {
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
