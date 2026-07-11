import type { TexturePixelFormat } from "../textures/types";

export type TextureResourceKey = `texture-resource:${string}`;
export type VertexArrayResourceKey = `vertex-array:${string}`;
export type ElementArrayResourceKey = `elem-array:${string}`;
export type DynamicTextureResourceKey = `dyn-texture:${string}`;
export type DynamicVertexArrayResourceKey = `dyn-vertex-array:${string}`;
export type DynamicElementArrayResourceKey = `dyn-elem-array:${string}`;
export type RenderResourceKey =
	| TextureResourceKey
	| VertexArrayResourceKey
	| ElementArrayResourceKey
	| DynamicTextureResourceKey
	| DynamicElementArrayResourceKey
	| DynamicVertexArrayResourceKey;

// Guessing on the realistic params for these.
export interface RendererResourceManager {
	createTexture(
		format: TexturePixelFormat,
		data: Uint8Array,
	): TextureResourceKey;
	createDynamicTexture(
		format: TexturePixelFormat,
		width: number,
		height: number,
	): DynamicTextureResourceKey;
	// idk what the args should be for these.
	createVertexArray(data: Uint8Array): VertexArrayResourceKey;
	createDynamicVertexArray(size: number): DynamicVertexArrayResourceKey;
	createElementVertexArray(data: Uint32Array): ElementArrayResourceKey;
	createDynamicElementVertexArray(size: number): DynamicElementArrayResourceKey;
	setTextureData(
		key: TextureResourceKey | DynamicTextureResourceKey,
		data: Uint8Array,
	): void;
	setVertexData(
		key: VertexArrayResourceKey | DynamicVertexArrayResourceKey,
		data: Uint8Array,
	): void;
	setElementData(
		key: ElementArrayResourceKey | DynamicElementArrayResourceKey,
		data: Uint32Array,
	): void;
	releaseResource(key: RenderResourceKey): boolean;
	destroy(): Promise<void>;
}
