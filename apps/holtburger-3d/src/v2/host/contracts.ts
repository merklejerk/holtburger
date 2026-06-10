import type { HostAssetKey, PreparedAsset } from "../assets/contracts";

export interface RuntimeHost {
	lookupAsset(key: HostAssetKey, revision: number): Promise<PreparedAsset>;
	createSnapshot(): RuntimeHostSnapshot;
}

export interface RuntimeHostSnapshot {
	readonly isAvailable: boolean;
	readonly failure: string | null;
}
