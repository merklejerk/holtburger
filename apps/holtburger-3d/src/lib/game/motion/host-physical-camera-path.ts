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

/** One authoritative viewer point in landblock-local AC axes. */
interface HostPhysicalCameraPathPoint {
	/** Portal-seeded placement that becomes authoritative with this point. */
	readonly residency: SceneResidency;
	/** Presented viewer origin in `residency.landblockId` local `[east, north, up]`. */
	readonly origin: readonly [number, number, number];
}

/** One placement-stable motion leg ending at an authoritative point. */
interface HostPhysicalCameraPathLeg {
	/** Monotonic normalized fixed-tick fraction at this boundary. */
	readonly endFraction: number;
	/** Point and residency that become authoritative at the exact boundary. */
	readonly end: HostPhysicalCameraPathPoint;
}

/** One fixed-tick, host-solved placed-motion path in AC axes. */
export interface HostPhysicalCameraPath {
	/** Runtime generation; paths from an earlier handoff are stale. */
	readonly session: number;
	/** Monotonic path counter within the session. */
	readonly sequence: number;
	/** Physical response that produced this path. */
	readonly mode: PhysicalCameraMode;
	/** Positive fixed-tick playback duration. */
	readonly durationMs: number;
	/** Authoritative point at normalized tick fraction zero. */
	readonly initial: HostPhysicalCameraPathPoint;
	/** Non-empty accepted geometry and placement transitions. */
	readonly legs: readonly [
		HostPhysicalCameraPathLeg,
		...HostPhysicalCameraPathLeg[],
	];
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
	validateHostPhysicalCameraPath(path);
	const progress = Math.min(Math.max(elapsedMs / path.durationMs, 0), 1);
	let start = path.initial;
	let startFraction = 0;
	for (const leg of path.legs) {
		if (progress < leg.endFraction) {
			const localProgress =
				(progress - startFraction) / (leg.endFraction - startFraction);
			return interpolatePathPoints(start, leg.end, localProgress);
		}
		if (progress === leg.endFraction) return pathPointPlacement(leg.end);
		start = leg.end;
		startFraction = leg.endFraction;
	}
	return pathPointPlacement(start);
}

/** Reject malformed host paths at the transport boundary instead of sampling incoherent state. */
export function validateHostPhysicalCameraPath(
	path: HostPhysicalCameraPath,
): void {
	if (!Number.isFinite(path.durationMs) || path.durationMs <= 0) {
		throw new Error(
			"Host physical-camera path duration must be positive and finite.",
		);
	}
	if (path.legs.length === 0) {
		throw new Error("Host physical-camera path must contain at least one leg.");
	}
	let previous = 0;
	for (const leg of path.legs) {
		if (
			!Number.isFinite(leg.endFraction) ||
			leg.endFraction <= previous ||
			leg.endFraction > 1
		) {
			throw new Error(
				"Host physical-camera path fractions must increase through (0, 1].",
			);
		}
		previous = leg.endFraction;
	}
	if (previous !== 1) {
		throw new Error("Host physical-camera path must end at tick fraction one.");
	}
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
