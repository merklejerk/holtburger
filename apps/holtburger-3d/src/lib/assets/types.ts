import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../host/contracts";

export type AssetPreparationStatus = "idle" | "pending" | "ready" | "error";

export type AssetResidencyKind =
	| "outdoor-landblock"
	| "indoor-env-cell"
	| "unknown";

export interface PreparedAssetRecord {
	request: AssetLookupRequestDto;
	response: AssetLookupResponseDto;
	residencyKind: AssetResidencyKind;
	debugPrimitive: string;
	paletteKey: string;
	summary: string;
	notes: string[];
	preparedAt: string;
}

export type AssetActivityStatus = "requested" | "prepared" | "failed";

export interface AssetActivityRecord {
	requestId: string;
	assetId: string;
	priority: AssetLookupRequestDto["priority"];
	status: AssetActivityStatus;
	channel: string;
	summary: string;
	timestamp: string;
}

export interface AssetChannelState {
	channel: string;
	status: AssetPreparationStatus;
	activeRequest: AssetLookupRequestDto | null;
	preparedAsset: PreparedAssetRecord | null;
	preparedByPriority: Record<AssetLookupRequestDto["priority"], PreparedAssetRecord | null>;
	lastResponse: AssetLookupResponseDto | null;
	errorMessage: string | null;
	history: AssetActivityRecord[];
}

export function createInitialAssetChannelState(
	channel = "asset",
): AssetChannelState {
	return {
		channel,
		status: "idle",
		activeRequest: null,
		preparedAsset: null,
		preparedByPriority: {
			bootstrap: null,
			streaming: null,
			prefetch: null,
		},
		lastResponse: null,
		errorMessage: null,
		history: [],
	};
}