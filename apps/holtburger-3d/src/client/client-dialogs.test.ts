import { playerEntitySnapshot } from "./client-entity-mirror.test-support";
import { describe, expect, it, vi } from "vitest";
import { ClientDialogs } from "./client-dialogs";
import { ClientLifecycleSession } from "./client-lifecycle-session";

async function fixture() {
	const handlers = new Map<string, (payload: unknown) => void>();
	const invoke = vi
		.fn<(command: string, args?: Record<string, unknown>) => Promise<void>>()
		.mockResolvedValue(undefined);
	const session = new ClientLifecycleSession({
		invoke,
		listen: async (name, handler) => {
			handlers.set(name, handler);
			return () => {
				handlers.delete(name);
			};
		},
	});
	await session.start();
	const dialogs = new ClientDialogs(session);
	function emit(name: string, payload: unknown) {
		const handler = handlers.get(name);
		if (handler === undefined) throw new Error(`Missing listener: ${name}`);
		handler(payload);
	}
	const confirmation = (requestId: string) => ({
		requestId,
		text: `Question ${requestId}?`,
	});
	const request = (requestId: string) =>
		emit("client-confirmation-updated", {
			confirmation: confirmation(requestId),
		});
	const snapshot = (requestId: string | null) =>
		emit("client-current-state", {
			lifecycle: { kind: "in-world" },
			entityCollisionDisabled: false,
			localPlayerGuid: 7,
			entities: playerEntitySnapshot(7),
			serverTime: 1,
			worldGeneration: 1,
			worldName: null,
			playerName: null,
			vitals: [],
			characterMotion: null,
			activeConfirmation: requestId === null ? null : confirmation(requestId),
			dynamic: { hostTime: { seconds: 1 }, entities: [] },
		});
	return {
		dialogs,
		session,
		invoke,
		emit,
		request,
		snapshot,
		destroy: () => {
			dialogs.destroy();
			session.stop();
		},
	};
}

describe("ClientDialogs", () => {
	it("retains pre-world popups in order and gives answerable confirmations priority", async () => {
		const f = await fixture();
		f.emit("client-popup-string", { message: "First\nmessage" });
		const first = f.dialogs.snapshot();
		if (first?.kind !== "popup") throw new Error("Expected popup");
		f.emit("client-popup-string", { message: "Second" });
		f.request("42");
		expect(f.dialogs.snapshot()?.kind).toBe("confirmation");
		f.emit("client-confirmation-updated", { confirmation: null });
		expect(f.dialogs.snapshot()).toEqual(first);
		f.dialogs.dismissPopup(first.id);
		expect(f.dialogs.snapshot()).toMatchObject({
			kind: "popup",
			text: "Second",
		});
		f.dialogs.dismissPopup(first.id);
		expect(f.dialogs.snapshot()).toMatchObject({ text: "Second" });
		f.destroy();
	});

	it("submits an exact receipt once and waits for authority acknowledgement", async () => {
		const f = await fixture();
		f.request("18446744073709551615");
		f.invoke.mockClear();
		await f.dialogs.respond("18446744073709551615", false);
		await f.dialogs.respond("18446744073709551615", true);
		expect(f.invoke.mock.calls).toEqual([
			[
				"respond_to_client_confirmation",
				{ request_id: "18446744073709551615", accepted: false },
			],
		]);
		expect(f.dialogs.snapshot()).toMatchObject({
			submission: { kind: "submitting" },
		});
		f.emit("client-confirmation-updated", { confirmation: null });
		expect(f.dialogs.snapshot()).toBeNull();
		f.destroy();
	});

	it("recovers a prompt from snapshots and retains it across world lifecycle updates", async () => {
		const f = await fixture();
		f.snapshot("3");
		expect(f.dialogs.snapshot()).toMatchObject({ request: { requestId: "3" } });
		f.emit("client-lifecycle-changed", {
			kind: "portal-space",
			cause: "teleport",
			worldGeneration: 2,
		});
		expect(f.dialogs.snapshot()).toMatchObject({ request: { requestId: "3" } });
		f.dialogs.destroy();
		const recovered = new ClientDialogs(f.session);
		expect(recovered.snapshot()).toMatchObject({ request: { requestId: "3" } });
		f.emit("client-lifecycle-changed", {
			kind: "exiting",
			cause: "server-disconnect",
		});
		expect(recovered.snapshot()).toBeNull();
		recovered.destroy();
		f.destroy();
	});

	it("shows transport failure for retry and ignores late failure after replacement", async () => {
		const f = await fixture();
		f.request("4");
		f.invoke.mockRejectedValueOnce(new Error("Host transport unavailable"));
		await f.dialogs.respond("4", true);
		expect(f.dialogs.snapshot()).toMatchObject({
			submission: { kind: "ready", error: "Host transport unavailable" },
		});
		let reject: (reason: Error) => void = () => {
			throw new Error("Submission not started");
		};
		f.invoke.mockImplementationOnce(
			() =>
				new Promise((_resolve, rejectPromise) => {
					reject = rejectPromise;
				}),
		);
		const pending = f.dialogs.respond("4", true);
		f.request("5");
		reject(new Error("Late failure"));
		await pending;
		expect(f.dialogs.snapshot()).toMatchObject({
			request: { requestId: "5" },
			submission: { kind: "ready", error: null },
		});
		f.invoke.mockClear();
		await f.dialogs.respond("4", true);
		expect(f.invoke).not.toHaveBeenCalled();
		f.destroy();
		expect(f.dialogs.snapshot()).toBeNull();
	});
});
