import { describe, expect, it, vi } from "vitest";
import { CLIENT_COMBAT_EFFECTS_TUNING } from "../../../client/client-tuning";
import { sceneVector3 } from "../../assets/ac-frame";
import {
	CombatEffectsSystem,
	type CombatEffectInstance,
	type CombatEffectsTuning,
} from "./combat-effects-system";

function fixture(overrides: Partial<CombatEffectsTuning> = {}) {
	const tuning: CombatEffectsTuning = {
		...CLIENT_COMBAT_EFFECTS_TUNING,
		lifetimeMs: 100,
		popMs: 20,
		fadeMs: 40,
		maximumActive: 2,
		popScale: 1.2,
		criticalPopScale: 1.8,
		...overrides,
	};
	let frame: readonly CombatEffectInstance[] = [];
	const clear = vi.fn(() => {
		frame = [];
	});
	const release = vi.fn();
	const setAppearance = vi.fn();
	const refreshFontAtlas = vi.fn();
	const system = new CombatEffectsSystem(tuning, {
		create: () => ({
			setAppearance,
			refreshFontAtlas,
			submit: (instances) => {
				frame = instances.map((instance) => ({ ...instance }));
			},
			clear,
			release,
		}),
	});
	return {
		system,
		clear,
		release,
		setAppearance,
		refreshFontAtlas,
		frame: () => frame,
	};
}

describe("combat effects lifecycle", () => {
	it("updates appearance without changing captured placement, spawn time or resources", () => {
		const f = fixture();
		f.system.accept(
			{ kind: "damage", amount: 37, criticalHit: true },
			{ kind: "unplaced" },
			0,
		);
		const before = f.frame()[0];
		const appearance = {
			font: "serif",
			fontSize: 42,
			colors: CLIENT_COMBAT_EFFECTS_TUNING.colors,
		};
		f.system.setAppearance(appearance);
		f.system.refreshFontAtlas();
		expect(f.setAppearance).toHaveBeenCalledExactlyOnceWith(appearance);
		expect(f.refreshFontAtlas).toHaveBeenCalledTimes(1);
		expect(f.frame()[0]).toEqual(before);
		expect(f.clear).not.toHaveBeenCalled();
		expect(f.release).not.toHaveBeenCalled();
		f.system.advance(100);
		expect(f.frame()).toEqual([]);
		expect(() =>
			f.system.setAppearance({ ...appearance, fontSize: 0 }),
		).toThrow("fontSize");
		expect(f.setAppearance).toHaveBeenCalledTimes(1);
	});

	it("selects confirmed profiles, keeps zero damage, and evaluates pop and fade from elapsed time", () => {
		const f = fixture();
		f.system.accept(
			{ kind: "damage", amount: 0, criticalHit: false },
			{ kind: "unplaced" },
			0,
		);
		f.system.advance(10);
		expect(f.frame()[0]).toMatchObject({
			text: "0",
			profile: "damage",
			scale: 1.2,
			opacity: 1,
		});
		f.system.accept(
			{ kind: "damage", amount: 37, criticalHit: true },
			{ kind: "unplaced" },
			10,
		);
		f.system.advance(20);
		expect(f.frame()[1]).toMatchObject({
			text: "37",
			profile: "critical",
			scale: 1.8,
		});
		expect(f.system.activeCount).toBe(2); // Label and number consume one logical slot.
		f.system.advance(80);
		expect(f.frame()[0].opacity).toBe(0.5);
		f.system.advance(110);
		expect(f.frame()).toEqual([]);
	});

	it("shares the budget and lifecycle across physical damage, spell criticals, MISS and RESIST", () => {
		const f = fixture({ maximumActive: 4 });
		for (const outcome of [
			{ kind: "damage", amount: 0, criticalHit: false },
			{ kind: "damage", amount: 37, criticalHit: true },
			{ kind: "evaded" },
			{ kind: "resisted" },
		] as const)
			f.system.accept(outcome, { kind: "unplaced" }, 0);
		expect(f.frame().map(({ text, profile }) => ({ text, profile }))).toEqual([
			{ text: "0", profile: "damage" },
			{ text: "37", profile: "critical" },
			{ text: "MISS", profile: "avoidance" },
			{ text: "RESIST", profile: "avoidance" },
		]);
		f.system.accept({ kind: "resisted" }, { kind: "unplaced" }, 0);
		expect(f.frame().map(({ text }) => text)).toEqual([
			"37",
			"MISS",
			"RESIST",
			"RESIST",
		]);
		f.system.advance(100);
		expect(f.frame()).toEqual([]);
		f.system.accept({ kind: "resisted" }, { kind: "unplaced" }, 110);
		f.system.clear();
		expect(f.frame()).toEqual([]);
		f.system.dispose();
		expect(f.release).toHaveBeenCalledTimes(1);
	});

	it("retains captured placement and spawn spread while hidden or after target removal", () => {
		const f = fixture();
		const position = sceneVector3([1, 2, 3]);
		f.system.accept(
			{ kind: "evaded" },
			{ kind: "world", position, scopes: [{ kind: "outdoor" }] },
			0,
		);
		const first = f.frame()[0];
		f.system.advance(50);
		expect(f.frame()[0]).toMatchObject({
			text: "MISS",
			profile: "avoidance",
			spreadPixels: first.spreadPixels,
			progress: 0.5,
		});
		expect(f.frame()[0].placement).toEqual(first.placement);
		f.system.advance(100);
		expect(f.system.activeCount).toBe(0);
	});

	it("retires the oldest cosmetic instance at capacity and reset drops submitted work", () => {
		const f = fixture();
		for (const amount of [1, 2, 3])
			f.system.accept(
				{ kind: "damage", amount, criticalHit: false },
				{ kind: "unplaced" },
				0,
			);
		expect(f.frame().map((effect) => effect.text)).toEqual(["2", "3"]);
		f.system.clear();
		expect(f.system.activeCount).toBe(0);
		expect(f.frame()).toEqual([]);
		expect(f.release).not.toHaveBeenCalled();
	});

	it("releases once and rejects further spawning after disposal", () => {
		const f = fixture();
		f.system.dispose();
		f.system.dispose();
		f.system.accept({ kind: "evaded" }, { kind: "unplaced" }, 0);
		f.system.advance(50);
		expect(f.release).toHaveBeenCalledTimes(1);
		expect(f.system.activeCount).toBe(0);
	});

	it("validates before allocating and propagates adapter creation failures", () => {
		const create = vi.fn(() => {
			throw new Error("GPU allocation failed");
		});
		expect(
			() =>
				new CombatEffectsSystem(
					{ ...CLIENT_COMBAT_EFFECTS_TUNING, maximumActive: 0 },
					{ create },
				),
		).toThrow("budget");
		expect(create).not.toHaveBeenCalled();
		expect(
			() => new CombatEffectsSystem(CLIENT_COMBAT_EFFECTS_TUNING, { create }),
		).toThrow("GPU allocation failed");
	});

	it.each([
		["lifetimeMs", 0],
		["popMs", 0],
		["fadeMs", 0],
		["fontSize", 0],
		["worldRise", -1],
		["screenRise", -1],
		["spreadPixels", -1],
		["outlineWidth", -1],
		["criticalOutlineWidth", -1],
		["criticalLabelGap", -1],
		["popScale", 0],
		["criticalPopScale", 0],
		["criticalLabelScale", 0],
		["font", " "],
	] as const)(
		"rejects invalid %s before leasing renderer resources",
		(field, value) => {
			const create = vi.fn();
			expect(
				() =>
					new CombatEffectsSystem(
						{ ...CLIENT_COMBAT_EFFECTS_TUNING, [field]: value },
						{ create },
					),
			).toThrow(field);
			expect(create).not.toHaveBeenCalled();
		},
	);

	it.each(["popMs", "fadeMs"] as const)(
		"rejects %s extending beyond the lifetime",
		(phase) => {
			expect(() => fixture({ lifetimeMs: 100, [phase]: 101 })).toThrow(phase);
		},
	);

	it.each(["damage", "avoidance", "critical"] as const)(
		"rejects invalid %s RGB tint",
		(profile) => {
			expect(() =>
				fixture({
					colors: {
						...CLIENT_COMBAT_EFFECTS_TUNING.colors,
						[profile]: [0, 2, 0],
					},
				}),
			).toThrow(profile);
		},
	);
});
