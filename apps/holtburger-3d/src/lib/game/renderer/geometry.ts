/** Terrain attributes retained from generation through backend upload. */
export interface TerrainGeometryData {
	readonly kind: "terrain";
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly textureCoordinates: Float32Array;
	/** One authored terrain type code for each terrain vertex. */
	readonly terrainColorCodes: Uint8Array;
	readonly indices: Uint16Array | Uint32Array;
}

/** Object/interior attributes shared by baked, rigid, and articulated geometry. */
export interface ObjectGeometryData {
	readonly kind: "object";
	/** Baked publication material rows; absent for uniform-material source geometry and shells. */
	readonly materials?: {
		/** Dense material-table row for each vertex. */
		readonly selectors: Uint32Array;
		/** Row count shared by selector validation and geometry-owned table allocation. */
		readonly count: number;
	};
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly textureCoordinates: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
	/**
	 * Interleaved RGB static light burned into each vertex, or null when a geometry receives
	 * no authored static lighting.
	 *
	 * Retail bakes interior static lights into the mesh's vertex diffuse at construction
	 * (`D3DPolyRender::SetStaticLightingVertexColors`, acclient.c:434570) and the fixed-function
	 * pipeline adds it as the emissive term. Absent here means the shader's default zero
	 * attribute, which contributes nothing.
	 */
	readonly bakedLight: Float32Array | null;
}

/** Shared source-local dynamic vertices; source indices stay CPU-side for appearance compilation. */
export interface DynamicGeometryData extends Omit<
	ObjectGeometryData,
	"kind" | "bakedLight" | "materials"
> {
	/** Source-local merged rigid parts, transformed by a shader-readable pose palette. */
	readonly kind: "dynamic-parts";
	/** Required pose-table rows, including parts without triangles; checked before device upload. */
	readonly partCount: number;
	/** Required material-table rows, derived once by the layout compiler. */
	readonly materialCount: number;
	/** Dense pose-record selector for each vertex, independent from authored part numbering. */
	readonly partSelectors: Uint32Array;
	/** Dense logical material slot/wrap selector for each vertex. */
	readonly materialSelectors: Uint32Array;
}

/** Pose selector location shared by articulated geometry upload and its shader. */
export const DYNAMIC_PART_SELECTOR_ATTRIBUTE = 3;
/** Material selector location shared by baked and articulated table-backed shaders. */
export const OBJECT_MATERIAL_SELECTOR_ATTRIBUTE = 4;

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
	| DynamicGeometryData
	| PortalGeometryData;
