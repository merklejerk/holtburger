/** Terrain attributes retained from generation through backend upload. */
export interface TerrainGeometryData {
	readonly kind: "terrain";
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly textureCoordinates: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
}

/** Object/interior attributes shared by baked, rigid, and articulated geometry. */
export interface ObjectGeometryData {
	readonly kind: "object";
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly textureCoordinates: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
}

/** Position-only geometry used for portal masking and clipping. */
export interface PortalGeometryData {
	readonly kind: "portal-aperture";
	readonly positions: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
}

/** Complete semantic geometry accepted by renderer backends. */
export type RenderGeometryData =
	| TerrainGeometryData
	| ObjectGeometryData
	| PortalGeometryData;
