export type HostAssetKeyKind =
	| "landblock-outdoor"
	| "landblock-env-cells"
	| "landblock-scene-lod"
	| "env-cell"
	| "animation"
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

export interface PreparedAssetReader {
	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset>;
}

export interface AssetService extends PreparedAssetReader {
	acquirePreparedAssetLease(key: HostAssetKey): PreparedAssetLease;
	pruneExpiredWarmAssets(nowMs?: number): number;
	createOverviewSnapshot(): AssetServiceOverviewSnapshot;
	createSnapshot(): AssetServiceSnapshot;
}

export interface AssetServiceOverviewSnapshot {
	/** Number of asset requests currently waiting on host resolution. */
	readonly pendingCount: number;
	/** Number of prepared assets currently retained by the asset service. */
	readonly committedCount: number;
}

export interface AssetServiceSnapshot {
	readonly pending: readonly PendingAssetSnapshot[];
	readonly committed: readonly CommittedAssetSnapshot[];
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
