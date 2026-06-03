export interface RenderResourceJobSchedulerMetrics {
	submittedJobCount: number;
	dedupedDesiredJobCount: number;
	coalescedDesiredJobCount: number;
	staleResultCount: number;
	readyResultCount: number;
	committedResultCount: number;
	errorCount: number;
	lastStaleDiscardReason: string | null;
	lastErrorMessage: string | null;
}

export interface RenderResourceJobSchedulerOptions<TInput, TResult> {
	getInputKey(input: TInput): string;
	getResultKey(result: TResult): string;
	submit(input: TInput): Promise<TResult>;
}

interface InFlightJob {
	key: string;
	revision: number;
}

export class RenderResourceJobScheduler<TInput, TResult> {
	private committedKey: string | null = null;

	private desiredKey: string | null = null;

	private inFlight: InFlightJob | null = null;

	private pendingDesiredInput: TInput | null = null;

	private readonly readyResults: TResult[] = [];

	private nextRevision = 1;

	private disposed = false;

	private readonly metricsState: RenderResourceJobSchedulerMetrics = {
		submittedJobCount: 0,
		dedupedDesiredJobCount: 0,
		coalescedDesiredJobCount: 0,
		staleResultCount: 0,
		readyResultCount: 0,
		committedResultCount: 0,
		errorCount: 0,
		lastStaleDiscardReason: null,
		lastErrorMessage: null,
	};

	constructor(
		private readonly options: RenderResourceJobSchedulerOptions<
			TInput,
			TResult
		>,
	) {}

	scheduleDesired(input: TInput): void {
		this.throwIfDisposed();

		const key = this.options.getInputKey(input);
		this.desiredKey = key;

		if (key === this.committedKey) {
			this.pendingDesiredInput = null;
			this.metricsState.dedupedDesiredJobCount += 1;
			return;
		}

		if (this.inFlight) {
			if (key === this.inFlight.key) {
				this.pendingDesiredInput = null;
				this.metricsState.dedupedDesiredJobCount += 1;
				return;
			}

			this.pendingDesiredInput = input;
			this.metricsState.coalescedDesiredJobCount += 1;
			return;
		}

		this.submit(input, key);
	}

	consumeReadyResults(): TResult[] {
		return this.readyResults.splice(0);
	}

	markCommitted(key: string): void {
		this.throwIfDisposed();
		this.committedKey = key;
		this.metricsState.committedResultCount += 1;
		if (this.desiredKey === key) {
			this.pendingDesiredInput = null;
		}
	}

	getMetrics(): RenderResourceJobSchedulerMetrics {
		return { ...this.metricsState };
	}

	dispose(): void {
		this.disposed = true;
		this.inFlight = null;
		this.pendingDesiredInput = null;
		this.readyResults.splice(0);
	}

	private submit(input: TInput, key: string): void {
		const revision = this.nextRevision++;
		this.inFlight = { key, revision };
		this.metricsState.submittedJobCount += 1;

		this.options
			.submit(input)
			.then((result) => {
				this.handleResult(revision, key, result);
			})
			.catch((error: unknown) => {
				this.handleError(revision, key, error);
			});
	}

	private handleResult(
		revision: number,
		inputKey: string,
		result: TResult,
	): void {
		if (this.disposed) {
			return;
		}

		if (!this.matchesInFlight(revision, inputKey)) {
			this.recordStaleDiscard("result no longer matched the in-flight job");
			return;
		}

		this.inFlight = null;
		const resultKey = this.options.getResultKey(result);
		if (resultKey !== this.desiredKey) {
			this.recordStaleDiscard("result key no longer matched desired key");
			this.submitPendingDesired();
			return;
		}

		this.readyResults.push(result);
		this.metricsState.readyResultCount += 1;
		this.submitPendingDesired();
	}

	private handleError(
		revision: number,
		inputKey: string,
		error: unknown,
	): void {
		if (this.disposed) {
			return;
		}

		if (!this.matchesInFlight(revision, inputKey)) {
			this.recordStaleDiscard("error no longer matched the in-flight job");
			return;
		}

		this.inFlight = null;
		const normalized = toError(error);
		this.metricsState.errorCount += 1;
		this.metricsState.lastErrorMessage = normalized.message;
		this.submitPendingDesired();
	}

	private submitPendingDesired(): void {
		if (!this.pendingDesiredInput) {
			return;
		}

		const input = this.pendingDesiredInput;
		this.pendingDesiredInput = null;
		const key = this.options.getInputKey(input);
		if (key === this.committedKey) {
			this.metricsState.dedupedDesiredJobCount += 1;
			return;
		}

		this.submit(input, key);
	}

	private matchesInFlight(revision: number, inputKey: string): boolean {
		return (
			this.inFlight !== null &&
			this.inFlight.revision === revision &&
			this.inFlight.key === inputKey
		);
	}

	private recordStaleDiscard(reason: string): void {
		this.metricsState.staleResultCount += 1;
		this.metricsState.lastStaleDiscardReason = reason;
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new Error("Render resource job scheduler was disposed.");
		}
	}
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
