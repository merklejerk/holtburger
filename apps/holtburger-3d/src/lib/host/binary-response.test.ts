import { describe, expect, it } from "vitest";

import { asHostBinary } from "./binary-response";

describe("asHostBinary", () => {
	it("preserves typed arrays and wraps ArrayBuffers", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		expect(asHostBinary(bytes, "test")).toBe(bytes);
		expect(asHostBinary(bytes.buffer, "test")).toEqual(bytes);
	});

	it("rejects values outside the byte contract", () => {
		expect(() => asHostBinary([0, 127, 255], "test")).toThrow(
			"test returned a non-binary response.",
		);
	});
});
