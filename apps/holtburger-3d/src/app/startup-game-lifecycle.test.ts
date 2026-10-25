import { describe, expect, it, vi } from "vitest";
import { StartupGameLifecycle } from "./startup-game-lifecycle";

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
		const lifecycle = new StartupGameLifecycle("client");
		expect(await lifecycle.prepareClose()).toEqual({ kind: "prepared" });
		const mount = vi.fn(async () => true);
		await lifecycle.start(mount);
		expect(mount).not.toHaveBeenCalled();
	});

	it("joins settings bootstrap and cancels construction when closing during it", async () => {
		const lifecycle = new StartupGameLifecycle("client");
		const settings = gate();
		const construct = vi.fn();
		const mounting = lifecycle.start(async (isClosing) => {
			await settings.promise;
			if (isClosing()) return false;
			construct();
			return true;
		});
		await Promise.resolve();
		const closing = lifecycle.prepareClose();
		settings.open();
		await mounting;
		expect(await closing).toEqual({ kind: "prepared" });
		expect(construct).not.toHaveBeenCalled();
	});

	it("waits for onMount cleanup registration and delegates close once", async () => {
		const lifecycle = new StartupGameLifecycle("client");
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
		const lifecycle = new StartupGameLifecycle("client");
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

	it("mounts Explorer once without requiring a Client cleanup delegate", async () => {
		const lifecycle = new StartupGameLifecycle("explorer");
		const mount = vi.fn(async () => true);
		await Promise.all([lifecycle.start(mount), lifecycle.start(mount)]);
		expect(mount).toHaveBeenCalledOnce();
		expect(await lifecycle.prepareClose()).toEqual({ kind: "prepared" });
	});
});
