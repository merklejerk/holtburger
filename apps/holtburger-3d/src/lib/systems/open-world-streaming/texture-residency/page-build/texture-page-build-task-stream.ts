import type { MaterializationOwnerId } from "../../owners/owner-id";
import type { TextureBindingId } from "../../../../textures/identity";
import type { OpenWorldTextureClaimRegistry } from "../claims/texture-claim-registry";
import type { OpenWorldTextureBucketKey } from "../claims/bucket-key";
import type { OpenWorldStreamingTextureCommit } from "../commits/contracts";
import { settleOpenWorldTexturePageBuildResult } from "./page-build-results";
import type {
	OpenWorldTexturePageBuildInput,
	OpenWorldTexturePageBuildOutput,
} from "./protocol";
import type { OpenWorldTexturePageBuilder } from "./worker-client";

export interface OpenWorldTexturePageBuildTaskStreamOptions {
	readonly pageBuilder: OpenWorldTexturePageBuilder;
	readonly textureClaims: OpenWorldTextureClaimRegistry;
	readonly onCommit: (commit: OpenWorldStreamingTextureCommit) => void;
}

export interface OpenWorldTexturePageBuildTaskRequest {
	readonly isCurrent: () => boolean;
	readonly ownerId: MaterializationOwnerId;
	readonly pageBuildRequests: readonly OpenWorldTexturePageBuildInput[];
	readonly sourceTaskId: string;
}

export interface OpenWorldTexturePageBuildTaskSettlement {
	readonly error: string | null;
	readonly jobId: string;
	readonly pageId: OpenWorldTexturePageBuildInput["pageId"];
	readonly status: "accepted" | "committed" | "failed" | "stale-rejected";
}

export interface OpenWorldTexturePageBuildTaskDiagnosticsSnapshot {
	readonly active: readonly OpenWorldTexturePageBuildActiveTaskDiagnostics[];
	readonly recent: readonly OpenWorldTexturePageBuildTaskTimingDiagnostics[];
	readonly summary: {
		readonly accepted: number;
		readonly active: number;
		readonly committed: number;
		readonly failed: number;
		readonly queued: number;
		readonly staleRejected: number;
	};
}

interface OpenWorldTexturePageBuildActiveTaskDiagnostics {
	readonly bucketKey: string;
	readonly elapsedMs: number;
	readonly jobId: string;
	readonly ownerId: string;
	readonly pageId: string;
	readonly sourceTaskId: string;
}

interface OpenWorldTexturePageBuildTaskTimingDiagnostics {
	readonly bucketKey: string;
	readonly durationMs: number;
	readonly error: string | null;
	readonly jobId: string;
	readonly ownerId: string;
	readonly pageId: string;
	readonly sourceTaskId: string;
	readonly stageTimings: OpenWorldTexturePageBuildOutput["stageTimings"];
	readonly status: "accepted" | "committed" | "failed" | "stale-rejected";
}

interface ActiveTexturePageBuildTask {
	readonly bucketKey: OpenWorldTextureBucketKey;
	readonly jobId: string;
	readonly ownerId: MaterializationOwnerId;
	readonly pageId: OpenWorldTexturePageBuildInput["pageId"];
	readonly sourceTaskId: string;
	readonly startedAtMs: number;
}

const RECENT_TEXTURE_PAGE_BUILD_TASK_LIMIT = 80;

export class OpenWorldTexturePageBuildTaskStream {
	readonly #activeTasksByJobId = new Map<string, ActiveTexturePageBuildTask>();
	readonly #onCommit: (commit: OpenWorldStreamingTextureCommit) => void;
	readonly #pageBuilder: OpenWorldTexturePageBuilder;
	readonly #textureClaims: OpenWorldTextureClaimRegistry;
	#acceptedCount = 0;
	#committedCount = 0;
	#failedCount = 0;
	#queuedCount = 0;
	#staleRejectedCount = 0;
	readonly #idleWaiters = new Set<() => void>();
	#recentTaskTimings: OpenWorldTexturePageBuildTaskTimingDiagnostics[] = [];

	constructor(options: OpenWorldTexturePageBuildTaskStreamOptions) {
		this.#onCommit = options.onCommit;
		this.#pageBuilder = options.pageBuilder;
		this.#textureClaims = options.textureClaims;
	}

	schedule(
		request: OpenWorldTexturePageBuildTaskRequest,
	): Promise<readonly OpenWorldTexturePageBuildTaskSettlement[]> {
		return Promise.all(
			request.pageBuildRequests.map((pageBuildRequest) => {
				this.#queuedCount += 1;
				return this.#runTask(request, pageBuildRequest);
			}),
		);
	}

	createDiagnosticsSnapshot(): OpenWorldTexturePageBuildTaskDiagnosticsSnapshot {
		const now = nowMs();
		return {
			active: [...this.#activeTasksByJobId.values()]
				.sort(compareActiveTasks)
				.map((task) => ({
					bucketKey: task.bucketKey,
					elapsedMs: now - task.startedAtMs,
					jobId: task.jobId,
					ownerId: task.ownerId,
					pageId: task.pageId,
					sourceTaskId: task.sourceTaskId,
				})),
			recent: this.#recentTaskTimings,
			summary: {
				accepted: this.#acceptedCount,
				active: this.#activeTasksByJobId.size,
				committed: this.#committedCount,
				failed: this.#failedCount,
				queued: this.#queuedCount,
				staleRejected: this.#staleRejectedCount,
			},
		};
	}

	async waitForIdle(): Promise<void> {
		if (this.#activeTasksByJobId.size === 0) {
			return;
		}
		await new Promise<void>((resolve) => {
			this.#idleWaiters.add(resolve);
		});
	}

	async #runTask(
		request: OpenWorldTexturePageBuildTaskRequest,
		pageBuildRequest: OpenWorldTexturePageBuildInput,
	): Promise<OpenWorldTexturePageBuildTaskSettlement> {
		const startedAtMs = nowMs();
		const activeTask: ActiveTexturePageBuildTask = {
			bucketKey: pageBuildRequest.bucketKey,
			jobId: pageBuildRequest.jobId,
			ownerId: request.ownerId,
			pageId: pageBuildRequest.pageId,
			sourceTaskId: request.sourceTaskId,
			startedAtMs,
		};
		this.#activeTasksByJobId.set(pageBuildRequest.jobId, activeTask);
		try {
			const output = await this.#pageBuilder.buildPage(pageBuildRequest);
			if (!request.isCurrent()) {
				this.#rejectPageBuild(pageBuildRequest);
				this.#staleRejectedCount += 1;
				this.#recordTaskTiming({
					activeTask,
					durationMs: nowMs() - startedAtMs,
					error: null,
					stageTimings: output.stageTimings,
					status: "stale-rejected",
				});
				return createTaskSettlement({
					error: null,
					pageBuildRequest,
					status: "stale-rejected",
				});
			}
			const settlement = settleOpenWorldTexturePageBuildResult(
				this.#textureClaims,
				output,
			);
			if (settlement.kind === "stale") {
				this.#staleRejectedCount += 1;
				this.#recordTaskTiming({
					activeTask,
					durationMs: nowMs() - startedAtMs,
					error: null,
					stageTimings: output.stageTimings,
					status: "stale-rejected",
				});
				return createTaskSettlement({
					error: null,
					pageBuildRequest,
					status: "stale-rejected",
				});
			}
			this.#acceptedCount += 1;
			if (settlement.commit) {
				this.#onCommit(settlement.commit);
				this.#committedCount += 1;
			}
			this.#recordTaskTiming({
				activeTask,
				durationMs: nowMs() - startedAtMs,
				error: null,
				stageTimings: output.stageTimings,
				status: settlement.commit ? "committed" : "accepted",
			});
			return createTaskSettlement({
				error: null,
				pageBuildRequest,
				status: settlement.commit ? "committed" : "accepted",
			});
		} catch (error) {
			const message = stringifyError(error);
			this.#rejectPageBuild(pageBuildRequest);
			const failureCommit = createFailedTexturePageBuildCommit(
				pageBuildRequest,
				message,
			);
			if (failureCommit) {
				this.#onCommit(failureCommit);
			}
			this.#failedCount += 1;
			this.#recordTaskTiming({
				activeTask,
				durationMs: nowMs() - startedAtMs,
				error: message,
				stageTimings: [],
				status: "failed",
			});
			return createTaskSettlement({
				error: message,
				pageBuildRequest,
				status: "failed",
			});
		} finally {
			this.#activeTasksByJobId.delete(pageBuildRequest.jobId);
			this.#notifyIdleWaitersIfIdle();
		}
	}

	#rejectPageBuild(pageBuildRequest: OpenWorldTexturePageBuildInput): void {
		this.#textureClaims.rejectPageBuild(
			pageBuildRequest.pageId,
			pageBuildRequest.reservationToken,
		);
	}

	#recordTaskTiming(input: {
		readonly activeTask: ActiveTexturePageBuildTask;
		readonly durationMs: number;
		readonly error: string | null;
		readonly stageTimings: OpenWorldTexturePageBuildOutput["stageTimings"];
		readonly status: OpenWorldTexturePageBuildTaskTimingDiagnostics["status"];
	}): void {
		this.#recentTaskTimings = [
			...this.#recentTaskTimings,
			{
				bucketKey: input.activeTask.bucketKey,
				durationMs: input.durationMs,
				error: input.error,
				jobId: input.activeTask.jobId,
				ownerId: input.activeTask.ownerId,
				pageId: input.activeTask.pageId,
				sourceTaskId: input.activeTask.sourceTaskId,
				stageTimings: input.stageTimings,
				status: input.status,
			},
		].slice(-RECENT_TEXTURE_PAGE_BUILD_TASK_LIMIT);
	}

	#notifyIdleWaitersIfIdle(): void {
		if (this.#activeTasksByJobId.size !== 0) {
			return;
		}
		const waiters = [...this.#idleWaiters];
		this.#idleWaiters.clear();
		for (const waiter of waiters) {
			waiter();
		}
	}
}

function createTaskSettlement(input: {
	readonly error: string | null;
	readonly pageBuildRequest: OpenWorldTexturePageBuildInput;
	readonly status: OpenWorldTexturePageBuildTaskSettlement["status"];
}): OpenWorldTexturePageBuildTaskSettlement {
	return {
		error: input.error,
		jobId: input.pageBuildRequest.jobId,
		pageId: input.pageBuildRequest.pageId,
		status: input.status,
	};
}

function compareActiveTasks(
	left: ActiveTexturePageBuildTask,
	right: ActiveTexturePageBuildTask,
): number {
	return (
		left.startedAtMs - right.startedAtMs ||
		left.sourceTaskId.localeCompare(right.sourceTaskId) ||
		left.jobId.localeCompare(right.jobId)
	);
}

function stringifyError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function createFailedTexturePageBuildCommit(
	pageBuildRequest: OpenWorldTexturePageBuildInput,
	message: string,
): OpenWorldStreamingTextureCommit | null {
	const bindingIds = collectPageBuildBindingIds(pageBuildRequest);
	if (bindingIds.length === 0) {
		return null;
	}
	return {
		bindingRemovals: [],
		bindingUpdates: bindingIds.map((bindingId) => ({
			bindingId,
			readiness: {
				kind: "failed",
				message,
			},
		})),
		bucketKey: pageBuildRequest.bucketKey,
		kind: "texture-commit",
		pageRemovals: [],
		pageUpdates: [],
	};
}

function collectPageBuildBindingIds(
	pageBuildRequest: OpenWorldTexturePageBuildInput,
): readonly TextureBindingId[] {
	const bindingIds = new Set<TextureBindingId>();
	for (const entry of pageBuildRequest.entries) {
		for (const bindingId of entry.bindingIds) {
			bindingIds.add(bindingId);
		}
	}
	return [...bindingIds].sort();
}

function nowMs(): number {
	return globalThis.performance?.now?.() ?? Date.now();
}
