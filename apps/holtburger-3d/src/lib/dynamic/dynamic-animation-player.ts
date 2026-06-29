import type {
	AnimationPayloadDto,
	PlacementTransformDto,
} from "../host/contracts";
import type {
	DynamicEntityActiveOmegaState,
	DynamicAnimationHookFrameKey,
	DynamicEntityAnimationPlaybackState,
	DynamicEntityAnimationState,
	DynamicEntityRecord,
} from "./contracts";

export const DYNAMIC_ANIMATION_FRAME_RATE_FPS = 30;
const MAX_CROSSED_HOOK_FRAMES_PER_UPDATE = 8;
const IDENTITY_PLACEMENT: PlacementTransformDto = {
	orientation: { w: 1, x: 0, y: 0, z: 0 },
	origin: { x: 0, y: 0, z: 0 },
};

interface PlaybackUpdate {
	readonly changed: boolean;
	readonly record: DynamicEntityRecord;
}

interface SampledAnimationFrame {
	readonly absoluteFrameIndex: number;
	readonly currentFrameIndex: number;
	readonly elapsedSeconds: number;
	readonly frameAlpha: number;
	readonly frameNumber: number;
	readonly loopIteration: number;
	readonly nextFrameIndex: number;
}

interface CrossedHookFrame {
	readonly absoluteFrameIndex: number;
	readonly frameIndex: number;
	readonly loopIteration: number;
	readonly timeSeconds: number;
}

type AnimationHookDto =
	AnimationPayloadDto["partFrames"][number]["hooks"][number];
type QuaternionDto = PlacementTransformDto["orientation"];
type PlayingPlayback = Extract<
	DynamicEntityAnimationPlaybackState,
	{ readonly status: "playing" }
>;

interface HookDispatchResult {
	readonly activeOmega: DynamicEntityActiveOmegaState | null;
}

interface CrossedHookDispatchResult {
	readonly activeOmega: DynamicEntityActiveOmegaState | null;
	readonly lastDispatchedHookFrame: DynamicAnimationHookFrameKey | null;
}

/** Samples default setup animations into dynamic entity runtime pose state. */
export class DynamicAnimationPlayer {
	readonly #hookDispatcher = new DynamicHookDispatcher();

	update(record: DynamicEntityRecord, timeSeconds: number): PlaybackUpdate {
		if (record.resources.setupAnimation.status !== "ready") {
			return { changed: false, record };
		}

		const animationResource = record.resources.setupAnimation.animation;
		const payload = animationResource.payload;
		if (payload.frameCount === 0) {
			return failZeroFrameAnimation(record, animationResource.assetId, payload);
		}

		const startedAtSeconds =
			record.animation.playback.status === "playing" &&
			record.animation.playback.animationAssetId === animationResource.assetId
				? record.animation.playback.startedAtSeconds
				: timeSeconds;
		const sampled = sampleAnimationFrame({
			frameCount: payload.frameCount,
			startedAtSeconds,
			timeSeconds,
		});
		const objectRootPose = sampleObjectRootPose({
			currentFrameIndex: sampled.currentFrameIndex,
			frameAlpha: sampled.frameAlpha,
			nextFrameIndex: sampled.nextFrameIndex,
			payload,
		});
		const partFrame = payload.partFrames[sampled.currentFrameIndex];
		const nextPartFrame =
			payload.partFrames[sampled.nextFrameIndex] ?? partFrame;
		const previousHookFrame =
			record.animation.playback.status === "playing" &&
			record.animation.playback.animationAssetId === animationResource.assetId
				? record.animation.playback.lastDispatchedHookFrame
				: null;
		const previousActiveOmega =
			record.animation.playback.status === "playing" &&
			record.animation.playback.animationAssetId === animationResource.assetId
				? record.animation.playback.transformEffects.activeOmega
				: null;
		const hookDispatch = this.#dispatchCrossedHooks({
			activeOmega: previousActiveOmega,
			animationAssetId: animationResource.assetId,
			entityId: record.id,
			frameCount: payload.frameCount,
			payload,
			previousHookFrame,
			sampled,
			startedAtSeconds,
			timeSeconds,
		});
		const next: DynamicEntityRecord = {
			...record,
			animation: {
				defaultAnimationId: record.animation.defaultAnimationId,
				playback: {
					animationAssetId: animationResource.assetId,
					animationId: payload.animationId,
					currentFrameIndex: sampled.currentFrameIndex,
					elapsedSeconds: sampled.elapsedSeconds,
					frameCount: payload.frameCount,
					frameNumber: sampled.frameNumber,
					frameRateFps: DYNAMIC_ANIMATION_FRAME_RATE_FPS,
					lastDispatchedHookFrame: hookDispatch.lastDispatchedHookFrame,
					loopIteration: sampled.loopIteration,
					objectRootPose,
					partCount: payload.partCount,
					partPoses: partFrame.localPlacements.map(
						(localPlacement, partIndex) => ({
							localPlacement: interpolatePlacement(
								localPlacement,
								nextPartFrame?.localPlacements[partIndex] ?? localPlacement,
								sampled.frameAlpha,
							),
							partIndex,
						}),
					),
					startedAtSeconds,
					status: "playing",
					transformEffects: {
						activeOmega: hookDispatch.activeOmega,
					},
				},
				status: "ready",
			},
		};
		return { changed: !animationStatesEqual(record, next), record: next };
	}

	#dispatchCrossedHooks(options: {
		readonly activeOmega: DynamicEntityActiveOmegaState | null;
		readonly animationAssetId: string;
		readonly entityId: string;
		readonly frameCount: number;
		readonly payload: AnimationPayloadDto;
		readonly previousHookFrame: DynamicAnimationHookFrameKey | null;
		readonly sampled: SampledAnimationFrame;
		readonly startedAtSeconds: number;
		readonly timeSeconds: number;
	}): CrossedHookDispatchResult {
		let activeOmega = options.activeOmega;
		let lastDispatchedHookFrame = options.previousHookFrame;
		const crossedFrames = createCrossedHookFrames({
			animationAssetId: options.animationAssetId,
			entityId: options.entityId,
			frameCount: options.frameCount,
			previousHookFrame: options.previousHookFrame,
			sampled: options.sampled,
			startedAtSeconds: options.startedAtSeconds,
		});

		for (const crossedFrame of crossedFrames) {
			activeOmega = integrateActiveOmega(activeOmega, crossedFrame.timeSeconds);
			const partFrame = options.payload.partFrames[crossedFrame.frameIndex];
			if (partFrame) {
				const dispatch = this.#hookDispatcher.dispatch({
					activeOmega,
					animationAssetId: options.animationAssetId,
					entityId: options.entityId,
					frameIndex: crossedFrame.frameIndex,
					hooks: partFrame.hooks,
					loopIteration: crossedFrame.loopIteration,
					payload: options.payload,
					timeSeconds: crossedFrame.timeSeconds,
				});
				activeOmega = dispatch.activeOmega;
			}
			lastDispatchedHookFrame = {
				frameIndex: crossedFrame.frameIndex,
				loopIteration: crossedFrame.loopIteration,
			};
		}

		return {
			activeOmega: integrateActiveOmega(activeOmega, options.timeSeconds),
			lastDispatchedHookFrame,
		};
	}
}

class DynamicHookDispatcher {
	dispatch(options: {
		readonly animationAssetId: string;
		readonly activeOmega: DynamicEntityActiveOmegaState | null;
		readonly entityId: string;
		readonly frameIndex: number;
		readonly hooks: AnimationPayloadDto["partFrames"][number]["hooks"];
		readonly loopIteration: number;
		readonly payload: AnimationPayloadDto;
		readonly timeSeconds: number;
	}): HookDispatchResult {
		let activeOmega = options.activeOmega;
		for (const hook of options.hooks) {
			if (hook.payloadKind === "none") {
				continue;
			}
			if (hook.payloadKind === "set-omega") {
				activeOmega = applySetOmegaHook({
					activeOmega,
					animationAssetId: options.animationAssetId,
					animationId: options.payload.animationId,
					entityId: options.entityId,
					frameIndex: options.frameIndex,
					hook,
					loopIteration: options.loopIteration,
					timeSeconds: options.timeSeconds,
				});
				continue;
			}
		}
		return { activeOmega };
	}
}

function applySetOmegaHook(options: {
	readonly activeOmega: DynamicEntityActiveOmegaState | null;
	readonly animationAssetId: string;
	readonly animationId: number;
	readonly entityId: string;
	readonly frameIndex: number;
	readonly hook: Extract<
		AnimationHookDto,
		{ readonly payloadKind: "set-omega" }
	>;
	readonly loopIteration: number;
	readonly timeSeconds: number;
}): DynamicEntityActiveOmegaState {
	return {
		animationAssetId: options.animationAssetId,
		animationId: options.animationId,
		entityId: options.entityId,
		hookName: options.hook.hookName,
		hookType: options.hook.hookType,
		lastAppliedFrameIndex: options.frameIndex,
		lastAppliedLoopIteration: options.loopIteration,
		lastIntegratedAtSeconds: options.timeSeconds,
		objectRootRotation:
			options.activeOmega?.objectRootRotation ?? IDENTITY_PLACEMENT.orientation,
		omega: options.hook.payload.omega,
		rawPayloadBytes: options.hook.rawPayloadBytes,
	};
}

function integrateActiveOmega(
	activeOmega: DynamicEntityActiveOmegaState | null,
	timeSeconds: number,
): DynamicEntityActiveOmegaState | null {
	if (activeOmega === null) {
		return null;
	}
	const deltaSeconds = Math.max(
		0,
		timeSeconds - activeOmega.lastIntegratedAtSeconds,
	);
	if (deltaSeconds === 0) {
		return activeOmega;
	}
	return {
		...activeOmega,
		lastIntegratedAtSeconds: timeSeconds,
		objectRootRotation: integrateOmegaRotation(
			activeOmega.objectRootRotation,
			activeOmega.omega,
			deltaSeconds,
		),
	};
}

function integrateOmegaRotation(
	rotation: QuaternionDto,
	omega: DynamicEntityActiveOmegaState["omega"],
	deltaSeconds: number,
): QuaternionDto {
	const speed = Math.hypot(omega.x, omega.y, omega.z);
	if (speed === 0) {
		return rotation;
	}
	// Retail static-object animation applies SetOmega through Frame::grotate once
	// per animation update, not as a raw radians-per-second velocity.
	const angle = speed * deltaSeconds * DYNAMIC_ANIMATION_FRAME_RATE_FPS;
	const halfAngle = angle / 2;
	const sinHalfAngle = Math.sin(halfAngle);
	const deltaRotation = normalizeQuaternion({
		w: Math.cos(halfAngle),
		x: (omega.x / speed) * sinHalfAngle,
		y: (omega.y / speed) * sinHalfAngle,
		z: (omega.z / speed) * sinHalfAngle,
	});
	return normalizeQuaternion(multiplyQuaternions(rotation, deltaRotation));
}

function multiplyQuaternions(
	left: QuaternionDto,
	right: QuaternionDto,
): QuaternionDto {
	return {
		w:
			left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
		x:
			left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
		y:
			left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
		z:
			left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
	};
}

function normalizeQuaternion(quaternion: QuaternionDto): QuaternionDto {
	const length = Math.hypot(
		quaternion.w,
		quaternion.x,
		quaternion.y,
		quaternion.z,
	);
	if (length === 0) {
		return IDENTITY_PLACEMENT.orientation;
	}
	return {
		w: quaternion.w / length,
		x: quaternion.x / length,
		y: quaternion.y / length,
		z: quaternion.z / length,
	};
}

function interpolatePlacement(
	current: PlacementTransformDto,
	next: PlacementTransformDto,
	alpha: number,
): PlacementTransformDto {
	if (alpha === 0) {
		return current;
	}
	return {
		orientation: slerpQuaternion(current.orientation, next.orientation, alpha),
		origin: {
			x: lerp(current.origin.x, next.origin.x, alpha),
			y: lerp(current.origin.y, next.origin.y, alpha),
			z: lerp(current.origin.z, next.origin.z, alpha),
		},
	};
}

function slerpQuaternion(
	current: QuaternionDto,
	next: QuaternionDto,
	alpha: number,
): QuaternionDto {
	const left = normalizeQuaternion(current);
	let right = normalizeQuaternion(next);
	let dot =
		left.w * right.w + left.x * right.x + left.y * right.y + left.z * right.z;
	if (dot < 0) {
		right = {
			w: -right.w,
			x: -right.x,
			y: -right.y,
			z: -right.z,
		};
		dot = -dot;
	}
	if (dot > 0.9995) {
		return normalizeQuaternion({
			w: lerp(left.w, right.w, alpha),
			x: lerp(left.x, right.x, alpha),
			y: lerp(left.y, right.y, alpha),
			z: lerp(left.z, right.z, alpha),
		});
	}
	const theta = Math.acos(Math.min(Math.max(dot, -1), 1));
	const sinTheta = Math.sin(theta);
	const currentScale = Math.sin((1 - alpha) * theta) / sinTheta;
	const nextScale = Math.sin(alpha * theta) / sinTheta;
	return normalizeQuaternion({
		w: left.w * currentScale + right.w * nextScale,
		x: left.x * currentScale + right.x * nextScale,
		y: left.y * currentScale + right.y * nextScale,
		z: left.z * currentScale + right.z * nextScale,
	});
}

function lerp(current: number, next: number, alpha: number): number {
	return current + (next - current) * alpha;
}

function sampleAnimationFrame(options: {
	readonly frameCount: number;
	readonly startedAtSeconds: number;
	readonly timeSeconds: number;
}): SampledAnimationFrame {
	const elapsedSeconds = Math.max(
		0,
		options.timeSeconds - options.startedAtSeconds,
	);
	const frameNumber = elapsedSeconds * DYNAMIC_ANIMATION_FRAME_RATE_FPS;
	const absoluteFrameIndex = Math.floor(frameNumber);
	const currentFrameIndex = absoluteFrameIndex % options.frameCount;
	return {
		absoluteFrameIndex,
		currentFrameIndex,
		elapsedSeconds,
		frameAlpha: frameNumber - absoluteFrameIndex,
		frameNumber,
		loopIteration: Math.floor(absoluteFrameIndex / options.frameCount),
		nextFrameIndex: createNextPoseFrameIndex(
			currentFrameIndex,
			options.frameCount,
		),
	};
}

function createNextPoseFrameIndex(
	currentFrameIndex: number,
	frameCount: number,
): number {
	const nextFrameIndex = currentFrameIndex + 1;
	// Authored part identities are not guaranteed to be spatially continuous
	// across the loop seam. Windmill animation 0x0300061b is the first concrete
	// case: frame 59 visually cycles to frame 0, but same-index blade parts do
	// not form valid interpolation pairs across that boundary.
	return nextFrameIndex < frameCount ? nextFrameIndex : currentFrameIndex;
}

function sampleObjectRootPose(options: {
	readonly currentFrameIndex: number;
	readonly frameAlpha: number;
	readonly nextFrameIndex: number;
	readonly payload: AnimationPayloadDto;
}): PlacementTransformDto {
	if (options.payload.objectPositionFrames.length === 0) {
		return IDENTITY_PLACEMENT;
	}
	const current =
		options.payload.objectPositionFrames[options.currentFrameIndex] ??
		IDENTITY_PLACEMENT;
	if (
		options.payload.objectPositionFrames.length !== options.payload.frameCount
	) {
		return current;
	}
	return interpolatePlacement(
		current,
		options.payload.objectPositionFrames[options.nextFrameIndex] ?? current,
		options.frameAlpha,
	);
}

function createCrossedHookFrames(options: {
	readonly animationAssetId: string;
	readonly entityId: string;
	readonly frameCount: number;
	readonly previousHookFrame: DynamicAnimationHookFrameKey | null;
	readonly sampled: SampledAnimationFrame;
	readonly startedAtSeconds: number;
}): readonly CrossedHookFrame[] {
	const startAbsoluteFrameIndex =
		options.previousHookFrame === null
			? options.sampled.absoluteFrameIndex
			: createAbsoluteFrameIndex(
					options.previousHookFrame,
					options.frameCount,
				) + 1;
	if (startAbsoluteFrameIndex > options.sampled.absoluteFrameIndex) {
		return [];
	}
	const crossedFrameCount =
		options.sampled.absoluteFrameIndex - startAbsoluteFrameIndex + 1;
	const droppedFrameCount = Math.max(
		0,
		crossedFrameCount - MAX_CROSSED_HOOK_FRAMES_PER_UPDATE,
	);
	if (droppedFrameCount > 0) {
		console.warn("[holtburger-3d][dynamic-animation-hook-catchup-truncated]", {
			animationAssetId: options.animationAssetId,
			dispatchedFrameCount: MAX_CROSSED_HOOK_FRAMES_PER_UPDATE,
			droppedFrameCount,
			entityId: options.entityId,
			frameCount: options.frameCount,
		});
	}
	const firstFrameIndex = startAbsoluteFrameIndex + droppedFrameCount;
	return Array.from(
		{
			length: options.sampled.absoluteFrameIndex - firstFrameIndex + 1,
		},
		(_, offset): CrossedHookFrame => {
			const absoluteFrameIndex = firstFrameIndex + offset;
			return {
				absoluteFrameIndex,
				frameIndex: absoluteFrameIndex % options.frameCount,
				loopIteration: Math.floor(absoluteFrameIndex / options.frameCount),
				timeSeconds:
					options.startedAtSeconds +
					absoluteFrameIndex / DYNAMIC_ANIMATION_FRAME_RATE_FPS,
			};
		},
	);
}

function createAbsoluteFrameIndex(
	frame: DynamicAnimationHookFrameKey,
	frameCount: number,
): number {
	return frame.loopIteration * frameCount + frame.frameIndex;
}

function failZeroFrameAnimation(
	record: DynamicEntityRecord,
	animationAssetId: string,
	payload: AnimationPayloadDto,
): PlaybackUpdate {
	const next: DynamicEntityRecord = {
		...record,
		animation: {
			defaultAnimationId: record.animation.defaultAnimationId,
			playback: {
				animationAssetId,
				animationId: payload.animationId,
				reason: "zero-frame",
				status: "failed",
			},
			status: "failed",
		},
	};
	return { changed: !animationStatesEqual(record, next), record: next };
}

function animationStatesEqual(
	left: DynamicEntityRecord,
	right: DynamicEntityRecord,
): boolean {
	return sameAnimationState(left.animation, right.animation);
}

function sameAnimationState(
	left: DynamicEntityAnimationState,
	right: DynamicEntityAnimationState,
): boolean {
	return (
		left.defaultAnimationId === right.defaultAnimationId &&
		left.status === right.status &&
		sameAnimationPlayback(left.playback, right.playback)
	);
}

function sameAnimationPlayback(
	left: DynamicEntityAnimationPlaybackState,
	right: DynamicEntityAnimationPlaybackState,
): boolean {
	if (left.status !== right.status) {
		return false;
	}
	if (
		left.status === "pending-resource" &&
		right.status === "pending-resource"
	) {
		return true;
	}
	if (left.status === "not-required" && right.status === "not-required") {
		return left.reason === right.reason;
	}
	if (left.status === "failed" && right.status === "failed") {
		return (
			left.animationAssetId === right.animationAssetId &&
			left.animationId === right.animationId &&
			left.reason === right.reason
		);
	}
	if (left.status !== "playing" || right.status !== "playing") {
		return false;
	}
	return (
		left.animationAssetId === right.animationAssetId &&
		left.animationId === right.animationId &&
		left.currentFrameIndex === right.currentFrameIndex &&
		left.elapsedSeconds === right.elapsedSeconds &&
		left.frameCount === right.frameCount &&
		left.frameNumber === right.frameNumber &&
		left.frameRateFps === right.frameRateFps &&
		sameHookFrame(
			left.lastDispatchedHookFrame,
			right.lastDispatchedHookFrame,
		) &&
		left.loopIteration === right.loopIteration &&
		samePlacement(left.objectRootPose, right.objectRootPose) &&
		left.partCount === right.partCount &&
		samePartPoses(left.partPoses, right.partPoses) &&
		left.startedAtSeconds === right.startedAtSeconds &&
		sameActiveOmega(
			left.transformEffects.activeOmega,
			right.transformEffects.activeOmega,
		)
	);
}

function sameHookFrame(
	left: DynamicAnimationHookFrameKey | null,
	right: DynamicAnimationHookFrameKey | null,
): boolean {
	if (left === null || right === null) {
		return left === right;
	}
	return (
		left.frameIndex === right.frameIndex &&
		left.loopIteration === right.loopIteration
	);
}

function samePartPoses(
	left: PlayingPlayback["partPoses"],
	right: PlayingPlayback["partPoses"],
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(leftPose, index) =>
				leftPose.partIndex === right[index]?.partIndex &&
				samePlacement(leftPose.localPlacement, right[index]?.localPlacement),
		)
	);
}

function samePlacement(
	left: PlacementTransformDto,
	right: PlacementTransformDto | undefined,
): boolean {
	return (
		right !== undefined &&
		left.origin.x === right.origin.x &&
		left.origin.y === right.origin.y &&
		left.origin.z === right.origin.z &&
		left.orientation.w === right.orientation.w &&
		left.orientation.x === right.orientation.x &&
		left.orientation.y === right.orientation.y &&
		left.orientation.z === right.orientation.z
	);
}

function sameActiveOmega(
	left: DynamicEntityActiveOmegaState | null,
	right: DynamicEntityActiveOmegaState | null,
): boolean {
	if (left === null || right === null) {
		return left === right;
	}
	return (
		left.animationAssetId === right.animationAssetId &&
		left.animationId === right.animationId &&
		left.entityId === right.entityId &&
		left.hookName === right.hookName &&
		left.hookType === right.hookType &&
		left.lastAppliedFrameIndex === right.lastAppliedFrameIndex &&
		left.lastAppliedLoopIteration === right.lastAppliedLoopIteration &&
		left.lastIntegratedAtSeconds === right.lastIntegratedAtSeconds &&
		sameQuaternion(left.objectRootRotation, right.objectRootRotation) &&
		left.omega.x === right.omega.x &&
		left.omega.y === right.omega.y &&
		left.omega.z === right.omega.z &&
		sameNumberArray(left.rawPayloadBytes, right.rawPayloadBytes)
	);
}

function sameQuaternion(left: QuaternionDto, right: QuaternionDto): boolean {
	return (
		left.w === right.w &&
		left.x === right.x &&
		left.y === right.y &&
		left.z === right.z
	);
}

function sameNumberArray(
	left: readonly number[],
	right: readonly number[],
): boolean {
	return (
		left.length === right.length &&
		left.every((leftValue, index) => leftValue === right[index])
	);
}
