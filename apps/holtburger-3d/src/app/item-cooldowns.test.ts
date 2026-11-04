import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemCooldowns } from "./item-cooldowns.svelte";

afterEach(() => vi.useRealTimers());

describe("item cooldown presentation clock", () => {
	it("anchors shared groups once and changes membership only on replacement", () => {
		const source = new ItemCooldowns(() => 5000);
		source.replace({
			receivedAtMs: 1000,
			cooldowns: [{ groupId: 213, remainingSeconds: 20 }],
		});
		expect(source.deadline(213)).toBe(21000);
		expect(source.deadline(1000)).toBeUndefined();
		source.replace({
			receivedAtMs: 5000,
			cooldowns: [{ groupId: 213, remainingSeconds: 30 }],
		});
		expect(source.deadline(213)).toBe(35000);
		source.replace(null);
		expect(source.deadline(213)).toBeUndefined();
	});

	it("uses one timeout for multiple active consumers and stops at expiry", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const source = new ItemCooldowns(() => Date.now());
		const first = vi.fn();
		const second = vi.fn();
		const stopFirst = source.watch(2400, 1, first);
		const stopSecond = source.watch(2400, 1, second);
		expect(vi.getTimerCount()).toBe(1);
		expect(first).toHaveBeenLastCalledWith(3);
		vi.advanceTimersByTime(1000);
		expect(first).toHaveBeenLastCalledWith(2);
		expect(second).toHaveBeenLastCalledWith(2);
		vi.advanceTimersByTime(1400);
		expect(first).toHaveBeenLastCalledWith(0);
		expect(second).toHaveBeenLastCalledWith(0);
		expect(vi.getTimerCount()).toBe(0);
		stopFirst();
		stopSecond();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("disposes the text clock when the last active cell unmounts", () => {
		vi.useFakeTimers();
		const source = new ItemCooldowns(() => Date.now());
		const stop = source.watch(Date.now() + 45000, 1, vi.fn());
		expect(vi.getTimerCount()).toBe(1);
		stop();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("samples tooltip and inspection independently while expiring both promptly", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const source = new ItemCooldowns(() => Date.now());
		const tooltip = vi.fn();
		const inspection = vi.fn();
		source.watch(12400, 5, tooltip);
		source.watch(12400, 1, inspection);
		expect(tooltip.mock.calls).toEqual([[13]]);
		vi.advanceTimersByTime(1000);
		expect(inspection).toHaveBeenLastCalledWith(12);
		expect(tooltip.mock.calls).toEqual([[13]]);
		vi.advanceTimersByTime(4000);
		expect(tooltip.mock.calls).toEqual([[13], [8]]);
		vi.advanceTimersByTime(5000);
		expect(tooltip.mock.calls).toEqual([[13], [8], [3]]);
		vi.advanceTimersByTime(2400);
		expect(tooltip.mock.calls).toEqual([[13], [8], [3], [0]]);
		expect(inspection).toHaveBeenLastCalledWith(0);
		expect(vi.getTimerCount()).toBe(0);
	});
});
