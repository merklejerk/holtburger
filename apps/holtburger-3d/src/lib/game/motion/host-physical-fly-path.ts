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
	type HostCameraPlacement,
	type HostPlacedPath,
	validateHostPlacedPath,
} from "./host-placed-path";

/** Solver completion or finite-budget result for one fixed host tick. */
export type PhysicalFlyTickStatus =
	"solved" | "substep-budget-exceeded" | "contact-budget-exceeded";

/** Non-gating residency of the final primary-sphere collision owner. */
export type PhysicalFlySceneResidency =
	| { readonly state: "resident" }
	| { readonly state: "missing-owner"; readonly landblockId: LandblockId }
	| { readonly state: "outside-landscape" };

/**
 * Ground classification of the camera body: walkable support, a retained sub-walkable contact
 * plane (sliding), airborne, or not yet classified.
 */
export type PhysicalFlyGroundState =
	"unknown" | "airborne" | "sliding" | "supported";

/** Every Explorer camera authority mode. */
export type ExplorerCameraMode = "free-fly" | "physical-fly";

/** One authoritative viewer point in landblock-local AC axes. */
interface HostPhysicalFlyPathPoint {
	/** Portal-seeded placement that becomes authoritative with this point. */
	readonly residency: SceneResidency;
	/** Presented viewer origin in `residency.landblockId` local `[east, north, up]`. */
	readonly origin: readonly [number, number, number];
}

/** One placement-stable motion leg ending at an authoritative point. */
/** One fixed-tick, host-solved placed-motion path in AC axes. */
export interface HostPhysicalFlyPath extends HostPlacedPath<HostPhysicalFlyPathPoint> {
	/** Runtime generation; paths from an earlier handoff are stale. */
	readonly session: number;
	/** Monotonic path counter within the session. */
	readonly sequence: number;
	/** Positive fixed-tick playback duration. */
	readonly durationMs: number;
	readonly status: PhysicalFlyTickStatus;
	/** Installed collision residency, independent from solver completion. */
	readonly sceneResidency: PhysicalFlySceneResidency;
	/** Ground classification committed by the latest solve. */
	readonly groundState: PhysicalFlyGroundState;
	/** Distinct collision constraints encountered during the latest solve. */
	readonly constraintCount: number;
	/** Collision substeps consumed by this tick. */
	readonly substeps: number;
	/** Contact-separation passes consumed by this tick. */
	readonly contactPasses: number;
	/** Host wall time spent solving the body and portal-transiting its viewer. */
	readonly solveDurationMs: number;
}

/**
 * Evaluates one host path without extending it or independently classifying portal placement.
 *
 * AC axes are `[east, north, up]`; canonical render-scene axes are `[east, up, south]`.
 */
export function evaluateHostPhysicalFlyPath(
	path: HostPhysicalFlyPath,
	elapsedMs: number,
): HostCameraPlacement {
	return evaluateHostPlacedPath(path, path.durationMs, elapsedMs, {
		interpolate: interpolatePathPoints,
		present: pathPointPlacement,
	});
}

/** Reject malformed host paths at the transport boundary instead of sampling incoherent state. */
export function validateHostPhysicalFlyPath(path: HostPhysicalFlyPath): void {
	validateHostPlacedPath(path, path.durationMs);
}

function interpolatePathPoints(
	start: HostPhysicalFlyPathPoint,
	end: HostPhysicalFlyPathPoint,
	fraction: number,
): HostCameraPlacement {
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
	point: HostPhysicalFlyPathPoint,
): HostCameraPlacement {
	return { position: pathPointPosition(point), residency: point.residency };
}

function pathPointPosition(point: HostPhysicalFlyPathPoint): SceneVec3 {
	return scenePositionFromHostPlacement(point.origin, point.residency);
}

/** Convert one host-authored AC-local origin paired with its authoritative residency. */
function scenePositionFromHostPlacement(
	origin: readonly [number, number, number],
	residency: SceneResidency,
): SceneVec3 {
	const owner = getLandblockCoordinates(residency.landblockId);
	const acX = owner.x * OUTDOOR_LANDBLOCK_WORLD_SIZE + origin[0];
	const acY = owner.y * OUTDOOR_LANDBLOCK_WORLD_SIZE + origin[1];
	return sceneVec3(new Vec3(acX, origin[2], -acY));
}

/** Explorer camera axes in canonical scene coordinates. */
export interface PhysicalFlyBasis {
	readonly forward: readonly [number, number, number];
	readonly right: readonly [number, number, number];
	readonly up: readonly [number, number, number];
}

/** Dimensionless local movement requested by the Explorer input controller. */
export interface PhysicalFlyLocalMovement {
	readonly forward: number;
	readonly right: number;
	readonly up: number;
}

/** Convert the frontend-owned pitched view direction to AC world axes for host viewer placement. */
export function resolvePhysicalFlyViewDirection(
	basis: PhysicalFlyBasis,
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
	movement: PhysicalFlyLocalMovement,
	basis: PhysicalFlyBasis,
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
	basis: PhysicalFlyBasis,
	distance: number,
): [number, number, number] {
	const east = basis.up[0] * distance;
	const north = -basis.up[2] * distance;
	return [east, north === 0 ? 0 : north, basis.up[1] * distance];
}
