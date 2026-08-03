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

	it("polls delayed timestamps and aggregates repeated pass intervals", () => {
		const harness = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(harness.gl);
		const frame = profiler.beginFrame(7);
		if (!frame)
			throw new Error("Supported timer queries did not begin a frame.");

		frame.beginPhase("terrain").finish();
		frame.beginPhase("terrain").finish();
		frame.beginPhase("opaque").finish();
		frame.finish();
		expect(profiler.getProfile()).toEqual({
			kind: "pending",
			pendingFrameCount: 1,
		});

		harness.resultsAvailable = true;
		profiler.poll();
		expect(profiler.getProfile()).toEqual({
			blendedMs: 0,
			frameNumber: 7,
			kind: "available",
			opaqueMs: 1,
			otherMs: 4,
			pendingFrameCount: 0,
			terrainMs: 2,
			totalMs: 7,
		});
		expect(harness.deleteQuery).toHaveBeenCalledTimes(8);
	});

	it("discards every pending frame when the GPU clock becomes disjoint", () => {
		const harness = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(harness.gl);
		for (const frameNumber of [1, 2]) {
			const frame = profiler.beginFrame(frameNumber);
			if (!frame) throw new Error("Supported timer queries lost a frame.");
			frame.finish();
		}

		harness.disjoint = true;
		profiler.poll();
		expect(profiler.getProfile()).toEqual({
			kind: "disjoint",
			pendingFrameCount: 0,
		});
		expect(harness.deleteQuery).toHaveBeenCalledTimes(4);
	});

	it("bounds pending frames and tears down every retained query", () => {
		const harness = createGpuHarness(true);
		const profiler = new WebGL2GpuFrameProfiler(harness.gl);
		for (const frameNumber of [1, 2, 3, 4]) {
			const frame = profiler.beginFrame(frameNumber);
			if (!frame) throw new Error("Pending GPU capacity rejected too early.");
			frame.finish();
		}

		expect(profiler.beginFrame(5)).toBeNull();
		profiler.destroy();
		expect(harness.deleteQuery).toHaveBeenCalledTimes(8);
	});
});

describe("WebGL2FrameProfiler", () => {
	it("summarizes the latest sixty CPU frames with a nearest-rank p95", () => {
		const harness = createGpuHarness(false);
		const profiler = new WebGL2FrameProfiler(harness.gl);
		for (let frameNumber = 1; frameNumber <= 61; frameNumber += 1) {
			profiler.finishFrame({
				blendedOrderingMs: 0,
				blendedSubmissionMs: 0,
				contribution: contributionMetrics(frameNumber),
				contributionMergeMs: 0,
				finalizationMs: 0,
				frameNumber,
				generatedInstanceCullingMs: 0,
				instanceRunPreparationMs: 0,
				instanceUploadMs: 0,
				objectPreparationMs: frameNumber * 2,
				opaqueSubmissionMs: 0,
				otherMs: 0,
				portalGraphPlanningMs: 0,
				sceneContributionResolutionMs: 0,
				sceneQueryMs: 0,
				setupMs: 0,
				terrainSubmissionMs: 0,
				totalMs: frameNumber,
				viewPreparationMs: 0,
			});
		}

		const profile = profiler.getProfile();
		expect(profile?.cpu).toMatchObject({
			latestFrameNumber: 61,
			latestTotalMs: 61,
			p95TotalMs: 58,
			sampleCount: 60,
		});
		expect(profile?.cpu.mean.totalMs).toBe(31.5);
		expect(profile?.cpu.mean.objectPreparationMs).toBe(63);
		expect(profile?.cpu.contribution.latest.staticObjectPreparationCount).toBe(
			61,
		);
		expect(profile?.cpu.contribution.mean.staticObjectPreparationCount).toBe(
			31.5,
		);
	});

	it("records portal contribution reuse and preparation work", () => {
		const harness = createGpuHarness(false);
		const profiler = new WebGL2FrameProfiler(harness.gl);
		const frame = profiler.beginFrame();
		frame.recordPortalNodePreparation();
		frame.recordPortalNodePreparation();
		frame.recordPortalContributionUse(["node-b", "node-a"]);
		frame.recordPortalContributionUse(["node-a", "node-b"]);
		frame.recordObjectPreparation(5, 2);
		frame.recordContributionMerge();
		frame.finish();

		expect(profiler.getProfile()?.cpu.contribution.latest).toEqual({
			...contributionMetrics(0),
			multiNodeMergeCount: 1,
			dynamicObjectPreparationCount: 2,
			staticObjectPreparationCount: 5,
			portalContributionSetCount: 1,
			portalContributionSetUseCount: 2,
			portalNodePreparationCount: 2,
			portalNodeUseCount: 4,
			repeatedPortalContributionSetUseCount: 1,
			repeatedPortalNodeUseCount: 2,
		});
	});
});

function contributionMetrics(staticObjectPreparationCount: number) {
	return {
		multiNodeMergeCount: 0,
		dynamicObjectPreparationCount: 0,
		staticObjectPreparationCount,
		portalContributionSetCount: 0,
		portalContributionSetUseCount: 0,
		portalNodePreparationCount: 0,
		portalNodeUseCount: 0,
		repeatedPortalContributionSetUseCount: 0,
		repeatedPortalNodeUseCount: 0,
	};
}

function createGpuHarness(
	supported: boolean,
	timestampBits = 64,
): {
	readonly createQuery: ReturnType<typeof vi.fn>;
	readonly deleteQuery: ReturnType<typeof vi.fn>;
	disjoint: boolean;
	readonly gl: WebGL2RenderingContext;
	resultsAvailable: boolean;
} {
	const timestamps = new Map<WebGLQuery, number>();
	let nextTimestamp = 0;
	const state = {
		disjoint: false,
		resultsAvailable: false,
	};
	const createQuery = vi.fn(() => ({}) as WebGLQuery);
	const deleteQuery = vi.fn();
	const extension = supported
		? {
				GPU_DISJOINT_EXT: 0x8fbb,
				QUERY_COUNTER_BITS_EXT: 0x8864,
				TIMESTAMP_EXT: 0x8e28,
				queryCounterEXT: (query: WebGLQuery) => {
					timestamps.set(query, nextTimestamp);
					nextTimestamp += 1_000_000;
				},
			}
		: null;
	const gl = {
		QUERY_RESULT: 0x8866,
		QUERY_RESULT_AVAILABLE: 0x8867,
		createQuery,
		deleteQuery,
		getExtension: () => extension,
		getParameter: () => state.disjoint,
		getQuery: () => timestampBits,
		getQueryParameter: (query: WebGLQuery, parameter: GLenum) =>
			parameter === 0x8867 ? state.resultsAvailable : timestamps.get(query),
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
