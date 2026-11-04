/** Interdependent radial bounds controlling how quickly full smear reaches the focal center. */
interface PortalWarpDriveRadialSmearTuning {
	/** Aspect-correct radius below which the exact vanishing point remains spatially stable. */
	readonly startRadius: number;
	/** Aspect-correct radius at which the full zoom-history transform is applied. */
	readonly fullRadius: number;
}

/** Renderer-owned visual controls for the reversible portal warp-drive transform. */
export interface PortalWarpDriveTuning {
	/** Exponent applied after smoothstep; values above one delay the strongest acceleration. */
	readonly accelerationExponent: number;
	/** Largest peripheral source-image zoom, where one is an unchanged frame. */
	readonly maximumZoom: number;
	/** Paired radial bounds for the continuous center-to-periphery smear weight. */
	readonly radialSmear: PortalWarpDriveRadialSmearTuning;
	/** Multiplier applied to additive bright-feature history streaks. */
	readonly streakIntensity: number;
	/** Exponent controlling how long the world remains visible before yielding to the tunnel. */
	readonly worldOpacityExponent: number;
}

/** Fail before shader use when a warp-drive tuning contract cannot produce a finite transform. */
export function validatePortalWarpDriveTuning(
	tuning: PortalWarpDriveTuning,
): void {
	if (!Number.isFinite(tuning.accelerationExponent)) {
		throw new Error("Portal warp acceleration exponent must be finite.");
	}
	if (tuning.accelerationExponent <= 0) {
		throw new Error("Portal warp acceleration exponent must be positive.");
	}
	if (!Number.isFinite(tuning.maximumZoom)) {
		throw new Error("Portal warp maximum zoom must be finite.");
	}
	if (tuning.maximumZoom < 1) {
		throw new Error("Portal warp maximum zoom must be at least one.");
	}
	if (!Number.isFinite(tuning.streakIntensity)) {
		throw new Error("Portal warp streak intensity must be finite.");
	}
	if (tuning.streakIntensity < 0) {
		throw new Error("Portal warp streak intensity must be non-negative.");
	}
	if (!Number.isFinite(tuning.worldOpacityExponent)) {
		throw new Error("Portal warp opacity exponent must be finite.");
	}
	if (tuning.worldOpacityExponent <= 0) {
		throw new Error("Portal warp opacity exponent must be positive.");
	}
	if (!Number.isFinite(tuning.radialSmear.startRadius)) {
		throw new Error("Portal warp radial smear start must be finite.");
	}
	if (tuning.radialSmear.startRadius < 0) {
		throw new Error("Portal warp radial smear start must be non-negative.");
	}
	if (!Number.isFinite(tuning.radialSmear.fullRadius)) {
		throw new Error("Portal warp full-smear radius must be finite.");
	}
	if (tuning.radialSmear.fullRadius <= tuning.radialSmear.startRadius) {
		throw new Error(
			"Portal warp full-smear radius must exceed its start radius.",
		);
	}
}
