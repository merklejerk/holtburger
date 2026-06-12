import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../../lib/host/contracts";
import type { HostAssetKey, PreparedAsset } from "./contracts";
import { formatHostAssetId } from "./keys";
import { prepareV2StaticAssetPayload } from "./preparation/route-payloads";

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
	if (response.requestId !== request.requestId) {
		throw new Error(
			`Host response request id ${response.requestId} did not match ${request.requestId}.`,
		);
	}
	if (response.assetId !== request.assetId) {
		throw new Error(
			`Host response asset id ${response.assetId} did not match ${request.assetId}.`,
		);
	}

	return {
		key,
		payload: prepareV2StaticAssetPayload(response),
		preparedAt: now().toISOString(),
		revision,
		sourceAssetId: response.assetId,
	};
}
