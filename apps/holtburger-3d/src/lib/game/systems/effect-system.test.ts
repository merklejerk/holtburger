import { describe, expect, it } from "vitest";
import type { DecodedAnimationHook } from "../../assets/decode-animation-record";
import type { PreparedAnimation } from "../animation/animation-asset-repository";
import { transformPoint3 } from "../math/matrices";
import { Mat4, Vec3 } from "../math/types";
import { EffectSystem } from "./effect-system";

const NODE = "scene-node:1";

describe("EffectSystem", () => {
	it("applies authored omega once per semantic step and samples its fractional modifier", () => {
		const effects = new EffectSystem();
		effects.install(NODE, 1);
		effects.executeDepartedFrames(
			NODE,
			animation([setOmegaHook(new Vec3(0, 0, 1))]),
			[0],
			"forward",
			"live",
		);

		const halfway = transformPoint3(
			effects.samplePresentation(NODE, 1 / 60, 0.5).rootRotationModifier,
			new Vec3(1, 0, 0),
		);
		expect(halfway.x).toBeCloseTo(Math.cos(0.5));
		expect(halfway.y).toBeCloseTo(Math.sin(0.5));

		effects.advanceSemanticStep(NODE, 1 / 30);
		const committed = transformPoint3(
			effects.samplePresentation(NODE, 0, 0).rootRotationModifier,
			new Vec3(1, 0, 0),
		);
		expect(committed.x).toBeCloseTo(Math.cos(1));
		expect(committed.y).toBeCloseTo(Math.sin(1));
	});

	it("sets immediate translucency exactly and samples timed ramps without mutation", () => {
		const effects = new EffectSystem();
		effects.install(NODE, 1);
		effects.executeDepartedFrames(
			NODE,
			animation([transparentPartHook(0, 0, 0.75, 0)]),
			[0],
			"forward",
			"live",
		);
		expect(effects.samplePresentation(NODE, 0, 0).partRenderStates).toEqual([
			{ translucency: 0.75 },
		]);

		effects.executeDepartedFrames(
			NODE,
			animation([transparentPartHook(0, 0.25, 1, 1)]),
			[0],
			"forward",
			"live",
		);
		expect(
			effects.samplePresentation(NODE, 0.5, 0).partRenderStates[0]
				?.translucency,
		).toBeCloseTo(0.625);
		expect(
			effects.samplePresentation(NODE, 0, 0).partRenderStates[0]?.translucency,
		).toBe(0.25);
	});

	it("lands timed ramps exactly on their endpoint with uneven steps", () => {
		const effects = new EffectSystem();
		effects.install(NODE, 1);
		effects.executeDepartedFrames(
			NODE,
			animation([transparentPartHook(0, 0, 1, 1)]),
			[0],
			"forward",
			"live",
		);
		for (let step = 0; step < 4; step += 1)
			effects.advanceSemanticStep(NODE, 0.3);

		expect(
			effects.samplePresentation(NODE, 0, 0).partRenderStates[0]?.translucency,
		).toBe(1);
	});

	it("keeps part timelines independent and removes complete entity state", () => {
		const effects = new EffectSystem();
		effects.install(NODE, 2);
		effects.executeDepartedFrames(
			NODE,
			animation([
				transparentPartHook(0, 0, 0.4, 0),
				transparentPartHook(1, 0, 0.8, 0),
			]),
			[0],
			"forward",
			"live",
		);
		expect(effects.samplePresentation(NODE, 0, 0).partRenderStates).toEqual([
			{ translucency: 0.4 },
			{ translucency: 0.8 },
		]);

		effects.remove(NODE);
		expect(effects.getDiagnostics().residentEffectStateCount).toBe(0);
		expect(() => effects.samplePresentation(NODE, 0, 0)).toThrow(
			"Effect state for scene-node:1 does not exist",
		);
	});

	it("retains bounded ordered provenance for executed and deferred hooks", () => {
		const effects = new EffectSystem();
		effects.install(NODE, 1);
		const clip = animation([
			setOmegaHook(new Vec3(0, 0, 1)),
			deferredEffectHook(),
		]);
		for (let index = 0; index < 150; index += 1) {
			effects.executeDepartedFrames(NODE, clip, [0], "forward", "live");
		}

		expect(effects.getDiagnostics()).toMatchObject({
			deferredHookCount: 150,
			executedHookCount: 150,
		});
		expect(effects.getObservations()).toHaveLength(256);
		expect(effects.getObservations().slice(-2)).toMatchObject([
			{ authoredOrder: 0, command: "set-omega", outcome: "executed" },
			{ authoredOrder: 1, command: "ethereal", outcome: "deferred" },
		]);
	});
});

function animation(hooks: readonly DecodedAnimationHook[]): PreparedAnimation {
	return {
		frameCount: 1,
		framesPerSecond: 30,
		hooks,
		id: "0x03000001",
		partCount: 2,
		partFrames: [Mat4.identity(), Mat4.identity()],
		positionFrames: [],
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
	partIndex: number,
	start: number,
	end: number,
	durationSeconds: number,
): DecodedAnimationHook {
	return {
		authoredOrder: partIndex,
		direction: "both",
		durationSeconds,
		end,
		frameIndex: 0,
		kind: "transparent-part",
		partIndex,
		start,
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
