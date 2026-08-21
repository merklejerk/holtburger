import { clamp } from "../math/vector-utils";

/** Frontend-owned yaw/pitch state reusable across free-fly and third-person camera policies. */
export interface CameraLook {
	readonly pitchRadians: number;
	readonly yawRadians: number;
}

/** Stateless-policy owner for bounded pitch and unbounded orbit/fly yaw. */
export class CameraLookController {
	#look: CameraLook;

	constructor(initialLook: CameraLook) {
		this.#look = { ...initialLook };
	}

	replace(look: CameraLook): CameraLook {
		this.#look = { ...look };
		return this.snapshot();
	}

	rotate(
		deltaX: number,
		deltaY: number,
		yawRadiansPerPixel: number,
		pitchRadiansPerPixel: number,
		maximumPitchRadians: number,
	): CameraLook {
		this.#look = {
			pitchRadians: clamp(
				this.#look.pitchRadians + deltaY * pitchRadiansPerPixel,
				-maximumPitchRadians,
				maximumPitchRadians,
			),
			yawRadians: this.#look.yawRadians - deltaX * yawRadiansPerPixel,
		};
		return this.snapshot();
	}

	snapshot(): CameraLook {
		return { ...this.#look };
	}
}
