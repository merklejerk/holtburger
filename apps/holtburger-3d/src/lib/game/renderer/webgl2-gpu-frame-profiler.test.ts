import { describe, expect, it, vi } from "vitest";
import {
	WebGL2FrameProfiler,
	WebGL2GpuFrameProfiler,
} from "./webgl2-gpu-frame-profiler";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";

describe("renderer profiling", () => {
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
	it("accumulates complete asynchronous frames", () => {
		const fixture = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(fixture.gl);
		profiler.beginFrame(1)?.finish();
		profiler.beginFrame(2)?.finish();
		expect(fixture.createQuery).toHaveBeenCalledTimes(2);
		expect(profiler.getProfile()).toEqual({
			kind: "pending",
			pendingFrameCount: 2,
			skippedFrameCount: 0,
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
			skippedFrameCount: 0,
			latestSystemMs: {
				terrain: 0,
				opaqueGeometry: 0,
				shadowMaps: 0,
				ambientOcclusion: 0,
				portalComposition: 0,
				transparencyAndEffects: 0,
				presentation: 0,
				other: 1,
			},
			meanSystemMs: {
				terrain: 0,
				opaqueGeometry: 0,
				shadowMaps: 0,
				ambientOcclusion: 0,
				portalComposition: 0,
				transparencyAndEffects: 0,
				presentation: 0,
				other: 1,
			},
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
			skippedFrameCount: 0,
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
	it("sums repeated systems and views, and includes absent systems in the frame mean", () => {
		const fixture = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(fixture.gl);
		const frame = profiler.beginFrame(1);
		profiler.setSystem("terrain");
		profiler.setSystem("terrain"); // Adjacent equal boundaries do not create another query.
		profiler.setSystem("opaqueGeometry");
		profiler.setSystem("terrain"); // A second view contributes to the same frame.
		frame?.finish();
		expect(fixture.createQuery).toHaveBeenCalledTimes(4);
		profiler.beginFrame(2)?.finish(); // No terrain or objects in this frame.
		fixture.resultsAvailable = true;
		profiler.poll();
		expect(profiler.getProfile()).toMatchObject({
			frameNumber: 2,
			sampleCount: 2,
			latestMs: 1,
			meanMs: 2.5,
			latestSystemMs: { terrain: 0, opaqueGeometry: 0, other: 1 },
			meanSystemMs: { terrain: 1, opaqueGeometry: 0.5, other: 1 },
		});
	});

	it("waits for every segment before reading or publishing any part of a frame", () => {
		const fixture = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(fixture.gl);
		const frame = profiler.beginFrame(1);
		profiler.setSystem("terrain");
		profiler.setSystem("other");
		frame?.finish();
		fixture.availableQueryCount = 2;
		profiler.poll();
		expect(profiler.getProfile()).toMatchObject({
			kind: "pending",
			pendingFrameCount: 1,
		});
		expect(fixture.readResult).not.toHaveBeenCalled();
		fixture.resultsAvailable = true;
		profiler.poll();
		expect(profiler.getProfile()).toMatchObject({
			kind: "available",
			sampleCount: 1,
			latestMs: 3,
		});
	});

	it("discards an entire over-budget frame and resumes on the next frame", () => {
		const fixture = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(fixture.gl);
		const frame = profiler.beginFrame(1);
		const maximum =
			SHARED_FRONTEND_TUNING.diagnostics.maximumGpuSegmentsPerFrame;
		for (let index = 0; index < maximum; index++)
			profiler.setSystem(index % 2 === 0 ? "terrain" : "other");
		frame?.finish();
		expect(fixture.createQuery).toHaveBeenCalledTimes(maximum);
		expect(fixture.deleteQuery).toHaveBeenCalledTimes(maximum);
		expect(profiler.getProfile()).toMatchObject({
			kind: "pending",
			pendingFrameCount: 0,
			skippedFrameCount: 1,
		});
		profiler.beginFrame(2)?.finish();
		fixture.resultsAvailable = true;
		profiler.poll();
		expect(profiler.getProfile()).toMatchObject({
			frameNumber: 2,
			sampleCount: 1,
			latestMs: 1,
			skippedFrameCount: 1,
		});
	});

	it("releases all active and pending segments on reset and disjoint", () => {
		const fixture = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(fixture.gl);
		const pending = profiler.beginFrame(1);
		profiler.setSystem("shadowMaps");
		pending?.finish();
		const active = profiler.beginFrame(2);
		profiler.setSystem("ambientOcclusion");
		fixture.disjoint = true;
		profiler.poll();
		active?.finish();
		expect(fixture.deleteQuery).toHaveBeenCalledTimes(4);
		fixture.disjoint = false;
		const next = profiler.beginFrame(3);
		profiler.setSystem("portalComposition");
		profiler.reset();
		next?.discard();
		next?.finish();
		expect(fixture.deleteQuery).toHaveBeenCalledTimes(6);
		expect(profiler.getProfile()).toMatchObject({
			kind: "pending",
			skippedFrameCount: 0,
		});
	});

	it("discards partial GPU work when rendering fails, including query allocation failure", () => {
		const fixture = createGpuHarness(true);
		const profiler = new WebGL2FrameProfiler(fixture.gl);
		const frame = profiler.beginFrame();
		profiler.setGpuSystem("terrain");
		fixture.createQuery.mockReturnValueOnce(null);
		expect(() => profiler.setGpuSystem("opaqueGeometry")).toThrow(
			"Failed to allocate",
		);
		frame.discardGpuFrame();
		frame.finish();
		expect(fixture.deleteQuery).toHaveBeenCalledTimes(2);
		const next = profiler.beginFrame();
		next.finish();
		fixture.resultsAvailable = true;
		// Poll by admitting another frame, just as the renderer does.
		profiler.beginFrame().finish();
		expect(profiler.getProfile()?.gpu).toMatchObject({
			kind: "available",
			frameNumber: 2,
			sampleCount: 1,
			latestSystemMs: { terrain: 0 },
		});
		profiler.destroy();
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
	readonly createQuery: ReturnType<typeof vi.fn<() => WebGLQuery | null>>;
	readonly readResult: ReturnType<typeof vi.fn>;
	availableQueryCount: number;
	readonly deleteQuery: ReturnType<typeof vi.fn>;
	disjoint: boolean;
	readonly gl: WebGL2RenderingContext;
	resultsAvailable: boolean;
} {
	// Each segment resolves to a fixed 1 ms; availability can advance independently.
	const elapsed = new Map<WebGLQuery, number>();
	const createdQueries: WebGLQuery[] = [];
	const readResult = vi.fn((query: WebGLQuery) => elapsed.get(query));
	const state = {
		availableQueryCount: 0,
		disjoint: false,
		resultsAvailable: false,
	};
	let active: WebGLQuery | null = null;
	const createQuery = vi.fn((): WebGLQuery | null => {
		const query = {} as WebGLQuery;
		createdQueries.push(query);
		return query;
	});
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
			parameter === 0x8867
				? state.resultsAvailable ||
					createdQueries.indexOf(query) < state.availableQueryCount
				: readResult(query),
	} as unknown as WebGL2RenderingContext;
	return {
		createQuery,
		deleteQuery,
		readResult,
		get availableQueryCount() {
			return state.availableQueryCount;
		},
		set availableQueryCount(value: number) {
			state.availableQueryCount = value;
		},
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
