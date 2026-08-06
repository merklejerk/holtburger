import { describe, expect, it } from "vitest";
import type { BehaviorTarget } from "../behavior/behavior-event-router";
import { Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import { EffectSystem } from "./effect-system";

const TARGET: BehaviorTarget = {
	generation: 1,
	nodeId: "node-1" as SceneNodeId,
};

function install(partCount = 2) {
	const effects = new EffectSystem();
	effects.install(TARGET.nodeId, partCount);
	return effects;
}

function translucencies(
	effects: EffectSystem,
	fractionalSeconds = 0,
): number[] {
	return effects
		.samplePresentation(TARGET.nodeId, fractionalSeconds, 0)
		.partRenderStates.map((state) => state.translucency);
}

describe("EffectSystem", () => {
	it("accumulates authored omega once per semantic step", () => {
		const effects = install();
		effects.applySetOmega(TARGET, new Vec3(0, 0, 1));

		const before = effects.samplePresentation(TARGET.nodeId, 0, 0);
		effects.advanceSemanticStep(TARGET.nodeId, 1 / 30);
		const after = effects.samplePresentation(TARGET.nodeId, 0, 0);

		expect(after.rootRotationModifier).not.toEqual(before.rootRotationModifier);
	});

	it("applies a sub-threshold ramp instantly and a timed ramp progressively", () => {
		const effects = install();
		effects.applyTransparentPart(TARGET, {
			durationSeconds: 0,
			end: 0.75,
			partIndex: 0,
			start: 0,
		});
		effects.applyTransparentPart(TARGET, {
			durationSeconds: 1,
			end: 1,
			partIndex: 1,
			start: 0,
		});

		// Part 0 jumped straight to its endpoint; part 1 is still at its start value.
		expect(translucencies(effects)).toEqual([0.75, 0]);

		effects.advanceSemanticStep(TARGET.nodeId, 0.5);
		expect(translucencies(effects)[1]).toBeCloseTo(0.5);
	});

	it("lands a timed ramp exactly on its endpoint across uneven steps", () => {
		const effects = install(1);
		effects.applyTransparentPart(TARGET, {
			durationSeconds: 1,
			end: 1,
			partIndex: 0,
			start: 0,
		});

		for (const step of [0.3, 0.45, 0.4]) {
			effects.advanceSemanticStep(TARGET.nodeId, step);
		}

		expect(translucencies(effects)).toEqual([1]);
	});

	it("samples a ramp without committing the sampled time", () => {
		const effects = install(1);
		effects.applyTransparentPart(TARGET, {
			durationSeconds: 1,
			end: 1,
			partIndex: 0,
			start: 0,
		});

		expect(translucencies(effects, 0.5)[0]).toBeCloseTo(0.5);
		// Sampling ahead must not advance the ramp itself.
		expect(translucencies(effects, 0)[0]).toBe(0);
	});

	it("leaves a replayed ramp in flight rather than snapping it to its endpoint", () => {
		const effects = install(1);

		// Replay applies the ramp, then the remaining elapsed steps advance it. Snapping to the end
		// here would discard a ramp that was still running when the owner became observable.
		effects.applyTransparentPart(TARGET, {
			durationSeconds: 10,
			end: 1,
			partIndex: 0,
			start: 0,
		});
		effects.advanceSemanticStep(TARGET.nodeId, 2.5);

		expect(translucencies(effects)[0]).toBeCloseTo(0.25);
	});

	it("rejects a part index outside the installed state", () => {
		const effects = install(1);

		expect(() =>
			effects.applyTransparentPart(TARGET, {
				durationSeconds: 0,
				end: 1,
				partIndex: 3,
				start: 0,
			}),
		).toThrow("out of range");
	});

	it("refuses to mutate state for a node it does not hold", () => {
		const effects = new EffectSystem();

		expect(() => effects.applySetOmega(TARGET, new Vec3(0, 0, 1))).toThrow(
			"does not exist",
		);
	});

	it("keeps part timelines independent and drops removed entity state", () => {
		const effects = install();
		effects.applyTransparentPart(TARGET, {
			durationSeconds: 1,
			end: 1,
			partIndex: 1,
			start: 0,
		});
		effects.advanceSemanticStep(TARGET.nodeId, 0.5);

		expect(translucencies(effects)[0]).toBe(0);
		expect(effects.getDiagnostics().residentEffectStateCount).toBe(1);

		effects.remove(TARGET.nodeId);
		expect(effects.getDiagnostics().residentEffectStateCount).toBe(0);
	});
});
