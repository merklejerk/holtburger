import { describe, expect, it } from "vitest";
import { Mat4 } from "../math/types";
import { skyViewMatrix } from "./webgl2-sky-pass";

describe("skyViewMatrix", () => {
	/** Celestial objects sit at the viewer's origin, so the sky rotates but never translates. */
	it("removes the view translation while preserving orientation", () => {
		const view = Mat4.identity();
		view.m11 = 0;
		view.m13 = -1;
		view.m41 = 12;
		view.m42 = -34;
		view.m43 = 56;
		const result = skyViewMatrix(view, new Float32Array(16));
		expect([result[12], result[13], result[14]]).toEqual([0, 0, 0]);
		expect(result[0]).toBe(0);
		expect(result[2]).toBe(-1);
	});
});
