import { describe, expect, it } from "vitest";

import {
	CLIENT_TOAST_DURATION_MS,
	ClientToastCenter,
	type ClientToastScheduler,
} from "./client-toast-center";

class FakeScheduler implements ClientToastScheduler {
	readonly callbacks = new Map<number, () => void>();
	readonly cancelled: number[] = [];
	readonly delays: number[] = [];
	#nextHandle = 1;

	cancel(handle: number): void {
		this.cancelled.push(handle);
	}

	schedule(callback: () => void, delayMs: number): number {
		const handle = this.#nextHandle++;
		this.callbacks.set(handle, callback);
		this.delays.push(delayMs);
		return handle;
	}

	fire(handle: number): void {
		const callback = this.callbacks.get(handle);
		if (callback === undefined) throw new Error(`Unknown timer ${handle}.`);
		callback();
	}
}

function fixture() {
	const scheduler = new FakeScheduler();
	const center = new ClientToastCenter({
		durationMs: CLIENT_TOAST_DURATION_MS,
		scheduler,
	});
	return { center, scheduler };
}

describe("ClientToastCenter", () => {
	it("publishes one toast and expires it at the configured duration", () => {
		const { center, scheduler } = fixture();
		const snapshots = [center.snapshot()];
		center.subscribe((toast) => snapshots.push(toast));

		center.publish({ message: "Precise jump enabled", tone: "status" });
		expect(center.snapshot()).toMatchObject({
			id: 1,
			message: "Precise jump enabled",
			tone: "status",
		});
		expect(scheduler.delays).toEqual([CLIENT_TOAST_DURATION_MS]);

		scheduler.fire(1);
		expect(center.snapshot()).toBeNull();
		expect(snapshots.at(-1)).toBeNull();
	});

	it("replaces stale feedback and ignores its obsolete expiry callback", () => {
		const { center, scheduler } = fixture();
		center.publish({ message: "First", tone: "status" });
		center.publish({
			message: "You need stable ground to jump.",
			tone: "warning",
		});

		expect(scheduler.cancelled).toEqual([1]);
		scheduler.fire(1);
		expect(center.snapshot()).toMatchObject({ id: 2, tone: "warning" });
		scheduler.fire(2);
		expect(center.snapshot()).toBeNull();
	});

	it("rejects invalid publication and tears down timer ownership", () => {
		const { center, scheduler } = fixture();
		expect(() => center.publish({ message: "  ", tone: "status" })).toThrow(
			"must not be empty",
		);
		center.publish({ message: "Visible", tone: "status" });
		center.destroy();

		expect(scheduler.cancelled).toEqual([1]);
		expect(center.snapshot()).toBeNull();
		expect(() => center.publish({ message: "Late", tone: "status" })).toThrow(
			"destroyed",
		);
	});
});
