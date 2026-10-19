import { describe, expect, it } from "vitest";
import fixture from "./fixtures/object-inspection-wire.json";
import { decodeObjectInspectionResult } from "./client-object-inspection-contract";

describe("object inspection host contract", () => {
	it("preserves exact item XP and rejects malformed progression payloads", () => {
		const item = structuredClone(fixture.item);
		item.outcome.inspection.details.details.progression.totalXp =
			"9007199254740993";
		expect(decodeObjectInspectionResult(item)).toEqual(item);
		for (const totalXp of [123, "-1", "01", "18446744073709551616"]) {
			const malformed = structuredClone(item);
			Object.assign(malformed.outcome.inspection.details.details.progression, {
				totalXp,
			});
			expect(() => decodeObjectInspectionResult(malformed)).toThrow();
		}
	});
	it("accepts every Rust-serialized outcome and subject variant", () => {
		for (const value of Object.values(fixture)) {
			expect(decodeObjectInspectionResult(value)).toEqual(value);
		}
	});

	it("accepts an undisclosed portal destination", () => {
		const item = structuredClone(fixture.item);
		const details: { portalDestination: string | null } =
			item.outcome.inspection.details.details;
		details.portalDestination = null;
		expect(decodeObjectInspectionResult(item)).toEqual(item);
	});

	it("rejects malformed discriminants, fields, and nested payloads", () => {
		expect(() =>
			decodeObjectInspectionResult({
				...fixture.rejected,
				outcome: { kind: "denied" },
			}),
		).toThrow();
		expect(() =>
			decodeObjectInspectionResult({ ...fixture.missing, stale: true }),
		).toThrow();
		expect(() =>
			decodeObjectInspectionResult({
				...fixture.item,
				outcome: {
					...fixture.item.outcome,
					inspection: {
						...fixture.item.outcome.inspection,
						details: { kind: "item", details: {} },
					},
				},
			}),
		).toThrow();
		expect(() =>
			decodeObjectInspectionResult({ ...fixture.missing, guid: 2 ** 32 }),
		).toThrow();
	});
});
