import type {
	EnvCellPayloadDto,
	LandblockEnvCellsPayloadDto,
} from "../../../lib/host/contracts";
import type { PreparedAsset } from "../contracts";

export function createResolverEnvCellPreparedAssetView(
	asset: PreparedAsset,
): PreparedAsset {
	if (isLandblockEnvCellsPayload(asset.payload)) {
		return {
			...asset,
			payload: createResolverLandblockEnvCellsPayloadView(asset.payload),
		};
	}
	if (isEnvCellPayload(asset.payload)) {
		return {
			...asset,
			payload: createResolverEnvCellPayloadView(asset.payload),
		};
	}

	return asset;
}

function createResolverLandblockEnvCellsPayloadView(
	payload: LandblockEnvCellsPayloadDto,
): LandblockEnvCellsPayloadDto {
	return {
		...payload,
		envCells: payload.envCells.map(createResolverEnvCellPayloadView),
	};
}

function createResolverEnvCellPayloadView(
	cell: EnvCellPayloadDto,
): EnvCellPayloadDto;
function createResolverEnvCellPayloadView(
	cell: LandblockEnvCellsPayloadDto["envCells"][number],
): LandblockEnvCellsPayloadDto["envCells"][number];
function createResolverEnvCellPayloadView(
	cell: EnvCellPayloadDto | LandblockEnvCellsPayloadDto["envCells"][number],
): EnvCellPayloadDto | LandblockEnvCellsPayloadDto["envCells"][number] {
	return {
		...cell,
		renderGeometry: {
			...cell.renderGeometry,
			normals: [],
			positions: [],
			uvs: [],
		},
	};
}

function isLandblockEnvCellsPayload(
	payload: unknown,
): payload is LandblockEnvCellsPayloadDto {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"kind" in payload &&
		payload.kind === "landblock-env-cells"
	);
}

function isEnvCellPayload(payload: unknown): payload is EnvCellPayloadDto {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"kind" in payload &&
		payload.kind === "env-cell"
	);
}
