import { describe, expect, it, vi } from "vitest";
import type {
	AnimationPayloadDto,
	PlacementTransformDto,
} from "../host/contracts";
import type { DynamicEntityRecord } from "./contracts";
import {
	DYNAMIC_ANIMATION_FRAME_RATE_FPS,
	DynamicAnimationPlayer,
} from "./dynamic-animation-player";

const TEST_SET_OMEGA_HOOK_TYPE = 22;
const TEST_SET_OMEGA_Z = -0.03836006671190262;
const TEST_SET_OMEGA_RAW_PAYLOAD_BYTES = [
	0, 0, 0, 0, 0, 0, 0, 0, 0x72, 0x20, 0x1d, 0xbd,
] as const;

describe("dynamic animation player", () => {
	it("interpolates object root and part poses inside the authored frame range", () => {
		const player = new DynamicAnimationPlayer();
		const record = createRecord({
			payload: createAnimationPayload({
				frameCount: 3,
				objectPositionFrames: [
					createPlacement({ x: 0, y: 0, z: 0 }),
					createPlacement({ x: 10, y: 0, z: 0 }),
					createPlacement({ x: 20, y: 0, z: 0 }),
				],
				partCount: 5,
			}),
		});

		const started = player.update(record, 10);
		const advanced = player.update(
			started.record,
			10 + 1.5 / DYNAMIC_ANIMATION_FRAME_RATE_FPS,
		);

		expect(started.record.animation.playback).toMatchObject({
			currentFrameIndex: 0,
			frameRateFps: DYNAMIC_ANIMATION_FRAME_RATE_FPS,
			objectRootPose: createPlacement({ x: 0, y: 0, z: 0 }),
			partCount: 5,
		});
		if (advanced.record.animation.playback.status !== "playing") {
			throw new Error("expected playing playback");
		}
		expect(advanced.record.animation.playback.currentFrameIndex).toBe(1);
		expect(
			advanced.record.animation.playback.objectRootPose.origin.x,
		).toBeCloseTo(15, 7);
		expect(
			advanced.record.animation.playback.partPoses.map((pose) => ({
				partIndex: pose.partIndex,
				x: pose.localPlacement.origin.x,
			})),
		).toEqual([
			{ partIndex: 0, x: expect.closeTo(150, 7) },
			{ partIndex: 1, x: expect.closeTo(151, 7) },
			{ partIndex: 2, x: expect.closeTo(152, 7) },
			{ partIndex: 3, x: expect.closeTo(153, 7) },
			{ partIndex: 4, x: expect.closeTo(154, 7) },
		]);
	});

	it("does not stringify playback state while detecting duplicate updates", () => {
		const player = new DynamicAnimationPlayer();
		const started = player.update(
			createRecord({
				payload: createAnimationPayload({
					frameCount: 1,
					objectPositionFrames: [],
					partCount: 1,
				}),
			}),
			0,
		);
		const stringify = vi.spyOn(JSON, "stringify").mockImplementation(() => {
			throw new Error("Playback hot-path equality must not stringify.");
		});
		try {
			const duplicate = player.update(started.record, 0);
			expect(duplicate.changed).toBe(false);
		} finally {
			stringify.mockRestore();
		}
	});

	it("holds the final authored pose instead of interpolating across the loop seam", () => {
		const player = new DynamicAnimationPlayer();
		const record = createRecord({
			payload: createAnimationPayload({
				frameCount: 2,
				objectPositionFrames: [
					createPlacement({ x: 0, y: 0, z: 0 }),
					createPlacement({ x: 10, y: 0, z: 0 }),
				],
				partCount: 2,
			}),
		});

		const started = player.update(record, 0);
		const update = player.update(
			started.record,
			1.5 / DYNAMIC_ANIMATION_FRAME_RATE_FPS,
		);

		if (update.record.animation.playback.status !== "playing") {
			throw new Error("expected playing playback");
		}
		expect(update.record.animation.playback.currentFrameIndex).toBe(1);
		expect(update.record.animation.playback.objectRootPose.origin.x).toBe(10);
		expect(
			update.record.animation.playback.partPoses.map((pose) => ({
				partIndex: pose.partIndex,
				x: pose.localPlacement.origin.x,
			})),
		).toEqual([
			{ partIndex: 0, x: 100 },
			{ partIndex: 1, x: 101 },
		]);
	});

	it("slerps object root orientation between authored frames", () => {
		const player = new DynamicAnimationPlayer();
		const started = player.update(
			createRecord({
				payload: createAnimationPayload({
					frameCount: 2,
					objectPositionFrames: [
						createPlacement({ x: 0, y: 0, z: 0 }),
						createPlacement({
							orientation: { w: 0, x: 0, y: 0, z: 1 },
							x: 0,
							y: 0,
							z: 0,
						}),
					],
					partCount: 1,
				}),
			}),
			0,
		);
		const update = player.update(
			started.record,
			0.5 / DYNAMIC_ANIMATION_FRAME_RATE_FPS,
		);

		if (update.record.animation.playback.status !== "playing") {
			throw new Error("expected playing playback");
		}
		expect(
			update.record.animation.playback.objectRootPose.orientation.w,
		).toBeCloseTo(Math.SQRT1_2, 7);
		expect(
			update.record.animation.playback.objectRootPose.orientation.z,
		).toBeCloseTo(Math.SQRT1_2, 7);
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
			transformEffects: {
				activeOmega: null,
			},
		});
	});

	it("samples malformed object position frame counts without stopping playback", () => {
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
	});

	it("marks zero-frame animations as failed playback", () => {
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
	});

	it("stores and integrates SetOmega as active object-root transform state", () => {
		const player = new DynamicAnimationPlayer();
		const payload = createAnimationPayload({
			frameCount: 7,
			hooksByFrame: [[createSetOmegaHook()]],
			objectPositionFrames: [],
			partCount: 2,
		});

		const started = player.update(createRecord({ payload }), 0);
		const advanced = player.update(started.record, 0.1);

		expect(started.record.animation.playback).toMatchObject({
			status: "playing",
			transformEffects: {
				activeOmega: {
					animationAssetId: "animation/0300061b",
					animationId: 0x0300061b,
					entityId: "dynamic-test-entity",
					hookName: "SetOmega",
					hookType: TEST_SET_OMEGA_HOOK_TYPE,
					lastAppliedFrameIndex: 0,
					lastAppliedLoopIteration: 0,
					omega: { x: 0, y: 0, z: TEST_SET_OMEGA_Z },
					rawPayloadBytes: TEST_SET_OMEGA_RAW_PAYLOAD_BYTES,
				},
			},
		});
		if (advanced.record.animation.playback.status !== "playing") {
			throw new Error("expected playing playback");
		}
		expect(
			advanced.record.animation.playback.transformEffects.activeOmega
				?.objectRootRotation.z,
		).toBeLessThan(0);
		expect(
			advanced.record.animation.playback.transformEffects.activeOmega
				?.lastAppliedFrameIndex,
		).toBe(0);
	});

	it("does not reset accumulated SetOmega rotation when the same frame-0 hook loops", () => {
		const player = new DynamicAnimationPlayer();
		const payload = createAnimationPayload({
			frameCount: 1,
			hooks: [createSetOmegaHook()],
			objectPositionFrames: [],
			partCount: 2,
		});

		const started = player.update(createRecord({ payload }), 0);
		const firstLoop = player.update(started.record, 1 / 30);
		const secondLoop = player.update(firstLoop.record, 2 / 30);

		if (
			firstLoop.record.animation.playback.status !== "playing" ||
			secondLoop.record.animation.playback.status !== "playing"
		) {
			throw new Error("expected playing playback");
		}
		const firstRotation =
			firstLoop.record.animation.playback.transformEffects.activeOmega
				?.objectRootRotation.z ?? 0;
		const secondRotation =
			secondLoop.record.animation.playback.transformEffects.activeOmega
				?.objectRootRotation.z ?? 0;

		expect(firstRotation).toBeLessThan(0);
		expect(firstRotation).toBeCloseTo(Math.sin(TEST_SET_OMEGA_Z / 2), 7);
		expect(secondRotation).toBeLessThan(firstRotation);
		expect(
			secondLoop.record.animation.playback.transformEffects.activeOmega,
		).toMatchObject({
			lastAppliedFrameIndex: 0,
			lastAppliedLoopIteration: 2,
		});
	});

	it("advances hook cursors for unsupported hooks without durable diagnostics", () => {
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

		expect(first.record.animation.playback).toMatchObject({
			lastDispatchedHookFrame: {
				frameIndex: 0,
				loopIteration: 0,
			},
			status: "playing",
		});
		expect(duplicate.changed).toBe(false);
		expect(looped.record.animation.playback).toMatchObject({
			lastDispatchedHookFrame: {
				frameIndex: 0,
				loopIteration: 1,
			},
			status: "playing",
		});
	});

	it("advances the hook cursor across unsupported crossed authored-frame hooks", () => {
		const player = new DynamicAnimationPlayer();
		const payload = createAnimationPayload({
			frameCount: 5,
			hooksByFrame: [
				[],
				[createUnsupportedHook({ hookType: 101 })],
				[createUnsupportedHook({ hookType: 102 })],
				[createUnsupportedHook({ hookType: 103 })],
				[createUnsupportedHook({ hookType: 104 })],
			],
			objectPositionFrames: [],
			partCount: 1,
		});

		const started = player.update(createRecord({ payload }), 0);
		const hitched = player.update(
			started.record,
			4 / DYNAMIC_ANIMATION_FRAME_RATE_FPS,
		);

		expect(hitched.record.animation.playback).toMatchObject({
			lastDispatchedHookFrame: {
				frameIndex: 4,
				loopIteration: 0,
			},
			status: "playing",
		});
	});

	it("caps crossed hook catch-up to the latest eight authored frames", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const player = new DynamicAnimationPlayer();
			const payload = createAnimationPayload({
				frameCount: 20,
				hooksByFrame: Array.from({ length: 20 }, (_, frameIndex) =>
					frameIndex === 0
						? []
						: [createUnsupportedHook({ hookType: 200 + frameIndex })],
				),
				objectPositionFrames: [],
				partCount: 1,
			});

			const started = player.update(createRecord({ payload }), 0);
			const hitched = player.update(
				started.record,
				12 / DYNAMIC_ANIMATION_FRAME_RATE_FPS,
			);

			expect(hitched.record.animation.playback).toMatchObject({
				lastDispatchedHookFrame: {
					frameIndex: 12,
					loopIteration: 0,
				},
				status: "playing",
			});
		} finally {
			warn.mockRestore();
		}
	});

	it("advances the hook cursor across hookless crossed frames", () => {
		const player = new DynamicAnimationPlayer();
		const payload = createAnimationPayload({
			frameCount: 5,
			objectPositionFrames: [],
			partCount: 1,
		});

		const started = player.update(createRecord({ payload }), 0);
		const hitched = player.update(
			started.record,
			3 / DYNAMIC_ANIMATION_FRAME_RATE_FPS,
		);

		expect(hitched.record.animation.playback).toMatchObject({
			lastDispatchedHookFrame: {
				frameIndex: 3,
				loopIteration: 0,
			},
			status: "playing",
		});
	});
});

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
			indexMembership: { kind: "none" },
			indexed: false,
			precision: "none",
		},
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
	readonly hooksByFrame?: readonly AnimationPayloadDto["partFrames"][number]["hooks"][];
	readonly objectPositionFrames: readonly PlacementTransformDto[];
	readonly partPlacementsByFrame?: readonly (readonly PlacementTransformDto[])[];
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
			hooks: options.hooksByFrame?.[frameIndex] ?? options.hooks ?? [],
			localPlacements:
				options.partPlacementsByFrame?.[frameIndex] ??
				Array.from({ length: options.partCount }, (_, partIndex) =>
					createPlacement({ x: frameIndex * 100 + partIndex, y: 0, z: 0 }),
				),
		})),
		provenance: createProvenance(),
		residencyKind: "unknown",
		sourceAssetKind: "animation",
	};
}

function createUnsupportedHook(options: {
	readonly hookType: number;
}): AnimationPayloadDto["partFrames"][number]["hooks"][number] {
	return {
		direction: 0,
		directionName: "Both",
		hookName: `Unsupported${options.hookType}`,
		hookType: options.hookType,
		payload: null,
		payloadKind: "raw",
		rawPayloadBytes: [options.hookType & 0xff],
	};
}

function createSetOmegaHook(): AnimationPayloadDto["partFrames"][number]["hooks"][number] {
	return {
		direction: 0,
		directionName: "Both",
		hookName: "SetOmega",
		hookType: TEST_SET_OMEGA_HOOK_TYPE,
		payload: {
			omega: { x: 0, y: 0, z: TEST_SET_OMEGA_Z },
		},
		payloadKind: "set-omega",
		rawPayloadBytes: TEST_SET_OMEGA_RAW_PAYLOAD_BYTES,
	};
}

function createPlacement(origin: {
	readonly orientation?: PlacementTransformDto["orientation"];
	readonly x: number;
	readonly y: number;
	readonly z: number;
}): PlacementTransformDto {
	const { orientation, ...position } = origin;
	return {
		orientation: orientation ?? { w: 1, x: 0, y: 0, z: 0 },
		origin: position,
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
