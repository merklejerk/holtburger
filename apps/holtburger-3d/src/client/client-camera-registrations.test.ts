import { describe, expect, it, vi } from "vitest";
import { ClientCameraRegistrations } from "./client-camera-registrations";
import { abortError } from "../lib/async-lifetime";
import type { ClientCameraStartRequest } from "./client-host-contract";

function deferred() {
	let resolve: () => void = () => {
		throw new Error("Deferred not initialized.");
	};
	let reject: (error: unknown) => void = () => {
		throw new Error("Deferred not initialized.");
	};
	const promise = new Promise<void>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const request: ClientCameraStartRequest = {
	playerGuid: 7,
	entityGeneration: 1,
	initialReach: 4.5,
	minimumReach: 1.2,
	maximumReach: 8,
	inputSequence: 0,
	viewDirection: [0, 0, -1],
	cumulativeZoomDisplacement: 0,
	projectionRevision: 1,
	clearanceRadius: 0.2,
};
const receipt = { playerGuid: 7, entityGeneration: 1, cameraGeneration: 1 };
function setup() {
	const start = vi.fn(async (_request: ClientCameraStartRequest) => {
		void _request;
	});
	const stop = vi.fn(async () => {});
	const report = vi.fn();
	return {
		start,
		stop,
		report,
		owner: new ClientCameraRegistrations({ start, stop, report }),
	};
}

describe("session-owned camera registrations", () => {
	it("observes the receipt while the command response is held and cancels the local wait immediately", async () => {
		const app = setup();
		const command = deferred();
		app.start.mockReturnValue(command.promise);
		const local = new AbortController();
		const starting = app.owner.register(request, local.signal);
		const cancelled = expect(starting).rejects.toMatchObject({
			name: "AbortError",
		});
		await vi.waitFor(() => expect(app.start).toHaveBeenCalledOnce());
		local.abort(abortError("withdrawn"));
		await cancelled;
		app.owner.receive(receipt);
		expect(app.stop).not.toHaveBeenCalled();
		command.resolve();
		await vi.waitFor(() =>
			expect(app.stop).toHaveBeenCalledExactlyOnceWith(receipt),
		);
		expect(app.report).not.toHaveBeenCalled();
	});
	it("never attributes an abandoned same-target receipt to its replacement", async () => {
		const app = setup();
		const first = new AbortController();
		const cancelled = expect(
			app.owner.register(request, first.signal),
		).rejects.toMatchObject({ name: "AbortError" });
		await vi.waitFor(() => expect(app.start).toHaveBeenCalledOnce());
		first.abort(abortError("replaced"));
		await cancelled;
		const replacement = app.owner.register(
			request,
			new AbortController().signal,
		);
		expect(app.start).toHaveBeenCalledOnce();
		app.owner.receive(receipt);
		await vi.waitFor(() => expect(app.start).toHaveBeenCalledTimes(2));
		expect(app.stop).toHaveBeenCalledExactlyOnceWith(receipt);
		const next = { ...receipt, cameraGeneration: 2 };
		app.owner.receive(next);
		await expect(replacement).resolves.toEqual(next);
	});
	it("hands pending registration to authority shutdown without a late stop", async () => {
		const app = setup();
		const local = new AbortController();
		const cancelled = expect(
			app.owner.register(request, local.signal),
		).rejects.toMatchObject({ name: "AbortError" });
		await vi.waitFor(() => expect(app.start).toHaveBeenCalledOnce());
		app.owner.close();
		await cancelled;
		app.owner.receive(receipt);
		await app.owner.stop(receipt);
		expect(app.stop).not.toHaveBeenCalled();
		expect(app.report).not.toHaveBeenCalled();
	});
	it("reports genuine native failure after the local caller has withdrawn", async () => {
		const app = setup();
		const command = deferred();
		app.start.mockReturnValue(command.promise);
		const local = new AbortController();
		const cancelled = expect(
			app.owner.register(request, local.signal),
		).rejects.toMatchObject({ name: "AbortError" });
		await vi.waitFor(() => expect(app.start).toHaveBeenCalledOnce());
		local.abort(abortError("withdrawn"));
		await cancelled;
		const error = new Error("camera transport failed");
		command.reject(error);
		await vi.waitFor(() =>
			expect(app.report).toHaveBeenCalledExactlyOnceWith(error),
		);
	});
	it("settles an ignored registration on authoritative reset and admits the next generation", async () => {
		const app = setup();
		const cancelled = expect(
			app.owner.register(request, new AbortController().signal),
		).rejects.toMatchObject({ name: "AbortError" });
		await vi.waitFor(() => expect(app.start).toHaveBeenCalledOnce());
		app.owner.reset();
		await cancelled;
		const next = app.owner.register(request, new AbortController().signal);
		await vi.waitFor(() => expect(app.start).toHaveBeenCalledTimes(2));
		app.owner.receive(receipt);
		await expect(next).resolves.toEqual(receipt);
	});
});
