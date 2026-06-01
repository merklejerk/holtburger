export type RenderSpatialItemId = string;

export function terrainSpatialItemId(assetId: string): RenderSpatialItemId {
	return `terrain:${assetId}`;
}

export function structuredCellSpatialItemId(
	renderKey: string,
): RenderSpatialItemId {
	return `structured-cell:${renderKey}`;
}

export function debugCellSpatialItemId(renderKey: string): RenderSpatialItemId {
	return `debug-cell:${renderKey}`;
}

export function portalSpatialItemId(portalId: string): RenderSpatialItemId {
	return `portal:${portalId}`;
}

export function staticRenderablePartSpatialItemId(
	renderKey: string,
): RenderSpatialItemId {
	return `static-renderable:${renderKey}`;
}
