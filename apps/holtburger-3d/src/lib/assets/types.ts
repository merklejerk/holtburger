import type {
	AssetErrorCode,
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	AssetProvenanceSource,
	Vec3Dto,
} from "../host/contracts";

export type AssetPreparationStatus = "idle" | "pending" | "ready" | "error";

export type AssetResidencyKind =
	| "outdoor-landblock"
	| "indoor-env-cell"
	| "unknown";

export interface PreparedAssetProvenance {
	source: AssetProvenanceSource;
	sourceAssetKind: string | null;
	errorCode: AssetErrorCode | null;
	detail: string | null;
}

export interface PreparedTerrainTriangle {
	a: number;
	b: number;
	c: number;
	terrainType: number;
	averageHeight: number;
}

export interface PreparedTerrainMesh {
	landblockId: number;
	gridSize: number;
	tileSize: number;
	vertices: Vec3Dto[];
	triangles: PreparedTerrainTriangle[];
	minHeight: number;
	maxHeight: number;
}

interface PreparedAssetPayloadBase {
	kind: string;
	residencyKind: AssetResidencyKind;
	provenance: PreparedAssetProvenance;
}

export interface PreparedDebugPresentation {
	primitive: string;
	paletteKey: string;
}

export interface PreparedTerrainLandblockPayload extends PreparedAssetPayloadBase {
	kind: "terrain-landblock";
	sourceAssetKind: "cell-landblock";
	debugPresentation: PreparedDebugPresentation;
	terrainMesh: PreparedTerrainMesh;
}

export interface PreparedIndoorEnvCellPayload extends PreparedAssetPayloadBase {
	kind: "indoor-env-cell";
	sourceAssetKind: "env-cell";
	debugPresentation: PreparedDebugPresentation;
	envCellId: number;
	environmentId: number | null;
	cellStructureId: number | null;
	visibleCellIds: number[];
	seenOutside: boolean | null;
	surfaceIds: number[];
	portalCount: number;
	staticObjectCount: number;
}

export interface PreparedEnvironmentPayload extends PreparedAssetPayloadBase {
	kind: "environment";
	sourceAssetKind: "environment";
	debugPresentation: PreparedDebugPresentation;
	environmentId: number;
	cellStructureIds: number[];
}

export interface PreparedCellStructurePayload extends PreparedAssetPayloadBase {
	kind: "cell-structure";
	sourceAssetKind: "cell-structure";
	debugPresentation: PreparedDebugPresentation;
	environmentId: number | null;
	cellStructureId: number;
	polygonCount: number | null;
	portalCount: number | null;
	hasCellBsp: boolean;
	hasPhysicsBsp: boolean;
	hasDrawingBsp: boolean;
}

export interface PreparedVisualAssetStubPayload extends PreparedAssetPayloadBase {
	kind: "visual-asset-stub";
	sourceAssetKind: string | null;
	debugPresentation: PreparedDebugPresentation;
}

export interface PreparedUnknownAssetPayload extends PreparedAssetPayloadBase {
	kind: "unknown";
	sourceAssetKind: string | null;
	rawKind: string;
	debugPresentation: PreparedDebugPresentation | null;
}

export type PreparedAssetPayload =
	| PreparedTerrainLandblockPayload
	| PreparedIndoorEnvCellPayload
	| PreparedEnvironmentPayload
	| PreparedCellStructurePayload
	| PreparedVisualAssetStubPayload
	| PreparedUnknownAssetPayload;

export interface PreparedAssetRecord {
	request: AssetLookupRequestDto;
	response: AssetLookupResponseDto;
	payload: PreparedAssetPayload;
	preparedAt: string;
}

export function isPreparedTerrainLandblock(
	asset: PreparedAssetRecord,
): asset is PreparedAssetRecord & { payload: PreparedTerrainLandblockPayload } {
	return asset.payload.kind === "terrain-landblock";
}

export function describePreparedAssetPayload(
	payload: PreparedAssetPayload,
): string {
	return payload.debugPresentation?.primitive ?? payload.kind;
}

export type AssetActivityStatus = "requested" | "prepared" | "failed";

export interface AssetActivityRecord {
	requestId: string;
	assetId: string;
	priority: AssetLookupRequestDto["priority"];
	status: AssetActivityStatus;
	channel: string;
	timestamp: string;
}

export interface AssetChannelState {
	channel: string;
	status: AssetPreparationStatus;
	activeRequest: AssetLookupRequestDto | null;
	preparedAsset: PreparedAssetRecord | null;
	preparedByPriority: Record<
		AssetLookupRequestDto["priority"],
		PreparedAssetRecord | null
	>;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
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
		preparedByAssetId: {},
		lastResponse: null,
		errorMessage: null,
		history: [],
	};
}
