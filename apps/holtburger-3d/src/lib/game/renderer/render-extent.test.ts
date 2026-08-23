import { describe, expect, it } from "vitest";
import { resolveRenderExtent, validateRenderExtent } from "./render-extent";

describe("render extent", () => {
	it("resolves each rounded drawing dimension exactly once from CSS size and render scale", () => {
		expect(resolveRenderExtent(801.9, 451.9, 1.5)).toEqual({
			height: 677,
			width: 1_202,
		});
	});

	it("retains a valid one-pixel backing extent for a collapsed canvas", () => {
		expect(resolveRenderExtent(0, 0, 1)).toEqual({ height: 1, width: 1 });
	});

	it("rejects invalid CSS, scale, and committed extent facts", () => {
		expect(() => resolveRenderExtent(Number.NaN, 1, 1)).toThrow("CSS extent");
		expect(() => resolveRenderExtent(1, 1, 0)).toThrow("render scale");
		expect(() =>
			validateRenderExtent({ height: 1.5, width: 1 }, "Fixture"),
		).toThrow("positive integers");
	});
});
