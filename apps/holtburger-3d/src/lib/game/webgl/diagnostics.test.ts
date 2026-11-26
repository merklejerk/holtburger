import { describe, expect, it, vi } from "vitest";
import {
	registerWebGL2Diagnostics,
	requireWebGL2NoError,
	webGL2UploadErrorChecksEnabled,
	type WebGL2DiagnosticSink,
} from "./diagnostics";

function mockGl(error = 0): WebGL2RenderingContext {
	return {
		NO_ERROR: 0,
		getError: vi.fn(() => error),
	} as unknown as WebGL2RenderingContext;
}

function mockSink(checkUploadErrors: boolean): WebGL2DiagnosticSink {
	return {
		checkUploadErrors,
		record: vi.fn(),
		fail: vi.fn(),
		changeBytes: vi.fn(),
	};
}

describe("WebGL2 upload error check gating", () => {
	it("enables synchronous upload checks only for explicit gl-error-checks=true", () => {
		expect(webGL2UploadErrorChecksEnabled("")).toBe(false);
		expect(webGL2UploadErrorChecksEnabled("?debug=true")).toBe(false);
		expect(webGL2UploadErrorChecksEnabled("?gl-error-checks=false")).toBe(
			false,
		);
		expect(webGL2UploadErrorChecksEnabled("?gl-error-checks=true")).toBe(true);
		expect(
			webGL2UploadErrorChecksEnabled("?debug=true&gl-error-checks=true"),
		).toBe(true);
	});

	it("skips gl.getError() when the registered sink disables upload checks", () => {
		const gl = mockGl(0x505);
		const sink = mockSink(false);
		registerWebGL2Diagnostics(gl, sink);

		expect(() => requireWebGL2NoError(gl, "After upload")).not.toThrow();
		expect(gl.getError).not.toHaveBeenCalled();
		expect(sink.fail).not.toHaveBeenCalled();
	});

	it("checks gl.getError() and reports failure when upload checks are enabled", () => {
		const gl = mockGl(0x505);
		const sink = mockSink(true);
		registerWebGL2Diagnostics(gl, sink);

		expect(() => requireWebGL2NoError(gl, "After upload")).toThrow(
			"After upload: WebGL error 0x505.",
		);
		expect(gl.getError).toHaveBeenCalledOnce();
		expect(sink.fail).toHaveBeenCalledWith("After upload: WebGL error 0x505.");
	});

	it("keeps checking gl.getError() on unregistered mock contexts", () => {
		const gl = mockGl(0x502);

		expect(() => requireWebGL2NoError(gl, "Before upload")).toThrow(
			"Before upload: WebGL error 0x502.",
		);
		expect(gl.getError).toHaveBeenCalledOnce();
	});
});
