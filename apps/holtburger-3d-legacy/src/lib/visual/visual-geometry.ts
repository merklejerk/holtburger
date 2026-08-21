import type { TextureBindingId } from "../textures/identity";

/** Axis-aligned bounds in the payload owner's source coordinate space. */
interface VisualGeometryBounds {
	readonly min: VisualGeometryVec3;
	readonly max: VisualGeometryVec3;
}

/** Minimal vector shape shared by static and dynamic visual geometry bounds. */
interface VisualGeometryVec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/** GPU index element width for a visual geometry payload. */
type VisualGeometryIndexType = "uint16" | "uint32";

/** Renderer shader family selected by material batching planning. */
export type VisualGeometryMaterialFamily =
	"flat-color" | "indexed-paletted" | "texture-rgba";

/** Renderer pass selected by material batching planning. */
export type VisualGeometryMaterialPass =
	"opaque" | "alpha-test" | "transparent" | "additive";

/** Renderer-visible draw state shared by object-style static and dynamic visual geometry. */
export interface VisualGeometryRenderState {
	readonly blend: {
		readonly enabled: boolean;
		readonly mode:
			| "opaque"
			| "clipmap"
			| "translucent"
			| "alpha"
			| "alpha-additive"
			| "inverse-alpha"
			| "inverse-alpha-additive"
			| "additive";
		readonly srcFactor: "one" | "src-alpha" | "one-minus-src-alpha" | null;
		readonly dstFactor: "one" | "src-alpha" | "one-minus-src-alpha" | null;
	};
	readonly depthTest: true;
	readonly depthWrite: boolean;
}

/** Renderer-visible material table entry for one material slot. */
export interface VisualGeometryMaterialTableEntry {
	readonly slot: number;
	readonly materialIds: readonly number[];
	readonly alphaTest: number;
	readonly indexedClipThreshold: number;
	readonly renderState: VisualGeometryRenderState;
	readonly materialColor: readonly [number, number, number, number];
	readonly materialEmissiveColor: readonly [number, number, number];
	readonly primaryTextureBindingId: TextureBindingId | null;
	readonly primaryTextureKey: string | null;
	readonly indexTextureBindingId: TextureBindingId | null;
	readonly indexTextureKey: string | null;
	readonly indexedTextureFormat: "p8" | "index16" | null;
	readonly paletteTextureBindingId: TextureBindingId | null;
	readonly paletteTextureKey: string | null;
	readonly detailTextureBindingId: TextureBindingId | null;
	readonly detailTextureKey: string | null;
	readonly detailTextureTiling: number;
	readonly primaryTextureWrapMode: "clamp" | "repeat";
}

/** Shared renderer-visible geometry and material payload for static and dynamic visual resources. */
export interface VisualGeometryPayload {
	/** Optional source-local bounds for culling, picking, and inspection projections. */
	readonly bounds: VisualGeometryBounds | null;
	/** GPU index buffer payload. */
	readonly indices: Uint16Array | Uint32Array;
	/** GPU index element width. */
	readonly indexType: VisualGeometryIndexType;
	/** Renderer-visible material/texture layout for each material slot referenced by this geometry. */
	readonly materialEntries: readonly VisualGeometryMaterialTableEntry[];
	/** Shader family required by this compatible geometry slice. */
	readonly materialFamily: VisualGeometryMaterialFamily;
	/** Render pass required by this compatible geometry slice. */
	readonly materialPass: VisualGeometryMaterialPass;
	/** Per-vertex material-slot attribute payload. */
	readonly materialSlotIndices: Float32Array;
	/** GPU position attribute payload. */
	readonly positions: Float32Array;
	/** Depth, blend, alpha, and culling-equivalent material state. */
	readonly renderState: VisualGeometryRenderState;
	/** GPU texture-coordinate attribute payload. */
	readonly texCoords: Float32Array;
	/** Renderer material binding ids consumed by binding ownership. */
	readonly textureBindingIds: readonly TextureBindingId[];
	/** Derived primitive count for diagnostics and renderer accounting. */
	readonly triangleCount: number;
	/** Derived vertex count for diagnostics and validation. */
	readonly vertexCount: number;
}

export function estimateVisualGeometryPayloadBufferBytes(
	payload: VisualGeometryPayload,
): number {
	return (
		payload.positions.byteLength +
		payload.texCoords.byteLength +
		payload.materialSlotIndices.byteLength +
		payload.indices.byteLength
	);
}
