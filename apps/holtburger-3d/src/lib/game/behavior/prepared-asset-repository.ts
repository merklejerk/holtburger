import type { DatAssetId } from "../game-types";

/** One deterministic reference to a shared prepared asset. */
export interface PreparedAssetHandle<TPrepared> {
	readonly asset: TPrepared;
	release(): void;
}

type EntryState<TPrepared> =
	| { readonly kind: "preparing"; readonly completion: Promise<TPrepared> }
	| { readonly kind: "ready"; readonly asset: TPrepared }
	| { readonly kind: "failed"; readonly cause: unknown };

interface Entry<TPrepared> {
	readonly id: DatAssetId;
	referenceCount: number;
	state: EntryState<TPrepared>;
}

/** Counts describing what a repository currently holds, independent of asset family. */
export interface PreparedAssetDiagnostics {
	readonly assetCount: number;
	readonly failedCount: number;
	readonly preparingCount: number;
	readonly readyCount: number;
	/** Total outstanding handles across every entry. */
	readonly referenceCount: number;
}

/** Everything an asset family must supply to reuse the shared preparation lifecycle. */
export interface PreparedAssetRepositoryOptions<TSource, TPrepared> {
	/** Asset-family name used verbatim in error messages, e.g. `"Animation"`. */
	readonly label: string;
	/** Ready data lives either with active handles or until repository teardown. */
	readonly retention: "referenced" | "session";
	readonly load: (id: DatAssetId) => Promise<TSource>;
	/** Validate and freeze one loaded source into its immutable prepared form. */
	readonly prepare: (source: TSource, id: DatAssetId) => TPrepared;
	/** Tear down the underlying transport when the repository is destroyed. */
	readonly destroySource: () => void;
}

/**
 * Shares immutable asset transfer/preparation and owns exact acquired-handle lifetimes.
 *
 * Asset families choose residency separately from active handle ownership. Preparation is shared
 * by id; session-retained definitions survive their last release until repository destruction.
 * Failed entries remain cached until explicit eviction, preventing repeated failed transfers.
 */
export class PreparedAssetRepository<TSource, TPrepared> {
	readonly #options: PreparedAssetRepositoryOptions<TSource, TPrepared>;
	readonly #entries = new Map<DatAssetId, Entry<TPrepared>>();
	#destroyed = false;

	constructor(options: PreparedAssetRepositoryOptions<TSource, TPrepared>) {
		this.#options = options;
	}

	async acquire(id: DatAssetId): Promise<PreparedAssetHandle<TPrepared>> {
		if (this.#destroyed) {
			throw new Error(
				`Cannot acquire from a destroyed ${this.#options.label} repository.`,
			);
		}
		const entry = this.#entries.get(id) ?? this.#start(id);
		entry.referenceCount += 1;
		let asset: TPrepared;
		try {
			asset = await entryCompletion(entry);
		} catch (cause) {
			entry.referenceCount -= 1;
			throw cause;
		}
		let released = false;
		return {
			asset,
			release: () => {
				if (released)
					throw new Error(
						`${this.#options.label} ${id} handle released twice.`,
					);
				released = true;
				this.#release(entry);
			},
		};
	}

	/** Acquire independent assets concurrently; release every success if any acquisition fails. */
	async acquireAll(
		ids: Iterable<DatAssetId>,
	): Promise<ReadonlyMap<DatAssetId, PreparedAssetHandle<TPrepared>>> {
		const results = await Promise.allSettled(
			[...new Set(ids)].map(async (id) => {
				try {
					return [id, await this.acquire(id)] as const;
				} catch (cause) {
					throw new Error(`${this.#options.label} ${id} acquisition failed.`, {
						cause,
					});
				}
			}),
		);
		const handles = new Map<DatAssetId, PreparedAssetHandle<TPrepared>>();
		const failures: unknown[] = [];
		for (const result of results) {
			if (result.status === "fulfilled") handles.set(...result.value);
			else failures.push(result.reason);
		}
		if (failures.length > 0) {
			for (const handle of handles.values()) handle.release();
			throw new AggregateError(
				failures,
				`${this.#options.label} batch acquisition failed.`,
			);
		}
		return handles;
	}

	/**
	 * Read an already-prepared asset without acquiring a handle.
	 *
	 * For consumers that run inside a frame and must never trigger a load: an id that is not ready
	 * returns `null` rather than starting one. Safe because whoever staged the asset still holds a
	 * handle for as long as it can be reached, so a ready entry cannot vanish mid-frame.
	 */
	getReady(id: DatAssetId): TPrepared | null {
		const state = this.#entries.get(id)?.state;
		return state?.kind === "ready" ? state.asset : null;
	}

	getState(id: DatAssetId): EntryState<TPrepared>["kind"] | null {
		return this.#entries.get(id)?.state.kind ?? null;
	}

	getDiagnostics(): PreparedAssetDiagnostics {
		const entries = [...this.#entries.values()];
		return {
			assetCount: entries.length,
			failedCount: entries.filter((entry) => entry.state.kind === "failed")
				.length,
			preparingCount: entries.filter(
				(entry) => entry.state.kind === "preparing",
			).length,
			readyCount: entries.filter((entry) => entry.state.kind === "ready")
				.length,
			referenceCount: entries.reduce(
				(total, entry) => total + entry.referenceCount,
				0,
			),
		};
	}

	/** Remove one cached failed load so an explicit later acquisition may retry. */
	evictFailed(id: DatAssetId): void {
		const entry = this.#entries.get(id);
		if (!entry) return;
		if (entry.state.kind !== "failed" || entry.referenceCount !== 0) {
			throw new Error(
				`${this.#options.label} ${id} is not an unreferenced failure.`,
			);
		}
		this.#entries.delete(id);
	}

	destroy(): void {
		if (this.#destroyed) return;
		const referenced = [...this.#entries.values()].find(
			(entry) => entry.referenceCount !== 0,
		);
		if (referenced) {
			throw new Error(
				`Cannot destroy ${this.#options.label} repository while ${referenced.id} is referenced.`,
			);
		}
		this.#destroyed = true;
		this.#entries.clear();
		this.#options.destroySource();
	}

	#start(id: DatAssetId): Entry<TPrepared> {
		const entry: Entry<TPrepared> = {
			id,
			referenceCount: 0,
			state: {
				cause: new Error(`${this.#options.label} preparation did not start.`),
				kind: "failed",
			},
		};
		const completion = this.#options
			.load(id)
			.then((source) => this.#options.prepare(source, id))
			.then((asset) => {
				// A concurrent destroy/evict can replace the entry; only the live one may commit.
				if (this.#entries.get(id) === entry)
					entry.state = { asset, kind: "ready" };
				return asset;
			})
			.catch((cause: unknown) => {
				if (this.#entries.get(id) === entry)
					entry.state = { cause, kind: "failed" };
				throw cause;
			});
		entry.state = { completion, kind: "preparing" };
		this.#entries.set(id, entry);
		return entry;
	}

	#release(entry: Entry<TPrepared>): void {
		if (entry.referenceCount <= 0)
			throw new Error(
				`${this.#options.label} ${entry.id} has no reference to release.`,
			);
		entry.referenceCount -= 1;
		if (
			entry.referenceCount === 0 &&
			entry.state.kind === "ready" &&
			this.#options.retention === "referenced"
		)
			this.#entries.delete(entry.id);
	}
}

function entryCompletion<TPrepared>(
	entry: Entry<TPrepared>,
): Promise<TPrepared> {
	if (entry.state.kind === "preparing") return entry.state.completion;
	if (entry.state.kind === "ready") return Promise.resolve(entry.state.asset);
	return Promise.reject(entry.state.cause);
}
