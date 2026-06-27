import type {
	AnimationPayloadDto,
	PlacementTransformDto,
} from "../host/contracts";
import type {
	DynamicEntityActiveOmegaState,
	DynamicAnimationHookFrameKey,
	DynamicEntityIssue,
	DynamicEntityRecord,
} from "./contracts";

const DEFAULT_FRAME_RATE_FPS = 30;
const IDENTITY_PLACEMENT: PlacementTransformDto = {
	orientation: { w: 1, x: 0, y: 0, z: 0 },
	origin: { x: 0, y: 0, z: 0 },
};

interface PlaybackUpdate {
	readonly changed: boolean;
	readonly record: DynamicEntityRecord;
}

interface SampledAnimationFrame {
	readonly currentFrameIndex: number;
	readonly elapsedSeconds: number;
	readonly frameNumber: number;
	readonly loopIteration: number;
}

type AnimationHookDto =
	AnimationPayloadDto["partFrames"][number]["hooks"][number];
type QuaternionDto = PlacementTransformDto["orientation"];

interface HookDispatchResult {
	readonly activeOmega: DynamicEntityActiveOmegaState | null;
	readonly issues: readonly DynamicEntityIssue[];
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
		const objectFrameDiagnostic = createObjectPositionFrameDiagnostic({
			animationAssetId: animationResource.assetId,
			payload,
		});
		const objectRootPose = sampleObjectRootPose(
			payload,
			sampled.currentFrameIndex,
		);
		const partFrame = payload.partFrames[sampled.currentFrameIndex];
		const hookFrame: DynamicAnimationHookFrameKey = {
			frameIndex: sampled.currentFrameIndex,
			loopIteration: sampled.loopIteration,
		};
		const previousHookFrame =
			record.animation.playback.status === "playing"
				? record.animation.playback.lastDispatchedHookFrame
				: null;
		const previousActiveOmega =
			record.animation.playback.status === "playing" &&
			record.animation.playback.animationAssetId === animationResource.assetId
				? record.animation.playback.transformEffects.activeOmega
				: null;
		const integratedActiveOmega = integrateActiveOmega(
			previousActiveOmega,
			timeSeconds,
		);
		const hookDispatch = shouldDispatchHooks(previousHookFrame, hookFrame)
			? this.#hookDispatcher.dispatch({
					activeOmega: integratedActiveOmega,
					animationAssetId: animationResource.assetId,
					entityId: record.id,
					frameIndex: sampled.currentFrameIndex,
					hooks: partFrame.hooks,
					loopIteration: sampled.loopIteration,
					payload,
					timeSeconds,
				})
			: { activeOmega: integratedActiveOmega, issues: [] };
		const diagnostics = appendUniqueDiagnostics(record.diagnostics, [
			...(objectFrameDiagnostic === null ? [] : [objectFrameDiagnostic]),
			...hookDispatch.issues,
		]);
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
					frameRateFps: DEFAULT_FRAME_RATE_FPS,
					lastDispatchedHookFrame:
						hookDispatch.issues.length > 0 || partFrame.hooks.length > 0
							? hookFrame
							: previousHookFrame,
					loopIteration: sampled.loopIteration,
					objectRootPose,
					partCount: payload.partCount,
					partPoses: partFrame.localPlacements.map(
						(localPlacement, partIndex) => ({
							localPlacement,
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
			diagnostics,
		};
		return { changed: !samePlaybackState(record, next), record: next };
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
		const issues: DynamicEntityIssue[] = [];
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
			issues.push({
				animationAssetId: options.animationAssetId,
				animationId: options.payload.animationId,
				entityId: options.entityId,
				frameIndex: options.frameIndex,
				hookName: hook.hookName,
				hookType: hook.hookType,
				kind: "dynamic-animation-hook-unsupported",
				loopIteration: options.loopIteration,
				payloadKind: hook.payloadKind,
				skippedEffect: "unsupported animation hook effect",
			});
		}
		return { activeOmega, issues };
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
	const angle = speed * deltaSeconds * DEFAULT_FRAME_RATE_FPS;
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

function sampleAnimationFrame(options: {
	readonly frameCount: number;
	readonly startedAtSeconds: number;
	readonly timeSeconds: number;
}): SampledAnimationFrame {
	const elapsedSeconds = Math.max(
		0,
		options.timeSeconds - options.startedAtSeconds,
	);
	const frameNumber = elapsedSeconds * DEFAULT_FRAME_RATE_FPS;
	const absoluteFrameIndex = Math.floor(frameNumber);
	return {
		currentFrameIndex: absoluteFrameIndex % options.frameCount,
		elapsedSeconds,
		frameNumber,
		loopIteration: Math.floor(absoluteFrameIndex / options.frameCount),
	};
}

function sampleObjectRootPose(
	payload: AnimationPayloadDto,
	frameIndex: number,
): PlacementTransformDto {
	if (payload.objectPositionFrames.length === 0) {
		return IDENTITY_PLACEMENT;
	}
	return payload.objectPositionFrames[frameIndex] ?? IDENTITY_PLACEMENT;
}

function createObjectPositionFrameDiagnostic(options: {
	readonly animationAssetId: string;
	readonly payload: AnimationPayloadDto;
}): DynamicEntityIssue | null {
	if (
		options.payload.objectPositionFrames.length === 0 ||
		options.payload.objectPositionFrames.length === options.payload.frameCount
	) {
		return null;
	}
	return {
		animationAssetId: options.animationAssetId,
		animationId: options.payload.animationId,
		expectedFrameCount: options.payload.frameCount,
		kind: "dynamic-animation-invalid",
		message:
			"Animation object position frame count does not match animation frame count.",
		objectPositionFrameCount: options.payload.objectPositionFrames.length,
		reason: "malformed-object-position-frames",
	};
}

function failZeroFrameAnimation(
	record: DynamicEntityRecord,
	animationAssetId: string,
	payload: AnimationPayloadDto,
): PlaybackUpdate {
	const issue: DynamicEntityIssue = {
		animationAssetId,
		animationId: payload.animationId,
		expectedFrameCount: 1,
		kind: "dynamic-animation-invalid",
		message: "Animation payload has no frames to sample.",
		objectPositionFrameCount: payload.objectPositionFrames.length,
		reason: "zero-frame",
	};
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
		diagnostics: appendUniqueDiagnostics(record.diagnostics, [issue]),
	};
	return { changed: !samePlaybackState(record, next), record: next };
}

function shouldDispatchHooks(
	previous: DynamicAnimationHookFrameKey | null,
	next: DynamicAnimationHookFrameKey,
): boolean {
	return (
		previous === null ||
		previous.frameIndex !== next.frameIndex ||
		previous.loopIteration !== next.loopIteration
	);
}

function appendUniqueDiagnostics(
	current: readonly DynamicEntityIssue[],
	additions: readonly DynamicEntityIssue[],
): readonly DynamicEntityIssue[] {
	const diagnostics = [...current];
	const keys = new Set(current.map(createDiagnosticKey));
	for (const issue of additions) {
		const key = createDiagnosticKey(issue);
		if (!keys.has(key)) {
			keys.add(key);
			diagnostics.push(issue);
		}
	}
	return diagnostics;
}

function createDiagnosticKey(issue: DynamicEntityIssue): string {
	if (issue.kind === "dynamic-animation-invalid") {
		return [
			issue.kind,
			issue.animationAssetId,
			issue.reason,
			issue.expectedFrameCount,
			issue.objectPositionFrameCount ?? "null",
		].join(":");
	}
	if (issue.kind === "dynamic-animation-hook-unsupported") {
		return [
			issue.kind,
			issue.entityId,
			issue.animationAssetId,
			issue.frameIndex,
			issue.loopIteration,
			issue.hookType,
			issue.hookName,
			issue.payloadKind,
		].join(":");
	}
	return JSON.stringify(issue);
}

function samePlaybackState(
	left: DynamicEntityRecord,
	right: DynamicEntityRecord,
): boolean {
	return (
		JSON.stringify(left.animation) === JSON.stringify(right.animation) &&
		left.diagnostics.length === right.diagnostics.length
	);
}
