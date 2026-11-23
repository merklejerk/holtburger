import { describe, expect, it } from "vitest";

import {
	classifyExplorerWeenieInput,
	settleExplorerWeenieSearch,
} from "./weenie-picker-state";

describe("Explorer weenie search state", () => {
	it("keeps numeric intent out of search even while invalid", () => {
		expect(classifyExplorerWeenieInput("42")).toEqual({
			kind: "numeric",
			result: { kind: "valid", value: 42 },
		});
		expect(classifyExplorerWeenieInput("0x2A")).toEqual({
			kind: "numeric",
			result: { kind: "valid", value: 42 },
		});
		expect(classifyExplorerWeenieInput("0x")).toMatchObject({
			kind: "numeric",
			result: { kind: "invalid" },
		});
		expect(classifyExplorerWeenieInput("4294967296")).toMatchObject({
			kind: "numeric",
			result: { kind: "invalid" },
		});
	});

	it("searches mixed digit-leading names and ordinary text", () => {
		expect(classifyExplorerWeenieInput("11-sec Firespurt")).toEqual({
			kind: "search",
			query: "11-sec Firespurt",
		});
		expect(classifyExplorerWeenieInput("  Drudge  ")).toEqual({
			kind: "search",
			query: "Drudge",
		});
	});

	it("rejects stale search successes and failures with one revision rule", () => {
		expect(settleExplorerWeenieSearch(4, 3, ["old result"])).toEqual({
			kind: "stale",
		});
		expect(settleExplorerWeenieSearch(4, 3, new Error("old failure"))).toEqual({
			kind: "stale",
		});
		expect(settleExplorerWeenieSearch(4, 4, ["current result"])).toEqual({
			kind: "current",
			value: ["current result"],
		});
	});
});
