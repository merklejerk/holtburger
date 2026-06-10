import type {
	AssetService,
	AssetServiceSnapshot,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "./contracts";

interface PendingAssetEntry {
	readonly key: HostAssetKey;
	readonly promise: Promise<PreparedAsset>;
	readonly revision: number;
	waiterCount: number;
}

interface CommittedAssetEntry {
	readonly asset: PreparedAsset;
	leaseCount: number;
}

export class InMemoryAssetService implements AssetService {
	readonly #pending = new Map<string, PendingAssetEntry>();
	readonly #committed = new Map<string, CommittedAssetEntry>();
	#revision = 0;

	requestPreparedAsset(
		key: HostAssetKey,
		load: () => Promise<PreparedAsset>,
	): Promise<PreparedAsset> {
		const keyString = describeHostAssetKey(key);
		const committed = this.#committed.get(keyString);

		if (committed) {
			return Promise.resolve(committed.asset);
		}

		const pending = this.#pending.get(keyString);

		if (pending) {
			pending.waiterCount += 1;
			return pending.promise;
		}

		const revision = this.#revision + 1;
		this.#revision = revision;
		const promise = load().then((asset) => {
			this.#pending.delete(keyString);
			this.#committed.set(keyString, {
				asset: {
					key,
					payload: asset.payload,
					revision,
				},
				leaseCount: 0,
			});

			return this.#committed.get(keyString)?.asset ?? asset;
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

		return {
			key,
			release: () => {
				if (released) {
					return;
				}

				released = true;
				committed.leaseCount -= 1;
			},
		};
	}

	createSnapshot(): AssetServiceSnapshot {
		return {
			committed: Array.from(this.#committed.values()).map((entry) => ({
				key: entry.asset.key,
				leaseCount: entry.leaseCount,
				revision: entry.asset.revision,
			})),
			pending: Array.from(this.#pending.values()).map((entry) => ({
				key: entry.key,
				revision: entry.revision,
				waiterCount: entry.waiterCount,
			})),
		};
	}
}

function describeHostAssetKey(key: HostAssetKey): string {
	return `${key.kind}:${key.id}`;
}
