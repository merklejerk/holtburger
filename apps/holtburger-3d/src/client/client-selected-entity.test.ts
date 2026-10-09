import { describe, expect, it } from "vitest";
import { entityFacts } from "./client-entity-mirror.test-support";
import {
	selectedPlayerTarget,
	type ClientSelectedEntity,
} from "./client-selected-entity";

describe("selected player social target", () => {
	it("requires known player facts and excludes the local player without requiring a scene entity", () => {
		const facts = entityFacts(2);
		if (facts.description.kind !== "known")
			throw new Error("Fixture must be known");
		const selected: ClientSelectedEntity = {
			guid: 2,
			facts: {
				...facts,
				description: {
					...facts.description,
					name: "Amy",
					mapCategory: "player",
				},
			},
			presentation: null,
		};
		expect(selectedPlayerTarget(selected, 1)).toEqual({ guid: 2, name: "Amy" });
		expect(selectedPlayerTarget(selected, 2)).toBeNull();
		expect(selectedPlayerTarget(selected, null)).toBeNull();
		expect(selectedPlayerTarget(null, 1)).toBeNull();
		expect(selectedPlayerTarget({ ...selected, facts: null }, 1)).toBeNull();
		expect(selectedPlayerTarget({ ...selected, facts }, 1)).toBeNull();
		expect(
			selectedPlayerTarget(
				{ ...selected, facts: { ...facts, description: { kind: "pending" } } },
				1,
			),
		).toBeNull();
	});
});
