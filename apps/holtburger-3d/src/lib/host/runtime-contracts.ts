import type { HostAssetKey, PreparedAsset } from "../assets/contracts";
import type { AssetLookupResponseDto } from "./contracts";

export interface RuntimeHostAssetResponse {
	readonly requestId: string;
	readonly response: AssetLookupResponseDto;
}

export interface RuntimeHost {
	lookupAsset(key: HostAssetKey, revision: number): Promise<PreparedAsset>;
	lookupAssetResponse(key: HostAssetKey): Promise<RuntimeHostAssetResponse>;
	createSnapshot(): RuntimeHostSnapshot;
}

export interface RuntimeHostSnapshot {
	readonly isAvailable: boolean;
	readonly failure: string | null;
}
