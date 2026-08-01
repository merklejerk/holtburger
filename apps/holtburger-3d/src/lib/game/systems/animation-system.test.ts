import { describe, expect, it } from "vitest";
import type { DecodedAnimationHook } from "../../assets/decode-animation-record";
import type { PreparedAnimation } from "../animation/animation-asset-repository";
import { transformPoint3 } from "../math/matrices";
import { Mat4, Vec3 } from "../math/types";
import { AnimationSystem } from "./animation-system";
import { HookSystem } from "./hook-system";

describe("AnimationSystem", () => {
	it("uses reproducible independent phases and smooth render-cadence sampling", () => {
		const firstHooks = new HookSystem();
		const first = new AnimationSystem<string>(firstHooks);
		const second = new AnimationSystem<string>(new HookSystem());
		const animation = clip();

		const firstInitial = first.install(
			"owner",
			"scene-node:1",
			"resident:a",
			animation,
		);
		const repeatedInitial = second.install(
			"owner",
			"scene-node:2",
			"resident:a",
			animation,
		);
		const independentInitial = first.install(
			"owner",
			"scene-node:3",
			"resident:b",
			animation,
		);

		expect(firstInitial.pose).toEqual(repeatedInitial.pose);
		expect(firstInitial.pose).not.toEqual(independentInitial.pose);
		expect(firstHooks.getObservations()).toMatchObject([
			{ frameIndex: 0, outcome: "folded-initial-state" },
			{ frameIndex: 0, outcome: "folded-initial-state" },
		]);

		first.update(10);
		const halfStep = first.update(10 + 1 / 60)[0]!;
		expect(halfStep.pose).not.toEqual(firstInitial.pose);
		expect(halfStep.visualRootTransform).not.toEqual(Mat4.identity());
	});

	it("rebases gaps above two seconds without hooks or a catch-up burst", () => {
		const hooks = new HookSystem();
		const system = new AnimationSystem<string>(hooks);
		system.install("owner", "scene-node:1", "resident:a", clip());
		const foldedCount = hooks.getObservations().length;

		system.update(0);
		system.update(3);
		expect(hooks.getObservations()).toHaveLength(foldedCount);
		system.update(3 + 1 / 30);
		expect(hooks.getObservations()).toHaveLength(foldedCount);
		system.update(3 + 2 / 30);
		expect(hooks.getObservations()).toHaveLength(foldedCount);
		system.update(3 + 3 / 30);
		expect(hooks.getObservations()).toHaveLength(foldedCount + 2);
		expect(hooks.getObservations().at(-1)).toMatchObject({
			command: "ethereal",
			outcome: "deferred",
		});
	});

	it("applies representative static omega as a per-update vector at 30 Hz", () => {
		const system = new AnimationSystem<string>(new HookSystem());
		const animation = clip(new Vec3(0, 0, 0.026797784));
		system.install("owner", "scene-node:1", "resident:a", animation);

		system.update(0);
		const afterOneSecond = system.update(1)[0]!;
		const point = transformPoint3(
			afterOneSecond.visualRootTransform,
			new Vec3(1, 0, 0),
		);
		const expectedRadians = 30 * 0.026797784;
		expect(point.x).toBeCloseTo(Math.cos(expectedRadians));
		expect(point.y).toBeCloseTo(Math.sin(expectedRadians));
	});

	it("stages replacement playback without retiring the active owner", () => {
		const hooks = new HookSystem();
		const system = new AnimationSystem<string>(hooks);
		system.install("owner", "scene-node:10", "resident:old", clip());
		const staged = system.stageOwner("owner", [
			{
				animation: clip(),
				nodeId: "scene-node:11",
				residentIdentity: "resident:new",
			},
		]);

		expect(system.getDiagnostics().activePlaybackCount).toBe(0);
		expect(system.update(0).map((sample) => sample.nodeId)).toEqual([
			"scene-node:10",
		]);
		staged.commit();
		expect(system.update(0).map((sample) => sample.nodeId)).toEqual([
			"scene-node:11",
		]);
	});
});

function clip(omega = new Vec3(0, 0, 1)): PreparedAnimation {
	return {
		frameCount: 4,
		framesPerSecond: 30,
		hooks: [setOmegaHook(omega), deferredEffectHook()],
		id: "0x03000001",
		partCount: 1,
		partFrames: [0, 1, 2, 3].map((translation) => {
			const transform = Mat4.identity();
			transform.m41 = translation;
			return transform;
		}),
		positionFrames: [],
	};
}

function deferredEffectHook(): DecodedAnimationHook {
	return {
		authoredOrder: 1,
		command: "ethereal",
		direction: "both",
		frameIndex: 0,
		kind: "deferred-effect",
		payload: { kind: "no-payload" },
		sourceType: 6,
	};
}

function setOmegaHook(omega: Vec3): DecodedAnimationHook {
	return {
		authoredOrder: 0,
		direction: "both",
		frameIndex: 0,
		kind: "set-omega",
		omega,
	};
}
