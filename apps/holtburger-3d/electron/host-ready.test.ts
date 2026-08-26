import { describe, expect, it } from "vitest";

import { createHostReadyGate } from "./host-ready";

describe("host readiness gate", () => {
	it("holds an early renderer request until the selected host is ready", async () => {
		const gate = createHostReadyGate<{ mode: string }>();
		let settled = false;
		const request = gate.promise.then((host) => {
			settled = true;
			return host.mode;
		});

		await Promise.resolve();
		expect(settled).toBe(false);
		gate.resolve({ mode: "client" });
		expect(await request).toBe("client");
	});

	it("rejects waiting requests when startup fails", async () => {
		const gate = createHostReadyGate<never>();
		const request = gate.promise;
		gate.reject(new Error("host failed"));
		await expect(request).rejects.toThrow("host failed");
	});
});
