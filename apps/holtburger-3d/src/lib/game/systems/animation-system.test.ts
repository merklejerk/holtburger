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
import {
	prepareAnimation,
	type PreparedAnimation,
} from "../animation/animation-asset-repository";
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

/** Stage and commit setup-default playback through the production owner API. */
function install(
	system: AnimationSystem<string>,
	ownerId: string,
	installations: readonly {
		readonly animation: PreparedAnimation;
		readonly target: BehaviorTarget;
		readonly residentIdentity: string;
	}[],
) {
	const staged = system.stageOwner(
		ownerId,
		installations.map((installation) => ({
			...installation,
			initialPartToObjectTransforms: initialPose(
				installation.animation.partCount,
			),
		})),
	);
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
				initialPartToObjectTransforms: initialPose(),
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
				initialPartToObjectTransforms: initialPose(),
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

	it("keeps traversing and looping while speed updates arrive every frame", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		const target = testTarget("scene-node:1");
		installEffectState(effects, target.targetId);
		system.applyMotion(
			"owner",
			target,
			"explicit",
			{
				kind: "install",
				clip: playingClip(testAnimation(Vec3.zero()), 0, 3, 30, "loop"),
			},
			{ kind: "remove" },
			initialPose(),
		);
		advanceAndSample(system, 0);
		let expectedFrame = 0;
		let speed = 30;
		for (let frame = 1; frame <= 60; frame += 1) {
			expectedFrame = (expectedFrame + speed / 60) % 4;
			const sample = requiredAt(advanceAndSample(system, frame / 60), 0);
			expect(sample.articulatedPose.partToObjectTransforms[0]?.m41).toBeCloseTo(
				Math.min(expectedFrame, 3),
				5,
			);
			speed = frame % 2 === 0 ? 30 : 30.01;
			system.applyMotion(
				"owner",
				target,
				"explicit",
				{ kind: "retime", framesPerSecond: speed },
				{ kind: "unchanged" },
				initialPose(),
			);
		}
	});

	it("installs a first clip onto a node that activated without playback", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		const target = testTarget("scene-node:1");
		// A motion-driven entity's owner installs effect state at activation and stages no clip.
		installEffectState(effects, target.targetId);

		expect(advanceAndSample(system, 0)).toEqual([]);
		system.applyMotion(
			"owner",
			target,
			"explicit",
			{
				kind: "install",
				clip: playingClip(testAnimation(Vec3.zero()), 1, 2, 30, "loop"),
			},
			{ kind: "remove" },
			initialPose(),
		);

		const sample = requiredAt(advanceAndSample(system, 0), 0);
		// Frame translations are the frame index, so the entry pose names the window's low frame.
		expect(sample.articulatedPose.partToObjectTransforms[0]?.m41).toBe(1);
	});

	it("retains untouched setup parts across full, partial, and full clips", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		const target = testTarget("scene-node:1");
		installEffectState(effects, target.targetId, 2);
		const play = (animation: PreparedAnimation) =>
			system.applyMotion(
				"owner",
				target,
				"explicit",
				{ kind: "install", clip: playingClip(animation, 0, 0, 30, "loop") },
				{ kind: "remove" },
				initialPose(2),
			);

		play(fixedPoseAnimation("0x03000010", [1, 9]));
		expect(
			requiredAt(
				advanceAndSample(system, 0),
				0,
			).articulatedPose.partToObjectTransforms.map(({ m41 }) => m41),
		).toEqual([1, 9]);

		play(fixedPoseAnimation("0x03000011", [2]));
		expect(
			requiredAt(
				advanceAndSample(system, 0),
				0,
			).articulatedPose.partToObjectTransforms.map(({ m41 }) => m41),
		).toEqual([2, 9]);

		play(fixedPoseAnimation("0x03000012", [3, 4]));
		expect(
			requiredAt(
				advanceAndSample(system, 0),
				0,
			).articulatedPose.partToObjectTransforms.map(({ m41 }) => m41),
		).toEqual([3, 4]);
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

		system.applyMotion(
			"owner",
			target,
			"explicit",
			{ kind: "install", clip: playingClip(animation, 0, 3, -30, "loop") },
			{ kind: "remove" },
			initialPose(),
		);

		// A reversed clip enters just inside its high frame rather than resuming where it was.
		const sample = requiredAt(advanceAndSample(system, 2 / 30), 0);
		expect(sample.articulatedPose.partToObjectTransforms[0]?.m41).toBe(3);
	});

	it("dispatches backward hooks and rejects forward hooks during reverse playback", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		const target = testTarget("scene-node:1");
		const animation: PreparedAnimation = {
			...testAnimation(Vec3.zero()),
			hooks: [
				transparentPartHook("forward", 0.75),
				transparentPartHook("backward", 0.25),
			],
		};
		installEffectState(effects, target.targetId);
		system.applyMotion(
			"owner",
			target,
			"explicit",
			{ kind: "install", clip: playingClip(animation, 0, 3, -30, "hold") },
			{ kind: "remove" },
			initialPose(),
		);

		advanceAndSample(system, 0);
		advanceAndSample(system, 1 / 30);
		const sample = requiredAt(advanceAndSample(system, 2 / 30), 0);

		expect(sample.effects.partRenderStates[0]?.translucency).toBe(0.25);
		expect(
			observations().filter(
				(observation) => observation.command === "transparent-part",
			),
		).toHaveLength(1);
	});

	it("refuses a clip whose target generation the node no longer holds", () => {
		const system = buildAnimationSystem();
		const target = testTarget("scene-node:1");
		const animation = testAnimation(Vec3.zero());
		install(system, "owner", [
			{ animation, residentIdentity: "resident:a", target },
		]);

		expect(() =>
			system.applyMotion(
				"owner",
				{ ...target, generation: target.generation + 1 },
				"explicit",
				{ kind: "install", clip: playingClip(animation, 1, 1, 30, "loop") },
				{ kind: "remove" },
				initialPose(),
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

		system.applyMotion(
			"owner",
			target,
			"explicit",
			{ kind: "install", clip: playingClip(animation, 0, 1, 30, "loop") },
			{ kind: "remove" },
			initialPose(),
		);

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
 * Advance both clocks, then sample — the order `GamePresentationRuntime` uses.
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
	return prepareAnimation(
		{
			frameCount: 4,
			hooks: [setOmegaHook(omega), deferredEffectHook()],
			id: "0x03000001",
			partCount: 1,
			partFrames: [0, 1, 2, 3].map((translation) => {
				const transform = Mat4.identity();
				transform.m41 = translation;
				return transform;
			}),
			positionFrames: [],
		},
		"0x03000001",
		30,
	);
}

function initialPose(partCount = 1): readonly Mat4[] {
	return Array.from({ length: partCount }, () => Mat4.identity());
}

function fixedPoseAnimation(
	id: string,
	partTranslations: readonly number[],
): PreparedAnimation {
	return prepareAnimation(
		{
			frameCount: 1,
			hooks: [],
			id: id as PreparedAnimation["id"],
			partCount: partTranslations.length,
			partFrames: partTranslations.map((translation) => {
				const transform = Mat4.identity();
				transform.m41 = translation;
				return transform;
			}),
			positionFrames: [],
		},
		id as PreparedAnimation["id"],
		30,
	);
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

function transparentPartHook(
	direction: "backward" | "forward",
	end: number,
): DecodedAnimationHook {
	return {
		authoredOrder: direction === "forward" ? 0 : 1,
		direction,
		durationSeconds: 0,
		end,
		frameIndex: 2,
		kind: "transparent-part",
		partIndex: 0,
		start: 1,
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

describe("independent gesture and locomotion playback", () => {
	it("reveals the running locomotion cursor without dispatching its hidden hooks", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		const target = testTarget("scene-node:1");
		installEffectState(effects, target.targetId);
		const gesture = playingClip(
			fixedPoseAnimation("0x03000020", [10]),
			0,
			0,
			0,
			"hold",
		);
		const locomotion = playingClip(
			testAnimation(Vec3.zero()),
			0,
			3,
			30,
			"loop",
		);
		system.applyMotion(
			"owner",
			target,
			"gesture",
			{ kind: "install", clip: gesture },
			{ kind: "install", clip: locomotion },
			initialPose(),
		);
		advanceAndSample(system, 0);
		const hidden = requiredAt(advanceAndSample(system, 0.2), 0);
		expect(hidden.articulatedPose.partToObjectTransforms[0]?.m41).toBe(10);
		expect(observations()).toHaveLength(0);
		system.applyMotion(
			"owner",
			target,
			"locomotion",
			{ kind: "remove" },
			{ kind: "unchanged" },
			initialPose(),
		);
		const revealed = requiredAt(advanceAndSample(system, 0.2), 0);
		expect(revealed.articulatedPose.partToObjectTransforms[0]?.m41).toBeCloseTo(
			2,
		);
		expect(observations()).toHaveLength(0);
		advanceAndSample(system, 0.34);
		expect(observations().length).toBeGreaterThan(0);
		system.removeOwner("owner");
		expect(system.holds(target)).toBe(false);
		expect(advanceAndSample(system, 0.4)).toEqual([]);
	});

	it("replaces hidden locomotion for reversal and stop without restarting the gesture", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		const target = testTarget("scene-node:1");
		installEffectState(effects, target.targetId);
		const animation = testAnimation(Vec3.zero());
		const gesture = playingClip({ ...animation, hooks: [] }, 0, 3, 1, "hold");
		const forward = playingClip(animation, 0, 3, 10, "loop");
		system.applyMotion(
			"owner",
			target,
			"gesture",
			{ kind: "install", clip: gesture },
			{ kind: "install", clip: forward },
			initialPose(),
		);
		advanceAndSample(system, 0);
		advanceAndSample(system, 0.1);
		system.applyMotion(
			"owner",
			target,
			"gesture",
			{ kind: "unchanged" },
			{ kind: "install", clip: playingClip(animation, 0, 3, -10, "loop") },
			initialPose(),
		);
		advanceAndSample(system, 0.1);
		const stillGesture = requiredAt(advanceAndSample(system, 0.2), 0);
		expect(
			stillGesture.articulatedPose.partToObjectTransforms[0]?.m41,
		).toBeCloseTo(0.2);
		expect(observations()).toHaveLength(0);
		// Contact replacement reveals the running reversed track immediately; its high-frame
		// entry has already advanced backwards by one frame while hidden.
		system.applyMotion(
			"owner",
			target,
			"explicit",
			{ kind: "remove" },
			{ kind: "unchanged" },
			initialPose(),
		);
		expect(
			requiredAt(advanceAndSample(system, 0.2), 0).articulatedPose
				.partToObjectTransforms[0]?.m41,
		).toBeCloseTo(3);
		// A new gesture hides the stop transition; it finishes while the gesture keeps playing.
		system.applyMotion(
			"owner",
			target,
			"gesture",
			{ kind: "install", clip: gesture },
			{ kind: "install", clip: playingClip(animation, 0, 3, 10, "hold") },
			initialPose(),
		);
		advanceAndSample(system, 0.2);
		advanceAndSample(system, 0.6);
		system.applyMotion(
			"owner",
			target,
			"explicit",
			{ kind: "remove" },
			{ kind: "unchanged" },
			initialPose(),
		);
		expect(
			requiredAt(advanceAndSample(system, 0.6), 0).articulatedPose
				.partToObjectTransforms[0]?.m41,
		).toBe(3);
		expect(observations()).toHaveLength(0);
	});

	it("finishes the local gesture after host retirement while locomotion keeps advancing", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		const target = testTarget("scene-node:1");
		installEffectState(effects, target.targetId);
		const animation = { ...testAnimation(Vec3.zero()), hooks: [] };
		system.applyMotion(
			"owner",
			target,
			"gesture",
			{ kind: "install", clip: playingClip(animation, 0, 3, 10, "hold") },
			{ kind: "install", clip: playingClip(animation, 0, 3, 6, "loop") },
			initialPose(),
		);
		advanceAndSample(system, 0);
		advanceAndSample(system, 0.1);
		system.applyMotion(
			"owner",
			target,
			"locomotion",
			{
				kind: "install",
				clip: playingClip(
					fixedPoseAnimation("0x03000021", [20]),
					0,
					0,
					0,
					"hold",
				),
			},
			{ kind: "unchanged" },
			initialPose(),
		);
		expect(
			requiredAt(advanceAndSample(system, 0.2), 0).articulatedPose
				.partToObjectTransforms[0]?.m41,
		).toBeCloseTo(2);
		expect(
			requiredAt(advanceAndSample(system, 0.4), 0).articulatedPose
				.partToObjectTransforms[0]?.m41,
		).toBeCloseTo(2.4);
	});

	it.each(["natural", "replacement"] as const)(
		"retains the current ordinary part pose through %s retirement",
		(retirement) => {
			const effects = new EffectSystem();
			const system = buildAnimationSystemOver(effects);
			const target = testTarget("scene-node:1");
			installEffectState(effects, target.targetId, 2);
			const gesture = prepareAnimation(
				{
					id: "0x03000030",
					frameCount: 4,
					partCount: 2,
					hooks: [],
					positionFrames: [],
					partFrames: [0, 1, 2, 3].flatMap((x) =>
						[x, x].map((translation) => {
							const pose = Mat4.identity();
							pose.m41 = translation;
							return pose;
						}),
					),
				},
				"0x03000030",
				10,
			);
			const partial = playingClip(
				fixedPoseAnimation("0x03000031", [9]),
				0,
				0,
				0,
				"hold",
			);
			system.applyMotion(
				"owner",
				target,
				"gesture",
				{ kind: "install", clip: playingClip(gesture, 0, 3, 10, "hold") },
				{ kind: "remove" },
				initialPose(2),
			);
			advanceAndSample(system, 0);
			advanceAndSample(system, 0.1);
			system.applyMotion(
				"owner",
				target,
				"locomotion",
				{ kind: "install", clip: partial },
				{ kind: "remove" },
				initialPose(2),
			);
			advanceAndSample(system, 0.2);
			if (retirement === "replacement") {
				system.applyMotion(
					"owner",
					target,
					"explicit",
					{ kind: "install", clip: partial },
					{ kind: "remove" },
					initialPose(2),
				);
			}
			const sample = requiredAt(
				advanceAndSample(system, retirement === "natural" ? 0.4 : 0.2),
				0,
			);
			expect(sample.articulatedPose.partToObjectTransforms[0]?.m41).toBe(9);
			expect(sample.articulatedPose.partToObjectTransforms[1]?.m41).toBeCloseTo(
				retirement === "natural" ? 3 : 2,
			);
		},
	);

	it("applies a genuine replacement immediately even while a gesture is finishing", () => {
		const effects = new EffectSystem();
		const system = buildAnimationSystemOver(effects);
		const target = testTarget("scene-node:1");
		installEffectState(effects, target.targetId);
		const animation = { ...testAnimation(Vec3.zero()), hooks: [] };
		system.applyMotion(
			"owner",
			target,
			"gesture",
			{ kind: "install", clip: playingClip(animation, 0, 3, 10, "hold") },
			{ kind: "install", clip: playingClip(animation, 0, 3, 6, "loop") },
			initialPose(),
		);
		advanceAndSample(system, 0);
		advanceAndSample(system, 0.1);
		system.applyMotion(
			"owner",
			target,
			"locomotion",
			{ kind: "remove" },
			{ kind: "unchanged" },
			initialPose(),
		);
		const replacement = playingClip(
			fixedPoseAnimation("0x03000022", [9]),
			0,
			0,
			0,
			"hold",
		);
		system.applyMotion(
			"owner",
			target,
			"explicit",
			{ kind: "install", clip: replacement },
			{ kind: "unchanged" },
			initialPose(),
		);
		expect(
			requiredAt(advanceAndSample(system, 0.1), 0).articulatedPose
				.partToObjectTransforms[0]?.m41,
		).toBe(9);
	});

	it.each(["gesture", "locomotion"] as const)(
		"retimes hidden locomotion while selecting %s without replaying hidden hooks",
		(activity) => {
			const effects = new EffectSystem();
			const system = buildAnimationSystemOver(effects);
			const target = testTarget("scene-node:1");
			installEffectState(effects, target.targetId);
			system.applyMotion(
				"owner",
				target,
				"gesture",
				{
					kind: "install",
					clip: playingClip(
						fixedPoseAnimation("0x03000023", [10]),
						0,
						0,
						0,
						"hold",
					),
				},
				{
					kind: "install",
					clip: playingClip(testAnimation(Vec3.zero()), 0, 3, 60, "loop"),
				},
				initialPose(),
			);
			advanceAndSample(system, 0);
			advanceAndSample(system, 0.02);
			system.applyMotion(
				"owner",
				target,
				activity,
				{ kind: "unchanged" },
				{ kind: "retime", framesPerSecond: 30 },
				initialPose(),
			);
			expect(observations()).toHaveLength(0);
			system.applyMotion(
				"owner",
				target,
				"locomotion",
				{ kind: "remove" },
				{ kind: "unchanged" },
				initialPose(),
			);
			expect(
				requiredAt(advanceAndSample(system, 0.02), 0).articulatedPose
					.partToObjectTransforms[0]?.m41,
			).toBeCloseTo(1.2);
			expect(observations()).toHaveLength(0);
		},
	);
});
