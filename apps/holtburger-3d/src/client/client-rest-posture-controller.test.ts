import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientRestPostureController } from "./client-rest-posture-controller";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import {
	DynamicEntityMirror,
	type RestPosture,
} from "../lib/game/runtime/dynamic-entity-feed";
import { emotePlaybackFixture } from "../harness/browser/client-emote-fixture";
import { CLIENT_TUNING } from "./client-tuning";

function fixture() {
	type Session = ConstructorParameters<typeof ClientRestPostureController>[0];
	let state: ReturnType<Session["state"]> = {
		lifecycle: { kind: "in-world" },
		playerGuid: 1,
		worldGeneration: 1,
	};
	const mirror = new DynamicEntityMirror(() => 0);
	const entity = emotePlaybackFixture(1, "locomotion");
	mirror.apply({
		kind: "snapshot",
		snapshot: { hostTime: { seconds: 0 }, entities: [entity] },
	});
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const setRestPosture = vi
		.fn<Session["setRestPosture"]>()
		.mockResolvedValue(undefined);
	const cancelRestPosture = vi
		.fn<Session["cancelRestPosture"]>()
		.mockResolvedValue(undefined);
	const release = vi.fn();
	let escape = () => {};
	const reportError = vi.fn();
	const onCycle = vi.fn();
	const controller = new ClientRestPostureController(
		{
			state: () => state,
			mirror,
			setRestPosture,
			cancelRestPosture,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		{
			bindEscapeContext: (cancel) => {
				escape = cancel;
				return { release, promote: vi.fn() };
			},
		},
		reportError,
		onCycle,
	);
	const emit = (event: ClientLifecycleSessionEvent) => {
		if (event.type === "dynamic" && !mirror.apply(event.event)) return;
		for (const listener of listeners) listener(event);
	};
	const observe = (posture: RestPosture, guid = 1) => {
		const updated = emotePlaybackFixture(guid, "explicit");
		if (updated.motion === null) throw new Error("fixture requires motion");
		updated.motion.restPosture = posture;
		emit({ type: "dynamic", event: { kind: "upserted", entity: updated } });
	};
	return {
		onCycle,
		controller,
		setRestPosture,
		cancelRestPosture,
		reportError,
		release,
		observe,
		emit,
		escape: () => escape(),
		replace: (changes: Partial<typeof state>) => {
			state = { ...state, ...changes };
			emit({ type: "entities" });
		},
	};
}

afterEach(() => vi.useRealTimers());

describe("rest posture cycle", () => {
	it("cycles through unconfirmed targets and wraps back to standing", async () => {
		const f = fixture();
		for (let i = 0; i < 4; i++) await f.controller.cycle(Promise.resolve());
		expect(f.setRestPosture.mock.calls).toEqual([
			["crouching"],
			["sitting"],
			["lying"],
			["standing"],
		]);
		expect(f.onCycle.mock.calls).toEqual(f.setRestPosture.mock.calls);
		expect(f.cancelRestPosture).not.toHaveBeenCalled();
		f.controller.destroy();
	});

	it("uses accepted gameplay posture rather than animation names or another player", async () => {
		const f = fixture();
		f.observe("sitting");
		f.observe("lying", 2);
		await f.controller.cycle(Promise.resolve());
		expect(f.setRestPosture).toHaveBeenLastCalledWith("lying");
		f.observe("lying");
		await f.controller.cycle(Promise.resolve());
		expect(f.setRestPosture).toHaveBeenLastCalledWith("standing");
		f.controller.destroy();
	});

	it("Escape explicitly cancels the shared prerequisite", async () => {
		const f = fixture();
		await f.controller.cycle(Promise.resolve());
		f.escape();
		expect(f.cancelRestPosture).toHaveBeenCalledOnce();
		expect(f.release).toHaveBeenCalledOnce();
		f.controller.destroy();
	});

	it("competing movement discards the pending cycle cursor", async () => {
		const f = fixture();
		await f.controller.cycle(Promise.resolve());
		f.controller.forget();
		await f.controller.cycle(Promise.resolve());
		expect(f.setRestPosture.mock.calls).toEqual([["crouching"], ["crouching"]]);
		f.controller.destroy();
	});

	it.each(["resyncing", "entities"] as const)(
		"retires pending input on %s or world replacement",
		async (type) => {
			const f = fixture();
			await f.controller.cycle(Promise.resolve());
			if (type === "entities") f.replace({ worldGeneration: 2 });
			else f.emit({ type });
			await f.controller.cycle(Promise.resolve());
			expect(f.setRestPosture.mock.calls).toEqual([
				["crouching"],
				["crouching"],
			]);
			f.controller.destroy();
		},
	);

	it("resync cancels core's pending prerequisite as well as the cycle cursor", async () => {
		const f = fixture();
		await f.controller.cycle(Promise.resolve());
		f.emit({ type: "resyncing" });
		expect(f.cancelRestPosture).toHaveBeenCalledOnce();
		f.controller.destroy();
	});

	it("an old standing snapshot cannot swallow the final request in a rapid full cycle", async () => {
		const f = fixture();
		f.observe("standing");
		for (let i = 0; i < 3; i++) await f.controller.cycle(Promise.resolve());
		let release = () => {};
		const priorInput = new Promise<void>((resolve) => {
			release = resolve;
		});
		const standing = f.controller.cycle(priorInput);
		// This is still the pre-cycle pose; the final Stand request has not been sent yet.
		f.observe("standing");
		release();
		await standing;
		expect(f.setRestPosture.mock.calls).toEqual([
			["crouching"],
			["sitting"],
			["lying"],
			["standing"],
		]);
		f.controller.destroy();
	});

	it("stale enqueue failures cannot erase a newer cycle target", async () => {
		const f = fixture();
		let rejectOld: (error: Error) => void = () => {};
		f.setRestPosture.mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					rejectOld = reject;
				}),
		);
		const first = f.controller.cycle(Promise.resolve());
		await Promise.resolve();
		const failed = expect(first).rejects.toThrow("old request");
		await f.controller.cycle(Promise.resolve());
		rejectOld(new Error("old request"));
		await failed;
		await f.controller.cycle(Promise.resolve());
		expect(f.setRestPosture.mock.calls).toEqual([
			["crouching"],
			["sitting"],
			["lying"],
		]);
		f.controller.destroy();
	});

	it("manual intent before preceding movement finishes prevents stale posture dispatch", async () => {
		const f = fixture();
		let release = () => {};
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const pending = f.controller.cycle(barrier);
		f.controller.forget();
		release();
		await pending;
		expect(f.setRestPosture).not.toHaveBeenCalled();
		f.controller.destroy();
	});

	it("bounds the pending cursor without assigning a duration to a held pose", async () => {
		vi.useFakeTimers();
		const f = fixture();
		await f.controller.cycle(Promise.resolve());
		await vi.advanceTimersByTimeAsync(
			CLIENT_TUNING.resting.acknowledgementTimeoutMs,
		);
		expect(f.cancelRestPosture).toHaveBeenCalledOnce();
		await f.controller.cycle(Promise.resolve());
		f.observe("crouching");
		await vi.advanceTimersByTimeAsync(
			CLIENT_TUNING.resting.acknowledgementTimeoutMs * 2,
		);
		expect(f.cancelRestPosture).toHaveBeenCalledOnce();
		f.controller.destroy();
	});
});
