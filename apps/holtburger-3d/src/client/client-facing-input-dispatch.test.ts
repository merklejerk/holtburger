import { afterEach, expect, it, vi } from "vitest";
import { ClientFacingInputDispatch } from "./client-facing-input-dispatch";

afterEach(() => vi.unstubAllGlobals());

it("sums displacement under backpressure and flushes before a lifecycle edge", async () => {
	const frames = new Map<number, FrameRequestCallback>();
	let id = 0;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.set(++id, callback);
		return id;
	});
	vi.stubGlobal("cancelAnimationFrame", (frame: number) =>
		frames.delete(frame),
	);
	const tick = () => {
		const queued = [...frames.values()];
		frames.clear();
		for (const callback of queued) callback(0);
	};
	const deliveries: {
		delta: number;
		current: () => boolean;
		resolve: () => void;
	}[] = [];
	const dispatch = new ClientFacingInputDispatch(
		(delta, current) =>
			new Promise<void>((resolve) =>
				deliveries.push({ delta, current, resolve }),
			),
	);
	dispatch.add(0.1);
	dispatch.add(0.2);
	tick();
	expect(deliveries).toHaveLength(1);
	expect(deliveries[0]?.delta).toBeCloseTo(0.3);
	for (let sample = 0; sample < 100; sample++) dispatch.add(0.01);
	tick();
	expect(deliveries).toHaveLength(1);
	dispatch.flush(); // A jump/drive edge can now enqueue after this accumulated displacement.
	expect(deliveries).toHaveLength(2);
	expect(deliveries[1]?.delta).toBeCloseTo(1);
	dispatch.cancel();
	expect(deliveries.every((delivery) => !delivery.current())).toBe(true);
	for (const delivery of deliveries) delivery.resolve();
	await Promise.resolve();
	tick();
	expect(deliveries).toHaveLength(2);
	dispatch.add(-0.4);
	tick();
	expect(deliveries[2]?.delta).toBeCloseTo(-0.4);
	expect(deliveries[2]?.current()).toBe(true);
	deliveries[2]?.resolve();
});
