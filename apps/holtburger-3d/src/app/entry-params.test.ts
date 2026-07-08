import { describe, expect, it } from "vitest";

import { readEntryParams } from "./entry-params";

describe("readEntryParams", () => {
	it("preserves query parameters in insertion order", () => {
		expect(readEntryParams("?landblock=0x0007FFFF&spawn=0x02000001")).toEqual([
			{ key: "landblock", value: "0x0007FFFF" },
			{ key: "spawn", value: "0x02000001" },
		]);
	});

	it("returns no params for an empty query", () => {
		expect(readEntryParams("")).toEqual([]);
	});
});
