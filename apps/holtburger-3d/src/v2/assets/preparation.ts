import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../../lib/host/contracts";
import { prepareAssetPayload } from "../../workers/shared/asset-prepare";
import type { HostAssetKey, PreparedAsset } from "./contracts";
import { formatHostAssetId } from "./keys";

export interface PrepareHostAssetOptions {
	readonly key: HostAssetKey;
	readonly requestId: string;
	readonly response: AssetLookupResponseDto;
	readonly revision: number;
	readonly now?: () => Date;
}

export function createHostAssetLookupRequest(
	key: HostAssetKey,
	requestId: string,
): AssetLookupRequestDto {
	return {
		assetId: formatHostAssetId(key),
		priority: "streaming",
		requestId,
	};
}

export function prepareHostAssetResponse({
	key,
	requestId,
	response,
	revision,
	now = () => new Date(),
}: PrepareHostAssetOptions): PreparedAsset {
	const request = createHostAssetLookupRequest(key, requestId);
	const prepared = prepareAssetPayload(request, response);

	return {
		key,
		payload: prepared.payload,
		preparedAt: now().toISOString(),
		revision,
		sourceAssetId: response.assetId,
	};
}
