import { sceneVec3, type SceneVec3 } from "../../assets/ac-frame";
import type { LandblockId } from "../game-types";
import {
	getLandblockCoordinates,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";
import type { SceneResidency } from "../scene";
import { Vec3 } from "../math/types";
import {
	evaluateHostPlacedPath,
	type HostPlacedPath,
	validateHostPlacedPath,
} from "./host-placed-path";

/** Solver completion or finite-budget result for one fixed host tick. */
export type PhysicalCameraTickStatus =
	| "solved"
	| "substep-budget-exceeded"
	| "contact-budget-exceeded";

/** Non-gating residency of the final primary-sphere collision owner. */
export type PhysicalCameraSceneResidency =
	| { readonly state: "resident" }
	| { readonly state: "missing-owner"; readonly landblockId: LandblockId }
	| { readonly state: "outside-landscape" };

/** Host-owned physical response selected for one camera session. */
export type PhysicalCameraMode = "physical-fly" | "grounded-walk";

/**
 * Ground classification of the camera body: walkable support, a retained sub-walkable contact
 * plane (sliding), airborne, or not yet classified.
 */
export type PhysicalCameraGroundState =
	| "unknown"
	| "airborne"
	| "sliding"
	| "supported";

/** Every Explorer camera authority mode. */
export type ExplorerCameraMode = "free-fly" | PhysicalCameraMode;

/** Host result for one grounded jump lifecycle edge drained before a fixed solve. */
export type GroundedCharacterEventOutcome =
	| {
			readonly kind:
				| "charge-accepted"
				| "charge-continues"
				| "ignored-stale"
				| "jump-released"
				| "reset";
			readonly sequence: number;
	  }
	| {
			readonly kind: "rejected";
			readonly reason:
				| "airborne"
				| "charge-not-active"
				| "constrained"
				| "invalid-heading"
				| "unsupported";
			readonly sequence: number;
	  };

/** One authoritative viewer point in landblock-local AC axes. */
interface HostPhysicalCameraPathPoint {
	/** Portal-seeded placement that becomes authoritative with this point. */
	readonly residency: SceneResidency;
	/** Presented viewer origin in `residency.landblockId` local `[east, north, up]`. */
	readonly origin: readonly [number, number, number];
}

/** One placement-stable motion leg ending at an authoritative point. */
/** One fixed-tick, host-solved placed-motion path in AC axes. */
export interface HostPhysicalCameraPath extends HostPlacedPath<HostPhysicalCameraPathPoint> {
	/** Runtime generation; paths from an earlier handoff are stale. */
	readonly session: number;
	/** Monotonic path counter within the session. */
	readonly sequence: number;
	/** Physical response that produced this path. */
	readonly mode: PhysicalCameraMode;
	/** Positive fixed-tick playback duration. */
	readonly durationMs: number;
	readonly status: PhysicalCameraTickStatus;
	/** Installed collision residency, independent from solver completion. */
	readonly sceneResidency: PhysicalCameraSceneResidency;
	/** Ground classification committed by the latest solve. */
	readonly groundState: PhysicalCameraGroundState;
	/** Distinct non-walkable planes encountered during the latest grounded solve. */
	readonly constraintCount: number;
	/** Collision substeps consumed by this tick. */
	readonly substeps: number;
	/** Contact-separation passes consumed by this tick. */
	readonly contactPasses: number;
	/** Host wall time spent solving the body and portal-transiting its viewer. */
	readonly solveDurationMs: number;
	/** Ordered grounded lifecycle outcomes processed immediately before this solve. */
	readonly characterEventOutcomes: readonly GroundedCharacterEventOutcome[];
}

/** Canonical presented position and authoritative residency evaluated from one host path. */
export interface PhysicalCameraPlacement {
	/** Camera position retained in canonical scene space. */
	readonly position: SceneVec3;
	/** Host-supplied portal placement paired atomically with the path position. */
	readonly residency: SceneResidency;
}

/**
 * Evaluates one host path without extending it or independently classifying portal placement.
 *
 * AC axes are `[east, north, up]`; canonical render-scene axes are `[east, up, south]`.
 */
export function evaluateHostPhysicalCameraPath(
	path: HostPhysicalCameraPath,
	elapsedMs: number,
): PhysicalCameraPlacement {
	return evaluateHostPlacedPath(path, path.durationMs, elapsedMs, {
		interpolate: interpolatePathPoints,
		present: pathPointPlacement,
	});
}

/** Reject malformed host paths at the transport boundary instead of sampling incoherent state. */
export function validateHostPhysicalCameraPath(
	path: HostPhysicalCameraPath,
): void {
	validateHostPlacedPath(path, path.durationMs);
}

function interpolatePathPoints(
	start: HostPhysicalCameraPathPoint,
	end: HostPhysicalCameraPathPoint,
	fraction: number,
): PhysicalCameraPlacement {
	const startPosition = pathPointPosition(start);
	const endPosition = pathPointPosition(end);
	return {
		position: sceneVec3(
			new Vec3(
				startPosition.x + (endPosition.x - startPosition.x) * fraction,
				startPosition.y + (endPosition.y - startPosition.y) * fraction,
				startPosition.z + (endPosition.z - startPosition.z) * fraction,
			),
		),
		// The start placement owns the half-open leg interval. The exact endpoint is handled above.
		residency: start.residency,
	};
}

function pathPointPlacement(
	point: HostPhysicalCameraPathPoint,
): PhysicalCameraPlacement {
	return { position: pathPointPosition(point), residency: point.residency };
}

function pathPointPosition(point: HostPhysicalCameraPathPoint): SceneVec3 {
	const owner = getLandblockCoordinates(point.residency.landblockId);
	const acX = owner.x * OUTDOOR_LANDBLOCK_WORLD_SIZE + point.origin[0];
	const acY = owner.y * OUTDOOR_LANDBLOCK_WORLD_SIZE + point.origin[1];
	return sceneVec3(new Vec3(acX, point.origin[2], -acY));
}

/** Explorer camera axes in canonical scene coordinates. */
export interface PhysicalCameraBasis {
	readonly forward: readonly [number, number, number];
	readonly right: readonly [number, number, number];
	readonly up: readonly [number, number, number];
}

/** Dimensionless local movement requested by the Explorer input controller. */
export interface PhysicalCameraLocalMovement {
	readonly forward: number;
	readonly right: number;
	readonly up: number;
}

/** Convert the frontend-owned pitched view direction to AC world axes for host viewer placement. */
export function resolvePhysicalCameraViewDirection(
	basis: PhysicalCameraBasis,
): [number, number, number] {
	const [east, up, south] = basis.forward;
	return [east, south === 0 ? 0 : -south, up];
}

/**
 * Converts pitch-relative Explorer input into normalized AC-world velocity.
 *
 * This is deliberately frontend policy: the world solver receives no camera orientation or key
 * semantics, only a concrete world-space velocity.
 */
export function resolvePhysicalFlyVelocity(
	movement: PhysicalCameraLocalMovement,
	basis: PhysicalCameraBasis,
	speed: number,
): [number, number, number] {
	const sceneX =
		basis.forward[0] * movement.forward +
		basis.right[0] * movement.right +
		basis.up[0] * movement.up;
	const sceneY =
		basis.forward[1] * movement.forward +
		basis.right[1] * movement.right +
		basis.up[1] * movement.up;
	const sceneZ =
		basis.forward[2] * movement.forward +
		basis.right[2] * movement.right +
		basis.up[2] * movement.up;
	const length = Math.hypot(sceneX, sceneY, sceneZ);
	if (length === 0) return [0, 0, 0];
	const scale = speed / length;
	// Canonical scene `[east, up, south]` back to AC `[east, north, up]`.
	const north = -sceneZ * scale;
	return [sceneX * scale, north === 0 ? 0 : north, sceneY * scale];
}

/** Converts one local-up wheel distance into an AC-world displacement. */
export function resolvePhysicalFlyWheelDisplacement(
	basis: PhysicalCameraBasis,
	distance: number,
): [number, number, number] {
	const east = basis.up[0] * distance;
	const north = -basis.up[2] * distance;
	return [east, north === 0 ? 0 : north, basis.up[1] * distance];
}
