import {
	IntegerTexture2DFormat,
	type GeometryResourceKey,
	type RendererResourceManager,
	type RenderResourceKey,
	type TextureArrayDescription,
	type TextureArrayLayerUpload,
	type TextureArrayResourceKey,
	type Texture2DFormat,
	type Texture2DResourceKey,
	type Texture2DRegionUpload,
	type Texture2DUpload,
} from "./resource-manager";
import { TexturePixelFormat } from "../textures/types";
import type { RenderGeometryData } from "./geometry";
import { OBJECT_BAKED_LIGHT_ATTRIBUTE } from "./webgl2-object-program";
import { TERRAIN_COLOR_CODE_ATTRIBUTE } from "./webgl2-terrain-program";

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

/** WebGL binding retained for one two-dimensional texture resource. */
export interface WebGL2Texture2DBinding {
	/** Physical scalar/channel format used to convert readbacks for inspection. */
	readonly format: Texture2DFormat;
	readonly height: number;
	/** Accessible allocated mip range used by draw-time sampler selection. */
	readonly mipLevels: number;
	readonly texture: WebGLTexture;
	readonly width: number;
}

/** WebGL texture-array binding and immutable storage facts. */
export interface WebGL2TextureArrayBinding {
	readonly texture: WebGLTexture;
	readonly description: TextureArrayDescription;
}

/** WebGL2 resource owner sharing the renderer's graphics context. */
export class WebGL2ResourceManager implements RendererResourceManager {
	readonly #gl: WebGL2RenderingContext;
	readonly #geometry = new Map<GeometryResourceKey, WebGL2GeometryResource>();
	readonly #textures = new Map<Texture2DResourceKey, WebGL2Texture2DBinding>();
	readonly #textureArrays = new Map<
		TextureArrayResourceKey,
		WebGL2TextureArrayBinding
	>();
	#nextGeometryId = 0;
	#nextTextureId = 0;
	#nextTextureArrayId = 0;

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

	createTexture2D(upload: Texture2DUpload): Texture2DResourceKey {
		const key: Texture2DResourceKey = `texture-2d-resource:${this.#nextTextureId++}`;
		this.#textures.set(key, this.#uploadTexture(upload));
		return key;
	}

	replaceTexture2D(key: Texture2DResourceKey, upload: Texture2DUpload): void {
		const previous = this.#textures.get(key);
		if (!previous) throw new Error(`Texture resource ${key} does not exist.`);
		const replacement = this.#uploadTexture(upload);
		this.#textures.set(key, replacement);
		this.#gl.deleteTexture(previous.texture);
	}

	updateTexture2DRegions(
		key: Texture2DResourceKey,
		regions: readonly Texture2DRegionUpload[],
	): void {
		const resource = this.getTexture2D(key);
		const gl = this.#gl;
		const format = resolveTextureFormat(gl, resource.format);
		for (const region of regions) {
			validateTexture2DRegionUpload(region, resource, format);
		}
		try {
			gl.bindTexture(gl.TEXTURE_2D, resource.texture);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			for (const region of regions) {
				gl.texSubImage2D(
					gl.TEXTURE_2D,
					0,
					region.x,
					region.y,
					region.width,
					region.height,
					format.external,
					format.dataType,
					region.data,
				);
			}
			// Level zero now matches a full rebuild of this texture, so one regeneration produces
			// the same chain a replacement upload would have.
			if (resource.mipLevels > 1) gl.generateMipmap(gl.TEXTURE_2D);
		} finally {
			gl.bindTexture(gl.TEXTURE_2D, null);
		}
	}

	getTexture2D(key: Texture2DResourceKey): WebGL2Texture2DBinding {
		const resource = this.#textures.get(key);
		if (!resource) throw new Error(`Texture resource ${key} does not exist.`);
		return resource;
	}

	createTextureArray(
		description: TextureArrayDescription,
	): TextureArrayResourceKey {
		const key: TextureArrayResourceKey = `texture-array-resource:${this.#nextTextureArrayId++}`;
		this.#textureArrays.set(key, this.#allocateTextureArray(description));
		return key;
	}

	uploadTextureArrayLayer(
		key: TextureArrayResourceKey,
		upload: TextureArrayLayerUpload,
	): void {
		const resource = this.getTextureArray(key);
		const { description } = resource;
		if (
			!Number.isInteger(upload.layer) ||
			upload.layer < 0 ||
			upload.layer >= description.layerCapacity
		) {
			throw new Error(
				`Texture array layer ${upload.layer} is outside ${key} capacity ${description.layerCapacity}.`,
			);
		}
		const format = resolveTextureFormat(this.#gl, description.format);
		const expectedBytes =
			description.width * description.height * format.bytesPerPixel;
		if (upload.data.byteLength !== expectedBytes) {
			throw new Error(
				`Texture array layer ${upload.layer} contains ${upload.data.byteLength} bytes; expected ${expectedBytes}.`,
			);
		}

		const gl = this.#gl;
		try {
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, resource.texture);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			gl.texSubImage3D(
				gl.TEXTURE_2D_ARRAY,
				0,
				0,
				0,
				upload.layer,
				description.width,
				description.height,
				1,
				format.external,
				gl.UNSIGNED_BYTE,
				upload.data,
			);
		} finally {
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
		}
	}

	generateTextureArrayMipmaps(key: TextureArrayResourceKey): void {
		const resource = this.getTextureArray(key);
		if (resource.description.mipLevels === 1) return;
		const gl = this.#gl;
		try {
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, resource.texture);
			gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
		} finally {
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
		}
	}

	getTextureArray(key: TextureArrayResourceKey): WebGL2TextureArrayBinding {
		const resource = this.#textureArrays.get(key);
		if (!resource) {
			throw new Error(`Texture array resource ${key} does not exist.`);
		}
		return resource;
	}

	releaseResource(key: RenderResourceKey): boolean {
		if (isGeometryResourceKey(key)) {
			const resource = this.#geometry.get(key);
			if (!resource) return false;
			this.#geometry.delete(key);
			this.#destroyGeometry(resource);
			return true;
		}
		if (isTextureArrayResourceKey(key)) {
			const resource = this.#textureArrays.get(key);
			if (!resource) return false;
			this.#textureArrays.delete(key);
			this.#gl.deleteTexture(resource.texture);
			return true;
		}
		const textureKey = key as Texture2DResourceKey;
		const resource = this.#textures.get(textureKey);
		if (!resource) return false;
		this.#textures.delete(textureKey);
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
		for (const resource of this.#textureArrays.values()) {
			this.#gl.deleteTexture(resource.texture);
		}
		this.#geometry.clear();
		this.#textures.clear();
		this.#textureArrays.clear();
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
			}
			if (geometry.kind === "terrain") {
				buffers.push(
					uploadIntegerAttribute(
						gl,
						TERRAIN_COLOR_CODE_ATTRIBUTE,
						1,
						geometry.terrainColorCodes,
					),
				);
			}
			if (geometry.kind === "object" && geometry.bakedLight) {
				buffers.push(
					uploadFloatAttribute(
						gl,
						OBJECT_BAKED_LIGHT_ATTRIBUTE,
						3,
						geometry.bakedLight,
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

	#uploadTexture(upload: Texture2DUpload): WebGL2Texture2DBinding {
		validateTexture2DUpload(this.#gl, upload);
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
				format.dataType,
				upload.data,
			);
			// Texture-owned accessibility must agree with the promised binding before generation.
			gl.texParameteri(
				gl.TEXTURE_2D,
				gl.TEXTURE_MAX_LEVEL,
				upload.mipLevels - 1,
			);
			if (upload.mipLevels > 1) gl.generateMipmap(gl.TEXTURE_2D);
			if (format.integer) configureIntegerTexture(gl);
			else configureNormalizedTexture(gl, gl.TEXTURE_2D, upload.mipLevels);
			return {
				format: upload.format,
				height: upload.height,
				mipLevels: upload.mipLevels,
				texture,
				width: upload.width,
			};
		} catch (error) {
			gl.deleteTexture(texture);
			throw error;
		} finally {
			gl.bindTexture(gl.TEXTURE_2D, null);
		}
	}

	#allocateTextureArray(
		description: TextureArrayDescription,
	): WebGL2TextureArrayBinding {
		validateTextureArrayDescription(this.#gl, description);
		const gl = this.#gl;
		const texture = gl.createTexture();
		if (!texture) throw new Error("Failed to allocate texture array resource.");
		try {
			const format = resolveTextureFormat(gl, description.format);
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
			gl.texStorage3D(
				gl.TEXTURE_2D_ARRAY,
				description.mipLevels,
				format.internal,
				description.width,
				description.height,
				description.layerCapacity,
			);
			configureNormalizedTexture(
				gl,
				gl.TEXTURE_2D_ARRAY,
				description.mipLevels,
			);
			return { description, texture };
		} catch (error) {
			gl.deleteTexture(texture);
			throw error;
		} finally {
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
		}
	}

	#destroyGeometry(resource: WebGL2GeometryResource): void {
		for (const buffer of resource.buffers) this.#gl.deleteBuffer(buffer);
		this.#gl.deleteVertexArray(resource.vertexArray);
	}
}

function validateTexture2DRegionUpload(
	region: Texture2DRegionUpload,
	resource: WebGL2Texture2DBinding,
	format: WebGL2TextureFormat,
): void {
	if (
		!Number.isInteger(region.x) ||
		!Number.isInteger(region.y) ||
		!Number.isInteger(region.width) ||
		!Number.isInteger(region.height) ||
		region.width <= 0 ||
		region.height <= 0
	) {
		throw new Error("Texture region dimensions must be positive integers.");
	}
	if (
		region.x < 0 ||
		region.y < 0 ||
		region.x + region.width > resource.width ||
		region.y + region.height > resource.height
	) {
		throw new Error("Texture region exceeds its texture bounds.");
	}
	validateTexelPayload(
		region.data,
		format,
		region.width * region.height,
		"Texture region",
	);
}

/** Prove one payload's scalar type and length match the texel count its format implies. */
function validateTexelPayload(
	data: Uint8Array | Uint32Array,
	format: WebGL2TextureFormat,
	texelCount: number,
	subject: string,
): void {
	if (
		format.integer
			? !(data instanceof Uint32Array)
			: !(data instanceof Uint8Array)
	) {
		throw new Error(
			format.integer
				? `${subject} requires Uint32Array data for an integer texture.`
				: `${subject} requires Uint8Array data for a normalized texture.`,
		);
	}
	const expectedBytes = texelCount * format.bytesPerPixel;
	if (data.byteLength !== expectedBytes) {
		throw new Error(
			`${subject} contains ${data.byteLength} bytes; expected ${expectedBytes}.`,
		);
	}
}

function validateTexture2DUpload(
	gl: WebGL2RenderingContext,
	upload: Texture2DUpload,
): void {
	if (
		!Number.isInteger(upload.width) ||
		!Number.isInteger(upload.height) ||
		upload.width <= 0 ||
		upload.height <= 0
	) {
		throw new Error("Texture dimensions must be positive.");
	}
	const maximumMipLevels =
		Math.floor(Math.log2(Math.max(upload.width, upload.height))) + 1;
	if (
		!Number.isInteger(upload.mipLevels) ||
		upload.mipLevels <= 0 ||
		upload.mipLevels > maximumMipLevels
	) {
		throw new Error(
			`Texture mip level count must be between 1 and ${maximumMipLevels}.`,
		);
	}
	const format = resolveTextureFormat(gl, upload.format);
	validateTexelPayload(
		upload.data,
		format,
		upload.width * upload.height,
		"Texture",
	);
}

function isGeometryResourceKey(
	key: RenderResourceKey,
): key is GeometryResourceKey {
	return key.startsWith("geometry-resource:");
}

function isTextureArrayResourceKey(
	key: RenderResourceKey,
): key is TextureArrayResourceKey {
	return key.startsWith("texture-array-resource:");
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

function uploadIntegerAttribute(
	gl: WebGL2RenderingContext,
	location: number,
	components: number,
	data: Uint8Array,
): WebGLBuffer {
	const buffer = requireBuffer(gl);
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(location);
	gl.vertexAttribIPointer(location, components, gl.UNSIGNED_BYTE, 0, 0);
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
	}
	if (
		geometry.kind === "terrain" &&
		geometry.terrainColorCodes.length !== vertexCount
	) {
		throw new Error("Terrain color-code count does not match positions.");
	}
}

/** Physical GL enums and scalar shape for one logical texture format. */
interface WebGL2TextureFormat {
	readonly internal: GLenum;
	readonly external: GLenum;
	readonly bytesPerPixel: number;
	readonly dataType: GLenum;
	readonly integer: boolean;
}

function resolveTextureFormat(
	gl: WebGL2RenderingContext,
	format: Texture2DFormat,
): WebGL2TextureFormat {
	switch (format) {
		case TexturePixelFormat.RGBA8:
			return {
				bytesPerPixel: 4,
				dataType: gl.UNSIGNED_BYTE,
				external: gl.RGBA,
				integer: false,
				internal: gl.RGBA8,
			};
		case TexturePixelFormat.RG8:
			return {
				bytesPerPixel: 2,
				dataType: gl.UNSIGNED_BYTE,
				external: gl.RG,
				integer: false,
				internal: gl.RG8,
			};
		case TexturePixelFormat.R8:
		case TexturePixelFormat.A8:
			return {
				bytesPerPixel: 1,
				dataType: gl.UNSIGNED_BYTE,
				external: gl.RED,
				integer: false,
				internal: gl.R8,
			};
		case IntegerTexture2DFormat.R32UI:
			return {
				bytesPerPixel: 4,
				dataType: gl.UNSIGNED_INT,
				external: gl.RED_INTEGER,
				integer: true,
				internal: gl.R32UI,
			};
		case IntegerTexture2DFormat.RGBA32UI:
			return {
				bytesPerPixel: 16,
				dataType: gl.UNSIGNED_INT,
				external: gl.RGBA_INTEGER,
				integer: true,
				internal: gl.RGBA32UI,
			};
	}
}

function configureIntegerTexture(gl: WebGL2RenderingContext): void {
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/** Configure a complete normalized texture so one-level mask arrays remain sampleable. */
function configureNormalizedTexture(
	gl: WebGL2RenderingContext,
	target: GLenum,
	mipLevels: number,
): void {
	gl.texParameteri(
		target,
		gl.TEXTURE_MIN_FILTER,
		mipLevels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
	);
	gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.REPEAT);
}

function validateTextureArrayDescription(
	gl: WebGL2RenderingContext,
	description: TextureArrayDescription,
): void {
	if (
		!Number.isInteger(description.width) ||
		!Number.isInteger(description.height) ||
		description.width <= 0 ||
		description.height <= 0
	) {
		throw new Error("Texture array dimensions must be positive.");
	}
	if (
		!Number.isInteger(description.layerCapacity) ||
		description.layerCapacity <= 0
	) {
		throw new Error("Texture array layer capacity must be positive.");
	}
	const maximumTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
	if (
		description.width > maximumTextureSize ||
		description.height > maximumTextureSize
	) {
		throw new Error(
			`Texture array dimensions exceed device limit ${maximumTextureSize}.`,
		);
	}
	const maximumLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
	if (description.layerCapacity > maximumLayers) {
		throw new Error(
			`Texture array capacity exceeds device limit ${maximumLayers}.`,
		);
	}
	const maximumMipLevels =
		Math.floor(Math.log2(Math.max(description.width, description.height))) + 1;
	if (
		!Number.isInteger(description.mipLevels) ||
		description.mipLevels <= 0 ||
		description.mipLevels > maximumMipLevels
	) {
		throw new Error(
			`Texture array mip level count must be between 1 and ${maximumMipLevels}.`,
		);
	}
}
