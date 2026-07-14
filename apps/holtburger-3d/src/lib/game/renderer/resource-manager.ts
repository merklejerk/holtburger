import type { TexturePixelFormat } from "../textures/types";
import type { RenderGeometryData } from "./geometry";

/** Opaque backend identity for one complete uploaded geometry resource. */
export type GeometryResourceKey = `geometry-resource:${number}`;

/** Opaque backend identity for one uploaded two-dimensional texture. */
export type Texture2DResourceKey = `texture-2d-resource:${number}`;

/** Opaque backend identity for one uploaded two-dimensional texture array. */
export type TextureArrayResourceKey = `texture-array-resource:${number}`;

/** Renderer resource identity leased by runtime owners. */
export type RenderResourceKey =
	| GeometryResourceKey
	| Texture2DResourceKey
	| TextureArrayResourceKey;

/** Complete texture upload with dimensions required by graphics APIs. */
export interface Texture2DUpload {
	readonly format: TexturePixelFormat;
	readonly width: number;
	readonly height: number;
	readonly data: Uint8Array;
}

/** Sampling policy fixed on a texture-array device resource. */
export enum TextureArraySamplingPolicy {
	LinearRepeat = "linear-repeat",
}

/** Immutable storage allocated for a homogeneous two-dimensional texture array. */
export interface TextureArrayDescription {
	readonly format: TexturePixelFormat;
	readonly width: number;
	readonly height: number;
	readonly mipLevels: number;
	readonly layerCapacity: number;
	readonly sampling: TextureArraySamplingPolicy;
}

/** Complete level-zero pixels uploaded into one texture-array layer. */
export interface TextureArrayLayerUpload {
	readonly layer: number;
	readonly data: Uint8Array;
}

/** Backend resource boundary consumed by logical render and texture-storage systems. */
export interface RendererResourceManager {
	createGeometry(geometry: RenderGeometryData): GeometryResourceKey;
	replaceGeometry(key: GeometryResourceKey, geometry: RenderGeometryData): void;
	createTexture2D(upload: Texture2DUpload): Texture2DResourceKey;
	replaceTexture2D(key: Texture2DResourceKey, upload: Texture2DUpload): void;
	createTextureArray(
		description: TextureArrayDescription,
	): TextureArrayResourceKey;
	uploadTextureArrayLayer(
		key: TextureArrayResourceKey,
		upload: TextureArrayLayerUpload,
	): void;
	generateTextureArrayMipmaps(key: TextureArrayResourceKey): void;
	releaseResource(key: RenderResourceKey): boolean;
	destroy(): Promise<void>;
}
