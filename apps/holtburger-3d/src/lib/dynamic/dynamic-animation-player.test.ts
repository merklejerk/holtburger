import { describe, expect, it } from "vitest";
import type {
	AnimationPayloadDto,
	PlacementTransformDto,
} from "../host/contracts";
import type { DynamicEntityRecord } from "./contracts";
import { DynamicAnimationPlayer } from "./dynamic-animation-player";

describe("dynamic animation player", () => {
	it("samples object root and all part poses from the setup animation", () => {
		const player = new DynamicAnimationPlayer();
		const record = createRecord({
			payload: createAnimationPayload({
				frameCount: 2,
				objectPositionFrames: [
					createPlacement({ x: 0, y: 0, z: 0 }),
					createPlacement({ x: 10, y: 0, z: 0 }),
				],
				partCount: 5,
			}),
		});

		const started = player.update(record, 10);
		const advanced = player.update(started.record, 10.04);

		expect(started.record.animation.playback).toMatchObject({
			currentFrameIndex: 0,
			frameRateFps: 30,
			objectRootPose: createPlacement({ x: 0, y: 0, z: 0 }),
			partCount: 5,
		});
		expect(advanced.record.animation.playback).toMatchObject({
			currentFrameIndex: 1,
			objectRootPose: createPlacement({ x: 10, y: 0, z: 0 }),
			partPoses: [
				{
					localPlacement: createPlacement({ x: 100, y: 0, z: 0 }),
					partIndex: 0,
				},
				{
					localPlacement: createPlacement({ x: 101, y: 0, z: 0 }),
					partIndex: 1,
				},
				{
					localPlacement: createPlacement({ x: 102, y: 0, z: 0 }),
					partIndex: 2,
				},
				{
					localPlacement: createPlacement({ x: 103, y: 0, z: 0 }),
					partIndex: 3,
				},
				{
					localPlacement: createPlacement({ x: 104, y: 0, z: 0 }),
					partIndex: 4,
				},
			],
		});
	});

	it("uses identity object root pose when object position frames are empty", () => {
		const player = new DynamicAnimationPlayer();
		const update = player.update(
			createRecord({
				payload: createAnimationPayload({
					frameCount: 1,
					objectPositionFrames: [],
					partCount: 1,
				}),
			}),
			0,
		);

		expect(update.record.animation.playback).toMatchObject({
			objectRootPose: createPlacement({ x: 0, y: 0, z: 0 }),
		});
		expect(update.record.diagnostics).toEqual([]);
	});

	it("diagnoses malformed object position frame counts without stopping playback", () => {
		const player = new DynamicAnimationPlayer();
		const update = player.update(
			createRecord({
				payload: createAnimationPayload({
					frameCount: 2,
					objectPositionFrames: [createPlacement({ x: 1, y: 0, z: 0 })],
					partCount: 1,
				}),
			}),
			0,
		);

		expect(update.record.animation.playback).toMatchObject({
			currentFrameIndex: 0,
			status: "playing",
		});
		expect(update.record.diagnostics).toMatchObject([
			{
				expectedFrameCount: 2,
				kind: "dynamic-animation-invalid",
				objectPositionFrameCount: 1,
				reason: "malformed-object-position-frames",
			},
		]);
	});

	it("diagnoses zero-frame animations explicitly", () => {
		const player = new DynamicAnimationPlayer();
		const update = player.update(
			createRecord({
				payload: createAnimationPayload({
					frameCount: 0,
					objectPositionFrames: [],
					partCount: 0,
				}),
			}),
			0,
		);

		expect(update.record.animation).toMatchObject({
			playback: {
				reason: "zero-frame",
				status: "failed",
			},
			status: "failed",
		});
		expect(update.record.diagnostics).toMatchObject([
			{
				kind: "dynamic-animation-invalid",
				reason: "zero-frame",
			},
		]);
	});

	it("does not emit unsupported-hook diagnostics for hook-free frames", () => {
		const player = new DynamicAnimationPlayer();
		const update = player.update(
			createRecord({
				payload: createAnimationPayload({
					frameCount: 1,
					objectPositionFrames: [],
					partCount: 1,
				}),
			}),
			0,
		);

		expect(
			update.record.diagnostics.filter(
				(issue) => issue.kind === "dynamic-animation-hook-unsupported",
			),
		).toEqual([]);
	});

	it("dispatches unsupported hook diagnostics once per sampled frame and loop", () => {
		const player = new DynamicAnimationPlayer();
		const payload = createAnimationPayload({
			frameCount: 1,
			hooks: [
				{
					direction: 0,
					directionName: "Both",
					hookName: "SetOmega",
					hookType: 22,
					payload: null,
					payloadKind: "raw",
					rawPayloadBytes: [0, 1, 2, 3],
				},
			],
			objectPositionFrames: [],
			partCount: 1,
		});

		const first = player.update(createRecord({ payload }), 0);
		const duplicate = player.update(first.record, 0);
		const looped = player.update(duplicate.record, 1 / 30);

		expect(unsupportedHookIssues(first.record)).toHaveLength(1);
		expect(unsupportedHookIssues(duplicate.record)).toHaveLength(1);
		expect(unsupportedHookIssues(looped.record)).toMatchObject([
			{
				animationAssetId: "animation/0300061b",
				entityId: "dynamic-test-entity",
				frameIndex: 0,
				hookName: "SetOmega",
				hookType: 22,
				loopIteration: 0,
				payloadKind: "raw",
				skippedEffect: "unsupported animation hook effect",
			},
			{
				frameIndex: 0,
				loopIteration: 1,
			},
		]);
	});
});

function unsupportedHookIssues(record: DynamicEntityRecord) {
	return record.diagnostics.filter(
		(issue) => issue.kind === "dynamic-animation-hook-unsupported",
	);
}

function createRecord(options: {
	readonly payload: AnimationPayloadDto;
}): DynamicEntityRecord {
	const seed = {
		classificationReason: "setup-default-animation" as const,
		defaultAnimationId: 0x0300061b,
		domain: "outdoor-buildings",
		landblockId: 0xda55ffff,
		localPlacement: createPlacement({ x: 7, y: 8, z: 9 }),
		object: {
			instanceId: "windmill-0",
			kind: "static-object-instance" as const,
			landblockId: 0xda55ffff,
			objectKind: "building" as const,
		},
		setupModelId: 0x020003e5,
		source: {
			kind: "static-object-source" as const,
			sourceAssetKind: "setup-model" as const,
			sourceDid: 0x020003e5,
		},
		sourceAssetId: "setup-model/020003e5",
		sourceResidence: {
			kind: "landblock-source" as const,
			landblockId: 0xda55ffff,
			source: "outdoor" as const,
		},
		sourceScale: { x: 1, y: 1, z: 1 },
	};
	return {
		animation: {
			defaultAnimationId: 0x0300061b,
			playback: {
				status: "pending-resource",
			},
			status: "ready",
		},
		baseTransform: {
			baseLocalPlacement: seed.localPlacement,
			sourceScale: seed.sourceScale,
		},
		bounds: {
			currentBounds: null,
			indexed: false,
		},
		diagnostics: [],
		effectiveResidence: {
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		},
		id: "dynamic-test-entity",
		provenance: {
			kind: "static-authored-outdoor",
			owner: {
				domain: "outdoor-buildings",
				scopeKey: "landblock:da55ffff",
				workId: "1:landblock:da55ffff:outdoor-buildings",
			},
			sourceScopeKey: "outdoor-buildings:landblock:da55ffff",
		},
		renderability: {
			reasons: [],
			status: "non-renderable",
		},
		resources: {
			required: ["setup-model", "animation"],
			setupAnimation: {
				animation: {
					assetId: "animation/0300061b",
					payload: options.payload,
				},
				animationKey: {
					id: 0x0300061b,
					kind: "animation",
				},
				setupModelKey: {
					id: 0x020003e5,
					kind: "setup-model",
				},
				status: "ready",
			},
			status: "setup-animation-ready",
			visual: {
				status: "pending",
			},
		},
		sourceResidence: {
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		},
		sourceSeed: seed,
	};
}

function createAnimationPayload(options: {
	readonly frameCount: number;
	readonly hooks?: AnimationPayloadDto["partFrames"][number]["hooks"];
	readonly objectPositionFrames: readonly PlacementTransformDto[];
	readonly partCount: number;
}): AnimationPayloadDto {
	return {
		animationAssetId: "animation/0300061b",
		animationId: 0x0300061b,
		dependencies: {},
		flags: 0,
		frameCount: options.frameCount,
		kind: "animation",
		objectPositionFrames: options.objectPositionFrames,
		partCount: options.partCount,
		partFrames: Array.from({ length: options.frameCount }, (_, frameIndex) => ({
			frameIndex,
			hooks: options.hooks ?? [],
			localPlacements: Array.from(
				{ length: options.partCount },
				(_, partIndex) =>
					createPlacement({ x: frameIndex * 100 + partIndex, y: 0, z: 0 }),
			),
		})),
		provenance: createProvenance(),
		residencyKind: "unknown",
		sourceAssetKind: "animation",
	};
}

function createPlacement(origin: {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}): PlacementTransformDto {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin,
	};
}

function createProvenance() {
	return {
		detail: null,
		errorCode: null,
		source: "repo-local-hba" as const,
		sourceAssetKind: "animation",
	};
}
