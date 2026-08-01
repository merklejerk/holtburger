import { describe, expect, it } from "vitest";
import type { DecodedAnimationHook } from "../../assets/decode-animation-record";
import type { PreparedAnimation } from "../animation/animation-asset-repository";
import { transformPoint3 } from "../math/matrices";
import { Mat4, Vec3 } from "../math/types";
import { HookSystem } from "./hook-system";

describe("HookSystem diagnostics", () => {
	it("applies authored omega once per retail static update and interpolates by step fraction", () => {
		const hooks = new HookSystem();
		hooks.install("scene-node:1", animation(), [0]);

		const halfway = transformPoint3(
			hooks.sampleVisualRoot("scene-node:1", 0.5),
			new Vec3(1, 0, 0),
		);
		expect(halfway.x).toBeCloseTo(Math.cos(0.5));
		expect(halfway.y).toBeCloseTo(Math.sin(0.5));

		hooks.advanceCommittedRotation("scene-node:1");
		const committed = transformPoint3(
			hooks.sampleVisualRoot("scene-node:1", 0),
			new Vec3(1, 0, 0),
		);
		expect(committed.x).toBeCloseTo(Math.cos(1));
		expect(committed.y).toBeCloseTo(Math.sin(1));
	});

	it("keeps cumulative outcomes while bounding recent provenance", () => {
		const hooks = new HookSystem();
		hooks.install(
			"scene-node:1",
			animation(),
			Array.from({ length: 300 }, () => 0),
		);

		expect(hooks.getDiagnostics()).toMatchObject({
			executedHookCount: 300,
		});
		expect(hooks.getObservations()).toHaveLength(256);
	});
});

function animation(): PreparedAnimation {
	const hook: DecodedAnimationHook = {
		authoredOrder: 0,
		direction: "both",
		frameIndex: 0,
		kind: "set-omega",
		omega: new Vec3(0, 0, 1),
	};
	return {
		frameCount: 1,
		framesPerSecond: 30,
		hooks: [hook],
		id: "0x03000001",
		partCount: 1,
		partFrames: [Mat4.identity()],
		positionFrames: [],
	};
}
