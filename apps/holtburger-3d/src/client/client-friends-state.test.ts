import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ClientFriendsState,
	FRIENDS_UPDATE_WAIT_MS,
} from "./client-friends-state";
import type { FriendsAction } from "./client-friends-contract";

const amy = { guid: 1, name: "Amy", online: false };
const ben = { guid: 2, name: "Ben", online: true };

function setup(
	submit: (action: FriendsAction) => Promise<void> = async () => {},
) {
	const owner = new ClientFriendsState(submit);
	owner.setContext(42, true);
	owner.update({ members: [amy, ben] });
	owner.updatePreferences({ appearOffline: false });
	return owner;
}

describe("Friends presentation owner", () => {
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
		const old = owner.request({ kind: "add", name: "Cara" }, notice);
		owner.reset();
		owner.setContext(99, true);
		owner.update({ members: [] });
		expect(await owner.request({ kind: "add", name: "Cara" }, notice)).toBe(
			false,
		);
		expect(notice).toHaveBeenCalledExactlyOnceWith("Couldn’t add friend.");
		rejectOld(new Error("Retired dispatch failed"));
		expect(await old).toBe(false);
		expect(notice).toHaveBeenCalledTimes(1);
		owner.destroy();
	});

	it("checks selected-target eligibility against unfiltered facts", () => {
		const owner = setup();
		owner.setFilters("nobody", true);
		expect(owner.canAdd(amy.guid, amy.name)).toBe(false);
		expect(owner.canAdd(99, "+AMY")).toBe(false);
		expect(owner.canAdd(42, "Self")).toBe(false);
		expect(owner.canAdd(3, " ")).toBe(false);
		expect(owner.canAdd(3, "Cara")).toBe(true);
		owner.setContext(42, false);
		expect(owner.canAdd(3, "Cara")).toBe(false);
		owner.destroy();
	});

	it("settles an ACE-resolved admin name immediately on its update", async () => {
		vi.useFakeTimers();
		const owner = setup();
		await owner.request({ kind: "add", name: "holtfighter" });
		owner.update({
			members: [amy, ben, { guid: 3, name: "+Holtfighter", online: true }],
		});
		expect(owner.read().pending).toBeNull();
		vi.advanceTimersByTime(FRIENDS_UPDATE_WAIT_MS);
		expect(owner.read().feedback).toBeNull();
		owner.destroy();
	});

	it("sorts by presence then name and filters without changing membership", () => {
		const owner = setup();
		expect(owner.read().members.map((member) => member.name)).toEqual([
			"Ben",
			"Amy",
		]);
		owner.setFilters("am", false);
		expect(owner.read().members).toEqual([amy]);
		owner.setFilters("", true);
		expect(owner.read().members).toEqual([ben]);
		owner.setFilters("", false);
		expect(owner.read().members).toHaveLength(2);
		owner.destroy();
	});

	it("keeps membership pending after queue acceptance and settles from published facts", async () => {
		const submit = vi.fn(async () => {});
		const owner = setup(submit);
		expect(await owner.request({ kind: "add", name: " Cara " })).toBe(true);
		expect(submit).toHaveBeenCalledWith({ kind: "add", name: "Cara" });
		expect(owner.read().members).toHaveLength(2);
		expect(owner.read().pending).toEqual({ kind: "add", name: "Cara" });
		expect(await owner.request({ kind: "remove", guid: 1 })).toBe(false);
		owner.update({
			members: [amy, ben, { guid: 3, name: "Cara", online: false }],
		});
		expect(owner.read().pending).toBeNull();
		await owner.request({ kind: "remove", guid: 1 });
		expect(owner.read().members).toContainEqual(amy);
		owner.update({ members: [ben] });
		expect(owner.read().pending).toBeNull();
		expect(owner.read().members).toEqual([ben]);
		owner.destroy();
	});

	it("settles preferences from core mirroring without a server echo", async () => {
		const owner = setup();
		await owner.request({ kind: "appearOffline", enabled: true });
		expect(owner.read().preferences?.appearOffline).toBe(false);
		owner.updatePreferences({ appearOffline: true });
		expect(owner.read().pending).toBeNull();
		expect(owner.read().preferences?.appearOffline).toBe(true);
		owner.destroy();
	});

	it("bounds missing evidence, preserves facts across portals, and never retries", async () => {
		vi.useFakeTimers();
		const submit = vi.fn(async () => {});
		const owner = setup(submit);
		await owner.request({ kind: "remove", guid: 1 });
		owner.setContext(42, false);
		expect(owner.read().pending).not.toBeNull();
		owner.setContext(42, true);
		vi.advanceTimersByTime(FRIENDS_UPDATE_WAIT_MS);
		expect(owner.read().pending).toBeNull();
		expect(owner.read().members).toContainEqual(amy);
		expect(owner.read().feedback).toBeNull();
		expect(submit).toHaveBeenCalledTimes(1);
		owner.destroy();
	});

	it("reports dispatch failure and releases the guard", async () => {
		const owner = setup(async () => {
			throw new Error("Transport unavailable");
		});
		expect(await owner.request({ kind: "remove", guid: 1 })).toBe(false);
		expect(owner.read().pending).toBeNull();
		expect(owner.read().feedback).toBe("Couldn’t remove friend.");
		owner.update({ members: [amy, ben] });
		expect(owner.read().feedback).toBeNull();
		owner.destroy();
	});

	it("ignores stale failures after retirement and a newer intent", async () => {
		let rejectFirst: (error: Error) => void = () => {
			throw new Error("First request was not installed");
		};
		const submit = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<void>((_resolve, reject) => {
						rejectFirst = reject;
					}),
			)
			.mockResolvedValue(undefined);
		const owner = setup(submit);
		const first = owner.request({ kind: "remove", guid: 1 });
		owner.reset();
		expect(owner.read().known).toBe(false);
		owner.setContext(99, true);
		owner.update({ members: [ben] });
		await owner.request({ kind: "add", name: "Cara" });
		rejectFirst(new Error("Old character failure"));
		await first;
		expect(owner.read().pending).toEqual({ kind: "add", name: "Cara" });
		expect(owner.read().feedback).toBeNull();
		owner.destroy();
	});
});
