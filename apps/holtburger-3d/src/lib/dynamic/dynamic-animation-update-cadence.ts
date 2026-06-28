import type { StaticBounds } from "../static/contracts";
import { createOutdoorLandblockRootTranslation } from "../static/placement";
import type { DynamicEntityRecord } from "./contracts";

export const DYNAMIC_ANIMATION_NEAR_UPDATE_DISTANCE = 64;
export const DYNAMIC_ANIMATION_MID_UPDATE_DISTANCE = 128;
export const DYNAMIC_ANIMATION_MID_UPDATE_INTERVAL_SECONDS = 0.05;
export const DYNAMIC_ANIMATION_FAR_UPDATE_INTERVAL_SECONDS = 0.15;

export interface DynamicAnimationUpdateCadenceContext {
	/** Active camera position in renderer-local space for the current frame. */
	readonly cameraPosition: readonly [number, number, number];
	/** Outdoor render anchor used to translate source-landblock-local dynamic positions. */
	readonly renderAnchorLandblockId: number | null;
}

export interface DynamicAnimationUpdateCadenceDecision {
	readonly distance: number | null;
	readonly intervalSeconds: number;
	readonly shouldUpdate: boolean;
}

/** Computes browser/app presentation cadence without mutating dynamic entity truth. */
export function shouldUpdateDynamicAnimationForCadence(options: {
	readonly context: DynamicAnimationUpdateCadenceContext | null;
	readonly lastUpdatedAtSeconds: number | null;
	readonly record: DynamicEntityRecord;
	readonly timeSeconds: number;
}): DynamicAnimationUpdateCadenceDecision {
	if (options.context === null) {
		return {
			distance: null,
			intervalSeconds: 0,
			shouldUpdate: true,
		};
	}

	const distance = computeDynamicAnimationDistance({
		context: options.context,
		record: options.record,
	});
	if (distance === null) {
		return {
			distance: null,
			intervalSeconds: 0,
			shouldUpdate: true,
		};
	}

	const intervalSeconds = intervalSecondsForDynamicAnimationDistance(distance);
	if (intervalSeconds === 0 || options.lastUpdatedAtSeconds === null) {
		return {
			distance,
			intervalSeconds,
			shouldUpdate: true,
		};
	}

	const elapsedSeconds = options.timeSeconds - options.lastUpdatedAtSeconds;
	return {
		distance,
		intervalSeconds,
		shouldUpdate: elapsedSeconds < 0 || elapsedSeconds >= intervalSeconds,
	};
}

export function intervalSecondsForDynamicAnimationDistance(
	distance: number,
): number {
	if (distance <= DYNAMIC_ANIMATION_NEAR_UPDATE_DISTANCE) {
		return 0;
	}
	if (distance <= DYNAMIC_ANIMATION_MID_UPDATE_DISTANCE) {
		return DYNAMIC_ANIMATION_MID_UPDATE_INTERVAL_SECONDS;
	}
	return DYNAMIC_ANIMATION_FAR_UPDATE_INTERVAL_SECONDS;
}

function computeDynamicAnimationDistance(options: {
	readonly context: DynamicAnimationUpdateCadenceContext;
	readonly record: DynamicEntityRecord;
}): number | null {
	const entityPosition = resolveDynamicEntityRenderPosition(options);
	if (entityPosition === null) {
		return null;
	}
	return distanceBetween(options.context.cameraPosition, entityPosition);
}

function resolveDynamicEntityRenderPosition(options: {
	readonly context: DynamicAnimationUpdateCadenceContext;
	readonly record: DynamicEntityRecord;
}): readonly [number, number, number] | null {
	const currentBounds = options.record.bounds.currentBounds;
	if (currentBounds !== null) {
		const center = centerOfBounds(currentBounds.bounds);
		if (currentBounds.kind === "env-cell") {
			return center;
		}
		if (options.context.renderAnchorLandblockId === null) {
			return null;
		}
		return translatePoint(
			center,
			createOutdoorLandblockRootTranslation(
				currentBounds.sourceLandblockId,
				options.context.renderAnchorLandblockId,
			),
		);
	}

	const baseOrigin = options.record.baseTransform.baseLocalPlacement.origin;
	const basePosition = [baseOrigin.x, baseOrigin.y, baseOrigin.z] as const;
	if (options.record.sourceResidence.kind === "env-cell") {
		return basePosition;
	}
	if (options.context.renderAnchorLandblockId === null) {
		return null;
	}
	return translatePoint(
		basePosition,
		createOutdoorLandblockRootTranslation(
			options.record.sourceResidence.landblockId,
			options.context.renderAnchorLandblockId,
		),
	);
}

function centerOfBounds(
	bounds: StaticBounds,
): readonly [number, number, number] {
	return [
		(bounds.min.x + bounds.max.x) / 2,
		(bounds.min.y + bounds.max.y) / 2,
		(bounds.min.z + bounds.max.z) / 2,
	];
}

function translatePoint(
	point: readonly [number, number, number],
	translation: readonly [number, number, number],
): readonly [number, number, number] {
	return [
		point[0] + translation[0],
		point[1] + translation[1],
		point[2] + translation[2],
	];
}

function distanceBetween(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): number {
	return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}
