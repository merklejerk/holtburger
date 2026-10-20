import { describe, expect, it } from "vitest";
import {
	compileEntityAlert,
	entityAlertRulesSchema,
	findExactEntityAlert,
	type EntityAlertRule,
} from "./client-entity-alerts";

describe("entity alert matching", () => {
	it.each([
		["*golem*", "Diamond Golem", true],
		["golem", "Diamond Golem", false],
		["?olem", "Golem", true],
		["?olem", "Ice Golem", false],
		["\\*Golem\\?", "*golem?", true],
		["\\*Golem\\?", "Ice Golem!", false],
		["雪?", "雪狐", true],
		["a**b", "ab", true],
		["a*b", "acbd", false],
	])("glob %s against %s", (pattern, name, expected) => {
		expect(compileEntityAlert({ mode: "glob", pattern })(name)).toBe(expected);
	});
	it("preserves literal wildcard characters in exact-name additions", () => {
		const matches = compileEntityAlert({ mode: "exact", pattern: "*Golem?" });
		expect(matches("*golem?")).toBe(true);
		expect(matches("Diamond Golem!")).toBe(false);
	});
	it("rejects empty patterns, unfinished escapes and equivalent rules", () => {
		const rule = (
			id: string,
			pattern: string,
			mode: "glob" | "exact" = "glob",
		) => ({ id, enabled: true, match: { pattern, mode } });
		for (const rules of [
			[rule("a", " ")],
			[rule("a", "abc\\")],
			[rule("a", "GOLEM", "exact"), rule("b", "golem", "exact")],
			[rule("a", "**golem*"), rule("b", "*GOLEM*")],
			[rule("a", "a"), rule("a", "b")],
		]) {
			expect(entityAlertRulesSchema.safeParse(rules).success).toBe(false);
		}
	});
	it("finds enabled and disabled exact names without treating globs as row toggles", () => {
		const glob: EntityAlertRule = {
			id: "glob",
			enabled: true,
			match: { mode: "glob", pattern: "*Golem*" },
		};
		const literalGlob: EntityAlertRule = {
			id: "literal-glob",
			enabled: true,
			match: { mode: "glob", pattern: "Diamond Golem" },
		};
		for (const enabled of [true, false]) {
			const exact: EntityAlertRule = {
				id: "exact",
				enabled,
				match: { mode: "exact", pattern: " Diamond GOLEM " },
			};
			const rules = entityAlertRulesSchema.parse([glob, literalGlob, exact]);
			expect(findExactEntityAlert(rules, "diamond golem")).toEqual({
				...exact,
				match: { mode: "exact", pattern: "Diamond GOLEM" },
			});
		}
		expect(
			findExactEntityAlert([glob, literalGlob], "Diamond Golem"),
		).toBeUndefined();
		expect(
			findExactEntityAlert(
				[
					{
						id: "literal-exact",
						enabled: true,
						match: { mode: "exact", pattern: "*Golem*" },
					},
				],
				"Diamond Golem",
			),
		).toBeUndefined();
	});
});
