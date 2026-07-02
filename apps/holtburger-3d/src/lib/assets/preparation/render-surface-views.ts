import type { RenderSurfacePayloadDto } from "../../../lib/host/contracts";
import type { PreparedAsset } from "../contracts";

type ResolverRenderSurfacePayloadDto = Omit<
	RenderSurfacePayloadDto,
	"sourceBytes"
>;

export function createResolverRenderSurfacePreparedAssetView(
	asset: PreparedAsset,
): PreparedAsset {
	if (!isRenderSurfacePayload(asset.payload)) {
		return asset;
	}

	return {
		...asset,
		payload: createResolverRenderSurfacePayloadView(asset.payload),
	};
}

function createResolverRenderSurfacePayloadView(
	payload: RenderSurfacePayloadDto,
): ResolverRenderSurfacePayloadDto {
	return {
		defaultPaletteId: payload.defaultPaletteId,
		dependencies: payload.dependencies,
		format: payload.format,
		formatRaw: payload.formatRaw,
		height: payload.height,
		kind: payload.kind,
		provenance: payload.provenance,
		renderSurfaceId: payload.renderSurfaceId,
		residencyKind: payload.residencyKind,
		sourceAssetKind: payload.sourceAssetKind,
		sourceByteLength: payload.sourceByteLength,
		unknown: payload.unknown,
		width: payload.width,
	};
}

function isRenderSurfacePayload(
	payload: unknown,
): payload is RenderSurfacePayloadDto {
	return (
		typeof payload === "object" &&
		payload !== null &&
		"kind" in payload &&
		payload.kind === "render-surface"
	);
}
