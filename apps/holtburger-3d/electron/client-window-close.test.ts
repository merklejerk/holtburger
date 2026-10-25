import { describe, expect, it, vi } from "vitest";
import {
	ClientWindowClose,
	CLIENT_CLOSE_PREPARATION_TIMEOUT_MS,
} from "./client-window-close";

function deferred() {
	let resolve: () => void = () => {
		throw new Error("Deferred not initialized.");
	};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function setup() {
	const dependencies = {
		prepareRenderer: vi.fn(),
		shutdownNative: vi.fn(async () => {}),
		reportFailure: vi.fn(),
		exit: vi.fn(),
		deadlineMs: CLIENT_CLOSE_PREPARATION_TIMEOUT_MS,
	};
	return { ...dependencies, owner: new ClientWindowClose(dependencies) };
}

describe("client native close ownership", () => {
	it("joins repeated native/window/application close requests and seals IPC before native cleanup", async () => {
		const app = setup();
		const stopping = deferred();
		app.shutdownNative.mockReturnValue(stopping.promise);
		const closing = app.owner.request();
		expect(app.owner.request()).toBe(closing);
		expect(app.owner.request()).toBe(closing);
		await vi.waitFor(() => expect(app.prepareRenderer).toHaveBeenCalledOnce());
		expect(app.owner.acceptsRendererRequests).toBe(true);
		expect(app.shutdownNative).not.toHaveBeenCalled();
		app.owner.acceptPreparation({ kind: "prepared" });
		expect(app.owner.acceptsRendererRequests).toBe(false);
		await vi.waitFor(() => expect(app.shutdownNative).toHaveBeenCalledOnce());
		expect(app.exit).not.toHaveBeenCalled();
		stopping.resolve();
		await closing;
		expect(app.exit).toHaveBeenCalledOnce();
		expect(app.reportFailure).not.toHaveBeenCalled();
	});
	it("continues independent native cleanup after failed or malformed preparation", async () => {
		for (const payload of [
			{ kind: "failed", diagnostic: "Settings failed" },
			{ kind: "unexpected" },
		]) {
			const app = setup();
			const closing = app.owner.request();
			await vi.waitFor(() =>
				expect(app.prepareRenderer).toHaveBeenCalledOnce(),
			);
			app.owner.acceptPreparation(payload);
			await closing;
			expect(app.reportFailure).toHaveBeenCalledOnce();
			expect(app.shutdownNative).toHaveBeenCalledOnce();
			expect(app.exit).toHaveBeenCalledOnce();
		}
	});
	it("uses the preparation deadline for an unresponsive renderer and ignores late acknowledgements", async () => {
		vi.useFakeTimers();
		try {
			const app = setup();
			const closing = app.owner.request();
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(CLIENT_CLOSE_PREPARATION_TIMEOUT_MS);
			await closing;
			expect(app.reportFailure).toHaveBeenCalledOnce();
			expect(app.shutdownNative).toHaveBeenCalledOnce();
			app.owner.acceptPreparation({ kind: "prepared" });
			expect(app.exit).toHaveBeenCalledOnce();
			expect(app.owner.acceptsRendererRequests).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
	it("fails preparation immediately when the renderer vanishes or is replaced", async () => {
		const app = setup();
		const closing = app.owner.request();
		await vi.waitFor(() => expect(app.prepareRenderer).toHaveBeenCalledOnce());
		app.owner.rendererUnavailable("Renderer context replaced");
		await closing;
		expect(app.reportFailure).toHaveBeenCalledWith(
			expect.objectContaining({ message: "Renderer context replaced" }),
		);
		expect(app.exit).toHaveBeenCalledOnce();
	});
	it("does not send a preparation request to an already missing renderer", async () => {
		const app = setup();
		app.owner.rendererUnavailable("Renderer missing");
		await app.owner.request();
		expect(app.prepareRenderer).not.toHaveBeenCalled();
		expect(app.shutdownNative).toHaveBeenCalledOnce();
		expect(app.reportFailure).toHaveBeenCalledOnce();
	});
	it("exits after a native cleanup failure while reporting its failure status", async () => {
		const app = setup();
		app.shutdownNative.mockRejectedValue(new Error("Host shutdown failed"));
		const closing = app.owner.request();
		await vi.waitFor(() => expect(app.prepareRenderer).toHaveBeenCalledOnce());
		app.owner.acceptPreparation({ kind: "prepared" });
		await closing;
		expect(app.reportFailure).toHaveBeenCalledWith(
			expect.objectContaining({ message: "Host shutdown failed" }),
		);
		expect(app.exit).toHaveBeenCalledOnce();
	});
});
