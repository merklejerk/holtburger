import { describe, expect, it, vi } from "vitest";
import {
	ClientAppraisalRequests,
	type AppraisalDemand,
	type ClientAppraisalRequestOptions,
} from "./client-appraisal-requests";
import type { ObjectInspectionResult } from "./client-object-inspection-contract";

const result: ObjectInspectionResult = {
	guid: 7,
	outcome: { kind: "missing" },
};

function makeRequests(overrides?: {
	sendFull?: (guid: number, refresh: boolean) => Promise<void>;
	sendFacts?: (guid: number) => Promise<void>;
	cancel?: (guid: number, demand: AppraisalDemand) => Promise<void>;
	options?: ClientAppraisalRequestOptions;
}) {
	const sendFull = overrides?.sendFull ?? vi.fn().mockResolvedValue(undefined);
	const sendFacts =
		overrides?.sendFacts ?? vi.fn().mockResolvedValue(undefined);
	const cancel = overrides?.cancel ?? vi.fn().mockResolvedValue(undefined);
	return {
		sendFull,
		sendFacts,
		cancel,
		requests: new ClientAppraisalRequests(
			{ sendFull, sendFacts, cancel },
			overrides?.options,
		),
	};
}

describe("ClientAppraisalRequests", () => {
	it("shares one wire request and delivers its result once to each interested consumer", async () => {
		const { sendFull, cancel, requests } = makeRequests();
		const first = vi.fn();
		const second = vi.fn();
		await Promise.all([
			requests.request(result.guid, first).sent,
			requests.request(result.guid, second).sent,
		]);
		expect(sendFull).toHaveBeenCalledExactlyOnceWith(result.guid, false);
		requests.receive({ type: "object-inspection-result", result });
		requests.receive({ type: "object-inspection-result", result });
		expect(first).toHaveBeenCalledExactlyOnceWith(result);
		expect(second).toHaveBeenCalledExactlyOnceWith(result);
		expect(cancel).not.toHaveBeenCalled();
	});

	it("cancels in core only when the last dispatched consumer cancels before reply", async () => {
		const { sendFull, cancel, requests } = makeRequests();
		const retired = vi.fn();
		const active = vi.fn();
		const first = requests.request(result.guid, retired);
		const second = requests.request(result.guid, active);
		await Promise.all([first.sent, second.sent]);

		first.cancel();
		expect(cancel).not.toHaveBeenCalled();

		second.cancel();
		expect(cancel).toHaveBeenCalledExactlyOnceWith(result.guid, "full");

		const replacement = vi.fn();
		await requests.request(result.guid, replacement).sent;
		expect(sendFull).toHaveBeenCalledTimes(2);
		requests.receive({ type: "object-inspection-result", result });
		expect(retired).not.toHaveBeenCalled();
		expect(active).not.toHaveBeenCalled();
		expect(replacement).toHaveBeenCalledExactlyOnceWith(result);
	});

	it("clears same-turn fresh preference when any consumer omits refresh", async () => {
		const { sendFull, requests } = makeRequests();
		await Promise.all([
			requests.request(result.guid, vi.fn(), { refresh: true }).sent,
			requests.request(result.guid, vi.fn(), { refresh: false }).sent,
		]);
		expect(sendFull).toHaveBeenCalledExactlyOnceWith(result.guid, false);
	});

	it("deduplicates facts-only requests, settles on entity health, and cancels when last consumer leaves early", async () => {
		const { sendFacts, cancel, requests } = makeRequests();
		const first = requests.requestFacts(result.guid);
		const second = requests.requestFacts(result.guid);
		await Promise.all([first.sent, second.sent]);
		expect(sendFacts).toHaveBeenCalledExactlyOnceWith(result.guid);

		first.cancel();
		expect(cancel).not.toHaveBeenCalled();
		second.cancel();
		expect(cancel).toHaveBeenCalledExactlyOnceWith(result.guid, "facts-only");

		const third = requests.requestFacts(result.guid);
		await third.sent;
		expect(sendFacts).toHaveBeenCalledTimes(2);
		requests.receive({
			type: "entity-health",
			health: {
				worldGeneration: 1,
				instanceSequence: 1,
				guid: result.guid,
				healthFraction: 0.75,
				observedAt: { seconds: 4.5 },
			},
		});
		// Already settled by entity-health, so late cancel does not notify core.
		third.cancel();
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("keeps unrelated targets independent and ignores unsolicited responses", async () => {
		const { requests } = makeRequests();
		const receive = vi.fn();
		await requests.request(result.guid, receive).sent;
		requests.receive({
			type: "object-inspection-result",
			result: { guid: 8, outcome: { kind: "rejected" } },
		});
		expect(receive).not.toHaveBeenCalled();
		requests.receive({ type: "object-inspection-result", result });
		expect(receive).toHaveBeenCalledWith(result);
	});

	it("shares transport failure and permits an explicit retry", async () => {
		const sendFull = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(undefined);
		const { requests } = makeRequests({ sendFull });
		const receive = vi.fn();
		const first = requests.request(result.guid, receive);
		const second = requests.request(result.guid, receive);
		await expect(first.sent).rejects.toThrow("offline");
		await expect(second.sent).rejects.toThrow("offline");
		await requests.request(result.guid, receive).sent;
		requests.receive({ type: "object-inspection-result", result });
		expect(sendFull).toHaveBeenCalledTimes(2);
		expect(receive).toHaveBeenCalledOnce();
	});

	it("retires old consumers on resync without letting a late transport failure discard replacement work", async () => {
		let failOld: (error: Error) => void = () => {
			throw new Error("Old transport was not called");
		};
		const oldSend = new Promise<void>((_, reject) => {
			failOld = reject;
		});
		const sendFull = vi
			.fn()
			.mockReturnValueOnce(oldSend)
			.mockResolvedValue(undefined);
		const { requests } = makeRequests({ sendFull });
		const retired = vi.fn();
		const old = requests.request(result.guid, retired);
		await Promise.resolve();
		requests.receive({ type: "resyncing" });
		const receive = vi.fn();
		await requests.request(result.guid, receive).sent;
		failOld(new Error("retired transport"));
		await expect(old.sent).rejects.toThrow("retired transport");
		requests.receive({ type: "object-inspection-result", result });
		expect(retired).not.toHaveBeenCalled();
		expect(receive).toHaveBeenCalledOnce();
	});

	it("does not dispatch or cancel work cancelled or retired before transport acceptance begins", async () => {
		const { sendFull, sendFacts, cancel, requests } = makeRequests();
		const cancelled = requests.request(7, vi.fn());
		cancelled.cancel();
		await cancelled.sent;
		const cancelledFacts = requests.requestFacts(9);
		cancelledFacts.cancel();
		await cancelledFacts.sent;
		const retired = requests.request(8, vi.fn());
		requests.receive({ type: "resyncing" });
		await retired.sent;
		expect(sendFull).not.toHaveBeenCalled();
		expect(sendFacts).not.toHaveBeenCalled();
		expect(cancel).not.toHaveBeenCalled();
	});

	it("dispatches one FactsOnly item at a time by lane, attack recency, and proximity, and supports dynamic reprioritization", async () => {
		const sentGuids: number[] = [];
		const { requests } = makeRequests({
			sendFacts: async (guid) => {
				sentGuids.push(guid);
			},
		});

		const vendor = requests.requestFacts(100, { kind: "vendor-offer" });
		const farUnattacked = requests.requestFacts(101, {
			kind: "combat-health",
			lastAttackedAtMs: null,
			distanceMeters: 18,
		});
		const owned = requests.requestFacts(102, { kind: "owned-equipment" });
		const closeUnattacked = requests.requestFacts(103, {
			kind: "combat-health",
			lastAttackedAtMs: null,
			distanceMeters: 4,
		});
		const attackedOlder = requests.requestFacts(104, {
			kind: "combat-health",
			lastAttackedAtMs: 1_000,
			distanceMeters: 3,
		});
		const partner = requests.requestFacts(105, { kind: "partner-trade" });
		const attackedRecentFar = requests.requestFacts(106, {
			kind: "combat-health",
			lastAttackedAtMs: 2_000,
			distanceMeters: 25,
		});
		const chest = requests.requestFacts(107, { kind: "world-container" });

		await chest.sent;
		expect(sentGuids).toEqual([107]);

		// Dynamically promote closeUnattacked as newly attacked while chest is in flight.
		closeUnattacked.setPriority?.({
			kind: "combat-health",
			lastAttackedAtMs: 3_000,
			distanceMeters: 4,
		});
		// Also merge a higher-priority consumer onto vendor item (never actually dispatched twice).
		const chestUpgrade = requests.requestFacts(100, {
			kind: "world-container",
		});

		const settleByHealth = (guid: number) =>
			requests.receive({
				type: "entity-health",
				health: {
					worldGeneration: 1,
					instanceSequence: 1,
					guid,
					healthFraction: 0.9,
					observedAt: { seconds: 1 },
				},
			});

		// Completing chest dispatches upgraded world-container item (100), then remaining combat-health, owned, partner.
		chest.cancel();
		await chestUpgrade.sent;
		expect(sentGuids).toEqual([107, 100]);

		chestUpgrade.cancel();
		vendor.cancel();
		await closeUnattacked.sent;
		settleByHealth(103);
		await attackedRecentFar.sent;
		settleByHealth(106);
		await attackedOlder.sent;
		settleByHealth(104);
		await farUnattacked.sent;
		settleByHealth(101);
		await owned.sent;
		owned.cancel();
		await partner.sent;
		partner.cancel();

		expect(sentGuids).toEqual([107, 100, 103, 106, 104, 101, 102, 105]);
	});

	it("releases an unanswered FactsOnly slot after the response timeout watchdog", async () => {
		vi.useFakeTimers();
		try {
			const timeoutMs = 1_500;
			const sentGuids: number[] = [];
			const { requests } = makeRequests({
				sendFacts: async (guid) => {
					sentGuids.push(guid);
				},
				options: { factsTimeoutMs: timeoutMs },
			});
			const stalled = requests.requestFacts(200, { kind: "world-container" });
			const queued = requests.requestFacts(201, { kind: "vendor-offer" });

			await vi.advanceTimersByTimeAsync(0);
			await stalled.sent;
			expect(sentGuids).toEqual([200]);

			await vi.advanceTimersByTimeAsync(timeoutMs);
			await queued.sent;
			expect(sentGuids).toEqual([200, 201]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("settles active FactsOnly items on appraisal-facts-settled or consumer settle without notifying core cancel", async () => {
		const sentGuids: number[] = [];
		const { cancel, requests } = makeRequests({
			sendFacts: async (guid) => {
				sentGuids.push(guid);
			},
		});

		const first = requests.requestFacts(301, { kind: "world-container" });
		const second = requests.requestFacts(302, { kind: "owned-equipment" });
		const third = requests.requestFacts(303, { kind: "vendor-offer" });

		await first.sent;
		expect(sentGuids).toEqual([301]);

		requests.receive({ type: "appraisal-facts-settled", guid: 301 });
		await second.sent;
		expect(sentGuids).toEqual([301, 302]);

		second.settle?.();
		await third.sent;
		expect(sentGuids).toEqual([301, 302, 303]);
		expect(cancel).not.toHaveBeenCalled();

		third.settle?.();
		expect(cancel).not.toHaveBeenCalled();
	});
});
