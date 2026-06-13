export type HostAssetKeyKind =
	| "landblock-outdoor"
	| "landblock-topology"
	| "landblock-env-cells"
	| "env-cell"
	| "gfx-obj"
	| "setup-model"
	| "setup-appearance"
	| "material"
	| "terrain-material"
	| "region-render-profile"
	| "surface-texture"
	| "render-surface"
	| "prepared-texture"
	| "palette"
	| "raw";

export interface HostAssetKey {
	readonly kind: HostAssetKeyKind;
	readonly id: string;
}

export interface PreparedAsset {
	readonly key: HostAssetKey;
	readonly revision: number;
	readonly sourceAssetId: string;
	readonly preparedAt: string;
	readonly payload: unknown;
}

export interface PreparedAssetLease {
	readonly key: HostAssetKey;
	release(): void;
}

export interface AssetService {
	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset>;
	acquirePreparedAssetLease(key: HostAssetKey): PreparedAssetLease;
	pruneExpiredWarmAssets(nowMs?: number): void;
	createSnapshot(): AssetServiceSnapshot;
}

export interface AssetServiceSnapshot {
	readonly pending: readonly PendingAssetSnapshot[];
	readonly committed: readonly CommittedAssetSnapshot[];
	readonly failures: readonly FailedAssetSnapshot[];
}

interface PendingAssetSnapshot {
	readonly key: HostAssetKey;
	readonly revision: number;
	readonly waiterCount: number;
}

interface CommittedAssetSnapshot {
	readonly key: HostAssetKey;
	readonly revision: number;
	readonly leaseCount: number;
	readonly warmRetainedUntilMs: number | null;
	readonly sourceAssetId: string;
}

export interface FailedAssetSnapshot {
	readonly key: HostAssetKey;
	readonly revision: number;
	readonly message: string;
}
