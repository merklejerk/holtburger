import type { EnvCellSystemLayerSourcePayloadDto } from "../../static/source-payloads";
import type { PreparedAsset } from "../contracts";
import { omitRenderGeometryVertexBuffers } from "./render-geometry-views";

type ResolverEnvCellRenderGeometryDto = Omit<
	EnvCellSystemLayerSourcePayloadDto["envCells"][number]["renderGeometry"],
	"normals" | "positions" | "uvs"
>;

type ResolverLandblockEnvCellDto = Omit<
	EnvCellSystemLayerSourcePayloadDto["envCells"][number],
	"renderGeometry"
> & {
	readonly renderGeometry: ResolverEnvCellRenderGeometryDto;
};

export type ResolverLandblockEnvCellLayerPayloadDto = Omit<
	EnvCellSystemLayerSourcePayloadDto,
	"envCells"
> & {
	readonly envCells: readonly ResolverLandblockEnvCellDto[];
};

// Minimal standalone env-cell shape needed for resolver diagnostic views.
interface EnvCellPayloadDto {
	readonly kind: "env-cell";
	readonly renderGeometry: EnvCellSystemLayerSourcePayloadDto["envCells"][number]["renderGeometry"];
	readonly [field: string]: unknown;
}

type ResolverEnvCellPayloadDto = Omit<EnvCellPayloadDto, "renderGeometry"> & {
	readonly renderGeometry: ResolverEnvCellRenderGeometryDto;
};

export function createResolverEnvCellPreparedAssetView(
	asset: PreparedAsset,
): PreparedAsset {
	if (isEnvCellSystemPayload(asset.payload)) {
		return {
			...asset,
			payload: createResolverEnvCellSystemPayloadView(asset.payload),
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

function createResolverEnvCellSystemPayloadView(
	payload: EnvCellSystemLayerSourcePayloadDto,
): ResolverLandblockEnvCellLayerPayloadDto {
	return {
		...payload,
		envCells: payload.envCells.map(createResolverEnvCellPayloadView),
	};
}

function createResolverEnvCellPayloadView(
	cell: EnvCellPayloadDto,
): ResolverEnvCellPayloadDto;
function createResolverEnvCellPayloadView(
	cell: EnvCellSystemLayerSourcePayloadDto["envCells"][number],
): ResolverLandblockEnvCellDto;
function createResolverEnvCellPayloadView(
	cell:
		EnvCellPayloadDto | EnvCellSystemLayerSourcePayloadDto["envCells"][number],
): ResolverEnvCellPayloadDto | ResolverLandblockEnvCellDto {
	return {
		...cell,
		renderGeometry: omitRenderGeometryVertexBuffers(cell.renderGeometry),
	};
}

function isEnvCellSystemPayload(
	payload: unknown,
): payload is EnvCellSystemLayerSourcePayloadDto {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"kind" in payload &&
		payload.kind === "landblock-scene-lod-env-cell-layer"
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
