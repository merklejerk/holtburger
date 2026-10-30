import type { AABB3 } from "../lib/game/math/types";
import type { PrimaryCameraView } from "../lib/game/runtime/types";
import type { ResolvedScenePlacement } from "../lib/game/scene";
import { createClientEntityProjector } from "./client-entity-projection";

const CLIP_EPSILON = 1e-7;

/** Geometry policy needed to classify and place the app-local target marker. */
export interface ClientTargetIndicatorGeometryTuning {
	readonly safeInsetCssPixels: number;
}

/** Frame-current offscreen marker placement in canvas-local CSS pixels. */
export interface ClientTargetIndicatorFrame {
	readonly rotationRadians: number;
	readonly x: number;
	readonly y: number;
}

export interface ClientTargetIndicatorProjectionInput {
	readonly bounds: AABB3;
	readonly cssHeight: number;
	readonly cssWidth: number;
	readonly placement: ResolvedScenePlacement;
	readonly tuning: ClientTargetIndicatorGeometryTuning;
	readonly view: PrimaryCameraView;
}

/** Project one exact current rigid bound into an offscreen edge marker, or null while on-screen. */
export function projectClientTargetIndicator(
	input: ClientTargetIndicatorProjectionInput,
): ClientTargetIndicatorFrame | null {
	validateInput(input);
	return classifyProjectedBounds(
		input,
		createClientEntityProjector(input.view, input.placement),
	);
}

function classifyProjectedBounds(
	input: ClientTargetIndicatorProjectionInput,
	project: ReturnType<typeof createClientEntityProjector>,
): ClientTargetIndicatorFrame | null {
	let allOutsideLeft = true;
	let allOutsideRight = true;
	let allOutsideBottom = true;
	let allOutsideTop = true;
	let allOutsideNear = true;
	let allOutsideFar = true;

	for (let corner = 0; corner < 8; corner += 1) {
		const point = project(
			(corner & 1) === 0 ? input.bounds.min.x : input.bounds.max.x,
			(corner & 2) === 0 ? input.bounds.min.y : input.bounds.max.y,
			(corner & 4) === 0 ? input.bounds.min.z : input.bounds.max.z,
		);
		if (![point.x, point.y, point.z, point.w].every(Number.isFinite)) {
			return null;
		}
		allOutsideLeft &&= point.x < -point.w;
		allOutsideRight &&= point.x > point.w;
		allOutsideBottom &&= point.y < -point.w;
		allOutsideTop &&= point.y > point.w;
		allOutsideNear &&= point.z < -point.w;
		allOutsideFar &&= point.z > point.w;
	}

	const outside =
		allOutsideLeft ||
		allOutsideRight ||
		allOutsideBottom ||
		allOutsideTop ||
		allOutsideNear ||
		allOutsideFar;
	if (outside) {
		return edgeIndicator(input, project);
	}
	return null;
}

function edgeIndicator(
	input: ClientTargetIndicatorProjectionInput,
	project: ReturnType<typeof createClientEntityProjector>,
): ClientTargetIndicatorFrame {
	const bounds = input.bounds;
	const center = project(
		(bounds.min.x + bounds.max.x) / 2,
		(bounds.min.y + bounds.max.y) / 2,
		(bounds.min.z + bounds.max.z) / 2,
	);
	const directionX = Number.isFinite(center.x) ? center.x : 0;
	let directionY = Number.isFinite(center.y) ? -center.y : 0;
	if (Math.abs(directionX) + Math.abs(directionY) <= CLIP_EPSILON) {
		// Straight behind has no unique screen direction. Choosing down is deterministic and avoids
		// the left/right sign flip caused by dividing through a negative homogeneous W.
		directionY = 1;
	}
	const inset = effectiveInset(input);
	const halfWidth = Math.max(0, input.cssWidth / 2 - inset);
	const halfHeight = Math.max(0, input.cssHeight / 2 - inset);
	const scale = Math.min(
		directionX === 0
			? Number.POSITIVE_INFINITY
			: halfWidth / Math.abs(directionX),
		directionY === 0
			? Number.POSITIVE_INFINITY
			: halfHeight / Math.abs(directionY),
	);
	return {
		rotationRadians: Math.atan2(directionY, directionX) + Math.PI / 2,
		x: input.cssWidth / 2 + directionX * scale,
		y: input.cssHeight / 2 + directionY * scale,
	};
}

function effectiveInset(input: ClientTargetIndicatorProjectionInput): number {
	return Math.min(
		input.tuning.safeInsetCssPixels,
		input.cssWidth / 2,
		input.cssHeight / 2,
	);
}

function validateInput(input: ClientTargetIndicatorProjectionInput): void {
	if (
		!Number.isFinite(input.cssWidth) ||
		input.cssWidth <= 0 ||
		!Number.isFinite(input.cssHeight) ||
		input.cssHeight <= 0 ||
		!Number.isFinite(input.tuning.safeInsetCssPixels) ||
		input.tuning.safeInsetCssPixels < 0
	) {
		throw new Error("Client target-indicator projection input is invalid.");
	}
}
