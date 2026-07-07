import { describe, expect, it } from "vitest";

import { createAppStatus } from "./app-status";

describe("createAppStatus", () => {
	it("describes the fresh app shell", () => {
		expect(createAppStatus().summary).toContain("clean app surface");
	});
});
