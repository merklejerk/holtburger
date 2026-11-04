import { describe, expect, it } from "vitest";
import { formatError } from "./format-error";

describe("formatError", () => {
	it("preserves the failed dependency under nested and aggregate context", () => {
		const root = new Error("Animation 0x0300055b missing");
		const error = new AggregateError(
			[
				new Error("Motion table 0x09000021", { cause: root }),
				"cleanup refused",
			],
			"Presentation failed",
		);
		expect(formatError(error)).toBe(
			"Presentation failed\nCaused by: Motion table 0x09000021\nCaused by: Animation 0x0300055b missing\nCaused by: cleanup refused",
		);
	});
	it("handles circular and non-Error rejections", () => {
		const error = new Error("cycle");
		error.cause = error;
		expect(formatError(error)).toBe("cycle\nCaused by: [repeated error]");
		expect(formatError(null)).toBe("null");
	});
});
