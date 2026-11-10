import { describe, expect, it, vi } from "vitest";
import {
	PerformanceSession,
	type PerformanceSessionSource,
} from "./performance-session";
import type {
	NativePerformanceSnapshot,
	NativePerformanceSource,
} from "./native-performance";
import { terrainCaptureDelta } from "./performance-report";
import { EXPLORER_TUNING } from "../explorer/explorer-tuning";
import type { ClosedWorkerPoolDiagnostics } from "../lib/game/workers/closed-worker";

function pool(): ClosedWorkerPoolDiagnostics {
	return {
		activeJobCount: 0,
		queuedJobCount: 0,
		completedJobCount: 0,
		peakQueuedJobCount: 0,
		totalJobTurnaroundMs: 0,
		totalQueueDelayMs: 0,
		transferredBytes: 0,
		workerCount: 1,
	};
}

function nativeSnapshot(
	generation: number,
	recording: boolean,
): NativePerformanceSnapshot {
	return {
		generation,
		recording,
		elapsedMs: 0,
		pendingScopes: 0,
		authority: [],
		forwarding: { sampleCount: 0, meanMs: null },
	};
}

function build(
	native: PerformanceSessionSource["native"] = {
		kind: "unavailable",
		reason: "fixture has no host",
	},
) {
	const runtime = {
		setFrameProfilingEnabled: vi.fn(),
		resetFrameProfile: vi.fn(),
		getRendererFrameDiagnostics: () => null,
		getPresentationProfile: () => null,
		getTerrainWorkerDiagnostics: () => pool(),
	};
	const session = new PerformanceSession({
		mode: "client",
		runtime,
		native,
		canvas: { clientWidth: 800, clientHeight: 600, width: 800, height: 600 },
		readGraphics: () => EXPLORER_TUNING.frameSettings,
		readFrameRates: () => null,
		readDevice: () => ({
			renderer: "fixture",
			vendor: "fixture",
			version: "WebGL2",
			shadingLanguageVersion: "fixture",
			unmaskedRenderer: null,
			unmaskedVendor: null,
		}),
	});
	return { session, runtime };
}

/** A response that crosses a capture boundary must not update the later window. */
function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error("Promise not initialized");
	};
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

describe("PerformanceSession", () => {
	it("resets all frontend measurements and freezes the stopped report", async () => {
		const { session, runtime } = build();
		expect(session.snapshot()).toBeNull();
		await session.start();
		session.recordFrame(4);
		session.recordFrame(8);
		expect(session.snapshot()?.browser.meanFrameWorkMs).toBe(6);
		await session.reset();
		expect(runtime.resetFrameProfile).toHaveBeenCalledOnce();
		expect(session.snapshot()?.browser.meanFrameWorkMs).toBeNull();
		session.recordFrame(2);
		await session.stop();
		const frozen = session.snapshot();
		session.recordFrame(100);
		expect(session.snapshot()).toBe(frozen);
		expect(frozen?.browser.meanFrameWorkMs).toBe(2);
		expect(frozen?.capture.state).toBe("stopped");
		expect(runtime.setFrameProfilingEnabled.mock.calls).toEqual([
			[true],
			[false],
		]);
	});

	it("rejects a delayed native snapshot after resetting the capture", async () => {
		const delayed = deferred<NativePerformanceSnapshot>();
		let priorGeneration = 0;
		let nativeReads = 0;
		const source: NativePerformanceSource = {
			control: async (action, generation) => {
				if (action === "snapshot")
					return ++nativeReads === 1
						? delayed.promise
						: nativeSnapshot(generation, true);
				if (!priorGeneration) priorGeneration = generation;
				return nativeSnapshot(generation, action === "start");
			},
		};
		const { session } = build({ kind: "available", source });
		await session.start();
		const refresh = session.refresh();
		await session.reset();
		await session.refresh();
		expect(nativeReads).toBe(2);
		delayed.resolve(nativeSnapshot(priorGeneration, true));
		await refresh;
		const current = session.snapshot();
		expect(current?.native.kind).toBe("available");
		if (current?.native.kind !== "available")
			throw new Error("Expected native snapshot");
		expect(current.native.snapshot.generation).toBe(current.capture.generation);
		expect(current.capture.generation).not.toBe(priorGeneration);
		await session.stop();
	});

	it("rolls back native start when renderer profiling fails", async () => {
		const control = vi.fn<NativePerformanceSource["control"]>(
			async (action, generation) =>
				nativeSnapshot(generation, action === "start"),
		);
		const { session, runtime } = build({
			kind: "available",
			source: { control },
		});
		runtime.setFrameProfilingEnabled.mockImplementation((enabled: boolean) => {
			if (enabled) throw new Error("device rejected profiling");
		});
		await expect(session.start()).rejects.toThrow("device rejected profiling");
		expect(control.mock.calls.map(([action]) => action)).toEqual([
			"start",
			"stop",
		]);
		expect(session.recording).toBe(false);
	});

	it("retirement while native start is pending never enables a retired renderer", async () => {
		const pending = deferred<NativePerformanceSnapshot>();
		let generation = 0;
		const source: NativePerformanceSource = {
			control: async (action, value) => {
				generation = value;
				return action === "start"
					? pending.promise
					: nativeSnapshot(value, false);
			},
		};
		const { session, runtime } = build({ kind: "available", source });
		const starting = session.start();
		session.retire();
		pending.resolve(nativeSnapshot(generation, true));
		await expect(starting).rejects.toThrow("retired");
		expect(runtime.setFrameProfilingEnabled).not.toHaveBeenCalled();
	});

	it("preserves completed observations when native stop fails", async () => {
		const source: NativePerformanceSource = {
			control: async (action, generation) => {
				if (action === "stop") throw new Error("host retired");
				return nativeSnapshot(generation, true);
			},
		};
		const { session, runtime } = build({ kind: "available", source });
		await session.start();
		session.recordFrame(2);
		await expect(session.stop()).rejects.toThrow("host retired");
		expect(session.snapshot()?.capture.state).toBe("stopped");
		expect(session.snapshot()?.native).toMatchObject({
			kind: "failed",
			lastSnapshot: { recording: true },
		});
		expect(runtime.setFrameProfilingEnabled).toHaveBeenLastCalledWith(false);
	});

	it("retains a stopped report after runtime retirement and rejects restart", async () => {
		const { session } = build();
		await session.start();
		session.recordFrame(3);
		session.retire();
		expect(session.snapshot()?.capture).toMatchObject({
			retired: true,
			state: "stopped",
		});
		await expect(session.start()).rejects.toThrow("retired");
	});
});

it("worker deltas preserve boundary-spanning work and instantaneous queue depth", () => {
	const start = {
		...pool(),
		activeJobCount: 1,
		queuedJobCount: 2,
		completedJobCount: 5,
		totalJobTurnaroundMs: 10,
	};
	const end = {
		...pool(),
		queuedJobCount: 1,
		completedJobCount: 7,
		totalJobTurnaroundMs: 30,
	};
	expect(terrainCaptureDelta(start, end)).toMatchObject({
		activeJobsAtStart: 1,
		queuedJobsAtStart: 2,
		completedJobs: 2,
		queuedJobs: 1,
		jobTurnaroundMs: 20,
	});
});
