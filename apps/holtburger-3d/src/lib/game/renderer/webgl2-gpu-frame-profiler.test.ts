import { describe, expect, it, vi } from "vitest";
import {
	WebGL2FrameProfiler,
	WebGL2GpuFrameProfiler,
} from "./webgl2-gpu-frame-profiler";

describe("WebGL2GpuFrameProfiler", () => {
	it("reports unsupported without allocating queries", () => {
		const harness = createGpuHarness(false);
		const profiler = new WebGL2GpuFrameProfiler(harness.gl);

		expect(profiler.beginFrame(1)).toBeNull();
		expect(profiler.getProfile()).toEqual({ kind: "unsupported" });
		expect(harness.createQuery).not.toHaveBeenCalled();
	});

	it("rejects an extension that exposes no timestamp bits", () => {
		const harness = createGpuHarness(true, 0);
		const profiler = new WebGL2GpuFrameProfiler(harness.gl);

		expect(profiler.beginFrame(1)).toBeNull();
		expect(profiler.getProfile()).toEqual({ kind: "unsupported" });
	});

	it("polls delayed results and aggregates repeated pass intervals", () => {
		const harness = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(harness.gl);
		const frame = profiler.beginFrame(7);
		if (!frame)
			throw new Error("Supported timer queries did not begin a frame.");

		frame.beginPhase("nearTerrain").finish();
		frame.beginPhase("farTerrain").finish();
		frame.beginPhase("ambientOcclusion").finish();
		frame.beginPhase("outdoorShadowMap").finish();
		frame.beginPhase("opaque").finish();
		frame.beginPhase("particle").finish();
		frame.beginPhase("presentation").finish();
		frame.beginPhase("portalComposition").finish();
		frame.beginPhase("portalComposition").finish();
		frame.finish();
		expect(profiler.getProfile()).toEqual({
			kind: "pending",
			pendingFrameCount: 1,
		});

		harness.resultsAvailable = true;
		profiler.poll();
		const timings = {
			ambientOcclusionMs: 1,
			blendedMs: 0,
			farTerrainMs: 1,
			opaqueMs: 1,
			outdoorShadowMapMs: 1,
			particleMs: 1,
			presentationMs: 1,
			portalCompositionMs: 2,
			// This frame drives no sky pass, so its span stays zero rather than being absent.
			skyMs: 0,
			nearTerrainMs: 1,
			// Near and far terrain remain available as one aggregate for existing consumers.
			terrainMs: 2,
			totalMs: 9,
		};
		expect(profiler.getProfile()).toEqual({
			...timings,
			frameNumber: 7,
			kind: "available",
			// One resolved frame, so the mean is that frame.
			mean: timings,
			pendingFrameCount: 0,
			sampleCount: 1,
		});
		// One query per phase, where the timestamp profiler needed a pair plus a frame pair.
		expect(harness.deleteQuery).toHaveBeenCalledTimes(9);
	});

	it("means every resolved frame, so one stalled batch cannot stand as the result", () => {
		const harness = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(harness.gl);
		harness.resultsAvailable = true;
		// Each query resolves to 1 ms, so opening `opaque` twice makes a frame twice as expensive.
		for (const opaquePhaseCount of [2, 1, 1]) {
			const frame = profiler.beginFrame(1);
			if (!frame)
				throw new Error("Supported timer queries did not begin a frame.");
			for (let index = 0; index < opaquePhaseCount; index += 1) {
				frame.beginPhase("opaque").finish();
			}
			frame.finish();
			profiler.poll();
		}

		const profile = profiler.getProfile();
		if (profile.kind !== "available") {
			throw new Error(`Expected resolved GPU timings, got ${profile.kind}.`);
		}
		expect(profile.sampleCount).toBe(3);
		expect(profile.opaqueMs).toBe(1);
		expect(profile.mean.opaqueMs).toBeCloseTo(4 / 3);

		// A reset delimits the next measurement window rather than carrying the old frames into it.
		profiler.reset();
		expect(profiler.getProfile().kind).toBe("pending");
	});

	it("refuses to nest elapsed queries, which WebGL permits only one of", () => {
		const harness = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(harness.gl);
		const frame = profiler.beginFrame(1);
		if (!frame)
			throw new Error("Supported timer queries did not begin a frame.");
		frame.beginPhase("nearTerrain");

		// The single-active-query constraint is why there is no frame-wide span; a caller that
		// opens overlapping phases must fail rather than silently mismeasure.
		expect(() => frame.beginPhase("opaque")).toThrow("cannot nest");
	});

	it("drops a frame that measured no phase instead of stalling the backlog", () => {
		const harness = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(harness.gl);
		const frame = profiler.beginFrame(1);
		if (!frame)
			throw new Error("Supported timer queries did not begin a frame.");
		frame.finish();

		profiler.poll();

		// Nothing was measured, so there is no result to wait for and no query to delete.
		expect(profiler.getProfile()).toEqual({
			kind: "pending",
			pendingFrameCount: 0,
		});
		expect(harness.deleteQuery).not.toHaveBeenCalled();
	});

	it("discards every pending frame when the GPU clock becomes disjoint", () => {
		const harness = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(harness.gl);
		for (const frameNumber of [1, 2]) {
			const frame = profiler.beginFrame(frameNumber);
			if (!frame) throw new Error("Supported timer queries lost a frame.");
			frame.beginPhase("opaque").finish();
			frame.finish();
		}

		harness.disjoint = true;
		profiler.poll();
		expect(profiler.getProfile()).toEqual({
			kind: "disjoint",
			pendingFrameCount: 0,
		});
		expect(harness.deleteQuery).toHaveBeenCalledTimes(2);
	});

	it("bounds pending frames and tears down every retained query", () => {
		const harness = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(harness.gl);
		for (const frameNumber of [1, 2, 3, 4]) {
			const frame = profiler.beginFrame(frameNumber);
			if (!frame) throw new Error("Pending GPU capacity rejected too early.");
			frame.beginPhase("opaque").finish();
			frame.finish();
		}

		expect(profiler.beginFrame(5)).toBeNull();
		profiler.destroy();
		expect(harness.deleteQuery).toHaveBeenCalledTimes(4);
	});
});

describe("WebGL2FrameProfiler", () => {
	it("means every frame since reset while the percentile ranks only the recent tail", () => {
		const harness = createGpuHarness(false);
		const profiler = new WebGL2FrameProfiler(harness.gl);
		for (let frameNumber = 1; frameNumber <= 61; frameNumber += 1) {
			profiler.finishFrame({
				blendedOrderingMs: 0,
				blendedSubmissionMs: 0,
				contribution: contributionMetrics(frameNumber),
				finalizationMs: 0,
				frameNumber,
				instanceRunPreparationMs: 0,
				instanceUploadMs: 0,
				opaqueSubmissionMs: 0,
				outdoorShadowMap: outdoorShadowMapMetrics(frameNumber),
				outdoorShadowMapMs: 0,
				otherMs: 0,
				particleSubmissionMs: 0,
				portalCompositionMs: 0,
				portalPlanningMs: 0,
				sceneContributionResolutionMs: 0,
				sceneQueryMs: 0,
				setupMs: 0,
				terrainSubmissionMs: 0,
				totalMs: frameNumber,
				viewPreparationMs: 0,
			});
		}

		const profile = profiler.getProfile();
		// Every one of the 61 frames reaches the mean. The percentile sees only the retained tail —
		// frames 2..61 once frame 1 is shifted out — whose nearest-rank p95 is 58.
		expect(profile?.cpu).toMatchObject({
			latestFrameNumber: 61,
			latestTotalMs: 61,
			p95RecentTotalMs: 58,
			sampleCount: 61,
		});
		expect(profile?.cpu.mean.totalMs).toBe(31);
		expect(profile?.cpu.contribution.latest.staticObjectPreparationCount).toBe(
			61,
		);
		expect(profile?.cpu.contribution.mean.staticObjectPreparationCount).toBe(
			31,
		);
		expect(profile?.cpu.outdoorShadowMap.mean.cascadeQueryCount).toBe(31);
	});

	it("drops accumulated samples on reset so the next mean covers one window", () => {
		const profiler = new WebGL2FrameProfiler(createGpuHarness(false).gl);
		const record = (frameNumber: number, totalMs: number): void => {
			profiler.finishFrame({
				blendedOrderingMs: 0,
				blendedSubmissionMs: 0,
				contribution: contributionMetrics(frameNumber),
				finalizationMs: 0,
				frameNumber,
				instanceRunPreparationMs: 0,
				instanceUploadMs: 0,
				opaqueSubmissionMs: 0,
				outdoorShadowMap: outdoorShadowMapMetrics(),
				outdoorShadowMapMs: 0,
				otherMs: 0,
				particleSubmissionMs: 0,
				portalCompositionMs: 0,
				portalPlanningMs: 0,
				sceneContributionResolutionMs: 0,
				sceneQueryMs: 0,
				setupMs: 0,
				terrainSubmissionMs: 0,
				totalMs,
				viewPreparationMs: 0,
			});
		};
		record(1, 100);
		record(2, 100);
		profiler.reset();
		expect(profiler.getProfile()).toBeNull();

		record(3, 4);
		record(4, 6);
		const profile = profiler.getProfile();
		expect(profile?.cpu.sampleCount).toBe(2);
		expect(profile?.cpu.mean.totalMs).toBe(5);
		// Frame numbering survives reset, so two samples from one session stay distinguishable.
		expect(profile?.cpu.latestFrameNumber).toBe(4);
	});

	it("records static and dynamic contribution preparation work", () => {
		const harness = createGpuHarness(false);
		const profiler = new WebGL2FrameProfiler(harness.gl);
		const frame = profiler.beginFrame();
		frame.recordObjectPreparation(5, 2);
		frame.recordOutdoorShadowMap({
			cascadeQueryCount: 3,
			compatibleDepthRunCount: 9,
			instanceUploadBytes: 240,
			instanceUploadCount: 3,
			selectedCasterPartCount: 12,
		});
		frame.finish();

		expect(profiler.getProfile()?.cpu.contribution.latest).toEqual({
			dynamicObjectPreparationCount: 2,
			staticObjectPreparationCount: 5,
		});
		expect(profiler.getProfile()?.cpu.outdoorShadowMap.latest).toEqual({
			cascadeQueryCount: 3,
			compatibleDepthRunCount: 9,
			instanceUploadBytes: 240,
			instanceUploadCount: 3,
			selectedCasterPartCount: 12,
		});
	});

	it("does not also charge named particle submission time to other", () => {
		const now = vi
			.spyOn(performance, "now")
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(1)
			.mockReturnValueOnce(4)
			.mockReturnValueOnce(10);
		try {
			const profiler = new WebGL2FrameProfiler(createGpuHarness(false).gl);
			const frame = profiler.beginFrame();
			const particleStartedAt = frame.beginCpuPhase();
			frame.finishCpuPhase("particleSubmission", particleStartedAt);
			frame.finish();

			expect(profiler.getProfile()?.cpu.mean).toMatchObject({
				otherMs: 7,
				particleSubmissionMs: 3,
				totalMs: 10,
			});
		} finally {
			now.mockRestore();
		}
	});
});

function contributionMetrics(staticObjectPreparationCount: number) {
	return {
		dynamicObjectPreparationCount: 0,
		staticObjectPreparationCount,
	};
}

function outdoorShadowMapMetrics(cascadeQueryCount = 0) {
	return {
		cascadeQueryCount,
		compatibleDepthRunCount: 0,
		instanceUploadBytes: 0,
		instanceUploadCount: 0,
		selectedCasterPartCount: 0,
	};
}

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
	// Each elapsed query resolves to a fixed 1 ms, so a phase opened twice in one frame aggregates
	// to 2 ms and the arithmetic under test stays obvious.
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
