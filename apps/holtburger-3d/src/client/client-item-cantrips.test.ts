import { describe, expect, it } from "vitest";
import type { CantripTier, SpellReference } from "../app/spell-references";
import { summarizeItemCantrips } from "./client-item-cantrips";

function known(id: number, cantripTier: CantripTier | null): SpellReference {
	return {
		kind: "known",
		id,
		name: `Spell ${id}`,
		details: {
			castingRoute: "self-target",
			classification: {
				beneficial: true,
				level: null,
				recipient: "creature",
				fellowship: false,
				damage: null,
			},
			description: "",
			school: 3,
			usesProjectileHandler: false,
			baseMana: 0,
			manaPerTarget: 0,
			durationSeconds: null,
			cantripTier,
		},
		artwork: { kind: "failed", detail: "irrelevant" },
	};
}

describe("item cantrip summary", () => {
	it("uses the compact label vocabulary for every tier", () => {
		const tiers: readonly CantripTier[] = [
			"feeble",
			"minor",
			"moderate",
			"major",
			"epic",
			"legendary",
			"other",
		];
		const summary = summarizeItemCantrips(
			tiers.map((_, index) => ({ id: index + 1, activeEnchantment: false })),
			tiers.map((tier, index) => known(index + 1, tier)),
			false,
		);
		expect(summary.kind === "ready" ? summary.pills : []).toMatchObject(
			["Feeb.", "Min.", "Mod.", "Maj.", "Epic", "Leg.", "Other"].map(
				(abbreviatedLabel) => ({ abbreviatedLabel }),
			),
		);
	});

	it("counts unique intrinsic spell identities in display order", () => {
		const spells = [
			{ id: 1, activeEnchantment: false },
			{ id: 1, activeEnchantment: false },
			{ id: 2, activeEnchantment: false },
			{ id: 3, activeEnchantment: false },
		];
		expect(
			summarizeItemCantrips(
				spells,
				[
					known(1, "legendary"),
					known(1, "legendary"),
					known(2, "minor"),
					known(3, "legendary"),
				],
				false,
			),
		).toEqual({
			kind: "ready",
			pills: [
				{
					tier: "minor",
					label: "Minor",
					abbreviatedLabel: "Min.",
					count: 1,
				},
				{
					tier: "legendary",
					label: "Legendary",
					abbreviatedLabel: "Leg.",
					count: 2,
				},
			],
			incompleteCount: 0,
		});
	});

	it("ignores active-only spells and does not double-count an intrinsic duplicate", () => {
		const spells = [
			{ id: 1, activeEnchantment: true },
			{ id: 1, activeEnchantment: false },
			{ id: 2, activeEnchantment: true },
		];
		expect(
			summarizeItemCantrips(
				spells,
				[known(1, "major"), known(1, "major"), known(2, "epic")],
				false,
			),
		).toEqual({
			kind: "ready",
			pills: [
				{
					tier: "major",
					label: "Major",
					abbreviatedLabel: "Maj.",
					count: 1,
				},
			],
			incompleteCount: 0,
		});
	});

	it("distinguishes loading and incomplete definitions without guessing", () => {
		const spells = [{ id: 1, activeEnchantment: false }];
		expect(summarizeItemCantrips(spells, null, false)).toEqual({
			kind: "loading",
		});
		expect(summarizeItemCantrips(spells, null, true)).toEqual({
			kind: "ready",
			pills: [],
			incompleteCount: 1,
		});
	});

	it("hides when an item has no intrinsic spells", () => {
		expect(
			summarizeItemCantrips([{ id: 1, activeEnchantment: true }], null, false),
		).toEqual({ kind: "hidden" });
	});

	it("omits a completed summary when known intrinsic spells are not cantrips", () => {
		expect(
			summarizeItemCantrips(
				[{ id: 1, activeEnchantment: false }],
				[known(1, null)],
				false,
			),
		).toEqual({ kind: "ready", pills: [], incompleteCount: 0 });
	});
});
