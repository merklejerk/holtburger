import { afterEach, describe, expect, it, vi } from "vitest";

import { createCadencedDirtySampler } from "./cadenced-dirty-sampler";

describe("cadenced dirty sampler", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not run expensive sampling when marked dirty", () => {
		vi.useFakeTimers();
		const sample = vi.fn();
		const sampler = createCadencedDirtySampler({
			intervalMs: 1_000,
			sample,
			initiallyDirty: false,
		});
		sampler.start();

		sampler.markDirty();

		expect(sample).not.toHaveBeenCalled();
		expect(sampler.dirty).toBe(true);
		vi.advanceTimersByTime(999);
		expect(sample).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(sample).toHaveBeenCalledTimes(1);
		expect(sampler.dirty).toBe(false);
		sampler.dispose();
	});

	it("samples immediately on explicit request", () => {
		const sample = vi.fn();
		const sampler = createCadencedDirtySampler({
			intervalMs: 1_000,
			sample,
			initiallyDirty: false,
		});

		sampler.markDirty();
		sampler.sampleNow();

		expect(sample).toHaveBeenCalledTimes(1);
		expect(sampler.dirty).toBe(false);
	});
});
