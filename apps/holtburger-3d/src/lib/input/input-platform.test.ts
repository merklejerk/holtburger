import { describe, expect, it } from "vitest";
import { detectInputPlatform } from "./input-platform";

describe("input platform", () => {
	it("resolves the platform from the browser user agent", () => {
		expect(detectInputPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe(
			"mac",
		);
		expect(detectInputPlatform("Mozilla/5.0 (Windows NT 10.0)")).toBe(
			"windows",
		);
		expect(detectInputPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe(
			"linux",
		);
		expect(detectInputPlatform("test host")).toBe("unknown");
	});
});
