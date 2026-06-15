import type { GfxObjPayloadDto } from "../../../lib/host/contracts";
import type { PreparedAsset } from "../contracts";

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
): GfxObjPayloadDto {
	return {
		...payload,
		renderGeometry: {
			...payload.renderGeometry,
			normals: [],
			positions: [],
			uvs: [],
		},
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
