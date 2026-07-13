import {
	type GeometryResourceKey,
	type RendererResourceManager,
	type RenderResourceKey,
	type TextureResourceKey,
	type TextureUpload,
} from "./resource-manager";
import { TexturePixelFormat } from "../textures/types";
import type { RenderGeometryData } from "./geometry";

/** WebGL draw binding retained for one semantic geometry resource. */
export interface WebGL2GeometryBinding {
	/** Vertex array containing the geometry attribute and index bindings. */
	readonly vertexArray: WebGLVertexArrayObject;
	/** Number of indices available to draw units. */
	readonly indexCount: number;
	/** WebGL scalar type used by the element buffer. */
	readonly indexType: GLenum;
	/** Byte width used to convert an index start into a draw offset. */
	readonly indexElementBytes: number;
}

interface WebGL2GeometryResource extends WebGL2GeometryBinding {
	readonly buffers: readonly WebGLBuffer[];
}

interface WebGL2TextureResource {
	readonly texture: WebGLTexture;
}

/** WebGL2 resource owner sharing the renderer's graphics context. */
export class WebGL2ResourceManager implements RendererResourceManager {
	readonly #gl: WebGL2RenderingContext;
	readonly #geometry = new Map<GeometryResourceKey, WebGL2GeometryResource>();
	readonly #textures = new Map<TextureResourceKey, WebGL2TextureResource>();
	#nextGeometryId = 0;
	#nextTextureId = 0;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	createGeometry(geometry: RenderGeometryData): GeometryResourceKey {
		const key: GeometryResourceKey = `geometry-resource:${this.#nextGeometryId++}`;
		this.#geometry.set(key, this.#uploadGeometry(geometry));
		return key;
	}

	replaceGeometry(
		key: GeometryResourceKey,
		geometry: RenderGeometryData,
	): void {
		const previous = this.#geometry.get(key);
		if (!previous) throw new Error(`Geometry resource ${key} does not exist.`);
		const replacement = this.#uploadGeometry(geometry);
		this.#geometry.set(key, replacement);
		this.#destroyGeometry(previous);
	}

	getGeometry(key: GeometryResourceKey): WebGL2GeometryBinding {
		const resource = this.#geometry.get(key);
		if (!resource) throw new Error(`Geometry resource ${key} does not exist.`);
		return resource;
	}

	createTexture(upload: TextureUpload): TextureResourceKey {
		const key: TextureResourceKey = `texture-resource:${this.#nextTextureId++}`;
		this.#textures.set(key, this.#uploadTexture(upload));
		return key;
	}

	replaceTexture(key: TextureResourceKey, upload: TextureUpload): void {
		const previous = this.#textures.get(key);
		if (!previous) throw new Error(`Texture resource ${key} does not exist.`);
		const replacement = this.#uploadTexture(upload);
		this.#textures.set(key, replacement);
		this.#gl.deleteTexture(previous.texture);
	}

	releaseResource(key: RenderResourceKey): boolean {
		if (isGeometryResourceKey(key)) {
			const resource = this.#geometry.get(key);
			if (!resource) return false;
			this.#geometry.delete(key);
			this.#destroyGeometry(resource);
			return true;
		}
		const resource = this.#textures.get(key);
		if (!resource) return false;
		this.#textures.delete(key);
		this.#gl.deleteTexture(resource.texture);
		return true;
	}

	async destroy(): Promise<void> {
		for (const resource of this.#geometry.values()) {
			this.#destroyGeometry(resource);
		}
		for (const resource of this.#textures.values()) {
			this.#gl.deleteTexture(resource.texture);
		}
		this.#geometry.clear();
		this.#textures.clear();
	}

	#uploadGeometry(geometry: RenderGeometryData): WebGL2GeometryResource {
		validateGeometry(geometry);
		const gl = this.#gl;
		const vertexArray = gl.createVertexArray();
		const indexBuffer = gl.createBuffer();
		if (!vertexArray || !indexBuffer) {
			if (vertexArray) gl.deleteVertexArray(vertexArray);
			if (indexBuffer) gl.deleteBuffer(indexBuffer);
			throw new Error(`Failed to allocate ${geometry.kind} geometry.`);
		}

		const buffers: WebGLBuffer[] = [indexBuffer];
		try {
			gl.bindVertexArray(vertexArray);
			buffers.push(uploadFloatAttribute(gl, 0, 3, geometry.positions));
			if (geometry.kind === "terrain" || geometry.kind === "object") {
				buffers.push(uploadFloatAttribute(gl, 1, 3, geometry.normals));
				buffers.push(
					uploadFloatAttribute(gl, 2, 2, geometry.textureCoordinates),
				);
				buffers.push(
					uploadUint16Attribute(
						gl,
						3,
						geometry.kind === "terrain"
							? geometry.featureSlots
							: geometry.materialSlots,
					),
				);
			}
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
			gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
			const usesShortIndices = geometry.indices instanceof Uint16Array;
			return {
				buffers,
				indexCount: geometry.indices.length,
				indexElementBytes: usesShortIndices ? 2 : 4,
				indexType: usesShortIndices ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
				vertexArray,
			};
		} catch (error) {
			for (const buffer of buffers) gl.deleteBuffer(buffer);
			gl.deleteVertexArray(vertexArray);
			throw error;
		} finally {
			gl.bindVertexArray(null);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
		}
	}

	#uploadTexture(upload: TextureUpload): WebGL2TextureResource {
		if (upload.width <= 0 || upload.height <= 0) {
			throw new Error("Texture dimensions must be positive.");
		}
		const gl = this.#gl;
		const texture = gl.createTexture();
		if (!texture) throw new Error("Failed to allocate texture resource.");
		try {
			const format = resolveTextureFormat(gl, upload.format);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				format.internal,
				upload.width,
				upload.height,
				0,
				format.external,
				gl.UNSIGNED_BYTE,
				upload.data,
			);
			return { texture };
		} catch (error) {
			gl.deleteTexture(texture);
			throw error;
		} finally {
			gl.bindTexture(gl.TEXTURE_2D, null);
		}
	}

	#destroyGeometry(resource: WebGL2GeometryResource): void {
		for (const buffer of resource.buffers) this.#gl.deleteBuffer(buffer);
		this.#gl.deleteVertexArray(resource.vertexArray);
	}
}

function isGeometryResourceKey(
	key: RenderResourceKey,
): key is GeometryResourceKey {
	return key.startsWith("geometry-resource:");
}

function uploadFloatAttribute(
	gl: WebGL2RenderingContext,
	location: number,
	components: number,
	data: Float32Array,
): WebGLBuffer {
	const buffer = requireBuffer(gl);
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(location);
	gl.vertexAttribPointer(location, components, gl.FLOAT, false, 0, 0);
	return buffer;
}

function uploadUint16Attribute(
	gl: WebGL2RenderingContext,
	location: number,
	data: Uint16Array,
): WebGLBuffer {
	const buffer = requireBuffer(gl);
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(location);
	gl.vertexAttribIPointer(location, 1, gl.UNSIGNED_SHORT, 0, 0);
	return buffer;
}

function requireBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
	const buffer = gl.createBuffer();
	if (!buffer) throw new Error("Failed to allocate geometry buffer.");
	return buffer;
}

function validateGeometry(geometry: RenderGeometryData): void {
	if (geometry.positions.length % 3 !== 0) {
		throw new Error(
			`${geometry.kind} positions are not three-component vectors.`,
		);
	}
	const vertexCount = geometry.positions.length / 3;
	if (geometry.kind !== "portal-aperture") {
		if (geometry.normals.length !== vertexCount * 3) {
			throw new Error(
				`${geometry.kind} normal count does not match positions.`,
			);
		}
		if (geometry.textureCoordinates.length !== vertexCount * 2) {
			throw new Error(`${geometry.kind} UV count does not match positions.`);
		}
		const slots =
			geometry.kind === "terrain"
				? geometry.featureSlots
				: geometry.materialSlots;
		if (slots.length !== vertexCount) {
			throw new Error(`${geometry.kind} slot count does not match positions.`);
		}
	}
}

function resolveTextureFormat(
	gl: WebGL2RenderingContext,
	format: TexturePixelFormat,
): { readonly internal: GLenum; readonly external: GLenum } {
	switch (format) {
		case TexturePixelFormat.RGBA8:
			return { external: gl.RGBA, internal: gl.RGBA8 };
		case TexturePixelFormat.RG8:
			return { external: gl.RG, internal: gl.RG8 };
		case TexturePixelFormat.R8:
		case TexturePixelFormat.A8:
			return { external: gl.RED, internal: gl.R8 };
	}
}
