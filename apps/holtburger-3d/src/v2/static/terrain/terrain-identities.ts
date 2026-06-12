import type {
	PaletteIdentity,
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	PreparedRgbaRenderSurfaceTextureUsage,
	RegionRenderProfileIdentity,
	RenderSurfaceIdentity,
	StaticResourceIdentity,
	SurfaceTextureIdentity,
	TerrainMaterialIdentity,
} from "../contracts";

export function createTerrainMaterialIdentity(
	regionNumber: number,
): TerrainMaterialIdentity {
	return {
		kind: "terrain-material",
		regionNumber: assertNonnegativeInteger(regionNumber, "regionNumber"),
	};
}

export function createRegionRenderProfileIdentity(
	regionNumber: number,
): RegionRenderProfileIdentity {
	return {
		kind: "region-render-profile",
		regionNumber: assertNonnegativeInteger(regionNumber, "regionNumber"),
	};
}

export function createSurfaceTextureIdentity(
	surfaceTextureId: number,
): SurfaceTextureIdentity {
	return {
		kind: "surface-texture",
		surfaceTextureId: assertNonnegativeInteger(
			surfaceTextureId,
			"surfaceTextureId",
		),
	};
}

export function createRenderSurfaceIdentity(
	renderSurfaceId: number,
): RenderSurfaceIdentity {
	return {
		kind: "render-surface",
		renderSurfaceId: assertNonnegativeInteger(
			renderSurfaceId,
			"renderSurfaceId",
		),
	};
}

export function createPaletteIdentity(paletteId: number): PaletteIdentity {
	return {
		kind: "palette",
		paletteId: assertNonnegativeInteger(paletteId, "paletteId"),
	};
}

export function createPreparedRenderSurfaceTextureUseIdentity(options: {
	readonly renderSurfaceId: number;
	readonly usage: PreparedRgbaRenderSurfaceTextureUsage;
}): PreparedRgbaRenderSurfaceTextureUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: createRenderSurfaceIdentity(options.renderSurfaceId),
		usage: options.usage,
	};
}

export function parseTerrainSliceDependencyRoute(
	assetId: string,
): StaticResourceIdentity {
	const surfaceTextureMatch = /^surface-texture\/([0-9a-fA-F]{8})$/.exec(
		assetId,
	);
	if (surfaceTextureMatch) {
		return createSurfaceTextureIdentity(
			Number.parseInt(surfaceTextureMatch[1] as string, 16),
		);
	}

	const renderSurfaceMatch = /^render-surface\/([0-9a-fA-F]{8})$/.exec(assetId);
	if (renderSurfaceMatch) {
		return createRenderSurfaceIdentity(
			Number.parseInt(renderSurfaceMatch[1] as string, 16),
		);
	}

	const paletteMatch = /^palette\/([0-9a-fA-F]{8})$/.exec(assetId);
	if (paletteMatch) {
		return createPaletteIdentity(
			Number.parseInt(paletteMatch[1] as string, 16),
		);
	}

	throw new Error(`Unsupported terrain dependency host route: ${assetId}`);
}

function assertNonnegativeInteger(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a nonnegative integer: ${value}`);
	}

	return value;
}
