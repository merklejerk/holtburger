import { describe, expect, it } from "vitest";

import {
	classifyExplorerWeenieInput,
	editExplorerWeeniePicker,
	resolveExplorerWeenieSpawnTarget,
	selectExplorerWeenie,
	settleExplorerWeenieSearch,
} from "./explorer-weenie-picker-state";

describe("Explorer weenie picker state", () => {
	it("keeps numeric intent out of search even while invalid", () => {
		expect(classifyExplorerWeenieInput("42")).toEqual({
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

	it("resolves only direct WCIDs or explicitly selected identities", () => {
		expect(
			resolveExplorerWeenieSpawnTarget(editExplorerWeeniePicker("0x2A")),
		).toBe(42);
		const selected = selectExplorerWeenie({
			wcid: 52077,
			name: "Rynthid Assessment Crystal",
			className: "rynthidassessmentcrystal",
		});
		expect(resolveExplorerWeenieSpawnTarget(selected)).toBe(52077);
		expect(() =>
			resolveExplorerWeenieSpawnTarget(editExplorerWeeniePicker("Drudge")),
		).toThrow("Choose a weenie");
		expect(() =>
			resolveExplorerWeenieSpawnTarget(editExplorerWeeniePicker("0x")),
		).toThrow("decimal or prefixed");
	});

	it("invalidates an exact selection on any subsequent edit", () => {
		const selected = selectExplorerWeenie({
			wcid: 42,
			name: "Drudge",
			className: "drudge",
		});
		expect(selected.kind).toBe("selected");
		expect(editExplorerWeeniePicker("Drudg")).toEqual({
			kind: "editing",
			input: "Drudg",
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

	it("resolving a successful spawn target retains the committed picker state", () => {
		const selected = selectExplorerWeenie({
			wcid: 42,
			name: "Drudge",
			className: "drudge",
		});
		expect(resolveExplorerWeenieSpawnTarget(selected)).toBe(42);
		expect(selected).toEqual({
			kind: "selected",
			input: "Drudge",
			selection: { wcid: 42, name: "Drudge", className: "drudge" },
		});
	});
});
