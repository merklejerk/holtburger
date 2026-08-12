import { sceneVec3, type SceneVec3 } from "../../assets/ac-frame";
import type { LandblockId } from "../game-types";
import {
	getLandblockCoordinates,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";
import type { SceneResidency } from "../scene";
import { Vec3 } from "../math/types";

/** Why one fixed host tick moved or held the physical camera. */
export type PhysicalCameraTickStatus =
	| "solved"
	| "missing-coverage"
	| "substep-budget-exceeded"
	| "contact-budget-exceeded";

/** Host-owned physical response selected for one camera session. */
export type PhysicalCameraMode = "physical-fly" | "grounded-walk";

/** Every Explorer camera authority mode. */
export type ExplorerCameraMode = "free-fly" | PhysicalCameraMode;

/** One short-lived, host-solved prediction segment in AC axes. */
export interface HostPhysicalCameraSegment {
	/** Runtime generation; segments from an earlier handoff are stale. */
	readonly session: number;
	/** Monotonic segment counter within the session. */
	readonly sequence: number;
	/** Physical response that produced this segment. */
	readonly mode: PhysicalCameraMode;
	/** Portal-seeded viewer placement committed atomically with the solved body pose. */
	readonly residency: SceneResidency;
	/** Presented viewer origin in landblock-local AC `[east, north, up]`. */
	readonly origin: readonly [number, number, number];
	/** Achieved AC-world velocity used only for presentation prediction. */
	readonly velocity: readonly [number, number, number];
	/** Constant-velocity validity interval in milliseconds. */
	readonly horizonMs: number;
	readonly status: PhysicalCameraTickStatus;
	/** Whether grounded response retained walkable lower-sphere support. */
	readonly grounded: boolean;
	/** Distinct non-walkable planes encountered during the latest grounded solve. */
	readonly constraintCount: number;
	/** Exact normalized owners absent from a missing-coverage tick. */
	readonly missingLandblocks: readonly LandblockId[];
	/** Whether the requested sweep left AC's representable outdoor grid. */
	readonly outsideWorld: boolean;
	/** Collision substeps consumed by this tick. */
	readonly substeps: number;
	/** Contact-separation passes consumed by this tick. */
	readonly contactPasses: number;
	/** Host wall time spent solving the body and portal-transiting its viewer. */
	readonly solveDurationMs: number;
}

/** Canonical presented position and authoritative residency evaluated from one host segment. */
export interface PhysicalCameraPlacement {
	/** Predicted camera position retained in canonical scene space. */
	readonly position: SceneVec3;
	/** Host-committed portal placement paired atomically with the solved position. */
	readonly residency: SceneResidency;
}

/** Maximum prediction age relative to one host validity horizon. */
export const MAX_EXTRAPOLATION_FACTOR = 2;

/**
 * Evaluates the latest host path without allowing a starved frontend to drift indefinitely.
 *
 * AC axes are `[east, north, up]`; canonical render-scene axes are `[east, up, south]`.
 */
export function evaluateHostPhysicalCameraSegment(
	segment: HostPhysicalCameraSegment,
	elapsedMs: number,
): PhysicalCameraPlacement {
	const elapsedSeconds =
		Math.min(
			Math.max(elapsedMs, 0),
			segment.horizonMs * MAX_EXTRAPOLATION_FACTOR,
		) / 1_000;
	const owner = getLandblockCoordinates(segment.residency.landblockId);
	const acX =
		owner.x * OUTDOOR_LANDBLOCK_WORLD_SIZE +
		segment.origin[0] +
		segment.velocity[0] * elapsedSeconds;
	const acY =
		owner.y * OUTDOOR_LANDBLOCK_WORLD_SIZE +
		segment.origin[1] +
		segment.velocity[1] * elapsedSeconds;
	const acZ = segment.origin[2] + segment.velocity[2] * elapsedSeconds;
	return {
		position: sceneVec3(new Vec3(acX, acZ, -acY)),
		residency: segment.residency,
	};
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

/**
 * Converts Explorer input into yaw-relative, horizontal AC-world walking velocity.
 *
 * Camera pitch and vertical input are presentation policy and cannot inject grounded drive.
 */
export function resolveGroundedWalkVelocity(
	movement: PhysicalCameraLocalMovement,
	basis: PhysicalCameraBasis,
	speed: number,
): [number, number, number] {
	const forward = horizontalDirection(basis.forward);
	const right = horizontalDirection(basis.right);
	const sceneX = forward[0] * movement.forward + right[0] * movement.right;
	const sceneZ = forward[1] * movement.forward + right[1] * movement.right;
	const length = Math.hypot(sceneX, sceneZ);
	if (length === 0) return [0, 0, 0];
	const scale = speed / length;
	const north = -sceneZ * scale;
	return [sceneX * scale, north === 0 ? 0 : north, 0];
}

function horizontalDirection(
	direction: readonly [number, number, number],
): readonly [number, number] {
	const length = Math.hypot(direction[0], direction[2]);
	return length === 0 ? [0, 0] : [direction[0] / length, direction[2] / length];
}
