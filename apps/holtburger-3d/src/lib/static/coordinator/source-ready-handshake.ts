export interface StaticSourceReadyResumeToken {
	/** Opaque id for one source-ready pause point. */
	readonly requestId: string;
	/** Domain being prepared; retained only for diagnostics and validation messages. */
	readonly domain: string;
	/** Demand revision that produced this source-ready work. */
	readonly revision: number;
	/** Static task ids that must still be current before this work may resume. */
	readonly taskIds: readonly string[];
}

export interface StaticSourceReadyWork<SourcePayload, PlacementIntent> {
	/** Token required to resume this source-ready work after placement. */
	readonly token: StaticSourceReadyResumeToken;
	/** Resolved source facts that will be passed to a baker after placement. */
	readonly sourcePayloads: readonly SourcePayload[];
	/** Texture placement intents that must be placed before baking resumes. */
	readonly placementIntents: readonly PlacementIntent[];
}

export type StaticSourceReadyResumeRejectionReason =
	| "already-resumed"
	| "cancelled"
	| "disposed"
	| "failed"
	| "stale-tasks"
	| "superseded"
	| "unknown-token";

export type StaticSourceReadyResumeResult<Result> =
	| {
			readonly kind: "resumed";
			readonly result: Result;
	  }
	| {
			readonly kind: "rejected";
			readonly reason: StaticSourceReadyResumeRejectionReason;
			readonly message: string;
	  };

type SourceReadyRequestStatus =
	| { readonly kind: "pending" }
	| { readonly kind: "resumed" }
	| { readonly kind: "cancelled"; readonly message: string }
	| { readonly kind: "failed"; readonly message: string };

interface SourceReadyRequestRecord<SourcePayload, PlacementIntent> {
	readonly token: StaticSourceReadyResumeToken;
	readonly placementIntents: readonly PlacementIntent[];
	readonly sourcePayloads: readonly SourcePayload[];
	status: SourceReadyRequestStatus;
}

export interface StaticSourceReadyHandshakeOptions {
	/** Prefix used when generating opaque resume token ids. */
	readonly requestIdPrefix?: string;
}

export interface StaticSourceReadyDemandState {
	/** Current static demand revision. Older source-ready tokens cannot resume. */
	readonly revision: number;
	/** Static task ids still accepted for resume at this revision. */
	readonly activeTaskIds: readonly string[];
}

export interface StaticSourceReadyWorkInput<SourcePayload, PlacementIntent> {
	readonly domain: string;
	readonly taskIds: readonly string[];
	readonly sourcePayloads: readonly SourcePayload[];
	readonly placementIntents: readonly PlacementIntent[];
}

/**
 * Small state machine for the source-ready pause/resume contract.
 *
 * It intentionally knows nothing about real texture packing, renderer resources, or static baking.
 * The goal is to make stale-token behavior executable before the full coordinator cutover exists.
 */
export class StaticSourceReadyHandshake<SourcePayload, PlacementIntent> {
	readonly #requestIdPrefix: string;
	readonly #requests = new Map<
		string,
		SourceReadyRequestRecord<SourcePayload, PlacementIntent>
	>();
	#activeTaskIds = new Set<string>();
	#disposed = false;
	#nextRequestIndex = 1;
	#revision = 0;

	constructor(options: StaticSourceReadyHandshakeOptions = {}) {
		this.#requestIdPrefix = options.requestIdPrefix ?? "static-source-ready";
	}

	setDemandState(state: StaticSourceReadyDemandState): void {
		this.#revision = state.revision;
		this.#activeTaskIds = new Set(state.activeTaskIds);
	}

	createSourceReadyWork(
		input: StaticSourceReadyWorkInput<SourcePayload, PlacementIntent>,
	): StaticSourceReadyWork<SourcePayload, PlacementIntent> {
		this.#assertNotDisposed();
		const requestId = `${this.#requestIdPrefix}:${this.#nextRequestIndex}`;
		this.#nextRequestIndex += 1;
		const token: StaticSourceReadyResumeToken = {
			domain: input.domain,
			requestId,
			revision: this.#revision,
			taskIds: [...input.taskIds],
		};
		this.#requests.set(requestId, {
			placementIntents: input.placementIntents,
			sourcePayloads: input.sourcePayloads,
			status: { kind: "pending" },
			token,
		});

		return {
			placementIntents: input.placementIntents,
			sourcePayloads: input.sourcePayloads,
			token,
		};
	}

	cancel(token: StaticSourceReadyResumeToken, message: string): void {
		const record = this.#requests.get(token.requestId);
		if (!record || record.status.kind !== "pending") {
			return;
		}
		record.status = { kind: "cancelled", message };
	}

	fail(token: StaticSourceReadyResumeToken, message: string): void {
		const record = this.#requests.get(token.requestId);
		if (!record || record.status.kind !== "pending") {
			return;
		}
		record.status = { kind: "failed", message };
	}

	dispose(): void {
		this.#disposed = true;
	}

	resume<PlacementSnapshot, Result>(
		token: StaticSourceReadyResumeToken,
		placementSnapshot: PlacementSnapshot,
		resumeWork: (
			work: StaticSourceReadyWork<SourcePayload, PlacementIntent>,
			placementSnapshot: PlacementSnapshot,
		) => Result,
	): StaticSourceReadyResumeResult<Result> {
		const validation = this.#validateResume(token);
		if (validation.kind === "rejected") {
			return validation;
		}
		const { record } = validation;
		record.status = { kind: "resumed" };

		return {
			kind: "resumed",
			result: resumeWork(
				{
					placementIntents: record.placementIntents,
					sourcePayloads: record.sourcePayloads,
					token: record.token,
				},
				placementSnapshot,
			),
		};
	}

	#validateResume(token: StaticSourceReadyResumeToken):
		| {
				readonly kind: "accepted";
				readonly record: SourceReadyRequestRecord<
					SourcePayload,
					PlacementIntent
				>;
		  }
		| Extract<
				StaticSourceReadyResumeResult<never>,
				{ readonly kind: "rejected" }
		  > {
		if (this.#disposed) {
			return rejectResume("disposed", "Source-ready handshake is disposed.");
		}

		const record = this.#requests.get(token.requestId);
		if (!record) {
			return rejectResume(
				"unknown-token",
				`Unknown source-ready token ${token.requestId}.`,
			);
		}
		if (record.status.kind === "resumed") {
			return rejectResume(
				"already-resumed",
				`Source-ready token ${token.requestId} has already resumed.`,
			);
		}
		if (record.status.kind === "cancelled") {
			return rejectResume("cancelled", record.status.message);
		}
		if (record.status.kind === "failed") {
			return rejectResume("failed", record.status.message);
		}
		if (record.token.revision !== this.#revision) {
			return rejectResume(
				"superseded",
				`Source-ready token ${token.requestId} was produced at revision ${record.token.revision}, current revision is ${this.#revision}.`,
			);
		}
		const staleTaskId = record.token.taskIds.find(
			(taskId) => !this.#activeTaskIds.has(taskId),
		);
		if (staleTaskId) {
			return rejectResume(
				"stale-tasks",
				`Source-ready token ${token.requestId} references stale task ${staleTaskId}.`,
			);
		}

		return { kind: "accepted", record };
	}

	#assertNotDisposed(): void {
		if (this.#disposed) {
			throw new Error("Source-ready handshake is disposed.");
		}
	}
}

function rejectResume(
	reason: StaticSourceReadyResumeRejectionReason,
	message: string,
): Extract<
	StaticSourceReadyResumeResult<never>,
	{ readonly kind: "rejected" }
> {
	return { kind: "rejected", message, reason };
}
