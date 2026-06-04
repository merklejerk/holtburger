import { RenderResourceJobScheduler } from "../render-resource-job-scheduler";
import { RenderResourceWorkerClient } from "../render-resource-worker-client";
import {
	createBuildCompactedGeometryWorkerInput,
	type BuildCompactedGeometryWorkerInput,
	type BuildCompactedGeometryWorkerResult,
} from "./compacted-geometry-worker-payloads";
import type { CompactedGeometryPlan } from "../compaction/compacted-geometry";
import type { StagedWorldDrawUnitAssembly } from "../staged-world-assembly";

interface CompactedGeometryWorkerSchedulerOptions {
	client?: RenderResourceWorkerClient;
	onReadyResult: () => void;
}

export interface CompactedGeometryWorkerDesiredBatch {
	groupKey: string;
	desiredJobKey: string;
	plan: CompactedGeometryPlan;
	drawUnits: readonly StagedWorldDrawUnitAssembly[];
	batchOrigin: { x: number; y: number; z: number };
}

interface ScheduledCompactedGeometryWorkerInput {
	groupKey: string;
	input: BuildCompactedGeometryWorkerInput;
}

export interface ReadyCompactedGeometryWorkerResult {
	groupKey: string;
	result: BuildCompactedGeometryWorkerResult;
}

export class CompactedGeometryWorkerScheduler {
	private readonly client: RenderResourceWorkerClient;

	private readonly schedulersByGroupKey = new Map<
		string,
		RenderResourceJobScheduler<
			ScheduledCompactedGeometryWorkerInput,
			ReadyCompactedGeometryWorkerResult
		>
	>();

	private disposed = false;

	constructor(options: CompactedGeometryWorkerSchedulerOptions) {
		this.client = options.client ?? new RenderResourceWorkerClient();
		this.onReadyResult = options.onReadyResult;
	}

	private readonly onReadyResult: () => void;

	scheduleDesired(batch: CompactedGeometryWorkerDesiredBatch): void {
		this.throwIfDisposed();
		this.schedulerForGroup(batch.groupKey).scheduleDesired({
			groupKey: batch.groupKey,
			input: createBuildCompactedGeometryWorkerInput({
				key: batch.desiredJobKey,
				plan: batch.plan,
				drawUnits: batch.drawUnits,
				batchOrigin: batch.batchOrigin,
			}),
		});
	}

	consumeReadyResults(): ReadyCompactedGeometryWorkerResult[] {
		const results: ReadyCompactedGeometryWorkerResult[] = [];
		for (const scheduler of this.schedulersByGroupKey.values()) {
			results.push(...scheduler.consumeReadyResults());
		}
		return results;
	}

	markCommitted(groupKey: string, key: string): void {
		const scheduler = this.schedulersByGroupKey.get(groupKey);
		if (!scheduler) {
			return;
		}
		scheduler.markCommitted(key);
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		for (const scheduler of this.schedulersByGroupKey.values()) {
			scheduler.dispose();
		}
		this.schedulersByGroupKey.clear();
		this.client.dispose();
	}

	private schedulerForGroup(
		groupKey: string,
	): RenderResourceJobScheduler<
		ScheduledCompactedGeometryWorkerInput,
		ReadyCompactedGeometryWorkerResult
	> {
		const existing = this.schedulersByGroupKey.get(groupKey);
		if (existing) {
			return existing;
		}
		const scheduler = new RenderResourceJobScheduler<
			ScheduledCompactedGeometryWorkerInput,
			ReadyCompactedGeometryWorkerResult
		>({
			getInputKey(input) {
				return input.input.key;
			},
			getResultKey(result) {
				return result.result.key;
			},
			submit: async (input) => ({
				groupKey: input.groupKey,
				result: await this.client.runBuildCompactedGeometryJob({
					type: "build-compacted-geometry",
					key: input.input.key,
					input: input.input,
				}),
			}),
			onReadyResult: this.onReadyResult,
		});
		this.schedulersByGroupKey.set(groupKey, scheduler);
		return scheduler;
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new Error("Compacted geometry worker scheduler was disposed.");
		}
	}
}
