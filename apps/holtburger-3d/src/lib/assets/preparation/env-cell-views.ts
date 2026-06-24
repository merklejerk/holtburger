import type { LandblockEnvCellsPayloadDto } from "../../../lib/host/contracts";
import type { PreparedAsset } from "../contracts";
import { omitRenderGeometryVertexBuffers } from "./render-geometry-views";

type ResolverEnvCellRenderGeometryDto = Omit<
	LandblockEnvCellsPayloadDto["envCells"][number]["renderGeometry"],
	"normals" | "positions" | "uvs"
>;

type ResolverLandblockEnvCellDto = Omit<
	LandblockEnvCellsPayloadDto["envCells"][number],
	"renderGeometry"
> & {
	readonly renderGeometry: ResolverEnvCellRenderGeometryDto;
};

export type ResolverLandblockEnvCellsPayloadDto = Omit<
	LandblockEnvCellsPayloadDto,
	"envCells"
> & {
	readonly envCells: readonly ResolverLandblockEnvCellDto[];
};

// Minimal standalone env-cell shape needed for resolver diagnostic views.
interface EnvCellPayloadDto {
	readonly kind: "env-cell";
	readonly renderGeometry: LandblockEnvCellsPayloadDto["envCells"][number]["renderGeometry"];
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
	payload: LandblockEnvCellsPayloadDto,
): ResolverLandblockEnvCellsPayloadDto {
	return {
		...payload,
		envCells: payload.envCells.map(createResolverEnvCellPayloadView),
	};
}

function createResolverEnvCellPayloadView(
	cell: EnvCellPayloadDto,
): ResolverEnvCellPayloadDto;
function createResolverEnvCellPayloadView(
	cell: LandblockEnvCellsPayloadDto["envCells"][number],
): ResolverLandblockEnvCellDto;
function createResolverEnvCellPayloadView(
	cell: EnvCellPayloadDto | LandblockEnvCellsPayloadDto["envCells"][number],
): ResolverEnvCellPayloadDto | ResolverLandblockEnvCellDto {
	return {
		...cell,
		renderGeometry: omitRenderGeometryVertexBuffers(cell.renderGeometry),
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
