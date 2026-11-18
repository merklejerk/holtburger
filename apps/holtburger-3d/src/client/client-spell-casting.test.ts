import { describe, expect, it } from "vitest";
import type { SpellDetails } from "../app/spell-references";
import { resolveClientSpellCastAim } from "./client-spell-casting";

function details(overrides: Partial<SpellDetails> = {}): SpellDetails {
	return {
		castingRoute: "selected-target",
		classification: {
			beneficial: false,
			level: 7,
			recipient: "creature",
			fellowship: false,
			damage: "fire",
		},
		description: "A spell.",
		school: { kind: "known", school: "war-magic" },
		usesProjectileHandler: true,
		baseMana: 10,
		manaPerTarget: 0,
		durationSeconds: null,
		cantripTier: null,
		...overrides,
	};
}

describe("client spell casting policy", () => {
	it.each([
		["War", { kind: "known", school: "war-magic" }],
		["Creature Enchantment", { kind: "known", school: "creature-enchantment" }],
		["Void", { kind: "known", school: "void-magic" }],
	] as const)(
		"casts a selected-target %s projectile forward when no entity is selected",
		(_label, school) => {
			expect(resolveClientSpellCastAim(details({ school }), null)).toEqual({
				kind: "untargeted",
			});
		},
	);

	it("preserves an explicit selection for eligible projectiles", () => {
		expect(resolveClientSpellCastAim(details(), 7)).toEqual({
			kind: "normal",
			selection: 7,
		});
	});

	it.each([
		[
			"Life Magic",
			details({ school: { kind: "known", school: "life-magic" } }),
		],
		["non-projectile", details({ usesProjectileHandler: false })],
		["self-targeted", details({ castingRoute: "self-target" })],
		["naturally untargeted", details({ castingRoute: "untargeted" })],
		["missing details", null],
	])("leaves a targetless %s cast on the ordinary route", (_label, spell) => {
		expect(resolveClientSpellCastAim(spell, null)).toEqual({
			kind: "normal",
			selection: null,
		});
	});
});
