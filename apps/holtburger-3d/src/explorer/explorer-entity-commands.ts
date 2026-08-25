import { z } from "zod";

import type { HostCameraPlacement } from "../lib/game/motion/host-placed-path";
import {
	getLandblockCoordinates,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../lib/game/landblocks";

/** Frontend request/result ceiling mirrored by the independently enforced host boundary. */
export const EXPLORER_WEENIE_SEARCH_RESULT_LIMIT = 32;

const unsigned32 = z.number().int().min(0).max(0xffff_ffff);
const generation = z.number().int().nonnegative();

const explorerCatalogCapabilitySchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("available"),
		path: z.string(),
		recordCount: z.number().int().nonnegative(),
	}),
	z.object({
		status: z.literal("unavailable"),
		path: z.string().nullable(),
		kind: z.enum(["missing-content-location", "missing", "invalid"]),
		reason: z.string(),
	}),
]);

const explorerEntityMutationReceiptSchema = z.object({
	guid: unsigned32,
	generation,
});

const explorerWeenieSearchResultSchema = z.object({
	wcid: unsigned32,
	name: z.string().min(1),
	className: z.string().min(1),
});

const explorerWeenieSearchResultsSchema = z
	.array(explorerWeenieSearchResultSchema)
	.max(EXPLORER_WEENIE_SEARCH_RESULT_LIMIT)
	.superRefine((results, context) => {
		const wcids = new Set<number>();
		for (const [index, result] of results.entries()) {
			if (wcids.has(result.wcid)) {
				context.addIssue({
					code: "custom",
					message: `Duplicate search-result WCID ${result.wcid}.`,
					path: [index, "wcid"],
				});
			}
			wcids.add(result.wcid);
		}
	});

const explorerWeenieSearchRequestSchema = z.object({
	query: z.string(),
	limit: z.number().int().positive().max(EXPLORER_WEENIE_SEARCH_RESULT_LIMIT),
});

export type ExplorerCatalogCapability = z.infer<
	typeof explorerCatalogCapabilitySchema
>;
export type ExplorerEntityMutationReceipt = z.infer<
	typeof explorerEntityMutationReceiptSchema
>;

/** One validated host search request; the host remains authoritative for hard bounds and ordering. */
export type ExplorerWeenieSearchRequest = z.infer<
	typeof explorerWeenieSearchRequestSchema
>;

/** Exact catalog identity presented by the Explorer weenie picker. */
export type ExplorerWeenieSearchResult = z.infer<
	typeof explorerWeenieSearchResultSchema
>;

/** Complete explicit host request for one Explorer-local catalog spawn. */
export interface ExplorerEntitySpawnRequest {
	readonly wcid: number;
	readonly cameraPose: {
		readonly landblockId: number;
		readonly coords: {
			readonly x: number;
			readonly y: number;
			readonly z: number;
		};
		readonly rotation: {
			readonly w: number;
			readonly x: number;
			readonly y: number;
			readonly z: number;
		};
	};
	readonly candidate: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly rotation: {
		readonly w: number;
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
	readonly physicalIntent: "pose-only" | "simulated";
}

/** Explicit one-shot launch; catalog facts own speed and spin. */
export interface LaunchExplorerEntityRequest {
	readonly guid: number;
	readonly generation: number;
	readonly direction: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
}

/** Explicit discontinuous relocation; the host remains portal/cell authority. */
export interface ExplorerEntityRelocationRequest {
	readonly guid: number;
	readonly generation: number;
	readonly cameraPose: ExplorerEntitySpawnRequest["cameraPose"];
	readonly candidate: ExplorerEntitySpawnRequest["candidate"];
	readonly rotation: ExplorerEntitySpawnRequest["rotation"];
	readonly kind: "teleport" | "reset";
}

type CameraRelativeEntityCandidate = Pick<
	ExplorerEntitySpawnRequest,
	"cameraPose" | "candidate" | "rotation"
>;

/** Validate catalog capability before it can alter Explorer controls. */
export function decodeExplorerCatalogCapability(
	value: unknown,
): ExplorerCatalogCapability {
	return explorerCatalogCapabilitySchema.parse(value);
}

/** Validate the exact identity returned after one ordered host mutation. */
export function decodeExplorerEntityMutationReceipt(
	value: unknown,
): ExplorerEntityMutationReceipt {
	return explorerEntityMutationReceiptSchema.parse(value);
}

/** Validate a bounded ordered host result before it reaches picker state. */
export function decodeExplorerWeenieSearchResults(
	value: unknown,
): readonly ExplorerWeenieSearchResult[] {
	return explorerWeenieSearchResultsSchema.parse(value);
}

/** Validate a frontend-authored request before it crosses the injected transport. */
export function decodeExplorerWeenieSearchRequest(
	value: unknown,
): ExplorerWeenieSearchRequest {
	return explorerWeenieSearchRequestSchema.parse(value);
}

/**
 * Camera-relative spawn distance offered by the Explorer's spawn control, in metres.
 *
 * A number input validates its value against the ladder `minimum + step * k`, so these three must
 * stay mutually consistent: a default off that ladder makes the browser reject the untouched form
 * before any handler runs. They live together here so the relationship is visible and tested
 * rather than split across HTML attributes and a state initializer.
 */
export const EXPLORER_SPAWN_DISTANCE = {
	minimum: 0.5,
	step: 0.5,
	default: 5,
} as const;

/** Whether a distance sits on the control's valid step ladder. */
export function isExplorerSpawnDistanceOnStep(distance: number): boolean {
	const steps =
		(distance - EXPLORER_SPAWN_DISTANCE.minimum) / EXPLORER_SPAWN_DISTANCE.step;
	return (
		Number.isFinite(steps) &&
		steps >= 0 &&
		Math.abs(steps - Math.round(steps)) < 1e-9
	);
}

/** Parse one intentionally narrow decimal or `0x` WCID input. */
export function parseExplorerWcid(raw: string): number {
	const value = raw.trim();
	const radix = /^0[xX][0-9a-fA-F]+$/.test(value)
		? 16
		: /^[0-9]+$/.test(value)
			? 10
			: null;
	if (radix === null)
		throw new Error("WCID must be decimal or prefixed hexadecimal (0x…).");
	const parsed = Number.parseInt(radix === 16 ? value.slice(2) : value, radix);
	if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff)
		throw new Error("WCID must fit an unsigned 32-bit integer.");
	return parsed;
}

/** Snapshot the presented camera and compute one camera-relative candidate in AC world axes. */
export function createExplorerSpawnRequest(
	wcid: number,
	placement: HostCameraPlacement,
	viewDirection: readonly [number, number, number],
	distance: number,
	physicalIntent: ExplorerEntitySpawnRequest["physicalIntent"],
): ExplorerEntitySpawnRequest {
	if (!Number.isInteger(wcid) || wcid < 0 || wcid > 0xffff_ffff)
		throw new Error("WCID must fit an unsigned 32-bit integer.");
	return {
		wcid,
		...createCameraRelativeEntityCandidate(placement, viewDirection, distance),
		physicalIntent,
	};
}

/** Build one camera-relative teleport/reset request for an exact live generation. */
export function createExplorerRelocationRequest(
	guid: number,
	generationValue: number,
	placement: HostCameraPlacement,
	viewDirection: readonly [number, number, number],
	distance: number,
	kind: ExplorerEntityRelocationRequest["kind"],
): ExplorerEntityRelocationRequest {
	validateEntityIdentity(guid, generationValue);
	return {
		guid,
		generation: generationValue,
		...createCameraRelativeEntityCandidate(placement, viewDirection, distance),
		kind,
	};
}

function createCameraRelativeEntityCandidate(
	placement: HostCameraPlacement,
	viewDirection: readonly [number, number, number],
	distance: number,
): CameraRelativeEntityCandidate {
	if (!Number.isFinite(distance) || distance <= 0)
		throw new Error("Entity candidate distance must be positive and finite.");
	if (!viewDirection.every(Number.isFinite))
		throw new Error("Camera view direction must be finite.");
	const directionLength = Math.hypot(...viewDirection);
	if (directionLength === 0)
		throw new Error("Camera view direction must not be zero.");

	const owner = getLandblockCoordinates(placement.residency.landblockId);
	const sceneOriginX = owner.x * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const sceneOriginZ = -owner.y * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const cameraCoords = {
		x: placement.position.x - sceneOriginX,
		y: -(placement.position.z - sceneOriginZ),
		z: placement.position.y,
	};
	const normalized = viewDirection.map(
		(component) => component / directionLength,
	) as [number, number, number];
	const identityRotation = { w: 1, x: 0, y: 0, z: 0 } as const;
	return {
		cameraPose: {
			landblockId: numericCameraLandblockId(placement),
			coords: cameraCoords,
			// The host consumes this pose as coordinate anchor and portal history; candidate
			// orientation is an independent Explorer policy below.
			rotation: identityRotation,
		},
		candidate: {
			x: cameraCoords.x + normalized[0] * distance,
			y: cameraCoords.y + normalized[1] * distance,
			z: cameraCoords.z + normalized[2] * distance,
		},
		// Initial Explorer UX creates neutral-world-orientation objects; rotation is never host-defaulted.
		rotation: identityRotation,
	};
}

/** Validate one harness/scenario direction without inventing speed at the frontend. */
export function createExplorerLaunchRequest(
	guid: number,
	generationValue: number,
	direction: readonly [number, number, number],
): LaunchExplorerEntityRequest {
	validateEntityIdentity(guid, generationValue);
	if (!direction.every(Number.isFinite) || Math.hypot(...direction) === 0)
		throw new Error("Launch direction must be finite and nonzero.");
	return {
		guid,
		generation: generationValue,
		direction: { x: direction[0], y: direction[1], z: direction[2] },
	};
}

function validateEntityIdentity(guid: number, generationValue: number): void {
	if (!Number.isInteger(guid) || guid < 0 || guid > 0xffff_ffff)
		throw new Error("Entity GUID must fit an unsigned 32-bit integer.");
	if (!Number.isSafeInteger(generationValue) || generationValue < 0)
		throw new Error("Entity generation must be a nonnegative safe integer.");
}

function numericCellId(value: string): number {
	const digits = value.startsWith("0x") ? value.slice(2) : value;
	if (!/^[0-9a-fA-F]{8}$/.test(digits))
		throw new Error(`Invalid cell id ${value}.`);
	return Number.parseInt(digits, 16) >>> 0;
}

/** Convert frontend residency into the host's frame selector without mistaking an owner sentinel
 * for an indoor EnvCell. Outdoor frontend residency uses `0xXXYYFFFF` as an owner key; a host
 * WorldPosition uses the high-word-only frame until outdoor cell normalization commits a cell.
 */
function numericCameraLandblockId(placement: HostCameraPlacement): number {
	const residencyId = numericCellId(
		placement.residency.envCellId ?? placement.residency.landblockId,
	);
	return placement.residency.envCellId === null
		? (residencyId & 0xffff_0000) >>> 0
		: residencyId;
}
