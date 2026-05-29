import { describe, expect, it } from "vitest";

import { parseWorldRenderBackend } from "./render-backend";

describe("parseWorldRenderBackend", () => {
	it("defaults to the Three renderer when unset", () => {
		expect(parseWorldRenderBackend(undefined)).toBe("three");
		expect(parseWorldRenderBackend(null)).toBe("three");
		expect(parseWorldRenderBackend("")).toBe("three");
	});

	it("accepts explicit renderer backend values", () => {
		expect(parseWorldRenderBackend("three")).toBe("three");
		expect(parseWorldRenderBackend("luma")).toBe("luma");
		expect(parseWorldRenderBackend("webgl2")).toBe("webgl2");
	});

	it("fails hard for unsupported renderer backend values", () => {
		expect(() => parseWorldRenderBackend("webgpu")).toThrow(
			'Unsupported VITE_HOLTBURGER_RENDER_BACKEND value "webgpu". Expected "three", "luma", or "webgl2".',
		);
	});
});
