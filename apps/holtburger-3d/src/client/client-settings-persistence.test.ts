import { describe, expect, it, vi } from "vitest";
import { ClientSettingsPersistence } from "./client-settings-persistence";

describe("ClientSettingsPersistence", () => {
	it("coalesces a quiet interval to the latest snapshot", async () => {
		vi.useFakeTimers();
		const saved: number[] = [];
		const persistence = new ClientSettingsPersistence<number>({
			delayMs: 100,
			save: async (value) => void saved.push(value),
			report: () => undefined,
		});
		persistence.publish(1);
		persistence.publish(2);
		await vi.advanceTimersByTimeAsync(100);
		expect(saved).toEqual([2]);
		vi.useRealTimers();
	});

	it("serializes an in-flight save and retains only the newest pending value", async () => {
		let release: (() => void) | undefined;
		const saved: number[] = [];
		const persistence = new ClientSettingsPersistence<number>({
			delayMs: 100,
			save: async (value) => {
				saved.push(value);
				if (value === 1)
					await new Promise<void>((resolve) => {
						release = resolve;
					});
			},
			report: () => undefined,
		});
		persistence.publish(1);
		const flushing = persistence.flush();
		await Promise.resolve();
		persistence.publish(2);
		persistence.publish(3);
		release?.();
		await flushing;
		expect(saved).toEqual([1, 3]);
	});

	it("reports failure and retries the retained snapshot on a later mutation", async () => {
		let attempts = 0;
		const failures: unknown[] = [];
		const saved: number[] = [];
		const persistence = new ClientSettingsPersistence<number>({
			delayMs: 100,
			save: async (value) => {
				attempts += 1;
				if (attempts === 1) throw new Error("disk full");
				saved.push(value);
			},
			report: (error) => failures.push(error),
		});
		persistence.publish(1);
		await expect(persistence.flush()).rejects.toThrow("disk full");
		persistence.publish(2);
		await persistence.flush();
		expect(failures).toHaveLength(1);
		expect(saved).toEqual([2]);
	});
});
