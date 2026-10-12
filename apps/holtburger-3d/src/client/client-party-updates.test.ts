import { describe, expect, it, vi } from "vitest";
import { ClientPartyUpdates } from "./client-party-updates";

function fixture() {
	const send = vi
		.fn<(enabled: boolean) => Promise<void>>()
		.mockResolvedValue(undefined);
	const report = vi.fn<(error: unknown) => void>();
	const owner = new ClientPartyUpdates(send, report);
	owner.setActive(true, false);
	return { owner, send, report };
}

describe("session-owned party update demand", () => {
	it("explicitly disables unknown server demand during snapshot recovery", async () => {
		const { owner, send } = fixture();
		owner.setActive(true, true);
		await vi.waitFor(() => expect(send.mock.calls).toEqual([[false]]));
	});

	it("does not let a pre-portal completion establish subscription state after re-entry", async () => {
		const { owner, send } = fixture();
		let finish: (() => void) | undefined;
		send.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		owner.setDemand("hud", true);
		await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
		owner.setActive(false, false);
		owner.setDemand("hud", false);
		owner.setActive(true, false);
		if (finish === undefined) throw new Error("Missing pending update request");
		finish();
		await vi.waitFor(() => expect(send.mock.calls).toEqual([[true], [false]]));
	});

	it("keeps updates enabled until both surfaces release demand", async () => {
		const { owner, send } = fixture();
		owner.setDemand("hud", true);
		await vi.waitFor(() => expect(send).toHaveBeenCalledWith(true));
		owner.setDemand("management", true);
		owner.setDemand("management", false);
		owner.setDemand("hud", false);
		await vi.waitFor(() => expect(send.mock.calls).toEqual([[true], [false]]));
	});

	it("serializes in-flight changes and sends the final demand", async () => {
		const { owner, send } = fixture();
		let finish: (() => void) | undefined;
		send.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		owner.setDemand("hud", true);
		await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
		owner.setDemand("hud", false);
		owner.setDemand("management", true);
		owner.setDemand("management", false);
		expect(send).toHaveBeenCalledOnce();
		if (finish === undefined) throw new Error("Missing pending update request");
		finish();
		await vi.waitFor(() => expect(send.mock.calls).toEqual([[true], [false]]));
	});

	it("defers demand during portal transit and refreshes it on re-entry and recovery", async () => {
		const { owner, send } = fixture();
		owner.setDemand("hud", true);
		await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
		owner.setActive(false, false);
		owner.setDemand("management", true);
		owner.setActive(true, false);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		owner.setActive(true, true);
		await vi.waitFor(() =>
			expect(send.mock.calls).toEqual([[true], [true], [true]]),
		);
	});

	it("reconciles a release made during portal transit", async () => {
		const { owner, send } = fixture();
		owner.setDemand("hud", true);
		await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
		owner.setActive(false, false);
		owner.setDemand("hud", false);
		owner.setActive(true, false);
		await vi.waitFor(() => expect(send.mock.calls).toEqual([[true], [false]]));
	});

	it("reports failures and permits the next explicit reconciliation", async () => {
		const { owner, send, report } = fixture();
		const error = new Error("Transport unavailable");
		send.mockRejectedValueOnce(error);
		owner.setDemand("hud", true);
		await vi.waitFor(() => expect(report).toHaveBeenCalledWith(error));
		owner.setDemand("hud", true);
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	});

	it("retires pending work and demand when the session stops", async () => {
		const { owner, send } = fixture();
		owner.setDemand("hud", true);
		owner.stop();
		owner.setActive(true, false);
		owner.setDemand("management", true);
		await vi.waitFor(() => expect(send.mock.calls).toEqual([[true]]));
		owner.setDemand("management", false);
		await vi.waitFor(() => expect(send.mock.calls).toEqual([[true], [false]]));
	});
});
