import { describe, expect, it } from "vitest";
import {
	HUMANOID_BODY_LAYOUT,
	resolveHumanoidBodyLayout,
} from "./humanoid-body-layout";
import { HUMANOID_TEST_PARENTS } from "./humanoid-body-test-fixture";

describe("humanoid layout recognition", () => {
	it("accepts standard and Tumerok hierarchies with the same part grouping", () => {
		const standard = resolveHumanoidBodyLayout(
			HUMANOID_TEST_PARENTS.length,
			HUMANOID_TEST_PARENTS,
		);
		const tumerok = [...HUMANOID_TEST_PARENTS];
		tumerok[13] = 9;
		tumerok[16] = 9;
		expect(standard).toBe(HUMANOID_BODY_LAYOUT);
		expect(resolveHumanoidBodyLayout(tumerok.length, tumerok)).toBe(standard);
	});
	it("leaves missing, incomplete and incompatible skeletons uncomposed", () => {
		expect(
			resolveHumanoidBodyLayout(HUMANOID_TEST_PARENTS.length, []),
		).toBeNull();
		expect(resolveHumanoidBodyLayout(1, HUMANOID_TEST_PARENTS)).toBeNull();
		const incompatible = [...HUMANOID_TEST_PARENTS];
		incompatible[25] = 9;
		expect(
			resolveHumanoidBodyLayout(incompatible.length, incompatible),
		).toBeNull();
	});
});
