import { afterEach, describe, expect, it, vi } from "vitest";
import { StartupGameLifecycle } from "./startup-game-lifecycle";
import {
	isElectronDocumentClosing,
	registerElectronStartupClose,
} from "../../lib/host/electron-host-transport";

function gate() {
	const waiters: Array<() => void> = [];
	const promise = new Promise<void>((resolve) => {
		waiters.push(resolve);
	});
	return {
		promise,
		open: () => {
			for (const resolve of waiters) resolve();
		},
	};
}

describe("startup game ownership", () => {
	it("prevents game construction when close wins before readiness", async () => {
		const lifecycle = new StartupGameLifecycle();
		expect(await lifecycle.prepareClose()).toEqual({ kind: "prepared" });
		const mount = vi.fn(async () => true);
		await lifecycle.start(mount);
		expect(mount).not.toHaveBeenCalled();
	});

	it("joins settings bootstrap and cancels construction when closing during it", async () => {
		const lifecycle = new StartupGameLifecycle();
		const settings = gate();
		const construct = vi.fn();
		const retire = vi.fn();
		const mounting = lifecycle.start(async (signal) => {
			signal.addEventListener("abort", retire, { once: true });
			await settings.promise;
			if (signal.aborted) return false;
			construct();
			return true;
		});
		await Promise.resolve();
		const closing = lifecycle.prepareClose();
		expect(retire).toHaveBeenCalledOnce();
		settings.open();
		await mounting;
		expect(await closing).toEqual({ kind: "prepared" });
		expect(construct).not.toHaveBeenCalled();
	});

	it("waits for onMount cleanup registration and delegates close once", async () => {
		const lifecycle = new StartupGameLifecycle();
		const mount = vi.fn(async () => true);
		const mounting = lifecycle.start(mount);
		await Promise.resolve();
		const closing = lifecycle.prepareClose();
		const cleanup = vi.fn(async () => ({ kind: "prepared" as const }));
		lifecycle.registerCleanup(cleanup);
		await mounting;
		expect(await closing).toEqual({ kind: "prepared" });
		expect(await lifecycle.prepareClose()).toEqual({ kind: "prepared" });
		expect(cleanup).toHaveBeenCalledOnce();
		expect(mount).toHaveBeenCalledOnce();
	});

	it("does not strand close when a Svelte effect fails before registration", async () => {
		const lifecycle = new StartupGameLifecycle();
		const mounting = lifecycle.start(async () => true);
		const failed = expect(mounting).rejects.toThrow("mount effect failed");
		await Promise.resolve();
		lifecycle.failMount(new Error("mount effect failed"));
		await failed;
		expect(await lifecycle.prepareClose()).toEqual({
			kind: "failed",
			diagnostic: "mount effect failed",
		});
	});

	describe("document close state", () => {
		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("marks the document closing synchronously when close preparation begins", async () => {
			const lifecycle = new StartupGameLifecycle();
			const cleanupGate = gate();
			let closeHandler: (() => Promise<unknown>) | null = null;
			vi.stubGlobal("window", {
				holtburgerClient: {
					start: async () => {},
					quit: async () => {},
					onPrepareClose: (handler: () => Promise<unknown>) => {
						closeHandler = handler;
						return () => {
							closeHandler = null;
						};
					},
				},
			});
			const unregister = registerElectronStartupClose(lifecycle);
			try {
				lifecycle.registerCleanup(async () => {
					await cleanupGate.promise;
					return { kind: "prepared" };
				});
				expect(lifecycle.closing).toBe(false);
				expect(isElectronDocumentClosing()).toBe(false);
				if (closeHandler === null)
					throw new Error("Expected startup close handler registration.");
				const triggerClose: () => Promise<unknown> = closeHandler;

				const closing = triggerClose();
				expect(lifecycle.closing).toBe(true);
				expect(isElectronDocumentClosing()).toBe(true);

				cleanupGate.open();
				expect(await closing).toEqual({ kind: "prepared" });
				expect(isElectronDocumentClosing()).toBe(true);
			} finally {
				unregister();
			}
			expect(isElectronDocumentClosing()).toBe(false);
		});
	});
});
