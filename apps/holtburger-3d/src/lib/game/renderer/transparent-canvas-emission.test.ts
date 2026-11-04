import { describe, expect, it } from "vitest";
import {
	TRANSPARENT_CANVAS_EMISSION_MODE,
	transparentCanvasEmissionMode,
} from "./transparent-canvas-emission";

describe("transparent canvas emission", () => {
	it("classifies every additive source factor without converting source-over", () => {
		expect(
			transparentCanvasEmissionMode({
				destination: "one-minus-src-alpha",
				source: "src-alpha",
			}),
		).toBe(TRANSPARENT_CANVAS_EMISSION_MODE.none);
		expect(
			transparentCanvasEmissionMode({ destination: "one", source: "one" }),
		).toBe(TRANSPARENT_CANVAS_EMISSION_MODE.one);
		expect(
			transparentCanvasEmissionMode({
				destination: "one",
				source: "src-alpha",
			}),
		).toBe(TRANSPARENT_CANVAS_EMISSION_MODE["src-alpha"]);
		expect(
			transparentCanvasEmissionMode({
				destination: "one",
				source: "one-minus-src-alpha",
			}),
		).toBe(TRANSPARENT_CANVAS_EMISSION_MODE["one-minus-src-alpha"]);
	});
});
