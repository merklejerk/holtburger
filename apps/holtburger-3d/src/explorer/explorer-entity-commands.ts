import { z } from "zod";

import type { PhysicalCameraPlacement } from "../lib/game/motion/host-physical-camera-path";
import {
	getLandblockCoordinates,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../lib/game/landblocks";

const unsigned32 = z.number().int().min(0).max(0xffff_ffff);
const generation = z.number().int().nonnegative();

const explorerCatalogCapabilitySchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("available"),
		path: z.string(),
		provenance: z.string(),
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

export type ExplorerCatalogCapability = z.infer<
	typeof explorerCatalogCapabilitySchema
>;
export type ExplorerEntityMutationReceipt = z.infer<
	typeof explorerEntityMutationReceiptSchema
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
	placement: PhysicalCameraPlacement,
	viewDirection: readonly [number, number, number],
	distance: number,
	physicalIntent: ExplorerEntitySpawnRequest["physicalIntent"],
): ExplorerEntitySpawnRequest {
	if (!Number.isInteger(wcid) || wcid < 0 || wcid > 0xffff_ffff)
		throw new Error("WCID must fit an unsigned 32-bit integer.");
	if (!Number.isFinite(distance) || distance <= 0)
		throw new Error("Spawn distance must be positive and finite.");
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
		wcid,
		cameraPose: {
			landblockId: numericCellId(
				placement.residency.envCellId ?? placement.residency.landblockId,
			),
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
		physicalIntent,
	};
}

function numericCellId(value: string): number {
	const digits = value.startsWith("0x") ? value.slice(2) : value;
	if (!/^[0-9a-fA-F]{8}$/.test(digits))
		throw new Error(`Invalid cell id ${value}.`);
	return Number.parseInt(digits, 16) >>> 0;
}
