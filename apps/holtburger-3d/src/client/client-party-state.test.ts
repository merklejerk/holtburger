import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientPartyState, PARTY_UPDATE_WAIT_MS } from "./client-party-state";
import type {
	PartyAction,
	PartyPreferences,
	PartySnapshot,
} from "./client-party-contract";
import type {
	ClientLifecycleSessionEvent,
	ClientLifecycleSessionState,
} from "./client-lifecycle-session";

function fixture() {
	let party: PartySnapshot | null = {
		name: "Raid",
		leader: 1,
		shareXp: true,
		evenShare: true,
		open: false,
		locked: false,
		capabilities: { isLeader: true, canRecruit: true, canChangeOpenness: true },
		members: [1, 2].map((guid) => ({
			guid,
			name: `Member ${guid}`,
			level: 10,
			canManage: guid !== 1,
			vitals: [10, 10, 10, 20, 20, 20],
		})),
	};
	let preferences: PartyPreferences = {
		shareXp: true,
		shareLoot: false,
		ignoreRequests: false,
	};
	let state: Pick<ClientLifecycleSessionState, "playerGuid" | "lifecycle"> = {
		playerGuid: 1,
		lifecycle: { kind: "in-world" },
	};
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const submit = vi
		.fn<(action: PartyAction) => Promise<void>>()
		.mockResolvedValue(undefined);
	const updates = vi
		.fn<(enabled: boolean) => Promise<void>>()
		.mockResolvedValue(undefined);
	const failure = vi.fn<(message: string) => void>();
	const notice = vi.fn<(message: string) => void>();
	const owner = new ClientPartyState(
		{
			state: () => state,
			partySnapshot: () => party,
			partyPreferences: () => preferences,
			submitParty: submit,
			setPartyUpdates: updates,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
		failure,
		notice,
	);
	return {
		owner,
		submit,
		updates,
		failure,
		notice,
		snapshot: () => party,
		setParty: (next: PartySnapshot | null) => {
			party = next;
		},
		setPreferences: (next: PartyPreferences) => {
			preferences = next;
		},
		lifecycle: (next: NonNullable<typeof state.lifecycle>) => {
			state = { ...state, lifecycle: next };
			for (const listener of listeners)
				listener({ type: "lifecycle", lifecycle: next });
		},
	};
}

afterEach(() => vi.restoreAllMocks());
describe("party presentation ownership", () => {
	it("queues changed creation settings before the create action", async () => {
		const f = fixture();
		f.setParty(null);
		f.owner.create("  New Raid  ", { shareXp: false, shareLoot: true });
		f.owner.create("Duplicate", { shareXp: false, shareLoot: true });
		await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(3));
		expect(f.submit.mock.calls.map(([action]) => action)).toEqual([
			{ kind: "shareXp", enabled: false },
			{ kind: "shareLoot", enabled: true },
			{ kind: "create", name: "New Raid" },
		]);
		expect(f.owner.read().pending).toBe(true);
		f.owner.destroy();
	});
	it("does not create after a creation preference dispatch fails", async () => {
		const f = fixture();
		f.setParty(null);
		f.submit.mockRejectedValueOnce(
			new Error("Preference dispatch unavailable"),
		);
		f.owner.create("Raid", { shareXp: false, shareLoot: true });
		await Promise.resolve();
		expect(f.submit).toHaveBeenCalledOnce();
		expect(f.owner.read().pending).toBe(false);
		expect(f.failure).toHaveBeenCalledOnce();
		f.owner.destroy();
	});

	it("guards duplicate dispatch, retains authoritative facts, and settles from the observed state", () => {
		const f = fixture();
		const authoritative = f.snapshot();
		if (authoritative === null) throw new Error("Missing fixture party");
		f.owner.request({ kind: "openness", open: true });
		f.owner.request({ kind: "openness", open: true });
		expect(f.submit).toHaveBeenCalledTimes(1);
		expect(f.owner.read().party?.open).toBe(true);
		expect(f.owner.read().pending).toBe(true);
		expect(f.snapshot()?.open).toBe(false);
		f.setParty({
			...authoritative,
			members: authoritative.members.map((member) => ({
				...member,
				vitals: [1, 2, 3, 4, 5, 6],
			})),
		});
		expect(f.owner.read().pending).toBe(true);
		f.setParty({ ...authoritative, open: true });
		expect(f.owner.read().pending).toBe(false);
		f.owner.destroy();
	});
	it("releases the duplicate guard on dispatch failure", async () => {
		const f = fixture();
		f.submit.mockRejectedValueOnce(new Error("Dispatch unavailable"));
		f.owner.request({ kind: "openness", open: true });
		await Promise.resolve();
		expect(f.owner.read().pending).toBe(false);
		expect(f.failure).toHaveBeenCalledWith("Error: Dispatch unavailable");
		f.owner.request({ kind: "openness", open: true });
		expect(f.submit).toHaveBeenCalledTimes(2);
		f.owner.destroy();
	});
	it("does not attach an older failure to newer intent", async () => {
		const f = fixture();
		let reject: ((error: Error) => void) | undefined;
		f.submit.mockImplementationOnce(
			() =>
				new Promise((_resolve, fail) => {
					reject = fail;
				}),
		);
		f.owner.request({ kind: "openness", open: true });
		f.lifecycle({ kind: "character-selection", characters: [] });
		f.lifecycle({ kind: "in-world" });
		f.owner.request({ kind: "shareLoot", enabled: true });
		if (reject === undefined) throw new Error("Missing delayed failure");
		reject(new Error("Old dispatch failed"));
		await Promise.resolve();
		expect(f.owner.read().pending).toBe(true);
		expect(f.failure).not.toHaveBeenCalled();
		f.owner.destroy();
	});

	it("settles mirrored preferences without waiting for a wire echo", () => {
		const f = fixture();
		f.owner.request({ kind: "shareLoot", enabled: true });
		expect(f.owner.read().pending).toBe(true);
		f.setPreferences({ shareXp: true, shareLoot: true, ignoreRequests: false });
		expect(f.owner.read().pending).toBe(false);
		f.owner.destroy();
	});
	it("keeps pending ownership across close/reopen and releases it on a bounded deadline", () => {
		const now = vi.spyOn(performance, "now").mockReturnValue(0);
		const f = fixture();
		f.owner.setVisible(true);
		f.owner.request({ kind: "openness", open: true });
		f.owner.setVisible(false);
		f.owner.setVisible(true);
		expect(f.owner.read().pending).toBe(true);
		now.mockReturnValue(PARTY_UPDATE_WAIT_MS);
		expect(f.owner.read().pending).toBe(false);
		expect(f.owner.read().party?.open).toBe(false);
		expect(f.failure).toHaveBeenCalledOnce();
		expect(f.submit).toHaveBeenCalledOnce();
		f.owner.destroy();
	});
	it("rejects a destructive answer after the reviewed roster retires", () => {
		const f = fixture();
		f.owner.request({ kind: "dismiss", target: 2 });
		const question = f.owner.question();
		if (question === null) throw new Error("Missing confirmation");
		f.setParty(null);
		f.owner.respond(question.requestId, true);
		expect(f.submit).not.toHaveBeenCalled();
		f.owner.destroy();
	});
	it.each(["hide", "portal"])(
		"retires destructive review on %s",
		(transition) => {
			const f = fixture();
			f.owner.setVisible(true);
			f.owner.request({ kind: "dismiss", target: 2 });
			const question = f.owner.question();
			if (question === null) throw new Error("Missing confirmation");
			if (transition === "hide") f.owner.setVisible(false);
			else
				f.lifecycle({
					kind: "portal-space",
					worldGeneration: 2,
					cause: "teleport",
				});
			expect(f.owner.question()).toBeNull();
			f.owner.respond(question.requestId, true);
			expect(f.submit).not.toHaveBeenCalled();
			f.owner.destroy();
		},
	);
	it("leaves immediately as a member without a confirmation", () => {
		const f = fixture();
		const party = f.owner.read().party;
		if (party === null) throw new Error("Missing fixture party");
		f.setParty({
			...party,
			leader: 2,
			capabilities: {
				isLeader: false,
				canRecruit: false,
				canChangeOpenness: false,
			},
			members: party.members.map((member) => ({
				...member,
				canManage: false,
				vitals: [10, 10, 10, 20, 20, 20],
			})),
		});
		f.owner.leave(null);
		expect(f.submit).toHaveBeenCalledWith({ kind: "leave" });
		expect(f.owner.question()).toBeNull();
		f.owner.destroy();
	});
	it("requires a current successor before a multi-member leader leaves", async () => {
		const f = fixture();
		for (const successor of [null, 1, 99]) f.owner.leave(successor);
		expect(f.submit).not.toHaveBeenCalled();
		f.owner.leave(2);
		await Promise.resolve();
		expect(f.submit.mock.calls).toEqual([
			[{ kind: "promote", target: 2 }],
			[{ kind: "leave" }],
		]);
		f.owner.destroy();
	});
	it("uses shared permissions even when raw party facts would suggest leadership", () => {
		const f = fixture();
		const party = f.owner.read().party;
		if (party === null) throw new Error("Missing fixture party");
		f.setParty({
			...party,
			capabilities: {
				isLeader: false,
				canRecruit: false,
				canChangeOpenness: false,
			},
			members: party.members.map((member) => ({
				...member,
				canManage: false,
				vitals: [10, 10, 10, 20, 20, 20],
			})),
		});
		expect(f.owner.canInvite(3)).toBe(false);
		for (const action of [
			{ kind: "invite", target: 3 },
			{ kind: "promote", target: 2 },
			{ kind: "dismiss", target: 2 },
			{ kind: "disband" },
			{ kind: "openness", open: true },
		] as const)
			f.owner.request(action);
		expect(f.submit).not.toHaveBeenCalled();
		expect(f.owner.question()).toBeNull();
		f.owner.destroy();
	});
	it("recruits from the HUD without enabling panel update demand", () => {
		const f = fixture();
		expect(f.owner.canInvite(1)).toBe(false);
		expect(f.owner.canInvite(2)).toBe(false);
		expect(f.owner.canInvite(3)).toBe(true);
		f.owner.request({ kind: "invite", target: 3 });
		expect(f.submit).toHaveBeenCalledWith({ kind: "invite", target: 3 });
		expect(f.updates).not.toHaveBeenCalled();
		f.owner.destroy();
	});

	it("reports an invitation only after its submission completes", async () => {
		const f = fixture();
		let complete: (() => void) | undefined;
		f.submit.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		f.owner.request({ kind: "invite", target: 3 });
		expect(f.notice).not.toHaveBeenCalled();
		if (complete === undefined) throw new Error("Missing delayed invitation");
		complete();
		await Promise.resolve();
		expect(f.notice).toHaveBeenCalledExactlyOnceWith("Party invitation sent.");
		expect(f.owner.read().pending).toBe(false);
		f.owner.destroy();
	});
	it("reports invitation dispatch failure without a sent notice", async () => {
		const f = fixture();
		f.submit.mockRejectedValueOnce(new Error("Transport closed"));
		f.owner.request({ kind: "invite", target: 3 });
		await Promise.resolve();
		expect(f.failure).toHaveBeenCalledExactlyOnceWith(
			"Error: Transport closed",
		);
		expect(f.notice).not.toHaveBeenCalled();
		f.owner.destroy();
	});
	it("suppresses a late invitation notice after character retirement", async () => {
		const f = fixture();
		let complete: (() => void) | undefined;
		f.submit.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		f.owner.request({ kind: "invite", target: 3 });
		f.lifecycle({ kind: "character-selection", characters: [] });
		if (complete === undefined) throw new Error("Missing delayed invitation");
		complete();
		await Promise.resolve();
		expect(f.notice).not.toHaveBeenCalled();
		f.owner.destroy();
	});

	it("prevents an old handoff completion from quitting after character retirement", async () => {
		const f = fixture();
		let complete: (() => void) | undefined;
		f.submit.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		f.owner.leave(2);
		expect(f.owner.question()).toBeNull();
		expect(f.submit).toHaveBeenCalledWith({ kind: "promote", target: 2 });
		f.lifecycle({ kind: "character-selection", characters: [] });
		f.lifecycle({ kind: "in-world" });
		if (complete === undefined) throw new Error("Missing delayed dispatch");
		complete();
		await Promise.resolve();
		expect(f.submit).toHaveBeenCalledOnce();
		f.owner.destroy();
	});
	it("retains pending intent through portal travel and reapplies active demand", () => {
		const f = fixture();
		f.owner.setVisible(true);
		f.owner.request({ kind: "openness", open: true });
		f.lifecycle({
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		f.lifecycle({ kind: "in-world" });
		expect(f.owner.read().pending).toBe(true);
		expect(f.updates.mock.calls).toEqual([[true], [true]]);
		f.owner.destroy();
	});
});
