import { describe, expect, it } from "vitest";
import type { DecodedAnimationHook } from "../../assets/decode-animation-record";
import type { PreparedAnimation } from "../animation/animation-asset-repository";
import { transformPoint3 } from "../math/matrices";
import { Mat4, Vec3 } from "../math/types";
import { AnimationSystem } from "./animation-system";
import { EffectSystem } from "./effect-system";

describe("AnimationSystem", () => {
	it("uses reproducible independent phases and smooth render-cadence sampling", () => {
		const firstEffects = new EffectSystem();
		const first = new AnimationSystem<string>(firstEffects);
		const second = new AnimationSystem<string>(new EffectSystem());
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

		expect(firstInitial.articulatedPose).toEqual(
			repeatedInitial.articulatedPose,
		);
		expect(firstInitial.articulatedPose).not.toEqual(
			independentInitial.articulatedPose,
		);
		expect(firstEffects.getObservations()).toMatchObject([
			{ frameIndex: 0, outcome: "folded-initial-state" },
			{ frameIndex: 0, outcome: "folded-initial-state" },
		]);

		first.update(10);
		const observationCount = firstEffects.getObservations().length;
		const halfStep = requiredAt(first.update(10 + 1 / 60), 0);
		expect(halfStep.articulatedPose).not.toEqual(firstInitial.articulatedPose);
		expect(halfStep.effects.rootRotationModifier).not.toEqual(Mat4.identity());
		expect(firstEffects.getObservations()).toHaveLength(observationCount);
	});

	it("rebases gaps above two seconds without hooks or a catch-up burst", () => {
		const effects = new EffectSystem();
		const system = new AnimationSystem<string>(effects);
		system.install("owner", "scene-node:1", "resident:a", clip());
		const foldedCount = effects.getObservations().length;

		system.update(0);
		system.update(3);
		expect(effects.getObservations()).toHaveLength(foldedCount);
		system.update(3 + 1 / 30);
		expect(effects.getObservations()).toHaveLength(foldedCount);
		system.update(3 + 2 / 30);
		expect(effects.getObservations()).toHaveLength(foldedCount);
		system.update(3 + 3 / 30);
		expect(effects.getObservations()).toHaveLength(foldedCount + 2);
		expect(effects.getObservations().at(-1)).toMatchObject({
			command: "ethereal",
			outcome: "deferred",
		});
	});

	it("applies representative static omega as a per-update vector at 30 Hz", () => {
		const system = new AnimationSystem<string>(new EffectSystem());
		const animation = clip(new Vec3(0, 0, 0.026797784));
		const initial = system.install(
			"owner",
			"scene-node:1",
			"resident:a",
			animation,
		);
		const initialPoint = transformPoint3(
			initial.effects.rootRotationModifier,
			new Vec3(1, 0, 0),
		);

		system.update(0);
		const afterOneSecond = requiredAt(system.update(1), 0);
		const point = transformPoint3(
			afterOneSecond.effects.rootRotationModifier,
			new Vec3(1, 0, 0),
		);
		const expectedRadians = 30 * 0.026797784;
		const deltaRadians =
			Math.atan2(point.y, point.x) - Math.atan2(initialPoint.y, initialPoint.x);
		expect(deltaRadians).toBeCloseTo(expectedRadians);
	});

	it("stages replacement playback without retiring the active owner", () => {
		const effects = new EffectSystem();
		const system = new AnimationSystem<string>(effects);
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
		expect(effects.getDiagnostics().residentEffectStateCount).toBe(1);
	});

	it("releases staged and active effect state deterministically", () => {
		const effects = new EffectSystem();
		const system = new AnimationSystem<string>(effects);
		system.install("owner", "scene-node:10", "resident:old", clip());
		const staged = system.stageOwner("owner", [
			{
				animation: clip(),
				nodeId: "scene-node:11",
				residentIdentity: "resident:new",
			},
		]);
		expect(effects.getDiagnostics().residentEffectStateCount).toBe(2);

		staged.release();
		expect(effects.getDiagnostics().residentEffectStateCount).toBe(1);
		system.destroy();
		expect(effects.getDiagnostics().residentEffectStateCount).toBe(0);
		expect(() => system.update(0)).toThrow("destroyed animation playback");
		expect(() => staged.commit()).toThrow("state released");
	});

	it("folds effect history before the deterministic initial phase is sampled", () => {
		const effects = new EffectSystem();
		const system = new AnimationSystem<string>(effects);
		const animation = clipWithInitialTransparency();
		const initial = system.install(
			"owner",
			"scene-node:1",
			"resident:a",
			animation,
		);
		const renderState = initial.effects.partRenderStates[0];
		if (!renderState)
			throw new Error("Initial effect sample has no first part.");

		expect(renderState.translucency).toBeGreaterThan(0);
		expect(renderState.translucency).toBeLessThan(1);
		expect(effects.getObservations()).toContainEqual(
			expect.objectContaining({
				command: "transparent-part",
				outcome: "folded-initial-state",
			}),
		);
	});

	it("produces identical hook and effect outcomes for one large accepted step or smaller steps", () => {
		const largeEffects = new EffectSystem();
		const smallEffects = new EffectSystem();
		const large = new AnimationSystem<string>(largeEffects);
		const small = new AnimationSystem<string>(smallEffects);
		const animation = clipWithTransparency();
		large.install("owner", "scene-node:1", "resident:a", animation);
		small.install("owner", "scene-node:1", "resident:a", animation);
		large.update(0);
		small.update(0);
		const largeBaseline = largeEffects.getObservations().length;
		const smallBaseline = smallEffects.getObservations().length;

		const largeSample = large.update(0.1)[0];
		small.update(1 / 30);
		small.update(2 / 30);
		const smallSample = small.update(3 / 30)[0];
		if (!largeSample || !smallSample)
			throw new Error("Playback comparison did not produce a sample.");

		expect(largeEffects.getObservations().slice(largeBaseline)).toEqual(
			smallEffects.getObservations().slice(smallBaseline),
		);
		const largeTransform =
			largeSample.articulatedPose.partToObjectTransforms[0];
		const smallTransform =
			smallSample.articulatedPose.partToObjectTransforms[0];
		const largeRenderState = largeSample.effects.partRenderStates[0];
		const smallRenderState = smallSample.effects.partRenderStates[0];
		if (
			!largeTransform ||
			!smallTransform ||
			!largeRenderState ||
			!smallRenderState
		) {
			throw new Error("Comparison samples are incomplete.");
		}
		expect(largeTransform.m41).toBeCloseTo(smallTransform.m41, 12);
		expect(largeRenderState.translucency).toBeCloseTo(
			smallRenderState.translucency,
			12,
		);
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

function requiredAt<T>(values: readonly T[], index: number): T {
	const value = values[index];
	if (value === undefined)
		throw new Error(`Expected test value at index ${index}.`);
	return value;
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

function clipWithTransparency(): PreparedAnimation {
	const animation = clip(Vec3.zero());
	return {
		...animation,
		hooks: [
			{
				authoredOrder: 0,
				direction: "both",
				durationSeconds: 0.2,
				end: 1,
				frameIndex: 1,
				kind: "transparent-part",
				partIndex: 0,
				start: 0,
			},
			{
				authoredOrder: 0,
				command: "animation-done",
				direction: "both",
				frameIndex: 2,
				kind: "semantic",
			},
		],
	};
}

function clipWithInitialTransparency(): PreparedAnimation {
	const animation = clip(Vec3.zero());
	return {
		...animation,
		hooks: [
			{
				authoredOrder: 0,
				direction: "both",
				durationSeconds: 1,
				end: 1,
				frameIndex: 0,
				kind: "transparent-part",
				partIndex: 0,
				start: 0,
			},
		],
	};
}
