import type { SceneVector3 } from "../../assets/ac-frame";
import type { Quat, Vec3 } from "../math/types";
import type { SceneResidency } from "../scene";

export interface LoDConfig {
	/** Outdoor terrain radius; terrain is always enabled for an active interest. */
	terrainRadius: number;
	/** Outdoor-building radius, or null when the layer is disabled. */
	buildingRadius: number | null;
	/** Explicit outdoor-object radius, or null when the layer is disabled. */
	explicitObjectRadius: number | null;
	/** Generated-scenery radius, or null when the layer is disabled. */
	generatedObjectRadius: number | null;
	/** Environment-cell radius, or null when the layer is disabled. */
	envCellRadius: number | null;
}

/** Camera pose and authoritative scene residency. */
export interface CameraPlacement extends SceneResidency {
	/** Camera position expressed in canonical scene/world space. */
	readonly position: Vec3;
	/** Camera-to-world orientation. */
	readonly rotation: Quat;
}

/**
 * Where a frontend places the audio listener, in canonical scene space.
 *
 * Separate from {@link Camera} because the listener is not a camera: it has no projection, and a
 * client may deliberately place it somewhere the camera is not.
 */
export interface AudioListenerPlacement {
	/**
	 * Listener position in the fixed scene frame.
	 *
	 * Branded rather than a bare {@link Vec3} so the frontend states the frame at the boundary it
	 * owns. The runtime cannot check the claim, and asserting it on the runtime's side would be the
	 * frame erasure this brand exists to prevent.
	 */
	readonly position: SceneVector3;
	/** Listener-to-world orientation; its local +X is the right hand panning projects onto. */
	readonly rotation: Quat;
}

export interface Camera {
	/** Vertical field of view in degrees. */
	readonly fov: number;
	/** Near clipping distance in world units. */
	readonly near: number;
	/** Far clipping distance in world units. */
	readonly far: number;
	/** Pose used by visibility and anchor-relative rendering. */
	readonly placement: CameraPlacement;
}
