import type { FrameState } from "../renderer/types";

export interface FreeCameraState {
	readonly position: readonly [number, number, number];
	readonly yawRadians: number;
	readonly pitchRadians: number;
	readonly moveSpeed: number;
	readonly focusDistance: number;
	readonly hasManualControl: boolean;
}

export interface FreeCameraConfig {
	readonly defaultPosition: readonly [number, number, number];
	readonly defaultYawRadians: number;
	readonly defaultPitchRadians: number;
	readonly defaultMoveSpeed: number;
	readonly defaultFocusDistance: number;
	readonly minPitchRadians: number;
	readonly maxPitchRadians: number;
	readonly pointerYawRadiansPerPixel: number;
	readonly pointerPitchRadiansPerPixel: number;
	readonly keyboardYawRadiansPerSecond: number;
	readonly keyboardMoveInitialSpeedMultiplier: number;
	readonly keyboardMoveAccelerationSeconds: number;
	readonly shiftSlowMultiplier: number;
	readonly wheelDeltaClamp: number;
	readonly wheelLocalUpUnitsPerDelta: number;
	readonly panScalePerPixelAtFocusDistance: number;
}

const DEFAULT_FREE_CAMERA_CONFIG: FreeCameraConfig = {
	defaultPosition: [96, 120, 260],
	defaultYawRadians: 0,
	defaultPitchRadians: -0.45,
	defaultMoveSpeed: 150,
	defaultFocusDistance: 360,
	minPitchRadians: -1.38,
	maxPitchRadians: 1.38,
	pointerYawRadiansPerPixel: 0.006,
	pointerPitchRadiansPerPixel: 0.005,
	keyboardYawRadiansPerSecond: 1.8,
	keyboardMoveInitialSpeedMultiplier: 0.125,
	keyboardMoveAccelerationSeconds: 2,
	shiftSlowMultiplier: 0.05,
	wheelDeltaClamp: 900,
	wheelLocalUpUnitsPerDelta: -0.025,
	panScalePerPixelAtFocusDistance: 0.0005,
};

export function createFreeCameraState(
	config = DEFAULT_FREE_CAMERA_CONFIG,
): FreeCameraState {
	return {
		position: config.defaultPosition,
		yawRadians: config.defaultYawRadians,
		pitchRadians: config.defaultPitchRadians,
		moveSpeed: config.defaultMoveSpeed,
		focusDistance: config.defaultFocusDistance,
		hasManualControl: false,
	};
}

export function rotateFreeCamera(
	state: FreeCameraState,
	deltaPixels: { readonly x: number; readonly y: number },
	speedMultiplier = 1,
	config = DEFAULT_FREE_CAMERA_CONFIG,
): FreeCameraState {
	return {
		...state,
		yawRadians:
			state.yawRadians -
			deltaPixels.x * config.pointerYawRadiansPerPixel * speedMultiplier,
		pitchRadians: clamp(
			state.pitchRadians +
				deltaPixels.y * config.pointerPitchRadiansPerPixel * speedMultiplier,
			config.minPitchRadians,
			config.maxPitchRadians,
		),
		hasManualControl: true,
	};
}

export function rotateFreeCameraAroundWorldUp(
	state: FreeCameraState,
	direction: -1 | 1,
	deltaSeconds: number,
	speedMultiplier = 1,
	config = DEFAULT_FREE_CAMERA_CONFIG,
): FreeCameraState {
	return {
		...state,
		yawRadians:
			state.yawRadians +
			direction *
				config.keyboardYawRadiansPerSecond *
				deltaSeconds *
				speedMultiplier,
		hasManualControl: true,
	};
}

export function moveFreeCameraLocalUpByWheel(
	state: FreeCameraState,
	wheelDelta: number,
	speedMultiplier = 1,
	config = DEFAULT_FREE_CAMERA_CONFIG,
): FreeCameraState {
	const { up } = getFreeCameraAxes(state);
	const localUpDistance =
		-clamp(wheelDelta, -config.wheelDeltaClamp, config.wheelDeltaClamp) *
		config.wheelLocalUpUnitsPerDelta *
		speedMultiplier;

	return {
		...state,
		position: addVec3(state.position, scaleVec3(up, localUpDistance)),
		hasManualControl: true,
	};
}

export function panFreeCamera(
	state: FreeCameraState,
	deltaPixels: { readonly x: number; readonly y: number },
	speedMultiplier = 1,
	config = DEFAULT_FREE_CAMERA_CONFIG,
): FreeCameraState {
	const { right, up } = getFreeCameraAxes(state);
	const panScale =
		state.focusDistance *
		config.panScalePerPixelAtFocusDistance *
		speedMultiplier;

	return {
		...state,
		position: addVec3(
			state.position,
			addVec3(
				scaleVec3(right, -deltaPixels.x * panScale),
				scaleVec3(up, deltaPixels.y * panScale),
			),
		),
		hasManualControl: true,
	};
}

export function moveFreeCameraLocal(
	state: FreeCameraState,
	movement: {
		readonly right: number;
		readonly up: number;
		readonly forward: number;
	},
	deltaSeconds: number,
	speedMultiplier = 1,
): FreeCameraState {
	if (movement.right === 0 && movement.up === 0 && movement.forward === 0) {
		return state;
	}

	const { forward, right, up } = getFreeCameraAxes(state);
	const direction = normalizeVec3(
		addVec3(
			addVec3(scaleVec3(right, movement.right), scaleVec3(up, movement.up)),
			scaleVec3(forward, movement.forward),
		),
	);

	return {
		...state,
		position: addVec3(
			state.position,
			scaleVec3(direction, state.moveSpeed * deltaSeconds * speedMultiplier),
		),
		hasManualControl: true,
	};
}

export function getFreeCameraSpeedMultiplier(
	isSlowModifierActive: boolean,
	config = DEFAULT_FREE_CAMERA_CONFIG,
): number {
	return isSlowModifierActive ? config.shiftSlowMultiplier : 1;
}

export function getFreeCameraKeyboardMoveSpeedMultiplier(
	elapsedSeconds: number,
	config = DEFAULT_FREE_CAMERA_CONFIG,
): number {
	if (config.keyboardMoveAccelerationSeconds <= 0) {
		return 1;
	}

	const accelerationProgress = clamp(
		elapsedSeconds / config.keyboardMoveAccelerationSeconds,
		0,
		1,
	);

	return (
		config.keyboardMoveInitialSpeedMultiplier +
		(1 - config.keyboardMoveInitialSpeedMultiplier) * accelerationProgress
	);
}

export function createFreeCameraFrameStateCamera(
	state: FreeCameraState,
): FrameState["camera"] {
	return {
		position: state.position,
		yawRadians: state.yawRadians,
		pitchRadians: state.pitchRadians,
	};
}

export function getFreeCameraAxes(
	state: Pick<FreeCameraState, "yawRadians" | "pitchRadians">,
): {
	readonly forward: readonly [number, number, number];
	readonly right: readonly [number, number, number];
	readonly up: readonly [number, number, number];
} {
	const cosPitch = Math.cos(state.pitchRadians);
	const forward = normalizeVec3([
		Math.sin(state.yawRadians) * cosPitch,
		Math.sin(state.pitchRadians),
		-Math.cos(state.yawRadians) * cosPitch,
	]);
	const right = normalizeVec3(crossVec3(forward, [0, 1, 0]));
	const up = normalizeVec3(crossVec3(right, forward));

	return {
		forward,
		right,
		up,
	};
}

function addVec3(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): readonly [number, number, number] {
	return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function scaleVec3(
	vector: readonly [number, number, number],
	scale: number,
): readonly [number, number, number] {
	return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}

function crossVec3(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): readonly [number, number, number] {
	return [
		left[1] * right[2] - left[2] * right[1],
		left[2] * right[0] - left[0] * right[2],
		left[0] * right[1] - left[1] * right[0],
	];
}

function normalizeVec3(
	vector: readonly [number, number, number],
): readonly [number, number, number] {
	const length = Math.hypot(vector[0], vector[1], vector[2]);

	if (length === 0) {
		return [0, 1, 0];
	}

	return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
