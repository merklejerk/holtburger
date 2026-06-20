import type { RuntimeHost } from "../host/contracts";
import type {
	AssetService,
	AssetServiceSnapshot,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "./contracts";
import { describeHostAssetKey } from "./keys";

interface PendingAssetEntry {
	readonly key: HostAssetKey;
	readonly promise: Promise<PreparedAsset>;
	readonly revision: number;
	waiterCount: number;
}

interface CommittedAssetEntry {
	readonly asset: PreparedAsset;
	leaseCount: number;
	warmRetainedUntilMs: number | null;
}

export interface HostBackedAssetServiceOptions {
	readonly host: RuntimeHost;
	readonly warmRetentionMs?: number;
	readonly nowMs?: () => number;
}

export class HostBackedAssetService implements AssetService {
	readonly #host: RuntimeHost;
	readonly #warmRetentionMs: number;
	readonly #nowMs: () => number;
	readonly #pending = new Map<string, PendingAssetEntry>();
	readonly #committed = new Map<string, CommittedAssetEntry>();
	#revision = 0;

	constructor({
		host,
		warmRetentionMs = 30_000,
		nowMs = () => Date.now(),
	}: HostBackedAssetServiceOptions) {
		this.#host = host;
		this.#warmRetentionMs = warmRetentionMs;
		this.#nowMs = nowMs;
	}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		const keyString = describeHostAssetKey(key);
		const committed = this.#committed.get(keyString);

		if (committed) {
			committed.warmRetainedUntilMs = null;
			return Promise.resolve(committed.asset);
		}

		const pending = this.#pending.get(keyString);
		if (pending) {
			pending.waiterCount += 1;
			return pending.promise;
		}

		const revision = this.#nextRevision();
		const promise = this.#host
			.lookupAsset(key, revision)
			.then((asset) => this.#commitAsset(keyString, key, revision, asset))
			.catch((error: unknown) => {
				this.#pending.delete(keyString);
				throw error;
			});

		this.#pending.set(keyString, {
			key,
			promise,
			revision,
			waiterCount: 1,
		});

		return promise;
	}

	acquirePreparedAssetLease(key: HostAssetKey): PreparedAssetLease {
		const keyString = describeHostAssetKey(key);
		const committed = this.#committed.get(keyString);

		if (!committed) {
			throw new Error(
				`Cannot lease prepared asset before it is committed: ${keyString}`,
			);
		}

		let released = false;
		committed.leaseCount += 1;
		committed.warmRetainedUntilMs = null;

		return {
			key,
			release: () => {
				if (released) {
					return;
				}

				released = true;
				committed.leaseCount -= 1;
				if (committed.leaseCount === 0) {
					committed.warmRetainedUntilMs = this.#nowMs() + this.#warmRetentionMs;
				}
			},
		};
	}

	pruneExpiredWarmAssets(nowMs = this.#nowMs()): number {
		let pruned = 0;
		for (const [keyString, entry] of this.#committed) {
			if (
				entry.leaseCount === 0 &&
				entry.warmRetainedUntilMs !== null &&
				entry.warmRetainedUntilMs <= nowMs
			) {
				this.#committed.delete(keyString);
				pruned += 1;
			}
		}
		return pruned;
	}

	createSnapshot(): AssetServiceSnapshot {
		return {
			committed: this.#sortCommittedSnapshot(),
			pending: this.#sortPendingSnapshot(),
		};
	}

	#commitAsset(
		keyString: string,
		key: HostAssetKey,
		revision: number,
		asset: PreparedAsset,
	): PreparedAsset {
		this.#pending.delete(keyString);
		const committedAsset = {
			key,
			payload: asset.payload,
			preparedAt: asset.preparedAt,
			revision,
			sourceAssetId: asset.sourceAssetId,
		};
		this.#committed.set(keyString, {
			asset: committedAsset,
			leaseCount: 0,
			warmRetainedUntilMs: this.#nowMs() + this.#warmRetentionMs,
		});

		return committedAsset;
	}

	#nextRevision(): number {
		this.#revision += 1;
		return this.#revision;
	}

	#sortPendingSnapshot(): AssetServiceSnapshot["pending"] {
		return Array.from(this.#pending.values())
			.map((entry) => ({
				key: entry.key,
				revision: entry.revision,
				waiterCount: entry.waiterCount,
			}))
			.sort(compareSnapshotKeys);
	}

	#sortCommittedSnapshot(): AssetServiceSnapshot["committed"] {
		return Array.from(this.#committed.values())
			.map((entry) => ({
				key: entry.asset.key,
				leaseCount: entry.leaseCount,
				revision: entry.asset.revision,
				sourceAssetId: entry.asset.sourceAssetId,
				warmRetainedUntilMs: entry.warmRetainedUntilMs,
			}))
			.sort(compareSnapshotKeys);
	}
}

function compareSnapshotKeys(
	left: { readonly key: HostAssetKey },
	right: { readonly key: HostAssetKey },
): number {
	return describeHostAssetKey(left.key).localeCompare(
		describeHostAssetKey(right.key),
	);
}
