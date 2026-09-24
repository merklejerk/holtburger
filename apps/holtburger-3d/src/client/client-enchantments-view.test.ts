import { describe, expect, it } from "vitest";
import type { SpellRow } from "./client-spells";
import {
	decodeResolvedEnchantments,
	type ResolvedEnchantments,
} from "./client-enchantments-contract";
import {
	effectiveEnchantmentKinds,
	projectEnchantmentSections,
} from "./client-enchantments-view";

const ordinary = { spellId: 10, layer: 1 };
const overridden = { spellId: 11, layer: 2 };
const attack = { spellId: 12, layer: 1 };
const harmful = { spellId: 13, layer: 1 };

function instance(
	key: typeof ordinary,
	kind: "beneficial" | "harmful",
	remainingSeconds: number | null,
	powerLevel: number,
): ResolvedEnchantments["instances"][number] {
	return {
		key,
		spellCategory: 7,
		powerLevel,
		kind,
		remainingSeconds,
		statModType: 0,
		statModKey: 0,
		statModValue: 1,
	};
}

const resolved: ResolvedEnchantments = {
	instances: [
		instance(ordinary, "beneficial", 80, 100),
		instance(overridden, "harmful", 30, 80),
		instance(attack, "beneficial", null, 60),
		instance(harmful, "harmful", 20, 40),
	],
	groups: [
		{
			affectedStat: { kind: "attribute", key: 1 },
			statName: "Strength",
			operation: "additive",
			channel: "ordinary",
			spellCategory: 7,
			effective: ordinary,
			overridden: [overridden],
		},
		{
			affectedStat: { kind: "skill", key: 1 },
			statName: "Axe",
			operation: "additive",
			channel: "ordinary",
			spellCategory: 7,
			effective: ordinary,
			overridden: [overridden],
		},
		{
			affectedStat: { kind: "skill", key: 1 },
			statName: "Axe",
			operation: "additive",
			channel: "attackSkills",
			spellCategory: 7,
			effective: attack,
			overridden: [],
		},
		{
			affectedStat: { kind: "skill", key: 1 },
			statName: "Axe",
			operation: "additive",
			channel: "ordinary",
			spellCategory: 8,
			effective: harmful,
			overridden: [],
		},
	],
};

const spells = new Map<number, SpellRow>([
	[
		10,
		{
			id: 10,
			name: "Strength Self VIII",
			details: null,
			artwork: { kind: "failed", detail: "fixture" },
		},
	],
	[
		11,
		{
			id: 11,
			name: "Frailness",
			details: null,
			artwork: { kind: "failed", detail: "fixture" },
		},
	],
	[
		12,
		{
			id: 12,
			name: "Attack Aura",
			details: null,
			artwork: { kind: "failed", detail: "fixture" },
		},
	],
	[
		13,
		{
			id: 13,
			name: "Weakness",
			details: null,
			artwork: { kind: "failed", detail: "fixture" },
		},
	],
]);

describe("enchantment presentation projection", () => {
	it("validates the transported contribution context and layer identity", () => {
		expect(decodeResolvedEnchantments(resolved)).toEqual(resolved);
		expect(() =>
			decodeResolvedEnchantments({
				...resolved,
				groups: [{ ...resolved.groups[0], operation: "wrong" }],
			}),
		).toThrow();
		expect(() =>
			decodeResolvedEnchantments({
				...resolved,
				instances: [
					{ ...resolved.instances[0], key: { spellId: 10, layer: -1 } },
				],
			}),
		).toThrow();
	});

	it("counts only effective kinds even when one spell appears under several stats", () => {
		expect(effectiveEnchantmentKinds(resolved)).toEqual({
			beneficial: true,
			harmful: true,
		});
		expect(
			effectiveEnchantmentKinds({
				...resolved,
				groups: resolved.groups.slice(0, 3),
			}),
		).toEqual({ beneficial: true, harmful: false });
	});

	it("keeps independent effective roots in one stat and duplicates overlap by identity", () => {
		const sections = projectEnchantmentSections(
			resolved,
			spells,
			{ text: "", tags: [] },
			"name",
		);
		expect(sections.map((section) => section.label)).toEqual([
			"Axe",
			"Strength",
		]);
		expect(sections[0]?.groups).toHaveLength(3);
		expect(
			sections[0]?.groups.map((group) => group.effective.instance.key),
		).toEqual(expect.arrayContaining([ordinary, attack, harmful]));
		expect(sections[1]?.groups[0]?.effective.instance.key).toBe(ordinary);
	});

	it("shows vitae under Harmful without ordinary stacking or cooldowns", () => {
		const vitaeKey = { spellId: 666, layer: 0 };
		const vitae: ResolvedEnchantments["instances"][number] = {
			...instance(vitaeKey, "harmful", null, 30),
			kind: "vitae",
			statModValue: 0.95,
		};
		const cooldown = {
			...instance({ spellId: 0x8000, layer: 0 }, "harmful", 10, 1),
			kind: "cooldown" as const,
		};
		const snapshot = { instances: [vitae, cooldown], groups: [] };
		const vitaeSpell: SpellRow = {
			id: 666,
			name: "Vitae",
			details: null,
			artwork: { kind: "failed", detail: "fixture" },
		};
		const references = new Map([[666, vitaeSpell]]);
		expect(effectiveEnchantmentKinds(snapshot)).toEqual({
			beneficial: false,
			harmful: true,
		});
		expect(
			effectiveEnchantmentKinds({ instances: [cooldown], groups: [] }),
		).toEqual({ beneficial: false, harmful: false });
		const query = (text: string, tags: ("harmful" | "beneficial")[]) =>
			projectEnchantmentSections(snapshot, references, { text, tags }, "name");
		const sections = query("penalty", ["harmful"]);
		expect(sections.map((section) => [section.label, section.value])).toEqual([
			["Vitae penalty", "5%"],
		]);
		expect(sections[0]?.groups[0]?.effective.spell?.name).toBe("Vitae");
		expect(sections[0]?.groups[0]?.overridden).toEqual([]);
		expect(
			projectEnchantmentSections(
				{ instances: [{ ...vitae, statModValue: 0.88 }], groups: [] },
				references,
				{ text: "", tags: ["harmful"] },
				"name",
			)[0]?.value,
		).toBe("12%");
		expect(query("vitae", ["harmful"])).toHaveLength(1);
		expect(query("vitae", ["beneficial"])).toEqual([]);
		expect(query("cooldown", [])).toEqual([]);
	});

	it("names known property headings and distinguishes unknown integer and float keys", () => {
		const group = (
			affectedStat: ResolvedEnchantments["groups"][number]["affectedStat"],
			statName?: string,
		): ResolvedEnchantments["groups"][number] => ({
			affectedStat,
			statName,
			operation: "additive",
			channel: "ordinary",
			spellCategory: 7,
			effective: ordinary,
			overridden: [],
		});
		const propertyGroups = [
			group({ kind: "intProperty", key: 360 }, "WeaponAuraDamage"),
			group({ kind: "floatProperty", key: 3 }, "HealthRate"),
			group({ kind: "floatProperty", key: 64 }, "ResistSlash"),
			group({ kind: "intProperty", key: 999 }),
			group({ kind: "floatProperty", key: 999 }),
		];
		const sections = projectEnchantmentSections(
			{ instances: resolved.instances, groups: propertyGroups },
			spells,
			{ text: "", tags: [] },
			"name",
		);
		expect(sections.map((section) => section.label)).toEqual([
			"Float property 999",
			"Health regeneration rate",
			"Integer property 999",
			"Slash resistance",
			"Weapon aura damage",
		]);
		expect(
			projectEnchantmentSections(
				{ instances: resolved.instances, groups: propertyGroups },
				spells,
				{ text: "slash resistance", tags: [] },
				"name",
			).map((section) => section.label),
		).toEqual(["Slash resistance"]);
	});

	it("retains a contextual parent when a child matches the spell-panel query", () => {
		const sections = projectEnchantmentSections(
			resolved,
			spells,
			{ text: "frln", tags: ["harmful"] },
			"name",
		);
		expect(sections).toHaveLength(2);
		for (const section of sections) {
			expect(section.groups).toHaveLength(1);
			expect(section.groups[0]?.contextualParent).toBe(true);
			expect(
				section.groups[0]?.overridden.map((row) => row.instance.key),
			).toEqual([overridden]);
		}
	});

	it("matches affected-stat headings together with spell names", () => {
		const sections = projectEnchantmentSections(
			resolved,
			spells,
			{ text: "strength frln", tags: [] },
			"name",
		);
		expect(sections.map((section) => section.label)).toEqual(["Strength"]);
		expect(sections[0]?.groups).toHaveLength(1);
		expect(sections[0]?.groups[0]?.contextualParent).toBe(true);
		expect(sections[0]?.groups[0]?.overridden[0]?.instance.key).toBe(
			overridden,
		);
	});

	it("sorts headings by their strongest or soonest effective spell", () => {
		const multiEffect: ResolvedEnchantments = {
			...resolved,
			groups: [resolved.groups[0], resolved.groups[2], resolved.groups[3]],
		};
		const name = projectEnchantmentSections(
			multiEffect,
			spells,
			{ text: "", tags: [] },
			"name",
		);
		expect(name.map((section) => section.label)).toEqual(["Axe", "Strength"]);
		const power = projectEnchantmentSections(
			multiEffect,
			spells,
			{ text: "", tags: [] },
			"power",
		);
		expect(power.map((section) => section.label)).toEqual(["Strength", "Axe"]);
		expect(power[1]?.groups[0]?.effective.instance.key).toBe(attack);
		const duration = projectEnchantmentSections(
			multiEffect,
			spells,
			{ text: "", tags: [] },
			"duration",
		);
		expect(duration.map((section) => section.label)).toEqual([
			"Axe",
			"Strength",
		]);
		const keys = duration[0]?.groups.map(
			(group) => group.effective.instance.key.spellId,
		);
		expect(keys?.[0]).toBe(harmful.spellId);
		expect(keys?.at(-1)).toBe(attack.spellId);
	});
});
