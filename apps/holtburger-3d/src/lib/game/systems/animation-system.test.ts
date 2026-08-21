import type {
	BehaviorEventRouter,
	BehaviorObservation,
	BehaviorTarget,
} from "../behavior/behavior-event-router";
import {
	buildEffectRouter,
	installEffectState,
	testTarget,
} from "../behavior/behavior-test-harness";
import { describe, expect, it } from "vitest";
import type { DecodedAnimationHook } from "../../assets/decode-animation-record";
import type { PreparedAnimation } from "../animation/animation-asset-repository";
import { playingClip } from "../animation/animation-playback";
import { transformPoint3 } from "../math/matrices";
import { Mat4, Vec3 } from "../math/types";
import { AnimationSystem } from "./animation-system";
import { EffectSystem } from "./effect-system";

/** An animation system over a throwaway effect system and its router. */
function buildAnimationSystem() {
	const previousRouter = lastRouter;
	const system = buildAnimationSystemOver(new EffectSystem());
	// Assertions read the router of the system under test; a throwaway system must not steal it.
	lastRouter = previousRouter;
	return system;
}

/**
 * Build a system over a caller-owned effect system, exposing the router.
 *
 * Dispatch provenance lives on the router since Phase 3, so assertions about which commands ran
 * read it rather than the effect state they mutated.
 */
function buildAnimationSystemOver(effects: EffectSystem) {
	const { router } = buildEffectRouter(effects);
	const system = new AnimationSystem<string>(effects, router);
	systemEffects.set(system, effects);
	lastRouter = router;
	// Effect state belongs to the entity, not to playback, so these tests stand in for the owner
	// that installs it in production.
	const stageOwner = system.stageOwner.bind(system);
	system.stageOwner = (ownerId, installations) => {
		for (const installation of installations) {
			installEffectState(
				effects,
				installation.target.targetId,
				installation.animation.partCount,
			);
		}
		return stageOwner(ownerId, installations);
	};
	return system;
}

/** Stage one owner and commit it, which is the only way production installs playback. */
function install(
	system: AnimationSystem<string>,
	ownerId: string,
	installations: readonly {
		readonly animation: PreparedAnimation;
		readonly target: BehaviorTarget;
		readonly residentIdentity: string;
	}[],
) {
	const staged = system.stageOwner(ownerId, installations);
	staged.commit();
	return staged.samples;
}

/** The router most recently wired by {@link buildAnimationSystemOver}. */
let lastRouter: BehaviorEventRouter;
const observations = (): readonly BehaviorObservation[] =>
	lastRouter.getObservations().filter((entry) => entry.command !== "no-op");

describe("AnimationSystem", () => {
	it("uses reproducible independent phases and smooth render-cadence sampling", () => {
		const firstEffects = new EffectSystem();
		const first = buildAnimationSystemOver(firstEffects);
		const second = buildAnimationSystem();
		const animation = testAnimation();

		const [firstInitial, independentInitial] = install(first, "owner", [
			{
				animation,
				residentIdentity: "resident:a",
				target: testTarget("scene-node:1"),
			},
			{
				animation,
				residentIdentity: "resident:b",
				target: testTarget("scene-node:3"),
			},
		]);
		const [repeatedInitial] = install(second, "owner", [
			{
				animation,
				residentIdentity: "resident:a",
				target: testTarget("scene-node:2"),
			},
		]);
		if (!firstInitial || !repeatedInitial || !independentInitial)
			throw new Error("Phase comparison did not produce three samples.");

		expect(firstInitial.articulatedPose).toEqual(
			repeatedInitial.articulatedPose,
		);
		expect(firstInitial.articulatedPose).not.toEqual(
			independentInitial.articulatedPose,
		);
		expect(
			observations()
				.filter((entry) => entry.outcome === "folded-initial-state")
				.map((entry) => entry.provenance.authoredPosition),
		).toEqual([0, 0]);

		advanceAndSample(first, 10);
		const observationCount = observations().length;
		const halfStep = requiredAt(advanceAndSample(first, 10 + 1 / 60), 0);
		expect(halfStep.articulatedPose).not.toEqual(firstInitial.articulatedPose);
		expect(halfStep.effects.rootTransformModifier).not.toEqual(Mat4.identity());
		expect(observations()).toHaveLength(observationCount);
	});

	it("rebases gaps above two seconds without hooks or a catch-up burst", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		install(system, "owner", [
			{
				animation: testAnimation(),
				residentIdentity: "resident:a",
				target: testTarget("scene-node:1"),
			},
		]);
		const foldedCount = observations().length;

		advanceAndSample(system, 0);
		advanceAndSample(system, 3);
		expect(observations()).toHaveLength(foldedCount);
		advanceAndSample(system, 3 + 1 / 30);
		expect(observations()).toHaveLength(foldedCount);
		advanceAndSample(system, 3 + 2 / 30);
		expect(observations()).toHaveLength(foldedCount);
		advanceAndSample(system, 3 + 3 / 30);
		expect(observations()).toHaveLength(foldedCount + 2);
		expect(observations().at(-1)).toMatchObject({
			command: "ethereal",
			outcome: "no-consumer",
		});
	});

	it("applies representative static omega as a per-update vector at 30 Hz", () => {
		const system = buildAnimationSystem();
		const animation = testAnimation(new Vec3(0, 0, 0.026797784));
		const initial = requiredAt(
			install(system, "owner", [
				{
					animation,
					residentIdentity: "resident:a",
					target: testTarget("scene-node:1"),
				},
			]),
			0,
		);
		const initialPoint = transformPoint3(
			initial.effects.rootTransformModifier,
			new Vec3(1, 0, 0),
		);

		advanceAndSample(system, 0);
		const afterOneSecond = requiredAt(advanceAndSample(system, 1), 0);
		const point = transformPoint3(
			afterOneSecond.effects.rootTransformModifier,
			new Vec3(1, 0, 0),
		);
		const expectedRadians = 30 * 0.026797784;
		const deltaRadians =
			Math.atan2(point.y, point.x) - Math.atan2(initialPoint.y, initialPoint.x);
		expect(deltaRadians).toBeCloseTo(expectedRadians);
	});

	it("stages replacement playback without retiring the active owner", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		install(system, "owner", [
			{
				animation: testAnimation(),
				residentIdentity: "resident:old",
				target: testTarget("scene-node:10"),
			},
		]);
		const staged = system.stageOwner("owner", [
			{
				animation: testAnimation(),
				target: testTarget("scene-node:11"),
				residentIdentity: "resident:new",
			},
		]);

		// The staged node is absent from advancement until commit, which is the whole point.
		expect(advanceAndSample(system, 0).map((sample) => sample.nodeId)).toEqual([
			"scene-node:10",
		]);
		staged.commit();
		expect(advanceAndSample(system, 0).map((sample) => sample.nodeId)).toEqual([
			"scene-node:11",
		]);
	});

	it("drops staged playback on release without disturbing the active owner", () => {
		const system = buildAnimationSystem();
		install(system, "owner", [
			{
				animation: testAnimation(),
				residentIdentity: "resident:old",
				target: testTarget("scene-node:10"),
			},
		]);
		const staged = system.stageOwner("owner", [
			{
				animation: testAnimation(),
				target: testTarget("scene-node:11"),
				residentIdentity: "resident:new",
			},
		]);

		staged.release();

		// Effect-state lifetime belongs to the entity owner now; playback only keeps its records.
		expect(advanceAndSample(system, 0).map((sample) => sample.nodeId)).toEqual([
			"scene-node:10",
		]);
	});

	it("folds effect history before the deterministic initial phase is sampled", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		const animation = animationWithInitialTransparency();
		const initial = requiredAt(
			install(system, "owner", [
				{
					animation,
					residentIdentity: "resident:a",
					target: testTarget("scene-node:1"),
				},
			]),
			0,
		);
		const renderState = initial.effects.partRenderStates[0];
		if (!renderState)
			throw new Error("Initial effect sample has no first part.");

		expect(renderState.translucency).toBeGreaterThan(0);
		expect(renderState.translucency).toBeLessThan(1);
		expect(observations()).toContainEqual(
			expect.objectContaining({
				command: "transparent-part",
				outcome: "folded-initial-state",
			}),
		);
	});

	it("produces identical hook and effect outcomes for one large accepted step or smaller steps", () => {
		const largeEffects = new EffectSystem();
		const smallEffects = new EffectSystem();
		const large = buildAnimationSystemOver(largeEffects);
		const small = buildAnimationSystemOver(smallEffects);
		const animation = animationWithTransparency();
		for (const system of [large, small]) {
			install(system, "owner", [
				{
					animation,
					residentIdentity: "resident:a",
					target: testTarget("scene-node:1"),
				},
			]);
		}
		advanceAndSample(large, 0);
		advanceAndSample(small, 0);
		const largeBaseline = observations().length;
		const smallBaseline = observations().length;

		const largeSample = advanceAndSample(large, 0.1)[0];
		advanceAndSample(small, 1 / 30);
		advanceAndSample(small, 2 / 30);
		const smallSample = advanceAndSample(small, 3 / 30)[0];
		if (!largeSample || !smallSample)
			throw new Error("Playback comparison did not produce a sample.");

		expect(observations().slice(largeBaseline)).toEqual(
			observations().slice(smallBaseline),
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

	it("keeps semantic state exact while visual sampling is sparse", () => {
		const fullEffects = new EffectSystem();
		const sparseEffects = new EffectSystem();
		const full = buildAnimationSystemOver(fullEffects);
		const sparse = buildAnimationSystemOver(sparseEffects);
		const animation = animationWithTransparency();
		for (const system of [full, sparse]) {
			install(system, "owner", [
				{
					animation,
					residentIdentity: "resident:a",
					target: testTarget("scene-node:1"),
				},
			]);
		}

		advanceAndSample(full, 0);
		advanceAndSample(sparse, 0);
		for (const time of [1 / 30, 2 / 30]) {
			advanceAndSample(full, time);
			// Semantics advance every step on both paths; only *sampling* is sparse here, so the
			// effect clock moves for `sparse` too.
			sparseEffects.advance(time);
			sparse.advance(time);
		}
		const fullFinal = requiredAt(advanceAndSample(full, 0.1), 0);
		sparseEffects.advance(0.1);
		const sparseFrame = sparse.advance(0.1);
		const sparseFinal = requiredAt(
			sparse.sample(sparseFrame, ["scene-node:1"]),
			0,
		);

		expect(observations()).toEqual(observations());
		expect(sparseFinal.articulatedPose).toEqual(fullFinal.articulatedPose);
		expect(sparseFinal.effects.partRenderStates).toEqual(
			fullFinal.effects.partRenderStates,
		);
		expect(sparseFinal.effects.rootTransformModifier).toEqual(
			fullFinal.effects.rootTransformModifier,
		);
		expect(sparse.getDiagnostics().lastSampledPresentationCount).toBe(1);
	});

	it("installs a first clip onto a node that activated without playback", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		const target = testTarget("scene-node:1");
		// A motion-driven entity's owner installs effect state at activation and stages no clip.
		installEffectState(effects, target.targetId);

		expect(advanceAndSample(system, 0)).toEqual([]);
		system.playClip(
			"owner",
			target,
			playingClip(testAnimation(Vec3.zero()), 1, 2, 30, "loop"),
		);

		const sample = requiredAt(advanceAndSample(system, 0), 0);
		// Frame translations are the frame index, so the entry pose names the window's low frame.
		expect(sample.articulatedPose.partToObjectTransforms[0]?.m41).toBe(1);
	});

	it("re-enters at the replacement clip's own starting frame", () => {
		const system = buildAnimationSystem();
		const target = testTarget("scene-node:1");
		const animation = testAnimation(Vec3.zero());
		install(system, "owner", [
			{ animation, residentIdentity: "resident:a", target },
		]);
		advanceAndSample(system, 0);
		advanceAndSample(system, 2 / 30);

		system.playClip("owner", target, playingClip(animation, 0, 3, -30, "loop"));

		// A reversed clip enters just inside its high frame rather than resuming where it was.
		const sample = requiredAt(advanceAndSample(system, 2 / 30), 0);
		expect(sample.articulatedPose.partToObjectTransforms[0]?.m41).toBe(3);
	});

	it("refuses a clip whose target generation the node no longer holds", () => {
		const system = buildAnimationSystem();
		const target = testTarget("scene-node:1");
		const animation = testAnimation(Vec3.zero());
		install(system, "owner", [
			{ animation, residentIdentity: "resident:a", target },
		]);

		expect(() =>
			system.playClip(
				"owner",
				{ ...target, generation: target.generation + 1 },
				playingClip(animation, 1, 1, 30, "loop"),
			),
		).toThrow("names generation");
		const sample = requiredAt(advanceAndSample(system, 0), 0);
		expect(sample.articulatedPose.partToObjectTransforms[0]?.m41).not.toBe(1);
	});

	it("invalidates the advanced frame a swap raced", () => {
		const system = buildAnimationSystem();
		const target = testTarget("scene-node:1");
		const animation = testAnimation(Vec3.zero());
		install(system, "owner", [
			{ animation, residentIdentity: "resident:a", target },
		]);
		const frame = system.advance(0);

		system.playClip("owner", target, playingClip(animation, 0, 1, 30, "loop"));

		expect(() => system.sample(frame, ["scene-node:1"])).toThrow(
			"latest advanced frame",
		);
	});

	it("rejects stale, duplicate, and unknown sampling requests", () => {
		const system = buildAnimationSystem();
		install(system, "owner", [
			{
				animation: testAnimation(),
				residentIdentity: "resident:a",
				target: testTarget("scene-node:1"),
			},
		]);
		const staleFrame = system.advance(0);
		const currentFrame = system.advance(1 / 60);

		expect(() => system.sample(staleFrame, ["scene-node:1"])).toThrow(
			"latest advanced frame",
		);
		expect(() =>
			system.sample(currentFrame, ["scene-node:1", "scene-node:1"]),
		).toThrow("repeats scene-node:1");
		expect(() => system.sample(currentFrame, ["scene-node:999"])).toThrow(
			"unknown scene-node:999",
		);
	});
});

/**
 * Advance both clocks, then sample — the order `GameRuntime` uses.
 *
 * Effect stepping no longer rides animation playback, so a test that only advanced the animation
 * would sample effect state frozen at install.
 */
function advanceAndSample(
	system: AnimationSystem<string>,
	timeSeconds: number,
) {
	effectsFor(system).advance(timeSeconds);
	const frame = system.advance(timeSeconds);
	return system.sample(frame, frame.activeNodeIds);
}

/** The effect system a built animation system was wired over. */
function effectsFor(system: AnimationSystem<string>): EffectSystem {
	const effects = systemEffects.get(system);
	if (!effects)
		throw new Error("Animation system was not built by this suite.");
	return effects;
}

const systemEffects = new WeakMap<AnimationSystem<string>, EffectSystem>();

function testAnimation(omega = new Vec3(0, 0, 1)): PreparedAnimation {
	return {
		authoredRootTranslates: false,
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
		blocksActivation: false,
		kind: "unimplemented",
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

function animationWithTransparency(): PreparedAnimation {
	const animation = testAnimation(Vec3.zero());
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

function animationWithInitialTransparency(): PreparedAnimation {
	const animation = testAnimation(Vec3.zero());
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
