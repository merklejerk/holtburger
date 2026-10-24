import { describe, expect, it, vi } from "vitest";
import { ClientAppraisalRequests } from "./client-appraisal-requests";
import type { ObjectInspectionResult } from "./client-object-inspection-contract";

const result: ObjectInspectionResult = {
	guid: 7,
	outcome: { kind: "missing" },
};

describe("ClientAppraisalRequests", () => {
	it("shares one wire request and delivers its result once to each interested consumer", async () => {
		const send = vi.fn().mockResolvedValue(undefined);
		const requests = new ClientAppraisalRequests(send);
		const first = vi.fn();
		const second = vi.fn();
		await Promise.all([
			requests.request(result.guid, first).sent,
			requests.request(result.guid, second).sent,
		]);
		expect(send).toHaveBeenCalledExactlyOnceWith(result.guid);
		requests.receive({ type: "object-inspection-result", result });
		requests.receive({ type: "object-inspection-result", result });
		expect(first).toHaveBeenCalledExactlyOnceWith(result);
		expect(second).toHaveBeenCalledExactlyOnceWith(result);
	});

	it("drains cancelled requests and lets later consumers join without a second indistinguishable request", async () => {
		const send = vi.fn().mockResolvedValue(undefined);
		const requests = new ClientAppraisalRequests(send);
		const retired = vi.fn();
		const first = requests.request(result.guid, retired);
		await first.sent;
		first.cancel();
		const next = vi.fn();
		await requests.request(result.guid, next).sent;
		requests.receive({ type: "object-inspection-result", result });
		expect(send).toHaveBeenCalledOnce();
		expect(retired).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledWith(result);
	});

	it("keeps unrelated targets independent and ignores unsolicited responses", async () => {
		const requests = new ClientAppraisalRequests(async () => {});
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
		const send = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(undefined);
		const requests = new ClientAppraisalRequests(send);
		const receive = vi.fn();
		const first = requests.request(result.guid, receive);
		const second = requests.request(result.guid, receive);
		await expect(first.sent).rejects.toThrow("offline");
		await expect(second.sent).rejects.toThrow("offline");
		await requests.request(result.guid, receive).sent;
		requests.receive({ type: "object-inspection-result", result });
		expect(send).toHaveBeenCalledTimes(2);
		expect(receive).toHaveBeenCalledOnce();
	});

	it("retires old consumers on resync without letting a late transport failure discard replacement work", async () => {
		let failOld: (error: Error) => void = () => {
			throw new Error("Old transport was not called");
		};
		const oldSend = new Promise<void>((_, reject) => {
			failOld = reject;
		});
		const send = vi
			.fn()
			.mockReturnValueOnce(oldSend)
			.mockResolvedValue(undefined);
		const requests = new ClientAppraisalRequests(send);
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

	it("does not dispatch work cancelled or retired before transport acceptance begins", async () => {
		const send = vi.fn().mockResolvedValue(undefined);
		const requests = new ClientAppraisalRequests(send);
		const cancelled = requests.request(7, vi.fn());
		cancelled.cancel();
		await cancelled.sent;
		const retired = requests.request(8, vi.fn());
		requests.receive({ type: "resyncing" });
		await retired.sent;
		expect(send).not.toHaveBeenCalled();
	});
});
