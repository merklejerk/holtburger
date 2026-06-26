import type {
	AnimationPayloadDto,
	PlacementTransformDto,
} from "../host/contracts";
import type {
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
		const hookIssues = shouldDispatchHooks(previousHookFrame, hookFrame)
			? this.#hookDispatcher.dispatch({
					animationAssetId: animationResource.assetId,
					entityId: record.id,
					frameIndex: sampled.currentFrameIndex,
					hooks: partFrame.hooks,
					loopIteration: sampled.loopIteration,
					payload,
				})
			: [];
		const diagnostics = appendUniqueDiagnostics(record.diagnostics, [
			...(objectFrameDiagnostic === null ? [] : [objectFrameDiagnostic]),
			...hookIssues,
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
						hookIssues.length > 0 || partFrame.hooks.length > 0
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
		readonly entityId: string;
		readonly frameIndex: number;
		readonly hooks: AnimationPayloadDto["partFrames"][number]["hooks"];
		readonly loopIteration: number;
		readonly payload: AnimationPayloadDto;
	}): readonly DynamicEntityIssue[] {
		return options.hooks.flatMap((hook): readonly DynamicEntityIssue[] => {
			if (hook.payloadKind === "none") {
				return [];
			}
			return [
				{
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
				},
			];
		});
	}
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
