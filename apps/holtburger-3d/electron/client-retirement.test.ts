import { describe, expect, it, vi } from "vitest";
import {
	ClientRetirement,
	CLIENT_CLOSE_PREPARATION_TIMEOUT_MS,
} from "./client-retirement";

function setup() {
	const dependencies = {
		prepareRenderer: vi.fn(),
		shutdownNative: vi.fn(async () => {}),
		deadlineMs: CLIENT_CLOSE_PREPARATION_TIMEOUT_MS,
	};
	return { ...dependencies, owner: new ClientRetirement(dependencies) };
}
describe("document retirement preparation and native barrier", () => {
	it("joins repeated requests and seals game IPC before native cleanup", async () => {
		const app = setup();
		const retiring = app.owner.request();
		expect(app.owner.request()).toBe(retiring);
		await vi.waitFor(() => expect(app.prepareRenderer).toHaveBeenCalledOnce());
		expect(app.owner.acceptsRendererRequests).toBe(true);
		expect(app.shutdownNative).not.toHaveBeenCalled();
		app.owner.acceptPreparation({ kind: "prepared" });
		expect(app.owner.acceptsRendererRequests).toBe(false);
		await expect(retiring).resolves.toEqual({ kind: "prepared" });
		expect(app.shutdownNative).toHaveBeenCalledOnce();
	});
	it("returns preparation diagnostics after still attempting native cleanup", async () => {
		for (const payload of [
			{ kind: "failed", diagnostic: "Save failed" },
			{ kind: "unexpected" },
		]) {
			const app = setup();
			const retiring = app.owner.request();
			await vi.waitFor(() =>
				expect(app.prepareRenderer).toHaveBeenCalledOnce(),
			);
			app.owner.acceptPreparation(payload);
			await expect(retiring).resolves.toMatchObject({ kind: "failed" });
			expect(app.shutdownNative).toHaveBeenCalledOnce();
		}
	});
	it("bounds an unresponsive renderer and ignores late acknowledgements", async () => {
		vi.useFakeTimers();
		try {
			const app = setup();
			const retiring = app.owner.request();
			await vi.advanceTimersByTimeAsync(CLIENT_CLOSE_PREPARATION_TIMEOUT_MS);
			await expect(retiring).resolves.toMatchObject({ kind: "failed" });
			app.owner.acceptPreparation({ kind: "prepared" });
			expect(app.shutdownNative).toHaveBeenCalledOnce();
			expect(app.owner.acceptsRendererRequests).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
	it("does not wait on a renderer that has already vanished", async () => {
		const app = setup();
		app.owner.rendererUnavailable("Renderer missing");
		await expect(app.owner.request()).resolves.toEqual({
			kind: "failed",
			diagnostic: "Renderer missing",
		});
		expect(app.prepareRenderer).not.toHaveBeenCalled();
		expect(app.shutdownNative).toHaveBeenCalledOnce();
	});
	it("rejects native cleanup failure so the app cannot claim safe replacement", async () => {
		const app = setup();
		app.shutdownNative.mockRejectedValue(new Error("Host still running"));
		app.owner.rendererUnavailable("Renderer missing");
		await expect(app.owner.request()).rejects.toThrow("Host still running");
		expect(app.owner.acceptsRendererRequests).toBe(false);
	});
});
