import { describe, expect, it, vi } from "vitest";
import { PointerLockSession } from "./viewport-pointer-lock";

interface Deferred {
	readonly promise: Promise<void>;
	resolve(): void;
	reject(error: unknown): void;
}

function deferred(): Deferred {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function createFakeCanvas(requestImpl: () => Promise<void> | void): {
	readonly canvas: HTMLCanvasElement;
	readonly exitPointerLock: ReturnType<typeof vi.fn>;
	setLocked: (locked: boolean) => void;
} {
	const listeners = new Set<() => void>();
	let locked = false;
	const exitPointerLock = vi.fn(() => {
		locked = false;
		for (const listener of listeners) listener();
	});
	const doc = {
		get pointerLockElement() {
			return locked ? canvas : null;
		},
		addEventListener(type: string, handler: () => void) {
			if (type === "pointerlockchange") listeners.add(handler);
		},
		removeEventListener(type: string, handler: () => void) {
			if (type === "pointerlockchange") listeners.delete(handler);
		},
		exitPointerLock,
	};
	const canvas = {
		ownerDocument: doc,
		requestPointerLock: requestImpl,
	} as unknown as HTMLCanvasElement;
	return {
		canvas,
		exitPointerLock,
		setLocked(next: boolean) {
			locked = next;
			for (const listener of listeners) listener();
		},
	};
}

describe("PointerLockSession", () => {
	it("allows rapid request -> unlock -> request and ignores stale settlement", async () => {
		const first = deferred();
		const second = deferred();
		let calls = 0;
		const fake = createFakeCanvas(() => {
			calls += 1;
			return calls === 1 ? first.promise : second.promise;
		});
		const onLost = vi.fn();
		const onError = vi.fn();
		const session = new PointerLockSession({
			canvas: fake.canvas,
			onLost,
			onError,
		});

		session.request();
		session.unlock();
		session.request();
		await Promise.resolve();
		expect(calls).toBe(2);

		// Second request acquires lock before first stale promise settles.
		fake.setLocked(true);
		second.resolve();
		first.resolve();
		await Promise.all([first.promise, second.promise]);
		await Promise.resolve();

		expect(fake.exitPointerLock).not.toHaveBeenCalled();
		expect(session.locked).toBe(true);
		expect(onLost).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();

		// Unexpected OS/Escape unlock triggers onLost cleanly.
		fake.setLocked(false);
		expect(onLost).toHaveBeenCalledTimes(1);
		session.destroy();
	});

	it("exits pointer lock when a stale request settles while session is idle", async () => {
		const pending = deferred();
		const fake = createFakeCanvas(() => pending.promise);
		const session = new PointerLockSession({
			canvas: fake.canvas,
			onLost: vi.fn(),
			onError: vi.fn(),
		});

		session.request();
		await Promise.resolve();
		session.unlock();
		fake.setLocked(true);
		pending.resolve();
		await pending.promise;
		await Promise.resolve();

		expect(fake.exitPointerLock).toHaveBeenCalledTimes(1);
		session.destroy();
	});

	it("recovers from synchronous requestPointerLock throws without wedging", async () => {
		let shouldThrow = true;
		const fake = createFakeCanvas(() => {
			if (shouldThrow) throw new Error("sync denial");
			fake.setLocked(true);
		});
		const onLost = vi.fn();
		const onError = vi.fn();
		const session = new PointerLockSession({
			canvas: fake.canvas,
			onLost,
			onError,
		});

		session.request();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(onLost).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledTimes(1);

		// A subsequent request succeeds because #state was reset to idle.
		shouldThrow = false;
		session.request();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(session.locked).toBe(true);
		session.destroy();
	});
});
