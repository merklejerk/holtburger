import { describe, expect, it, vi } from "vitest";
import {
	characterSheetSchema,
	progressionQuoteSchema,
	type CharacterSheet,
	type ProgressionIntent,
	type ProgressionQuote,
} from "./client-character-sheet-contract";
import { ClientCharacterSheetState } from "./client-character-sheet-state";

const intent = {
	Raise: { target: { Attribute: "StrengthAttr" }, ranks: 1 },
} as const;

function sheet(character = 7, ranks = 1): CharacterSheet {
	return characterSheetSchema.parse({
		character,
		name: "Test Character",
		title: null,
		maximumLuminance: null,
		level: {
			level: 10,
			currentXp: "9007199254740993",
			unspentXp: "9007199254740993",
			unspentSkillPoints: 2,
			availableLuminance: "0",
			nextLevelXp: "9007199254741993",
			xpIntoLevel: "100",
			xpForNextLevel: "1000",
		},
		attributes: [
			{
				attr_type: "StrengthAttr",
				ranks,
				start: 10,
				spent_xp: ranks * 100,
				next_rank_xp: 300,
				base: 11,
				current: 11,
				breakdown: {
					modifiers: { contributions: [], multiplier: 1, additive: 0 },
					finalization: {
						before_rounding: 11,
						rounded: 11,
						minimum: 1,
						result: 11,
					},
				},
			},
		],
		vitals: [],
		skills: [],
		armor: 0,
		resistances: {
			slash: 1,
			pierce: 1,
			bludgeon: 1,
			fire: 1,
			cold: 1,
			acid: 1,
			electric: 1,
			nether: 1,
		},
		vitae: 1,
		guardedTargets: [],
	});
}

function quote(character = 7): ProgressionQuote {
	return progressionQuoteSchema.parse({
		scope_id: 4,
		quote: {
			character,
			intent,
			target_state: { training: null, ranks: 1, spent_xp: 100 },
			resulting_ranks: 2,
			xp_spent: 200,
			credits_spent: 0,
			available_xp: "9007199254740993",
			available_credits: 2,
		},
	});
}

describe("ClientCharacterSheetState", () => {
	it("retains admin-sized level and XP facts exactly", () => {
		const baseline = sheet();
		const attribute = baseline.attributes[0];
		if (attribute === undefined) throw new Error("missing fixture attribute");
		const admin = characterSheetSchema.parse({
			...baseline,
			level: {
				...baseline.level,
				level: 999,
				currentXp: "18446744073709551615",
				unspentXp: "18446744073709551615",
			},
			attributes: [{ ...attribute, spent_xp: 4_100_490_438 }],
			armor: 321,
			resistances: { ...baseline.resistances, slash: 0.75 },
			vitae: 0.8,
		});
		const owner = new ClientCharacterSheetState(
			async () => {},
			async () => {},
		);
		owner.reset(admin);
		expect(owner.read().sheet?.level.currentXp).toBe("18446744073709551615");
		expect(owner.read().sheet?.attributes[0]?.spent_xp).toBe(4_100_490_438);
		expect(owner.read().sheet?.armor).toBe(321);
	});

	it("guards only the submitted target until its authoritative rank changes", async () => {
		const evaluate = vi.fn(
			async (requestId: number, intents: readonly ProgressionIntent[]) => {
				expect(requestId).toBeGreaterThan(0);
				expect(intents.length).toBeGreaterThan(0);
			},
		);
		const submit = vi.fn(async () => undefined);
		const owner = new ClientCharacterSheetState(evaluate, submit);
		owner.reset(sheet());
		const firstRequest = evaluate.mock.calls.at(0)?.[0];
		if (firstRequest === undefined) throw new Error("missing quote request");
		owner.acceptEvaluations(firstRequest, [
			{ intent, result: { Ok: quote() } },
		]);
		await owner.purchase(quote());
		await owner.purchase(quote());
		expect(submit).toHaveBeenCalledTimes(1);
		const before = sheet();
		const attribute = before.attributes.at(0);
		if (attribute === undefined) throw new Error("missing fixture attribute");
		owner.replace({ ...before, attributes: [{ ...attribute, current: 15 }] });
		expect(owner.read().pendingTargets.size).toBe(1);
		owner.replace(sheet(7, 2));
		expect(owner.read().pendingTargets.size).toBe(0);
	});

	it("retires old character quotes and ignores delayed evaluation replies", async () => {
		const evaluate = vi.fn(
			async (requestId: number, intents: readonly ProgressionIntent[]) => {
				expect(requestId).toBeGreaterThan(0);
				expect(intents.length).toBeGreaterThan(0);
			},
		);
		const submit = vi.fn(async () => undefined);
		const owner = new ClientCharacterSheetState(evaluate, submit);
		owner.reset(sheet());
		const oldRequest = evaluate.mock.calls.at(0)?.[0];
		if (oldRequest === undefined) throw new Error("missing quote request");
		owner.reset(sheet(8));
		owner.acceptEvaluations(oldRequest, [{ intent, result: { Ok: quote() } }]);
		expect(owner.read().evaluations.size).toBe(0);
		await owner.purchase(quote());
		expect(submit).not.toHaveBeenCalled();
	});

	it("reprices after a resource update and ignores the previous reply", () => {
		const evaluate = vi.fn(
			async (requestId: number, intents: readonly ProgressionIntent[]) => {
				expect(requestId).toBeGreaterThan(0);
				expect(intents.length).toBeGreaterThan(0);
			},
		);
		const owner = new ClientCharacterSheetState(evaluate, async () => {});
		const before = sheet();
		owner.reset(before);
		const firstRequest = evaluate.mock.calls.at(-1)?.[0];
		if (firstRequest === undefined)
			throw new Error("missing first quote request");
		owner.replace({
			...before,
			level: { ...before.level, unspentXp: "500" },
		});
		const nextRequest = evaluate.mock.calls.at(-1)?.[0];
		if (nextRequest === undefined || nextRequest === firstRequest)
			throw new Error("resource change did not reprice purchases");
		owner.acceptEvaluations(firstRequest, [
			{ intent, result: { Ok: quote() } },
		]);
		expect(owner.read().evaluations.size).toBe(0);
	});

	it("updates row guards without repricing unchanged purchase facts", () => {
		const evaluate = vi.fn(async () => {});
		const owner = new ClientCharacterSheetState(evaluate, async () => {});
		const initial = sheet();
		owner.reset(initial);
		const requests = evaluate.mock.calls.length;
		owner.replace({
			...initial,
			guardedTargets: [{ Attribute: "StrengthAttr" }],
		});
		expect(evaluate).toHaveBeenCalledTimes(requests);
		expect(owner.read().sheet?.guardedTargets).toEqual([
			{ Attribute: "StrengthAttr" },
		]);
	});

	it("keeps an ambiguous bridge failure guarded until authoritative target change", async () => {
		const owner = new ClientCharacterSheetState(
			async () => undefined,
			async () => {
				throw new Error("bridge closed");
			},
		);
		owner.reset(sheet());
		await owner.purchase(quote());
		expect(owner.read().pendingTargets.size).toBe(1);
		expect(owner.read().feedback).toContain("awaiting a server update");
	});

	it.each(["reset", "target update"] as const)(
		"ignores a delayed bridge failure after %s retires its purchase",
		async (transition) => {
			let rejectSubmission: (error: Error) => void = () => {
				throw new Error("submission promise was not initialized");
			};
			const submission = new Promise<void>((_resolve, reject) => {
				rejectSubmission = reject;
			});
			const owner = new ClientCharacterSheetState(
				async () => undefined,
				() => submission,
			);
			owner.reset(sheet());
			const purchase = owner.purchase(quote());
			if (transition === "reset") owner.reset(sheet());
			else owner.replace(sheet(7, 2));
			const revision = owner.read().revision;
			rejectSubmission(new Error("retired bridge failure"));
			await purchase;
			expect(owner.read().feedback).toBeNull();
			expect(owner.read().pendingTargets.size).toBe(0);
			expect(owner.read().revision).toBe(revision);
		},
	);
});
