import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ClientSquelchState,
	SQUELCH_UPDATE_WAIT_MS,
} from "./client-squelch-state";
import type { SquelchAction, SquelchSnapshot } from "./client-squelch-contract";

const amy = {
	guid: 10,
	name: "Amy",
	account: true,
	coverage: "partial",
	removalScope: "account",
} as const;
const ben = {
	guid: 11,
	name: "Ben",
	account: false,
	coverage: "all",
	removalScope: "character",
} as const;
const baseline: SquelchSnapshot = {
	entries: [ben, amy],
	legacyAccounts: ["legacy"],
	globalCoverage: "partial",
};
function setup(
	submit: (action: SquelchAction) => Promise<void> = async () => {},
) {
	const owner = new ClientSquelchState(submit);
	owner.recover(baseline, 42, true);
	return owner;
}
describe("Ignores presentation owner", () => {
	afterEach(() => vi.useRealTimers());

	it("notifies only the current dispatch failure after character replacement", async () => {
		let rejectOld: (error: Error) => void = () => {
			throw new Error("Old dispatch was not installed");
		};
		const submit = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<void>((_resolve, reject) => {
						rejectOld = reject;
					}),
			)
			.mockRejectedValueOnce(new Error("New dispatch failed"));
		const owner = setup(submit);
		const notice = vi.fn();
		const old = owner.request(
			{ kind: "add", name: "Cara", scope: "account" },
			notice,
		);
		owner.reset();
		owner.setContext(99, true);
		owner.update({ entries: [], legacyAccounts: [], globalCoverage: "none" });
		expect(
			await owner.request(
				{ kind: "add", name: "Cara", scope: "account" },
				notice,
			),
		).toBe(false);
		expect(notice).toHaveBeenCalledExactlyOnceWith("Couldn’t add ignore.");
		rejectOld(new Error("Retired dispatch failed"));
		expect(await old).toBe(false);
		expect(notice).toHaveBeenCalledTimes(1);
		owner.destroy();
	});

	it("checks selected-target eligibility against unfiltered facts", () => {
		const owner = setup();
		owner.setSearch("nobody");
		expect(owner.canIgnoreAccount(amy.guid, amy.name)).toBe(false);
		expect(owner.canIgnoreAccount(99, "+AMY")).toBe(false);
		expect(owner.canIgnoreAccount(42, "Self")).toBe(false);
		expect(owner.canIgnoreAccount(3, " ")).toBe(false);
		expect(owner.canIgnoreAccount(3, "Cara")).toBe(true);
		owner.setContext(42, false);
		expect(owner.canIgnoreAccount(3, "Cara")).toBe(false);
		owner.destroy();
	});

	it("retains early replacement through establishment and sorts/filters only presentation", () => {
		const owner = new ClientSquelchState(async () => {});
		owner.update(baseline);
		owner.setContext(42, true);
		expect(owner.read().entries).toEqual([amy, ben]);
		owner.setSearch("BE");
		expect(owner.read().entries).toEqual([ben]);
		expect(owner.read().legacyAccounts).toEqual(["legacy"]);
		expect(owner.read().globalCoverage).toBe("partial");
		owner.setSearch("");
		expect(owner.read().entries).toHaveLength(2);
		owner.destroy();
	});
	it("settles add immediately from scope evidence and ACE name aliases", async () => {
		const submit = vi.fn(async () => {});
		const owner = setup(submit);
		await owner.request({ kind: "add", name: " Cara ", scope: "account" });
		expect(submit).toHaveBeenCalledWith({
			kind: "add",
			name: "Cara",
			scope: "account",
		});
		expect(owner.read().entries).toHaveLength(2);
		expect(owner.read().pending?.kind).toBe("add");
		owner.update({
			...baseline,
			entries: [
				...baseline.entries,
				{
					guid: 12,
					name: "+Cara",
					account: false,
					coverage: "all",
					removalScope: "character",
				},
			],
		});
		expect(owner.read().pending).not.toBeNull();
		owner.update({
			...baseline,
			entries: [
				...baseline.entries,
				{
					guid: 12,
					name: "+Cara",
					account: true,
					coverage: "all",
					removalScope: "account",
				},
			],
		});
		expect(owner.read().pending).toBeNull();
		owner.destroy();
	});
	it("removes only the chosen scope and reveals the remaining character restriction", async () => {
		const owner = setup();
		expect(
			await owner.request({ kind: "remove", guid: 10, scope: "character" }),
		).toBe(false);
		await owner.request({ kind: "remove", guid: 10, scope: "account" });
		expect(owner.read().entries).toContainEqual(amy);
		owner.update({ ...baseline, entries: [ben] });
		expect(owner.read().pending).toBeNull();
		owner.update(baseline);
		await owner.request({ kind: "remove", guid: 10, scope: "account" });
		const retained = { ...amy, account: false, removalScope: null };
		owner.update({ ...baseline, entries: [retained, ben] });
		expect(owner.read().pending).toBeNull();
		expect(owner.read().entries).toContainEqual(retained);
		expect(
			await owner.request({ kind: "remove", guid: 10, scope: "character" }),
		).toBe(false);
		await owner.request({ kind: "remove", guid: 11, scope: "character" });
		owner.recover({ ...baseline, entries: [retained] }, 42, true);
		expect(owner.read().pending).toBeNull();
		expect(owner.read().entries).toEqual([retained]);
		owner.destroy();
	});
	it("retains portal facts, quietly expires missing evidence, and never retries", async () => {
		vi.useFakeTimers();
		const submit = vi.fn(async () => {});
		const owner = setup(submit);
		await owner.request({ kind: "remove", guid: 11, scope: "character" });
		owner.setContext(42, false);
		expect(owner.read().pending).not.toBeNull();
		expect(
			await owner.request({ kind: "add", name: "Cara", scope: "character" }),
		).toBe(false);
		owner.setContext(42, true);
		vi.advanceTimersByTime(SQUELCH_UPDATE_WAIT_MS);
		expect(owner.read().pending).toBeNull();
		expect(owner.read().entries).toContainEqual(ben);
		expect(owner.read().feedback).toBeNull();
		expect(submit).toHaveBeenCalledTimes(1);
		owner.destroy();
	});
	it("reports dispatch failure and rejects stale completion after a new character intent", async () => {
		let rejectFirst: (error: Error) => void = () => {
			throw new Error("No pending dispatch");
		};
		const submit = vi
			.fn()
			.mockRejectedValueOnce(new Error("Disconnected"))
			.mockImplementationOnce(
				() =>
					new Promise<void>((_resolve, reject) => {
						rejectFirst = reject;
					}),
			)
			.mockResolvedValue(undefined);
		const owner = setup(submit);
		expect(
			await owner.request({ kind: "remove", guid: 11, scope: "character" }),
		).toBe(false);
		expect(owner.read().feedback).toBe("Couldn’t remove ignore.");
		owner.update(baseline);
		expect(owner.read().feedback).toBeNull();
		const first = owner.request({
			kind: "remove",
			guid: 11,
			scope: "character",
		});
		owner.reset();
		expect(owner.read().known).toBe(false);
		owner.recover(
			{ entries: [], legacyAccounts: [], globalCoverage: "none" },
			99,
			true,
		);
		await owner.request({ kind: "add", name: "Cara", scope: "character" });
		rejectFirst(new Error("Old dispatch"));
		await first;
		expect(owner.read().pending).toEqual({
			kind: "add",
			name: "Cara",
			scope: "character",
		});
		expect(owner.read().feedback).toBeNull();
		owner.destroy();
	});
});
