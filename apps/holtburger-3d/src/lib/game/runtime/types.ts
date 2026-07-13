import type { Quat, Vec3 } from "../math/types";
import type { SceneResidency } from "../scene";

export interface LoDConfig {
	landblockRadius: number;
	buildingRadius: number;
	explicitObjectRadius: number;
	generatedObjectRadius: number;
	envCellRadius: number;
}

/** Camera pose and authoritative scene residency. */
export interface CameraPlacement extends SceneResidency {
	/** Camera position expressed in its resident landblock coordinate frame. */
	readonly position: Vec3;
	/** Camera-to-landblock orientation. */
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
