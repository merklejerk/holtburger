import type { BrowserLocationSelection } from "../../app/browser-mode";
import type { CameraHintDto, Vec3Dto } from "../host/contracts";
import {
	getOutdoorLandblockCoords,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";
import type { NormalizedViewportPoint } from "./model";
import {
	convertCameraFrameBetweenAnchors,
	type RenderCameraFrame,
	type RenderLandblockAnchor,
} from "./render-chunks";

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

export interface BrowserFreeCameraState {
	position: Vec3Dto;
	yawRadians: number;
	pitchRadians: number;
	focusDistance: number;
	minFocusDistance: number;
	maxFocusDistance: number;
	moveSpeed: number;
	hasManualControl: boolean;
	lastFitKey: string | null;
}

export interface BrowserFreeCameraConfig {
	defaultPosition: Vec3Dto;
	defaultYawRadians: number;
	defaultPitchRadians: number;
	defaultFocusDistance: number;
	defaultMinFocusDistance: number;
	defaultMaxFocusDistance: number;
	defaultMoveSpeed: number;
	fovDegrees: number;
	near: number;
	far: number;
	minPitchRadians: number;
	maxPitchRadians: number;
	pointerYawRadiansPerPixel: number;
	pointerPitchRadiansPerPixel: number;
	keyboardYawRadiansPerSecond: number;
	keyboardMoveInitialSpeedMultiplier: number;
	keyboardMoveAccelerationSeconds: number;
	shiftSlowMultiplier: number;
	wheelDeltaClamp: number;
	wheelLocalUpUnitsPerDelta: number;
	panScalePerPixelAtFocusDistance: number;
	fitTargetScreenWidthOccupancy: number;
	fitVerticalDistanceScale: number;
	fitFrameMinDistanceScale: number;
	fitFrameMaxDistanceScale: number;
	fitMinDistanceScale: number;
	fitMaxDistanceScale: number;
	fitMinimumVerticalSpan: number;
	fitAbsoluteMinFocusDistance: number;
	fitAbsoluteMaxFocusDistance: number;
}

const DEFAULT_UP: Vec3Dto = { x: 0, y: 1, z: 0 };
const DEFAULT_CAMERA_YAW_RADIANS = Math.PI * 0.74;
const DEFAULT_CAMERA_PITCH_RADIANS = -Math.PI / 4;

export const DEFAULT_BROWSER_FREE_CAMERA_CONFIG: BrowserFreeCameraConfig = {
	defaultPosition: { x: 180, y: 220, z: 180 },
	defaultYawRadians: DEFAULT_CAMERA_YAW_RADIANS,
	defaultPitchRadians: DEFAULT_CAMERA_PITCH_RADIANS,
	defaultFocusDistance: 360,
	defaultMinFocusDistance: 18,
	defaultMaxFocusDistance: 4000,
	defaultMoveSpeed: 150,
	fovDegrees: 52,
	near: 0.1,
	far: 5000,
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
	fitTargetScreenWidthOccupancy: 1.5,
	fitVerticalDistanceScale: 1.15,
	fitFrameMinDistanceScale: 0.12,
	fitFrameMaxDistanceScale: 8,
	fitMinDistanceScale: 0.04,
	fitMaxDistanceScale: 10,
	fitMinimumVerticalSpan: 24,
	fitAbsoluteMinFocusDistance: 6,
	fitAbsoluteMaxFocusDistance: 800,
};

export function createBrowserFreeCameraState(
	config = DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
): BrowserFreeCameraState {
	return {
		position: { ...config.defaultPosition },
		yawRadians: config.defaultYawRadians,
		pitchRadians: config.defaultPitchRadians,
		focusDistance: config.defaultFocusDistance,
		minFocusDistance: config.defaultMinFocusDistance,
		maxFocusDistance: config.defaultMaxFocusDistance,
		moveSpeed: config.defaultMoveSpeed,
		hasManualControl: false,
		lastFitKey: null,
	};
}

export function fitSceneCameraFrameToBounds(
	bounds: SceneBoundsFrame,
	aspect: number,
	config = DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
): SceneCameraFrame {
	const focusDistance = calculateSceneFocusDistance(bounds, aspect, config);
	const axes = getCameraAxes({
		yawRadians: config.defaultYawRadians,
		pitchRadians: config.defaultPitchRadians,
	});
	const position = subtractVec3(
		bounds.center,
		scaleVec3(axes.forward, focusDistance),
	);

	return buildSceneCameraFrameFromPose({
		position,
		forward: axes.forward,
		up: axes.up,
		focusDistance,
		aspect,
		config,
	});
}

export function createFallbackSceneCameraFrame(
	aspect: number,
	config = DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
): SceneCameraFrame {
	const fallbackCamera = createBrowserFreeCameraState(config);
	const axes = getCameraAxes(fallbackCamera);

	return buildSceneCameraFrameFromPose({
		position: fallbackCamera.position,
		forward: axes.forward,
		up: axes.up,
		focusDistance: fallbackCamera.focusDistance,
		aspect,
		config,
	});
}

export function fitBrowserFreeCameraToBounds(
	state: BrowserFreeCameraState,
	bounds: SceneBoundsFrame,
	fitKey: string,
	options: { force: boolean; aspect?: number },
	config = DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
): BrowserFreeCameraState {
	if (!options.force && state.hasManualControl) {
		return state;
	}

	const horizontalSpan = calculateSceneHorizontalSpan(bounds);
	const focusDistance = calculateSceneFocusDistance(
		bounds,
		options.aspect ?? 1,
		config,
	);
	const nextState = {
		...state,
		focusDistance,
		minFocusDistance: Math.max(
			config.fitAbsoluteMinFocusDistance,
			horizontalSpan * config.fitMinDistanceScale,
		),
		maxFocusDistance: Math.max(
			config.fitAbsoluteMaxFocusDistance,
			horizontalSpan * config.fitMaxDistanceScale,
		),
		hasManualControl: options.force ? false : state.hasManualControl,
		lastFitKey: fitKey,
	};
	const forward = getCameraAxes(nextState).forward;

	return {
		...nextState,
		position: subtractVec3(bounds.center, scaleVec3(forward, focusDistance)),
	};
}

export function convertBrowserFreeCameraStateBetweenAnchors(
	state: BrowserFreeCameraState,
	oldAnchorLandblockId: number,
	newAnchorLandblockId: number,
): BrowserFreeCameraState {
	const convertedFrame = convertCameraFrameBetweenAnchors(
		createCameraStateRebaseFrame(state.position),
		oldAnchorLandblockId,
		newAnchorLandblockId,
	);

	return {
		...state,
		position: convertedFrame.position,
	};
}

export function rotateBrowserFreeCamera(
	state: BrowserFreeCameraState,
	deltaPixels: { x: number; y: number },
	speedMultiplier = 1,
	config = DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
): BrowserFreeCameraState {
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

export function rotateBrowserFreeCameraAroundLocalUp(
	state: BrowserFreeCameraState,
	direction: -1 | 1,
	deltaSeconds: number,
	speedMultiplier = 1,
	config = DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
): BrowserFreeCameraState {
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

export function moveBrowserFreeCameraLocalUpByWheel(
	state: BrowserFreeCameraState,
	wheelDeltaY: number,
	speedMultiplier = 1,
	config = DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
): BrowserFreeCameraState {
	const { up } = getCameraAxes(state);
	const localUpDistance =
		-clamp(wheelDeltaY, -config.wheelDeltaClamp, config.wheelDeltaClamp) *
		config.wheelLocalUpUnitsPerDelta *
		speedMultiplier;

	return {
		...state,
		position: addVec3(state.position, scaleVec3(up, localUpDistance)),
		hasManualControl: true,
	};
}

export function panBrowserFreeCamera(
	state: BrowserFreeCameraState,
	deltaPixels: { x: number; y: number },
	speedMultiplier = 1,
	config = DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
): BrowserFreeCameraState {
	const { right, up } = getCameraAxes(state);
	const panScale =
		state.focusDistance *
		config.panScalePerPixelAtFocusDistance *
		speedMultiplier;
	const position = addVec3(
		state.position,
		addVec3(
			scaleVec3(right, -deltaPixels.x * panScale),
			scaleVec3(up, deltaPixels.y * panScale),
		),
	);

	return {
		...state,
		position,
		hasManualControl: true,
	};
}

export function moveBrowserFreeCameraLocal(
	state: BrowserFreeCameraState,
	movement: { right: number; up: number; forward: number },
	deltaSeconds: number,
	speedMultiplier = 1,
): BrowserFreeCameraState {
	if (movement.right === 0 && movement.up === 0 && movement.forward === 0) {
		return state;
	}

	const { forward, right, up } = getCameraAxes(state);
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

export function getBrowserFreeCameraSpeedMultiplier(
	isSlowModifierActive: boolean,
	config = DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
): number {
	return isSlowModifierActive ? config.shiftSlowMultiplier : 1;
}

export function getBrowserFreeCameraKeyboardMoveSpeedMultiplier(
	elapsedSeconds: number,
	config = DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
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

export function buildBrowserFreeCameraFrame(
	state: BrowserFreeCameraState,
	config = DEFAULT_BROWSER_FREE_CAMERA_CONFIG,
): SceneCameraFrame {
	const axes = getCameraAxes(state);

	return buildSceneCameraFrameFromPose({
		position: state.position,
		forward: axes.forward,
		up: axes.up,
		focusDistance: state.focusDistance,
		aspect: 1,
		config,
	});
}

function calculateSceneHorizontalSpan(bounds: SceneBoundsFrame): number {
	return Math.max(bounds.size.x, bounds.size.z, bounds.minimumSpan);
}

function calculateSceneFocusDistance(
	bounds: SceneBoundsFrame,
	aspect: number,
	config: BrowserFreeCameraConfig,
): number {
	const horizontalSpan = calculateSceneHorizontalSpan(bounds);
	const verticalSpan = Math.max(bounds.size.y, config.fitMinimumVerticalSpan);
	const halfVerticalFovRadians = (config.fovDegrees * Math.PI) / 360;
	const horizontalDistance =
		horizontalSpan /
		(2 *
			Math.tan(halfVerticalFovRadians) *
			Math.max(aspect, 0.1) *
			config.fitTargetScreenWidthOccupancy);

	return clamp(
		Math.max(
			horizontalDistance,
			verticalSpan * config.fitVerticalDistanceScale,
		),
		Math.max(
			config.defaultMinFocusDistance,
			horizontalSpan * config.fitFrameMinDistanceScale,
		),
		Math.max(
			config.fitAbsoluteMaxFocusDistance,
			horizontalSpan * config.fitFrameMaxDistanceScale,
		),
	);
}

function buildSceneCameraFrameFromPose({
	position,
	forward,
	up,
	focusDistance,
	aspect,
	config,
}: {
	position: Vec3Dto;
	forward: Vec3Dto;
	up: Vec3Dto;
	focusDistance: number;
	aspect: number;
	config: BrowserFreeCameraConfig;
}): SceneCameraFrame {
	return {
		position: { ...position },
		target: addVec3(position, scaleVec3(forward, focusDistance)),
		up,
		aspect,
		fovDegrees: config.fovDegrees,
		near: config.near,
		far: config.far,
	};
}

function getCameraAxes(
	state: Pick<BrowserFreeCameraState, "yawRadians" | "pitchRadians">,
): {
	forward: Vec3Dto;
	right: Vec3Dto;
	up: Vec3Dto;
} {
	const cosPitch = Math.cos(state.pitchRadians);
	const forward = normalizeVec3({
		x: -Math.cos(state.yawRadians) * cosPitch,
		y: -Math.sin(-state.pitchRadians),
		z: -Math.sin(state.yawRadians) * cosPitch,
	});
	const right = normalizeVec3(crossVec3(forward, DEFAULT_UP));
	const up = normalizeVec3(crossVec3(right, forward));

	return {
		forward,
		right,
		up,
	};
}

export function buildCameraHintFromSceneCameraFrame(
	browserDestination: BrowserLocationSelection | null,
	frame: SceneCameraFrame,
	viewportPoint: NormalizedViewportPoint,
	activeRenderAnchor: RenderLandblockAnchor | null = null,
): CameraHintDto | null {
	return {
		source: "world-display",
		position: rendererPointToAcPosition(frame.position, activeRenderAnchor),
		forward: normalizeVec3(
			threeVectorToAc(buildFrameRayDirection(frame, viewportPoint)),
		),
		viewportNormalizedX: viewportPoint.normalizedX,
		viewportNormalizedY: viewportPoint.normalizedY,
		destinationLabel: browserDestination?.label ?? null,
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

function rendererPointToAcPosition(
	point: Vec3Dto,
	activeRenderAnchor: RenderLandblockAnchor | null,
): Vec3Dto {
	const acPoint = threeVectorToAc(point);
	if (activeRenderAnchor === null) {
		return acPoint;
	}

	const anchorCoords = getOutdoorLandblockCoords(
		activeRenderAnchor.landblockId,
	);
	return {
		x: anchorCoords.x * OUTDOOR_LANDBLOCK_WORLD_SIZE + acPoint.x,
		y: anchorCoords.y * OUTDOOR_LANDBLOCK_WORLD_SIZE + acPoint.y,
		z: acPoint.z,
	};
}

function createCameraStateRebaseFrame(position: Vec3Dto): RenderCameraFrame {
	return {
		position,
		target: position,
		up: { x: 0, y: 1, z: 0 },
		aspect: 1,
		fovDegrees: DEFAULT_BROWSER_FREE_CAMERA_CONFIG.fovDegrees,
		near: DEFAULT_BROWSER_FREE_CAMERA_CONFIG.near,
		far: DEFAULT_BROWSER_FREE_CAMERA_CONFIG.far,
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
