import type { GfxObjPayloadDto } from "../../../lib/host/contracts";
import type { PreparedAsset } from "../contracts";
import { omitRenderGeometryVertexBuffers } from "./render-geometry-views";

type ResolverGfxObjRenderGeometryDto = Omit<
	GfxObjPayloadDto["renderGeometry"],
	"normals" | "positions" | "uvs"
>;

export type ResolverGfxObjPayloadDto = Omit<
	GfxObjPayloadDto,
	"renderGeometry"
> & {
	readonly renderGeometry: ResolverGfxObjRenderGeometryDto;
};

export function createResolverGfxObjPreparedAssetView(
	asset: PreparedAsset,
): PreparedAsset {
	if (!isGfxObjPayload(asset.payload)) {
		return asset;
	}

	return {
		...asset,
		payload: createResolverGfxObjPayloadView(asset.payload),
	};
}

function createResolverGfxObjPayloadView(
	payload: GfxObjPayloadDto,
): ResolverGfxObjPayloadDto {
	return {
		...payload,
		renderGeometry: omitRenderGeometryVertexBuffers(payload.renderGeometry),
	};
}

function isGfxObjPayload(payload: unknown): payload is GfxObjPayloadDto {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"kind" in payload &&
		payload.kind === "gfx-obj"
	);
}
