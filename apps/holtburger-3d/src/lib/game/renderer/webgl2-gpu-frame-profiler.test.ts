import { describe, expect, it, vi } from "vitest";
import {
	WebGL2FrameProfiler,
	WebGL2GpuFrameProfiler,
} from "./webgl2-gpu-frame-profiler";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";

describe("whole-renderer profiling", () => {
	it("reports unsupported without allocating queries", () => {
		const fixture = createGpuHarness(false);
		const profiler = new WebGL2GpuFrameProfiler(fixture.gl);
		expect(profiler.beginFrame(1)).toBeNull();
		expect(profiler.getProfile()).toEqual({ kind: "unsupported" });
		expect(fixture.createQuery).not.toHaveBeenCalled();
	});
	it("rejects an extension without elapsed query support", () => {
		const fixture = createGpuHarness(true, 0);
		expect(new WebGL2GpuFrameProfiler(fixture.gl).beginFrame(1)).toBeNull();
	});
	it("uses one asynchronous query per frame and accumulates a mean", () => {
		const fixture = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(fixture.gl);
		profiler.beginFrame(1)?.finish();
		profiler.beginFrame(2)?.finish();
		expect(fixture.createQuery).toHaveBeenCalledTimes(2);
		expect(profiler.getProfile()).toEqual({
			kind: "pending",
			pendingFrameCount: 2,
		});
		fixture.resultsAvailable = true;
		profiler.poll();
		expect(profiler.getProfile()).toEqual({
			kind: "available",
			frameNumber: 2,
			latestMs: 1,
			meanMs: 1,
			sampleCount: 2,
			pendingFrameCount: 0,
		});
		expect(fixture.deleteQuery).toHaveBeenCalledTimes(2);
	});
	it("reset closes old queries without letting old captures close a new frame", () => {
		const fixture = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(fixture.gl);
		const old = profiler.beginFrame(1);
		profiler.reset();
		const next = profiler.beginFrame(2);
		old?.finish();
		expect(() => profiler.beginFrame(3)).toThrow("already active");
		next?.finish();
		fixture.resultsAvailable = true;
		profiler.poll();
		expect(profiler.getProfile()).toMatchObject({
			frameNumber: 2,
			sampleCount: 1,
		});
		expect(fixture.deleteQuery).toHaveBeenCalledTimes(2);
	});
	it("discards invalid GPU clock samples", () => {
		const fixture = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(fixture.gl);
		profiler.beginFrame(1)?.finish();
		fixture.disjoint = true;
		profiler.poll();
		expect(profiler.getProfile()).toEqual({
			kind: "disjoint",
			pendingFrameCount: 0,
		});
		fixture.disjoint = false;
		profiler.beginFrame(2)?.finish();
		fixture.resultsAvailable = true;
		profiler.poll();
		expect(profiler.getProfile()).toMatchObject({ sampleCount: 1, meanMs: 1 });
	});
	it("bounds outstanding device work and releases it on destruction", () => {
		const fixture = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(fixture.gl);
		const maximum = SHARED_FRONTEND_TUNING.diagnostics.maximumPendingGpuFrames;
		for (let index = 0; index < maximum; index++)
			profiler.beginFrame(index)?.finish();
		expect(profiler.beginFrame(maximum)).toBeNull();
		profiler.destroy();
		profiler.destroy();
		expect(fixture.deleteQuery).toHaveBeenCalledTimes(maximum);
		expect(() => profiler.beginFrame(maximum)).toThrow("destroyed");
	});
	it("averages whole CPU frames and isolates reset windows", () => {
		const fixture = createGpuHarness(false);
		let now = 0;
		const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
		try {
			const profiler = new WebGL2FrameProfiler(fixture.gl);
			const first = profiler.beginFrame();
			now += 2;
			first.finish();
			const second = profiler.beginFrame();
			now += 8;
			second.finish();
			expect(profiler.getProfile()?.cpu).toMatchObject({
				meanMs: 5,
				sampleCount: 2,
				p95RecentMs: 8,
			});
			const old = profiler.beginFrame();
			profiler.reset();
			now += 100;
			old.finish();
			expect(profiler.getProfile()).toBeNull();
			const next = profiler.beginFrame();
			now += 3;
			next.finish();
			expect(profiler.getProfile()?.cpu).toMatchObject({
				latestFrameNumber: 4,
				meanMs: 3,
				sampleCount: 1,
			});
		} finally {
			clock.mockRestore();
		}
	});
});

function createGpuHarness(
	supported: boolean,
	elapsedBits = 64,
): {
	readonly createQuery: ReturnType<typeof vi.fn>;
	readonly deleteQuery: ReturnType<typeof vi.fn>;
	disjoint: boolean;
	readonly gl: WebGL2RenderingContext;
	resultsAvailable: boolean;
} {
	// Each whole-frame query resolves to a fixed 1 ms.
	const elapsed = new Map<WebGLQuery, number>();
	const state = {
		disjoint: false,
		resultsAvailable: false,
	};
	let active: WebGLQuery | null = null;
	const createQuery = vi.fn(() => ({}) as WebGLQuery);
	const deleteQuery = vi.fn();
	const extension = supported
		? {
				GPU_DISJOINT_EXT: 0x8fbb,
				QUERY_COUNTER_BITS_EXT: 0x8864,
				TIME_ELAPSED_EXT: 0x88bf,
			}
		: null;
	const gl = {
		QUERY_RESULT: 0x8866,
		QUERY_RESULT_AVAILABLE: 0x8867,
		beginQuery: (_target: GLenum, query: WebGLQuery) => {
			if (active) throw new Error("fake GL: nested elapsed query");
			active = query;
			elapsed.set(query, 1_000_000);
		},
		createQuery,
		deleteQuery,
		endQuery: () => {
			if (!active) throw new Error("fake GL: no active elapsed query");
			active = null;
		},
		getExtension: () => extension,
		getParameter: () => state.disjoint,
		getQuery: () => elapsedBits,
		getQueryParameter: (query: WebGLQuery, parameter: GLenum) =>
			parameter === 0x8867 ? state.resultsAvailable : elapsed.get(query),
	} as unknown as WebGL2RenderingContext;
	return {
		createQuery,
		deleteQuery,
		get disjoint() {
			return state.disjoint;
		},
		set disjoint(value: boolean) {
			state.disjoint = value;
		},
		gl,
		get resultsAvailable() {
			return state.resultsAvailable;
		},
		set resultsAvailable(value: boolean) {
			state.resultsAvailable = value;
		},
	};
}
