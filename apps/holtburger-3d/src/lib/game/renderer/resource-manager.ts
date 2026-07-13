import type { TexturePixelFormat } from "../textures/types";
import type { RenderGeometryData } from "./geometry";

/** Opaque backend identity for one complete uploaded geometry resource. */
export type GeometryResourceKey = `geometry-resource:${number}`;

/** Opaque backend identity for one uploaded texture resource. */
export type TextureResourceKey = `texture-resource:${number}`;

/** Renderer resource identity leased by runtime owners. */
export type RenderResourceKey = GeometryResourceKey | TextureResourceKey;

/** Complete texture upload with dimensions required by graphics APIs. */
export interface TextureUpload {
	readonly format: TexturePixelFormat;
	readonly width: number;
	readonly height: number;
	readonly data: Uint8Array;
}

/** Backend resource boundary consumed by logical render resources and texture atlases. */
export interface RendererResourceManager {
	createGeometry(geometry: RenderGeometryData): GeometryResourceKey;
	replaceGeometry(key: GeometryResourceKey, geometry: RenderGeometryData): void;
	createTexture(upload: TextureUpload): TextureResourceKey;
	replaceTexture(key: TextureResourceKey, upload: TextureUpload): void;
	releaseResource(key: RenderResourceKey): boolean;
	destroy(): Promise<void>;
}
