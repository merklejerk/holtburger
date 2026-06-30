import type { LandblockEnvCellsLayerSourcePayloadDto } from "../../static/source-payloads";
import type { PreparedAsset } from "../contracts";
import { omitRenderGeometryVertexBuffers } from "./render-geometry-views";

type ResolverEnvCellRenderGeometryDto = Omit<
	LandblockEnvCellsLayerSourcePayloadDto["envCells"][number]["renderGeometry"],
	"normals" | "positions" | "uvs"
>;

type ResolverLandblockEnvCellDto = Omit<
	LandblockEnvCellsLayerSourcePayloadDto["envCells"][number],
	"renderGeometry"
> & {
	readonly renderGeometry: ResolverEnvCellRenderGeometryDto;
};

export type ResolverLandblockEnvCellLayerPayloadDto = Omit<
	LandblockEnvCellsLayerSourcePayloadDto,
	"envCells"
> & {
	readonly envCells: readonly ResolverLandblockEnvCellDto[];
};

// Minimal standalone env-cell shape needed for resolver diagnostic views.
interface EnvCellPayloadDto {
	readonly kind: "env-cell";
	readonly renderGeometry: LandblockEnvCellsLayerSourcePayloadDto["envCells"][number]["renderGeometry"];
	readonly [field: string]: unknown;
}

type ResolverEnvCellPayloadDto = Omit<EnvCellPayloadDto, "renderGeometry"> & {
	readonly renderGeometry: ResolverEnvCellRenderGeometryDto;
};

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
	payload: LandblockEnvCellsLayerSourcePayloadDto,
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
	cell: LandblockEnvCellsLayerSourcePayloadDto["envCells"][number],
): ResolverLandblockEnvCellDto;
function createResolverEnvCellPayloadView(
	cell:
		| EnvCellPayloadDto
		| LandblockEnvCellsLayerSourcePayloadDto["envCells"][number],
): ResolverEnvCellPayloadDto | ResolverLandblockEnvCellDto {
	return {
		...cell,
		renderGeometry: omitRenderGeometryVertexBuffers(cell.renderGeometry),
	};
}

function isLandblockEnvCellsPayload(
	payload: unknown,
): payload is LandblockEnvCellsLayerSourcePayloadDto {
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
