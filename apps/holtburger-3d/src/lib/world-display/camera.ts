import type { AppModeId } from "../../app/modes";
import type { BrowserLocationSelection } from "../../app/browser-mode";
import type {
	CameraHintDto,
	RuntimeBatchDto,
	Vec3Dto,
} from "../host/contracts";
import type { NormalizedViewportPoint } from "./model";

export interface SceneCameraFrame {
	position: Vec3Dto;
	target: Vec3Dto;
	up: Vec3Dto;
	aspect: number;
	fovDegrees: number;
	near: number;
	far: number;
}

export interface SceneBoundsFrame {
	center: Vec3Dto;
	size: Vec3Dto;
	minimumSpan: number;
}

export interface DebugOrbitCameraState {
	target: Vec3Dto;
	yawRadians: number;
	pitchRadians: number;
	distance: number;
	minDistance: number;
	maxDistance: number;
	hasManualControl: boolean;
	lastFitKey: string | null;
}

const DEFAULT_UP: Vec3Dto = { x: 0, y: 1, z: 0 };
const DEFAULT_FOV_DEGREES = 52;
const DEFAULT_NEAR = 0.1;
const DEFAULT_FAR = 5000;
const MIN_PITCH_RADIANS = -1.38;
const MAX_PITCH_RADIANS = 1.38;

export function createDebugOrbitCameraState(): DebugOrbitCameraState {
	return {
		target: { x: 0, y: 0, z: 0 },
		yawRadians: Math.PI * 0.74,
		pitchRadians: -0.72,
		distance: 360,
		minDistance: 18,
		maxDistance: 4000,
		hasManualControl: false,
		lastFitKey: null,
	};
}

export function fitDebugOrbitCameraToBounds(
	state: DebugOrbitCameraState,
	bounds: SceneBoundsFrame,
	fitKey: string,
	options: { force: boolean },
): DebugOrbitCameraState {
	if (!options.force && state.hasManualControl) {
		return state;
	}

	const horizontalSpan = Math.max(
		bounds.size.x,
		bounds.size.z,
		bounds.minimumSpan,
	);
	const verticalSpan = Math.max(bounds.size.y, 24);
	const distance = clamp(
		Math.max(horizontalSpan * 1.65, verticalSpan * 3.4),
		Math.max(18, horizontalSpan * 0.12),
		Math.max(1200, horizontalSpan * 8),
	);

	return {
		...state,
		target: { ...bounds.center },
		distance,
		minDistance: Math.max(6, horizontalSpan * 0.04),
		maxDistance: Math.max(1200, horizontalSpan * 10),
		hasManualControl: options.force ? false : state.hasManualControl,
		lastFitKey: fitKey,
	};
}

export function orbitDebugCamera(
	state: DebugOrbitCameraState,
	deltaPixels: { x: number; y: number },
): DebugOrbitCameraState {
	return {
		...state,
		yawRadians: state.yawRadians - deltaPixels.x * 0.006,
		pitchRadians: clamp(
			state.pitchRadians - deltaPixels.y * 0.005,
			MIN_PITCH_RADIANS,
			MAX_PITCH_RADIANS,
		),
		hasManualControl: true,
	};
}

export function zoomDebugCamera(
	state: DebugOrbitCameraState,
	wheelDeltaY: number,
): DebugOrbitCameraState {
	const multiplier = Math.exp(clamp(wheelDeltaY, -900, 900) * 0.0012);
	return {
		...state,
		distance: clamp(
			state.distance * multiplier,
			state.minDistance,
			state.maxDistance,
		),
		hasManualControl: true,
	};
}

export function panDebugCamera(
	state: DebugOrbitCameraState,
	deltaPixels: { x: number; y: number },
): DebugOrbitCameraState {
	const frame = buildDebugOrbitCameraFrame(state);
	const forward = normalizeVec3(subtractVec3(frame.target, frame.position));
	const right = normalizeVec3(crossVec3(forward, frame.up));
	const up = normalizeVec3(crossVec3(right, forward));
	const panScale = state.distance * 0.0018;
	const target = addVec3(
		state.target,
		addVec3(
			scaleVec3(right, -deltaPixels.x * panScale),
			scaleVec3(up, deltaPixels.y * panScale),
		),
	);

	return {
		...state,
		target,
		hasManualControl: true,
	};
}

export function buildDebugOrbitCameraFrame(
	state: DebugOrbitCameraState,
): SceneCameraFrame {
	const cosPitch = Math.cos(state.pitchRadians);
	const offset = {
		x: Math.cos(state.yawRadians) * cosPitch * state.distance,
		y: Math.sin(-state.pitchRadians) * state.distance,
		z: Math.sin(state.yawRadians) * cosPitch * state.distance,
	};

	return {
		position: addVec3(state.target, offset),
		target: { ...state.target },
		up: DEFAULT_UP,
		aspect: 1,
		fovDegrees: DEFAULT_FOV_DEGREES,
		near: DEFAULT_NEAR,
		far: DEFAULT_FAR,
	};
}

export function buildCameraHintFromSceneCameraFrame(
	activeMode: AppModeId,
	runtimeBatch: RuntimeBatchDto | null,
	browserDestination: BrowserLocationSelection | null,
	frame: SceneCameraFrame,
	viewportPoint: NormalizedViewportPoint,
): CameraHintDto | null {
	if (!runtimeBatch) {
		return null;
	}

	return {
		mode: activeMode,
		source: "world-display",
		position: threeVectorToAc(frame.position),
		forward: normalizeVec3(
			threeVectorToAc(buildFrameRayDirection(frame, viewportPoint)),
		),
		viewportNormalizedX: viewportPoint.normalizedX,
		viewportNormalizedY: viewportPoint.normalizedY,
		destinationLabel:
			browserDestination?.label ?? runtimeBatch.residency.focusLocationLabel,
	};
}

export function describeSceneCameraFrame(frame: SceneCameraFrame): string {
	return `Camera (${frame.position.x.toFixed(1)}, ${frame.position.y.toFixed(1)}, ${frame.position.z.toFixed(1)}) looking at (${frame.target.x.toFixed(1)}, ${frame.target.y.toFixed(1)}, ${frame.target.z.toFixed(1)}).`;
}

function buildFrameRayDirection(
	frame: SceneCameraFrame,
	viewportPoint: NormalizedViewportPoint,
): Vec3Dto {
	const forward = normalizeVec3(subtractVec3(frame.target, frame.position));
	const right = normalizeVec3(crossVec3(forward, frame.up));
	const up = normalizeVec3(crossVec3(right, forward));
	const halfVerticalFov = (frame.fovDegrees * Math.PI) / 360;
	const viewportX = (viewportPoint.normalizedX - 0.5) * 2;
	const viewportY = (0.5 - viewportPoint.normalizedY) * 2;

	return normalizeVec3(
		addVec3(
			forward,
			addVec3(
				scaleVec3(right, viewportX * Math.tan(halfVerticalFov) * frame.aspect),
				scaleVec3(up, viewportY * Math.tan(halfVerticalFov)),
			),
		),
	);
}

function threeVectorToAc(vector: Vec3Dto): Vec3Dto {
	return {
		x: vector.x,
		y: -vector.z,
		z: vector.y,
	};
}

function addVec3(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.x + right.x,
		y: left.y + right.y,
		z: left.z + right.z,
	};
}

function subtractVec3(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.x - right.x,
		y: left.y - right.y,
		z: left.z - right.z,
	};
}

function scaleVec3(vector: Vec3Dto, scale: number): Vec3Dto {
	return {
		x: vector.x * scale,
		y: vector.y * scale,
		z: vector.z * scale,
	};
}

function crossVec3(left: Vec3Dto, right: Vec3Dto): Vec3Dto {
	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x,
	};
}

function normalizeVec3(vector: Vec3Dto): Vec3Dto {
	const length = Math.hypot(vector.x, vector.y, vector.z);

	if (length === 0) {
		return { x: 0, y: 1, z: 0 };
	}

	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
