export interface HostAssetKey {
	readonly kind: string;
	readonly id: string;
}

export interface PreparedAsset {
	readonly key: HostAssetKey;
	readonly revision: number;
	readonly payload: unknown;
}

export interface PreparedAssetLease {
	readonly key: HostAssetKey;
	release(): void;
}

export interface AssetService {
	requestPreparedAsset(
		key: HostAssetKey,
		load: () => Promise<PreparedAsset>,
	): Promise<PreparedAsset>;
	acquirePreparedAssetLease(key: HostAssetKey): PreparedAssetLease;
	createSnapshot(): AssetServiceSnapshot;
}

export interface AssetServiceSnapshot {
	readonly pending: readonly PendingAssetSnapshot[];
	readonly committed: readonly CommittedAssetSnapshot[];
}

export interface PendingAssetSnapshot {
	readonly key: HostAssetKey;
	readonly revision: number;
	readonly waiterCount: number;
}

export interface CommittedAssetSnapshot {
	readonly key: HostAssetKey;
	readonly revision: number;
	readonly leaseCount: number;
}
