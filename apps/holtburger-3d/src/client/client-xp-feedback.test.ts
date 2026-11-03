import { describe, expect, it } from "vitest";
import type { CharacterSheet } from "./client-character-sheet-contract";
import {
	xpAnimationProgress,
	xpChange,
	xpPresentation,
} from "./client-xp-feedback";

const level: CharacterSheet["level"] = {
	level: 10,
	currentXp: "9007199254740993",
	unspentXp: "1000",
	unspentSkillPoints: 0,
	availableLuminance: "0",
	nextLevelXp: "9007199254741893",
	xpIntoLevel: "100",
	xpForNextLevel: "1000",
};
const before = { character: 7, level };

describe("HUD experience feedback", () => {
	it("detects a one-XP award beyond Number precision and ignores purchases", () => {
		expect(
			xpChange(before, {
				...before,
				level: { ...level, currentXp: "9007199254740994" },
			}),
		).toBe("gain");
		expect(
			xpChange(before, { ...before, level: { ...level, unspentXp: "0" } }),
		).toBe("unchanged");
	});
	it("celebrates one or several levels even when the percentage drops", () => {
		for (const gainedLevels of [1, 3]) {
			const after = {
				...before,
				level: {
					...level,
					level: level.level + gainedLevels,
					currentXp: "9007199254741993",
					xpIntoLevel: "0",
				},
			};
			expect(xpChange(before, after)).toBe("level-up");
			expect(xpPresentation(after.level).percent).toBe(0);
		}
	});
	it("handles a level update arriving after its XP update", () => {
		expect(
			xpChange(before, {
				...before,
				level: { ...level, level: level.level + 1 },
			}),
		).toBe("level-up");
	});
	it("snaps initial snapshots, retirement, character switches, and corrections", () => {
		expect(xpChange(null, before)).toBe("snap");
		expect(xpChange(before, null)).toBe("snap");
		expect(xpChange(before, { ...before, character: 8 })).toBe("snap");
		expect(
			xpChange(before, {
				...before,
				level: { ...level, currentXp: "9007199254740992" },
			}),
		).toBe("snap");
		expect(
			xpChange(before, {
				...before,
				level: { ...level, level: level.level - 1 },
			}),
		).toBe("snap");
	});
	it("keeps capped XP full while accepting further awards", () => {
		const capped = { ...before, level: { ...level, xpForNextLevel: "0" } };
		expect(xpPresentation(capped.level)).toEqual({
			percent: 100,
			description: "Maximum level · 9,007,199,254,740,993 total XP",
		});
		expect(
			xpChange(capped, {
				...capped,
				level: { ...capped.level, currentXp: "9007199254740994" },
			}),
		).toBe("gain");
	});
	it("shares exact hover text with the normal progress and empty baseline", () => {
		expect(xpPresentation(level)).toEqual({
			percent: 10,
			description: "100 / 1,000 XP",
		});
		expect(xpPresentation(null)).toEqual({
			percent: 0,
			description: undefined,
		});
	});
});

describe("XP animation phase timing", () => {
	it.each([
		{ elapsedMs: -10, durationMs: 100, expected: 0 },
		{ elapsedMs: 0, durationMs: 100, expected: 0 },
		{ elapsedMs: 25, durationMs: 100, expected: 0.25 },
		{ elapsedMs: 100, durationMs: 100, expected: 1 },
		{ elapsedMs: 150, durationMs: 100, expected: 1 },
		{ elapsedMs: 0, durationMs: 0, expected: 1 },
		{ elapsedMs: 10, durationMs: 0, expected: 1 },
	])(
		"bounds progress at $elapsedMs ms for a $durationMs ms phase",
		({ elapsedMs, durationMs, expected }) => {
			expect(xpAnimationProgress(elapsedMs, durationMs)).toBe(expected);
		},
	);
});
