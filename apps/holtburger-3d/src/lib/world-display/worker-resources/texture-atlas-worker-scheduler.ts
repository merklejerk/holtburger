import { RenderResourceJobScheduler } from "../render-resource-job-scheduler";
import type { RenderResourceJobSchedulerMetrics } from "../render-resource-job-scheduler";
import { RenderResourceWorkerClient } from "../render-resource-worker-client";
import type { TexturePageAtlasPlan } from "../texture-pages/texture-page-atlas-planner";
import type { TextureFilteringMode } from "../texture-pages/texture-sampling-policy";
import {
	createBuildTextureAtlasWorkerInput,
	describeBuildTextureAtlasWorkerJobKey,
	type BuildTextureAtlasWorkerInput,
	type BuildTextureAtlasWorkerResult,
} from "./texture-atlas-worker-payloads";

interface TextureAtlasWorkerSchedulerOptions {
	client?: RenderResourceWorkerClient;
	onReadyResult: () => void;
}

interface ScheduledTextureAtlasWorkerInput {
	input: BuildTextureAtlasWorkerInput;
}

export interface TextureAtlasWorkerSchedulerMetrics extends RenderResourceJobSchedulerMetrics {
	activeSchedulerCount: number;
}

export class TextureAtlasWorkerScheduler {
	private readonly client: RenderResourceWorkerClient;

	private scheduler: RenderResourceJobScheduler<
		ScheduledTextureAtlasWorkerInput,
		BuildTextureAtlasWorkerResult
	> | null = null;

	private disposed = false;

	constructor(options: TextureAtlasWorkerSchedulerOptions) {
		this.client = options.client ?? new RenderResourceWorkerClient();
		this.onReadyResult = options.onReadyResult;
	}

	private readonly onReadyResult: () => void;

	scheduleDesired({
		plan,
		textureFilteringMode,
		maxAnisotropy,
	}: {
		plan: TexturePageAtlasPlan;
		textureFilteringMode: TextureFilteringMode;
		maxAnisotropy: number;
	}): void {
		this.throwIfDisposed();
		this.schedulerForPlan().scheduleDesired({
			input: createBuildTextureAtlasWorkerInput({
				plan,
				textureFilteringMode,
				maxAnisotropy,
			}),
		});
	}

	consumeReadyResults(): BuildTextureAtlasWorkerResult[] {
		return this.scheduler?.consumeReadyResults() ?? [];
	}

	getMetrics(): TextureAtlasWorkerSchedulerMetrics {
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
		ScheduledTextureAtlasWorkerInput,
		BuildTextureAtlasWorkerResult
	> {
		if (this.scheduler) {
			return this.scheduler;
		}
		this.scheduler = new RenderResourceJobScheduler<
			ScheduledTextureAtlasWorkerInput,
			BuildTextureAtlasWorkerResult
		>({
			getInputKey(input) {
				return describeBuildTextureAtlasWorkerJobKey({
					plan: input.input,
					textureFilteringMode: input.input.textureFilteringMode,
					maxAnisotropy: input.input.maxAnisotropy,
				});
			},
			getResultKey(result) {
				return result.key;
			},
			submit: (input) =>
				this.client.runBuildTextureAtlasJob({
					type: "build-texture-atlas",
					key: describeBuildTextureAtlasWorkerJobKey({
						plan: input.input,
						textureFilteringMode: input.input.textureFilteringMode,
						maxAnisotropy: input.input.maxAnisotropy,
					}),
					input: input.input,
				}),
			onReadyResult: this.onReadyResult,
		});
		return this.scheduler;
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new Error("Texture atlas worker scheduler was disposed.");
		}
	}
}
