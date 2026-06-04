import { RenderResourceJobScheduler } from "../render-resource-job-scheduler";
import type { RenderResourceJobSchedulerMetrics } from "../render-resource-job-scheduler";
import { RenderResourceWorkerClient } from "../render-resource-worker-client";
import type { IndexedResourceAtlasPlan } from "../texture-pages/indexed-resource-atlas-planner";
import {
	createBuildIndexedResourceAtlasWorkerInput,
	type BuildIndexedResourceAtlasWorkerInput,
	type BuildIndexedResourceAtlasWorkerResult,
} from "./indexed-atlas-worker-payloads";

interface IndexedResourceAtlasWorkerSchedulerOptions {
	client?: RenderResourceWorkerClient;
	onReadyResult: () => void;
}

interface ScheduledIndexedResourceAtlasWorkerInput {
	input: BuildIndexedResourceAtlasWorkerInput;
}

export interface IndexedResourceAtlasWorkerSchedulerMetrics extends RenderResourceJobSchedulerMetrics {
	activeSchedulerCount: number;
}

export class IndexedResourceAtlasWorkerScheduler {
	private readonly client: RenderResourceWorkerClient;

	private scheduler: RenderResourceJobScheduler<
		ScheduledIndexedResourceAtlasWorkerInput,
		BuildIndexedResourceAtlasWorkerResult
	> | null = null;

	private disposed = false;

	constructor(options: IndexedResourceAtlasWorkerSchedulerOptions) {
		this.client = options.client ?? new RenderResourceWorkerClient();
		this.onReadyResult = options.onReadyResult;
	}

	private readonly onReadyResult: () => void;

	scheduleDesired(plan: IndexedResourceAtlasPlan): void {
		this.throwIfDisposed();
		this.schedulerForPlan().scheduleDesired({
			input: createBuildIndexedResourceAtlasWorkerInput(plan),
		});
	}

	consumeReadyResults(): BuildIndexedResourceAtlasWorkerResult[] {
		return this.scheduler?.consumeReadyResults() ?? [];
	}

	getMetrics(): IndexedResourceAtlasWorkerSchedulerMetrics {
		const schedulerMetrics = this.scheduler?.getMetrics();
		return {
			activeSchedulerCount: this.scheduler ? 1 : 0,
			submittedJobCount: schedulerMetrics?.submittedJobCount ?? 0,
			dedupedDesiredJobCount: schedulerMetrics?.dedupedDesiredJobCount ?? 0,
			coalescedDesiredJobCount: schedulerMetrics?.coalescedDesiredJobCount ?? 0,
			staleResultCount: schedulerMetrics?.staleResultCount ?? 0,
			readyResultCount: schedulerMetrics?.readyResultCount ?? 0,
			committedResultCount: schedulerMetrics?.committedResultCount ?? 0,
			errorCount: schedulerMetrics?.errorCount ?? 0,
			lastStaleDiscardReason: schedulerMetrics?.lastStaleDiscardReason ?? null,
			lastErrorMessage: schedulerMetrics?.lastErrorMessage ?? null,
		};
	}

	markCommitted(key: string): void {
		this.scheduler?.markCommitted(key);
	}

	reset(): void {
		this.scheduler?.dispose();
		this.scheduler = null;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.reset();
		this.client.dispose();
	}

	private schedulerForPlan(): RenderResourceJobScheduler<
		ScheduledIndexedResourceAtlasWorkerInput,
		BuildIndexedResourceAtlasWorkerResult
	> {
		if (this.scheduler) {
			return this.scheduler;
		}
		this.scheduler = new RenderResourceJobScheduler<
			ScheduledIndexedResourceAtlasWorkerInput,
			BuildIndexedResourceAtlasWorkerResult
		>({
			getInputKey(input) {
				return input.input.key;
			},
			getResultKey(result) {
				return result.key;
			},
			submit: (input) =>
				this.client.runBuildIndexedResourceAtlasJob({
					type: "build-indexed-resource-atlas",
					key: input.input.key,
					input: input.input,
				}),
			onReadyResult: this.onReadyResult,
		});
		return this.scheduler;
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new Error("Indexed resource atlas worker scheduler was disposed.");
		}
	}
}
