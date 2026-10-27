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
		titleSelection: null,
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
	it("withdraws portal purchases and reprices unchanged facts on return", async () => {
		const evaluate = vi.fn<
			(
				requestId: number,
				intents: readonly ProgressionIntent[],
			) => Promise<void>
		>(async () => {});
		const submit = vi.fn(async () => {});
		const owner = new ClientCharacterSheetState(
			evaluate,
			submit,
			async () => {},
			() => {},
		);
		const baseline = sheet();
		owner.reset(baseline, "in-world");
		const oldRequest = evaluate.mock.calls.at(-1)?.[0];
		if (oldRequest === undefined) throw new Error("missing initial evaluation");
		owner.acceptEvaluations(oldRequest, [{ intent, result: { Ok: quote() } }]);
		owner.setContext("portal-space");
		expect(owner.read().sheet).toBe(baseline);
		expect(owner.read().evaluations.size).toBe(0);
		expect(owner.read().progressionUnavailable).toContain("portal travel");
		owner.acceptEvaluations(oldRequest, [{ intent, result: { Ok: quote() } }]);
		expect(owner.read().evaluations.size).toBe(0);
		await owner.purchase(quote());
		expect(submit).not.toHaveBeenCalled();
		owner.acceptFeedback({ Rejected: { intent, reason: "CharacterNotReady" } });
		owner.replace(baseline);
		expect(evaluate).toHaveBeenCalledTimes(1);
		owner.setContext("in-world");
		owner.replace(baseline);
		owner.setContext("in-world");
		expect(evaluate).toHaveBeenCalledTimes(2);
		const newRequest = evaluate.mock.calls.at(-1)?.[0];
		if (newRequest === undefined) throw new Error("missing return evaluation");
		owner.acceptEvaluations(oldRequest, [
			{ intent, result: { Err: "CharacterNotReady" } },
		]);
		expect(owner.read().evaluations.size).toBe(0);
		owner.acceptEvaluations(newRequest, [{ intent, result: { Ok: quote() } }]);
		expect(owner.read().progressionUnavailable).toBeNull();
		await owner.purchase(quote());
		expect(submit).toHaveBeenCalledTimes(1);
	});

	it("retains attempted-purchase guards across portal travel", async () => {
		const submit = vi.fn(async () => {});
		const owner = new ClientCharacterSheetState(
			async () => {},
			submit,
			async () => {},
			() => {},
		);
		owner.reset(sheet(), "in-world");
		await owner.purchase(quote());
		owner.setContext("portal-space");
		owner.setContext("in-world");
		owner.replace(sheet());
		await owner.purchase(quote());
		expect(submit).toHaveBeenCalledTimes(1);
		expect(owner.read().pendingTargets.size).toBe(1);
		owner.replace(sheet(7, 2));
		expect(owner.read().pendingTargets.size).toBe(0);
	});

	it("recovers portal snapshots without evaluating until world entry completes", () => {
		const evaluate = vi.fn(async () => {});
		const owner = new ClientCharacterSheetState(
			evaluate,
			async () => {},
			async () => {},
			() => {},
		);
		const baseline = sheet();
		owner.reset(baseline, "in-world");
		owner.reset(baseline, "portal-space");
		expect(evaluate).toHaveBeenCalledTimes(1);
		expect(owner.read().sheet).toBe(baseline);
		owner.setContext("in-world");
		expect(evaluate).toHaveBeenCalledTimes(2);
	});

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
			async () => {},
			() => {},
		);
		owner.reset(admin, "in-world");
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
		const owner = new ClientCharacterSheetState(
			evaluate,
			submit,
			async () => {},
			() => {},
		);
		owner.reset(sheet(), "in-world");
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
		const owner = new ClientCharacterSheetState(
			evaluate,
			submit,
			async () => {},
			() => {},
		);
		owner.reset(sheet(), "in-world");
		const oldRequest = evaluate.mock.calls.at(0)?.[0];
		if (oldRequest === undefined) throw new Error("missing quote request");
		owner.reset(sheet(8), "in-world");
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
		const owner = new ClientCharacterSheetState(
			evaluate,
			async () => {},
			async () => {},
			() => {},
		);
		const before = sheet();
		owner.reset(before, "in-world");
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
		const owner = new ClientCharacterSheetState(
			evaluate,
			async () => {},
			async () => {},
			() => {},
		);
		const initial = sheet();
		owner.reset(initial, "in-world");
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
		const reportFailure = vi.fn();
		const owner = new ClientCharacterSheetState(
			async () => undefined,
			async () => {
				throw new Error("bridge closed");
			},
			async () => {},
			reportFailure,
		);
		owner.reset(sheet(), "in-world");
		await owner.purchase(quote());
		expect(owner.read().pendingTargets.size).toBe(1);
		expect(reportFailure).toHaveBeenCalledWith(
			expect.stringContaining("awaiting a server update"),
		);
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
			const reportFailure = vi.fn();
			const owner = new ClientCharacterSheetState(
				async () => undefined,
				() => submission,
				async () => {},
				reportFailure,
			);
			owner.reset(sheet(), "in-world");
			const purchase = owner.purchase(quote());
			if (transition === "reset") owner.reset(sheet(), "in-world");
			else owner.replace(sheet(7, 2));
			const revision = owner.read().revision;
			rejectSubmission(new Error("retired bridge failure"));
			await purchase;
			expect(reportFailure).not.toHaveBeenCalled();
			expect(owner.read().pendingTargets.size).toBe(0);
			expect(owner.read().revision).toBe(revision);
		},
	);
});

describe("optimistic title selection", () => {
	const titles = {
		selectedId: 1,
		entries: [
			{ id: 1, name: "Adventurer" },
			{ id: 42, name: null },
		],
	};
	it("updates immediately, sends identity once, and accepts server reconciliation", async () => {
		const send = vi.fn(async () => {});
		const owner = new ClientCharacterSheetState(
			async () => {},
			async () => {},
			send,
			() => {},
		);
		owner.reset({ ...sheet(), titleSelection: titles }, "in-world");
		const selection = owner.selectTitle(42);
		expect(owner.read().sheet?.titleSelection?.selectedId).toBe(42);
		expect(send).toHaveBeenCalledWith(7, 42);
		await selection;
		await owner.selectTitle(42);
		expect(send).toHaveBeenCalledTimes(1);
		owner.replace({ ...sheet(), titleSelection: titles });
		expect(owner.read().sheet?.titleSelection?.selectedId).toBe(1);
		owner.reset(sheet(8), "in-world");
		expect(owner.read().sheet?.titleSelection).toBeNull();
	});
	it("reports invocation errors without rolling back or locking selection", async () => {
		const send = vi.fn(async () => {
			throw new Error("host unavailable");
		});
		const reportFailure = vi.fn();
		const owner = new ClientCharacterSheetState(
			async () => {},
			async () => {},
			send,
			reportFailure,
		);
		owner.reset({ ...sheet(), titleSelection: titles }, "in-world");
		await owner.selectTitle(42);
		expect(reportFailure).toHaveBeenCalledWith(
			"Title selection send failed: host unavailable",
		);
		expect(owner.read().sheet?.titleSelection?.selectedId).toBe(42);
		await owner.selectTitle(1);
		expect(send).toHaveBeenCalledTimes(2);
	});
});
