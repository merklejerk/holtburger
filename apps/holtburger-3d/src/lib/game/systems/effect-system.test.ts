import { describe, expect, it } from "vitest";
import {
	behaviorTargetId,
	type BehaviorTarget,
} from "../behavior/behavior-event-router";
import { buildEffectRouter } from "../behavior/behavior-test-harness";
import { Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import {
	EffectSystem,
	BEHAVIOR_STEP_SECONDS,
	MINIMUM_TIMED_EFFECT_SECONDS,
} from "./effect-system";

const NODE_ID = "scene-node:1" as SceneNodeId;
const TARGET: BehaviorTarget = {
	generation: 1,
	targetId: behaviorTargetId(NODE_ID),
};

function install(partCount = 2, initialTranslucency = 0) {
	const effects = new EffectSystem();
	effects.install(NODE_ID, partCount, {
		translucency: initialTranslucency,
		cloaked: false,
	});
	return effects;
}

function translucencies(effects: EffectSystem): number[] {
	return effects
		.samplePresentation(NODE_ID)
		.partRenderStates.map((state) => state.translucency);
}

/** Per-system wall time, so each test drives the shared clock from its own zero. */
const clocks = new WeakMap<EffectSystem, number>();

/** Drive the shared behavior clock forward, committing whole steps as they elapse. */
function advance(effects: EffectSystem, elapsedSeconds: number): void {
	let now = clocks.get(effects);
	if (now === undefined) {
		now = 0;
		effects.advance(0);
	}
	now += elapsedSeconds;
	clocks.set(effects, now);
	effects.advance(now);
}

describe("EffectSystem", () => {
	it("enqueues a timed object hook without changing materials until clock advancement", () => {
		const effects = install(2, 0.4);
		effects.applyTranslucency(
			TARGET,
			{ kind: "transparent", start: 1, end: 0, durationSeconds: 1 },
			"live",
		);
		expect(translucencies(effects)).toEqual([0.4, 0.4]);
		advance(effects, BEHAVIOR_STEP_SECONDS);
		expect(translucencies(effects)[0]).toBeCloseTo(1 - BEHAVIOR_STEP_SECONDS);
		advance(effects, 1);
		expect(translucencies(effects)).toEqual([0.4, 0.4]);
	});

	it.each(["transparent", "transparent-part"] as const)(
		"coexists with an older whole-object hook: newer %s",
		(kind) => {
			const effects = install(2);
			effects.applyTranslucency(
				TARGET,
				{
					kind: "transparent",
					start: 0,
					end: 1,
					durationSeconds: 4 * BEHAVIOR_STEP_SECONDS,
				},
				"live",
			);
			effects.applyTranslucency(
				TARGET,
				{
					kind,
					partIndex: 0,
					start: 1,
					end: 0,
					durationSeconds: 8 * BEHAVIOR_STEP_SECONDS,
				},
				"live",
			);
			advance(effects, 4 * BEHAVIOR_STEP_SECONDS);
			// The older hook writes its endpoint last before it retires on this exact boundary.
			expect(translucencies(effects)).toEqual([1, 1]);
			expect(translucencies(effects)).toEqual([1, 1]);
			advance(effects, BEHAVIOR_STEP_SECONDS);
			expect(translucencies(effects)[0]).toBeCloseTo(3 / 8);
			expect(translucencies(effects)[1]).toBeCloseTo(
				kind === "transparent" ? 3 / 8 : 1,
			);
		},
	);

	it("allows an older part hook to write after a newer whole-object hook", () => {
		const effects = install(2);
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent-part",
				partIndex: 0,
				start: 0,
				end: 1,
				durationSeconds: 4 * BEHAVIOR_STEP_SECONDS,
			},
			"live",
		);
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent",
				start: 1,
				end: 0,
				durationSeconds: 8 * BEHAVIOR_STEP_SECONDS,
			},
			"live",
		);
		advance(effects, 2 * BEHAVIOR_STEP_SECONDS);
		expect(translucencies(effects)).toEqual([0.5, 0.75]);
	});

	it("holds an immediate write until the next update without cancelling an active hook", () => {
		const effects = install(1);
		effects.applyTranslucency(
			TARGET,
			{ kind: "transparent", start: 0, end: 1, durationSeconds: 1 },
			"live",
		);
		advance(effects, BEHAVIOR_STEP_SECONDS / 2);
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent",
				start: 0,
				end: 0.8,
				durationSeconds: MINIMUM_TIMED_EFFECT_SECONDS / 2,
			},
			"live",
		);
		expect(translucencies(effects)).toEqual([0.8]);
		advance(effects, BEHAVIOR_STEP_SECONDS / 4);
		expect(translucencies(effects)[0]).toBeCloseTo(
			(3 * BEHAVIOR_STEP_SECONDS) / 4,
		);
	});

	it("treats the threshold duration as timed and starts at the command's fractional phase", () => {
		const effects = install(1, 0.2);
		advance(effects, BEHAVIOR_STEP_SECONDS / 2);
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent",
				start: 1,
				end: 0.4,
				durationSeconds: MINIMUM_TIMED_EFFECT_SECONDS,
			},
			"live",
		);
		expect(translucencies(effects)).toEqual([0.2]);
		advance(effects, MINIMUM_TIMED_EFFECT_SECONDS / 2);
		expect(translucencies(effects)[0]).toBeCloseTo(0.7);
		advance(effects, BEHAVIOR_STEP_SECONDS);
		expect(translucencies(effects)).toEqual([0.4]);
	});

	it("retains the original floor while initially cloaked and never replays expired ignored writes", () => {
		const effects = new EffectSystem();
		effects.install(NODE_ID, 2, { translucency: 0.4, cloaked: true });
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent",
				start: 1,
				end: 0,
				durationSeconds: BEHAVIOR_STEP_SECONDS,
			},
			"live",
		);
		advance(effects, 2 * BEHAVIOR_STEP_SECONDS);
		effects.setCloaked(NODE_ID, false);
		expect(translucencies(effects)).toEqual([0, 0]);
		advance(effects, BEHAVIOR_STEP_SECONDS);
		expect(translucencies(effects)).toEqual([0, 0]);
		effects.applyTranslucency(
			TARGET,
			{ kind: "transparent", start: 1, end: 0, durationSeconds: 0 },
			"live",
		);
		expect(translucencies(effects)).toEqual([0.4, 0.4]);
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent-part",
				partIndex: 0,
				start: 1,
				end: 0,
				durationSeconds: 0,
			},
			"live",
		);
		expect(translucencies(effects)).toEqual([0, 0.4]);
	});

	it("preserves permitted fractional material state while cloaked and resumes an unexpired hook", () => {
		const effects = install(1);
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent",
				start: 0,
				end: 1,
				durationSeconds: 8 * BEHAVIOR_STEP_SECONDS,
			},
			"live",
		);
		advance(effects, BEHAVIOR_STEP_SECONDS / 2);
		const before = translucencies(effects);
		effects.setCloaked(NODE_ID, true);
		advance(effects, 3 * BEHAVIOR_STEP_SECONDS);
		expect(translucencies(effects)).toEqual(before);
		effects.setCloaked(NODE_ID, false);
		expect(translucencies(effects)).toEqual(before);
		advance(effects, BEHAVIOR_STEP_SECONDS);
		expect(translucencies(effects)[0]).toBeCloseTo(4.5 / 8);
	});

	it("replays translucency on the owner's independent semantic clock", () => {
		const effects = install(1);
		advance(effects, BEHAVIOR_STEP_SECONDS / 2);
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent",
				start: 1,
				end: 0,
				durationSeconds: 4 * BEHAVIOR_STEP_SECONDS,
			},
			"initial-state",
		);
		effects.foldSemanticStep(NODE_ID);
		expect(translucencies(effects)).toEqual([0.75]);
		effects.finishReplay(NODE_ID, BEHAVIOR_STEP_SECONDS / 2);
		expect(translucencies(effects)).toEqual([0.625]);
		advance(effects, BEHAVIOR_STEP_SECONDS / 2);
		expect(translucencies(effects)[0]).toBeCloseTo(0.5);
	});

	it("folds part rates without sharing ownership or continually invalidating presentation", () => {
		const effects = install();
		const other = "scene-node:2" as SceneNodeId;
		effects.install(other, 2, { translucency: 0, cloaked: false });
		const { router } = buildEffectRouter(effects);
		const provenance = {
			assetId: "0x33000D34" as const,
			authoredOrder: 0,
			authoredPosition: 1,
			producer: "physics-script" as const,
		};
		router.dispatch(
			{ kind: "texture-velocity", uSpeed: 0.25, vSpeed: 0.5 },
			TARGET,
			provenance,
			"initial-state",
		);
		router.dispatch(
			{ kind: "texture-velocity-part", partIndex: 1, uSpeed: -0.1, vSpeed: 0 },
			TARGET,
			provenance,
			"live",
		);
		expect(
			effects
				.samplePresentation(NODE_ID)
				.partRenderStates.map((p) => p.textureVelocity),
		).toEqual([
			[0.25, 0.5],
			[-0.1, 0],
		]);
		expect(
			effects
				.samplePresentation(other)
				.partRenderStates.map((p) => p.textureVelocity),
		).toEqual([
			[0, 0],
			[0, 0],
		]);
		expect(router.getObservations().map((o) => o.outcome)).toEqual([
			"folded-initial-state",
			"executed",
		]);
		advance(effects, 1);
		expect(effects.needsPresentation(NODE_ID)).toBe(false);
		effects.applyTextureVelocity(TARGET, {
			kind: "texture-velocity-part",
			partIndex: 1,
			uSpeed: -0.1,
			vSpeed: 0,
		});
		expect(effects.needsPresentation(NODE_ID)).toBe(false);
		effects.applyObjectTranslucency(NODE_ID, 0.4);
		expect(
			effects.samplePresentation(NODE_ID).partRenderStates[1]?.textureVelocity,
		).toEqual([-0.1, 0]);
		effects.applyTextureVelocity(TARGET, {
			kind: "texture-velocity",
			uSpeed: 0,
			vSpeed: 0,
		});
		expect(
			effects
				.samplePresentation(NODE_ID)
				.partRenderStates.map((p) => p.textureVelocity),
		).toEqual([
			[0, 0],
			[0, 0],
		]);
		effects.remove(NODE_ID);
		effects.install(NODE_ID, 1, { translucency: 0, cloaked: false });
		expect(effects.samplePresentation(NODE_ID).partRenderStates).toEqual([
			{ translucency: 0, textureVelocity: [0, 0] },
		]);
	});

	it("rejects a texture hook outside the installed part layout", () => {
		const effects = install(1);
		expect(() =>
			effects.applyTextureVelocity(TARGET, {
				kind: "texture-velocity-part",
				partIndex: 1,
				uSpeed: 1,
				vSpeed: 1,
			}),
		).toThrow("TextureVelocityPart index 1 is out of range");
	});

	it("seeds every part from whole-object translucency before part commands", () => {
		const effects = install(3, 0.5);
		expect(translucencies(effects)).toEqual([0.5, 0.5, 0.5]);

		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent-part",
				durationSeconds: 0,
				end: 1,
				partIndex: 1,
				start: 0.5,
			},
			"live",
		);
		expect(translucencies(effects)).toEqual([0.5, 1, 0.5]);
	});

	it("updates every part without cancelling an in-flight part ramp", () => {
		const effects = install(2, 0.5);
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent-part",
				durationSeconds: 1,
				end: 0.8,
				partIndex: 1,
				start: 0.2,
			},
			"live",
		);

		effects.applyObjectTranslucency(NODE_ID, 0.4);
		expect(translucencies(effects)).toEqual([0.4, 0.4]);
		advance(effects, 0.5);
		expect(translucencies(effects)[0]).toBe(0.4);
		expect(translucencies(effects)[1]).toBeCloseTo(0.5);
		effects.applyTranslucency(
			TARGET,
			{ kind: "transparent", start: 1, end: 0, durationSeconds: 0 },
			"live",
		);
		// Ordinary current-level writes did not replace the original object-description floor.
		expect(translucencies(effects)).toEqual([0.5, 0.5]);
	});

	it("steps every installed state, not only those a playback drives", () => {
		// The defect this clock exists to fix: stepping used to hang off `AnimationSystem`, so a
		// resident with a script but no animation never advanced and its ramps were inert.
		const effects = new EffectSystem();
		effects.install("scene-node:scripted" as SceneNodeId, 1, {
			translucency: 0,
			cloaked: false,
		});
		effects.install("scene-node:animated" as SceneNodeId, 1, {
			translucency: 0,
			cloaked: false,
		});
		for (const nodeId of ["scene-node:scripted", "scene-node:animated"]) {
			effects.applyTranslucency(
				{ generation: 1, targetId: behaviorTargetId(nodeId) },
				{
					kind: "transparent-part",
					durationSeconds: 1,
					end: 1,
					partIndex: 0,
					start: 0,
				},
				"live",
			);
		}

		advance(effects, 0.5);

		for (const nodeId of ["scene-node:scripted", "scene-node:animated"]) {
			const sample = effects.samplePresentation(nodeId as SceneNodeId);
			expect(sample.partRenderStates[0]?.translucency).toBeCloseTo(0.5, 1);
		}
	});

	it("commits whole steps only, holding the remainder for the next advance", () => {
		const effects = install(1);
		effects.applyScale(TARGET, { durationSeconds: 1, end: 3 });

		// Two sub-step advances that together exceed one step commit exactly one.
		advance(effects, 0.02);
		advance(effects, 0.02);

		// Committed 1/30 plus a 0.0067 remainder: interpolation is continuous across the boundary.
		expect(
			effects.samplePresentation(NODE_ID).rootTransformModifier.m11,
		).toBeCloseTo(1.08, 2);
	});

	it("accumulates authored omega once per semantic step", () => {
		const effects = install();
		effects.applySetOmega(TARGET, new Vec3(0, 0, 1));

		const before = effects.samplePresentation(NODE_ID);
		advance(effects, 1 / 30);
		const after = effects.samplePresentation(NODE_ID);

		expect(after.rootTransformModifier).not.toEqual(
			before.rootTransformModifier,
		);
	});

	it("applies a sub-threshold ramp instantly and a timed ramp progressively", () => {
		const effects = install();
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent-part",
				durationSeconds: 0,
				end: 0.75,
				partIndex: 0,
				start: 0,
			},
			"live",
		);
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent-part",
				durationSeconds: 1,
				end: 1,
				partIndex: 1,
				start: 0,
			},
			"live",
		);

		// Part 0 jumped straight to its endpoint; part 1 is still at its start value.
		expect(translucencies(effects)).toEqual([0.75, 0]);

		advance(effects, 0.5);
		expect(translucencies(effects)[1]).toBeCloseTo(0.5);
	});

	it("lands a timed ramp exactly on its endpoint across uneven steps", () => {
		const effects = install(1);
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent-part",
				durationSeconds: 1,
				end: 1,
				partIndex: 0,
				start: 0,
			},
			"live",
		);

		for (const step of [0.3, 0.45, 0.4]) {
			advance(effects, step);
		}

		expect(translucencies(effects)).toEqual([1]);
	});

	it("samples a ramp without committing the sampled time", () => {
		const effects = install(1);
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent-part",
				durationSeconds: 1,
				end: 1,
				partIndex: 0,
				start: 0,
			},
			"live",
		);

		// Less than one behavior step, so nothing commits and the value comes purely from
		// sub-step interpolation against the shared clock's phase.
		advance(effects, 0.02);
		expect(translucencies(effects)[0]).toBeCloseTo(0.02);
		// Sampling must not advance the ramp: the same phase yields the same value.
		expect(translucencies(effects)[0]).toBeCloseTo(0.02);
	});

	it("leaves a replayed ramp in flight rather than snapping it to its endpoint", () => {
		const effects = install(1);

		// Replay applies the ramp, then the remaining elapsed steps advance it. Snapping to the end
		// here would discard a ramp that was still running when the owner became observable.
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent-part",
				durationSeconds: 10,
				end: 1,
				partIndex: 0,
				start: 0,
			},
			"live",
		);
		advance(effects, 2.5);

		expect(translucencies(effects)[0]).toBeCloseTo(0.25);
	});

	it.each([0, 1])(
		"ignores absent transparency parts without disturbing resident ramps (duration %s)",
		(durationSeconds) => {
			const effects = install(1);
			effects.applyTranslucency(
				TARGET,
				{
					kind: "transparent-part",
					durationSeconds: 1,
					end: 1,
					partIndex: 0,
					start: 0,
				},
				"live",
			);
			translucencies(effects);
			expect(effects.needsPresentation(NODE_ID)).toBe(false);

			// The first absent slot and the reported failing index both leave state untouched.
			for (const partIndex of [1, 10]) {
				effects.applyTranslucency(
					TARGET,
					{
						kind: "transparent-part",
						durationSeconds,
						end: 0,
						partIndex,
						start: 1,
					},
					"live",
				);
			}
			expect(effects.needsPresentation(NODE_ID)).toBe(false);
			expect(translucencies(effects)).toEqual([0]);
			advance(effects, 0.5);
			expect(translucencies(effects)[0]).toBeCloseTo(0.5);
			advance(effects, 0.5);
			expect(translucencies(effects)[0]).toBeCloseTo(1);
		},
	);

	it("refuses to mutate state for a node it does not hold", () => {
		const effects = new EffectSystem();

		expect(() => effects.applySetOmega(TARGET, new Vec3(0, 0, 1))).toThrow(
			"does not exist",
		);
	});

	it("ramps whole-object scale and lands exactly on its target", () => {
		const effects = install(1);

		effects.applyScale(TARGET, { durationSeconds: 1, end: 3 });
		advance(effects, 0.5);
		// Halfway from the identity scale toward 3.
		expect(
			effects.samplePresentation(NODE_ID).rootTransformModifier.m11,
		).toBeCloseTo(2);

		advance(effects, 0.5);
		expect(effects.samplePresentation(NODE_ID).rootTransformModifier.m11).toBe(
			3,
		);
	});

	it("continues a mid-flight scale ramp from the current scale, as retail does", () => {
		const effects = install(1);

		effects.applyScale(TARGET, { durationSeconds: 1, end: 3 });
		advance(effects, 0.5);
		// Retail's SetScale interpolates from wherever the object is now, not from a fixed base.
		effects.applyScale(TARGET, { durationSeconds: 1, end: 4 });

		advance(effects, 0.5);
		expect(
			effects.samplePresentation(NODE_ID).rootTransformModifier.m11,
		).toBeCloseTo(3);
	});

	it("applies a sub-threshold scale immediately", () => {
		const effects = install(1);

		effects.applyScale(TARGET, { durationSeconds: 0, end: 2 });

		expect(effects.samplePresentation(NODE_ID).rootTransformModifier.m11).toBe(
			2,
		);
	});

	it("interpolates a scale ramp across the sub-step without committing it", () => {
		const effects = install(1);
		effects.applyScale(TARGET, { durationSeconds: 1, end: 3 });

		// Under one behavior step, so nothing commits and the value is pure interpolation.
		advance(effects, 0.02);

		expect(
			effects.samplePresentation(NODE_ID).rootTransformModifier.m11,
		).toBeCloseTo(1.04);
		// Sampling must not advance the ramp: the same phase yields the same value.
		expect(
			effects.samplePresentation(NODE_ID).rootTransformModifier.m11,
		).toBeCloseTo(1.04);
	});

	it("keeps part timelines independent and drops removed entity state", () => {
		const effects = install();
		effects.applyTranslucency(
			TARGET,
			{
				kind: "transparent-part",
				durationSeconds: 1,
				end: 1,
				partIndex: 1,
				start: 0,
			},
			"live",
		);
		advance(effects, 0.5);

		expect(translucencies(effects)[0]).toBe(0);
		expect(effects.getDiagnostics().residentEffectStateCount).toBe(1);

		effects.remove(NODE_ID);
		expect(effects.getDiagnostics().residentEffectStateCount).toBe(0);
	});
});
