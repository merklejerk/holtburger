import { describe, expect, it } from "vitest";

import { clientDebugEnabled } from "./client-debug";

describe("client debug launch flag", () => {
	it("enables diagnostics only for the value produced by --debug", () => {
		expect(clientDebugEnabled("?debug=true")).toBe(true);
		expect(clientDebugEnabled("")).toBe(false);
		expect(clientDebugEnabled("?debug=false")).toBe(false);
	});
});
