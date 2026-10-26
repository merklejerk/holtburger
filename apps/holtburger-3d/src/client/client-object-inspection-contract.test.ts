import { describe, expect, it } from "vitest";
import fixture from "./fixtures/object-inspection-wire.json";
import { decodeObjectInspectionResult } from "./client-object-inspection-contract";

describe("object inspection host contract", () => {
	it("preserves independently disclosed lock difficulty and integer percentage points", () => {
		for (const lockpicking of [
			null,
			{ difficulty: 250, successPercent: 73 },
			{ difficulty: 0, successPercent: 0 },
			{ difficulty: null, successPercent: 100 },
			{ difficulty: 250, successPercent: null },
		]) {
			const item = structuredClone(fixture.item);
			Object.assign(item.outcome.inspection.details.details, { lockpicking });
			expect(decodeObjectInspectionResult(item)).toEqual(item);
		}
		for (const lockpicking of [
			{ difficulty: 1.5, successPercent: 73 },
			{ difficulty: 250, successPercent: 0.73 },
			{ difficulty: 250 },
		]) {
			const item = structuredClone(fixture.item);
			Object.assign(item.outcome.inspection.details.details, { lockpicking });
			expect(() => decodeObjectInspectionResult(item)).toThrow();
		}
	});

	it("preserves independently disclosed healing-kit modifiers and rejects mixed effects", () => {
		const item = structuredClone(fixture.item);
		const details = item.outcome.inspection.details.details;
		for (const [skillBonus, restorationMultiplier] of [
			[50, 1.3],
			[0, null],
			[null, 1],
		]) {
			Object.assign(details, {
				useEffect: { kind: "healing-kit", skillBonus, restorationMultiplier },
			});
			expect(decodeObjectInspectionResult(item)).toEqual(item);
		}
		for (const useEffect of [
			{ kind: "healing-kit", skillBonus: 50, restorationMultiplier: Infinity },
			{ kind: "healing-kit", skillBonus: 1.5, restorationMultiplier: 1.3 },
			{
				kind: "healing-kit",
				skillBonus: 50,
				restorationMultiplier: 1.3,
				amount: 50,
				vital: "Health",
			},
		]) {
			Object.assign(details, { useEffect });
			expect(() => decodeObjectInspectionResult(item)).toThrow();
		}
	});
	it("accepts vital changes and spell roles while rejecting invalid effect contracts", () => {
		const item = structuredClone(fixture.item);
		const details = item.outcome.inspection.details.details;
		Object.assign(details, {
			useEffect: { kind: "vital-change", vital: "Stamina", amount: -20 },
			spells: [{ id: 42, role: "on-use" }],
		});
		expect(decodeObjectInspectionResult(item)).toEqual(item);
		for (const useEffect of [
			{ vital: "MaxHealth", amount: 50 },
			{ vital: "Mana", amount: 1.5 },
			{ vital: "Health", amount: 2147483648 },
		]) {
			Object.assign(details, {
				useEffect: { kind: "vital-change", ...useEffect },
			});
			expect(() => decodeObjectInspectionResult(item)).toThrow();
		}
		Object.assign(details, {
			useEffect: null,
			spells: [{ id: 42, role: "passive" }],
		});
		expect(() => decodeObjectInspectionResult(item)).toThrow();
	});
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
