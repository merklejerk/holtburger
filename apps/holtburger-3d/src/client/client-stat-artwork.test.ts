import { describe, expect, it } from "vitest";
import {
	creationIconKey,
	statIconKind,
	statIconReferencesSchema,
} from "./client-stat-artwork";
import { STAT_ICON_FIXTURE } from "../harness/browser/stat-icon-fixture";

describe("stat artwork references", () => {
	it("keeps canonical identities and numeric allocation identities in separate namespaces", () => {
		const references = statIconReferencesSchema.parse(STAT_ICON_FIXTURE);
		const coordination = references.find(
			(reference) =>
				"Attribute" in reference.target &&
				reference.target.Attribute === "CoordinationAttr",
		);
		expect(coordination?.creationId).toBe(2);
		expect(creationIconKey("attribute", 0)).not.toBe(
			creationIconKey("vital", 0),
		);
		expect(statIconKind({ Skill: "MeleeDefense" })).toBe("skill");
	});
	it("rejects duplicate canonical and allocation identities independently", () => {
		const reference = STAT_ICON_FIXTURE[0];
		expect(
			statIconReferencesSchema.safeParse([
				reference,
				{ ...reference, creationId: 99 },
			]).success,
		).toBe(false);
		expect(
			statIconReferencesSchema.safeParse([
				reference,
				{ ...reference, target: { Attribute: "Example" } },
			]).success,
		).toBe(false);
	});
	it("preserves a failed graphic without losing the stat identity", () => {
		const reference = {
			target: { Vital: "Health" },
			creationId: 0,
			artwork: { kind: "failed", detail: "Missing mapping" },
		};
		expect(statIconReferencesSchema.parse([reference])).toEqual([reference]);
	});
});
