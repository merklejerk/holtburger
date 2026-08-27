import { z } from "zod";
import { sceneVec3, type SceneVec3 } from "../../assets/ac-frame";
import type { EnvCellId, LandblockOwnerId } from "../game-types";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../landblocks";
import { Vec3 } from "../math/types";
import type { SceneResidency } from "../scene";
import {
	evaluateHostPlacedPath,
	type HostCameraPlacement,
	type HostPlacedPath,
	validateHostPlacedPath,
} from "./host-placed-path";

const finiteNumber = z.number().finite();
const generation = z.number().int().positive().safe();
const sequence = z.number().int().positive().safe();
const guid = z.number().int().nonnegative().max(0xffff_ffff);

const vector3Schema = z
	.object({ x: finiteNumber, y: finiteNumber, z: finiteNumber })
	.strict();
const worldPointSchema = z
	.object({
		landblockId: guid,
		coords: vector3Schema,
	})
	.strict();
const pathPointSchema = z
	.object({ position: worldPointSchema, visualPivot: worldPointSchema })
	.strict();
const pathSchema = z
	.object({
		initial: pathPointSchema,
		legs: z
			.array(
				z.object({ endFraction: finiteNumber, end: pathPointSchema }).strict(),
			)
			.nonempty(),
	})
	.strict();
const identityFields = {
	boomGeneration: generation,
	possessionGeneration: generation,
	guid,
	entityGeneration: generation,
};
const diagnosticsSchema = z
	.object({
		controlLegs: z.number().int().nonnegative().safe(),
		clearanceSweeps: z.number().int().nonnegative().safe(),
		transitSubsteps: z.number().int().nonnegative().safe(),
		contactPasses: z.number().int().nonnegative().safe(),
	})
	.strict();
const clearanceSchema = z
	.object({
		projectionRevision: generation,
		radius: finiteNumber.positive(),
	})
	.strict()
	.nullable();
const holdReasonSchema = z.enum([
	"clearance-sweep",
	"free-sphere-query",
	"target-contract",
	"controller-input",
	"path-projection",
]);
const reseedReasonSchema = z.enum([
	"initial-placement",
	"placed-path",
	"placement-recovery",
]);
const tickSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("advanced"),
			...identityFields,
			sequence,
			targetSphereRole: z.enum(["primary", "upper-constraint"]),
			clearance: clearanceSchema,
			desiredReach: finiteNumber.nonnegative(),
			renderedReach: finiteNumber.nonnegative(),
			path: pathSchema,
			diagnostics: diagnosticsSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("reseeded"),
			...identityFields,
			sequence,
			targetSphereRole: z.enum(["primary", "upper-constraint"]),
			clearance: clearanceSchema,
			desiredReach: finiteNumber.nonnegative(),
			renderedReach: finiteNumber.nonnegative(),
			path: pathSchema,
			reason: reseedReasonSchema,
			diagnostics: diagnosticsSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("held"),
			...identityFields,
			sequence,
			targetSphereRole: z.enum(["primary", "upper-constraint"]),
			clearance: clearanceSchema,
			desiredReach: finiteNumber.nonnegative(),
			renderedReach: finiteNumber.nonnegative(),
			path: pathSchema,
			reason: holdReasonSchema,
			diagnostics: diagnosticsSchema,
		})
		.strict(),
]);
const updateReceiptSchema = z.enum(["accepted", "ignored-stale"]);

/** Exact boom and possessed-body lifecycle tuple carried by every host result. */
export type HostKinematicBoomIdentity = Pick<
	z.infer<typeof tickSchema>,
	"boomGeneration" | "possessionGeneration" | "guid" | "entityGeneration"
>;

/** One validated host camera tick carrying continuous, reseeded, or recoverably held placement. */
export type HostKinematicBoomTick = z.infer<typeof tickSchema>;

/** Result of one semantic latest-wins input command. */
export type HostKinematicBoomUpdateReceipt = z.infer<
	typeof updateReceiptSchema
>;

/**
 * Camera placement and host-owned filtered subject pivot sampled from one path instant.
 *
 * The two can coincide. Every reseed tick — the generation's first, and each recovery — settles the
 * camera onto the possessed body's own collision sphere, which is also what the pivot resolves to,
 * so for those instants the camera is inside the body it is looking at and the pair carries no look
 * direction. Consumers that derive orientation from the pair must name a fallback; see
 * `resolveCameraLookAtAngles`.
 */
export interface HostKinematicBoomPresentation {
	readonly placement: HostCameraPlacement;
	readonly visualPivot: SceneVec3;
}

/** Placement-authoring condition recovered through an explicit safe discontinuity. */
export type HostKinematicBoomReseedReason = z.infer<typeof reseedReasonSchema>;

/** Machine-readable reason one recoverable tick held its last collision-safe placement. */
export type HostKinematicBoomHoldReason = z.infer<typeof holdReasonSchema>;

/**
 * Convert the camera's AC-world look direction into the boom's pivot-to-camera direction.
 *
 * The look controller points from the camera toward the subject. The host boom casts the opposite
 * ray, from the possessed subject toward the desired camera placement. Naming that sign change at
 * the wire-contract boundary keeps spawning/free-fly semantics out of the boom controller.
 */
export function resolveKinematicBoomDirection(
	cameraViewDirection: readonly [number, number, number],
): [number, number, number] {
	return cameraViewDirection.map((component) =>
		component === 0 ? 0 : -component,
	) as [number, number, number];
}

/** Validate one boom result and its nonempty path against the containing tick duration. */
export function decodeHostKinematicBoomTick(
	value: unknown,
	durationMs: number,
): HostKinematicBoomTick {
	const tick = tickSchema.parse(value);
	validateHostPlacedPath(tick.path, durationMs);
	if (
		(tick.kind === "reseeded" || tick.kind === "held") &&
		!tick.path.legs.every(({ end }) => samePathPoint(end, tick.path.initial))
	) {
		throw new Error(
			"Host boom discontinuity path must remain at its initial placement.",
		);
	}
	return tick;
}

/** Decode one semantic latest-wins input receipt. */
export function decodeHostKinematicBoomUpdateReceipt(
	value: unknown,
): HostKinematicBoomUpdateReceipt {
	return updateReceiptSchema.parse(value);
}

/** Validate a registration receipt before it can target later commands or paths. */
export function decodeHostKinematicBoomIdentity(
	value: unknown,
): HostKinematicBoomIdentity {
	return z.object(identityFields).strict().parse(value);
}

/** Compare complete lifecycle identity; no constituent generation is optional. */
export function sameHostKinematicBoomIdentity(
	left: HostKinematicBoomIdentity,
	right: HostKinematicBoomIdentity,
): boolean {
	return (
		left.boomGeneration === right.boomGeneration &&
		left.possessionGeneration === right.possessionGeneration &&
		left.guid === right.guid &&
		left.entityGeneration === right.entityGeneration
	);
}

/** Evaluate one collision-safe host path without predicting or reclassifying its residency. */
export function evaluateHostKinematicBoomPath(
	path: HostPlacedPath<z.infer<typeof pathPointSchema>>,
	durationMs: number,
	elapsedMs: number,
): HostKinematicBoomPresentation {
	return evaluateHostPlacedPath(path, durationMs, elapsedMs, {
		interpolate: (start, end, fraction) => {
			const startPresentation = presentationFromPoint(start);
			const endPresentation = presentationFromPoint(end);
			return {
				placement: {
					position: interpolatePosition(
						startPresentation.placement.position,
						endPresentation.placement.position,
						fraction,
					),
					// Host legs are placement-stable over their half-open intervals.
					residency: startPresentation.placement.residency,
				},
				visualPivot: interpolatePosition(
					startPresentation.visualPivot,
					endPresentation.visualPivot,
					fraction,
				),
			};
		},
		present: presentationFromPoint,
	});
}

function presentationFromPoint(
	point: z.infer<typeof pathPointSchema>,
): HostKinematicBoomPresentation {
	const cellId = point.position.landblockId >>> 0;
	const ownerId = (cellId & 0xffff_0000) | 0xffff;
	const residency: SceneResidency = {
		landblockId: formatId(ownerId) as LandblockOwnerId,
		envCellId:
			(cellId & 0xffff) >= 0x0100 && (cellId & 0xffff) !== 0xffff
				? (formatId(cellId) as EnvCellId)
				: null,
	};
	return {
		placement: {
			position: scenePositionFromWorldPoint(point.position),
			residency,
		},
		visualPivot: scenePositionFromWorldPoint(point.visualPivot),
	};
}

function interpolatePosition(
	start: SceneVec3,
	end: SceneVec3,
	fraction: number,
): SceneVec3 {
	return sceneVec3(
		new Vec3(
			start.x + (end.x - start.x) * fraction,
			start.y + (end.y - start.y) * fraction,
			start.z + (end.z - start.z) * fraction,
		),
	);
}

function scenePositionFromWorldPoint(
	position: z.infer<typeof worldPointSchema>,
): SceneVec3 {
	const ownerId = (position.landblockId & 0xffff_0000) | 0xffff;
	const ownerX = (ownerId >>> 24) & 0xff;
	const ownerY = (ownerId >>> 16) & 0xff;
	return sceneVec3(
		new Vec3(
			ownerX * OUTDOOR_LANDBLOCK_WORLD_SIZE + position.coords.x,
			position.coords.z,
			-(ownerY * OUTDOOR_LANDBLOCK_WORLD_SIZE + position.coords.y),
		),
	);
}

function samePathPoint(
	left: z.infer<typeof pathPointSchema>,
	right: z.infer<typeof pathPointSchema>,
): boolean {
	return (
		left.position.landblockId === right.position.landblockId &&
		left.position.coords.x === right.position.coords.x &&
		left.position.coords.y === right.position.coords.y &&
		left.position.coords.z === right.position.coords.z &&
		left.visualPivot.landblockId === right.visualPivot.landblockId &&
		left.visualPivot.coords.x === right.visualPivot.coords.x &&
		left.visualPivot.coords.y === right.visualPivot.coords.y &&
		left.visualPivot.coords.z === right.visualPivot.coords.z
	);
}

function formatId(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
