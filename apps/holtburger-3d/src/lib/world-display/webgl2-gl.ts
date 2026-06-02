type Webgl2ShaderStage = "vertex" | "fragment";

export interface Webgl2ProgramResource<
	TAttributeName extends string = string,
	TUniformName extends string = string,
> {
	readonly program: WebGLProgram;
	readonly attributes: Readonly<Record<TAttributeName, number>>;
	readonly uniforms: Readonly<Record<TUniformName, WebGLUniformLocation>>;
	dispose(): void;
}

export interface Webgl2BufferResource {
	readonly buffer: WebGLBuffer;
	dispose(): void;
}

export type Webgl2BufferUploadData =
	| BufferSource
	| ArrayBufferLike
	| ArrayBufferView<ArrayBufferLike>
	| null;

export interface Webgl2VertexArrayResource {
	readonly vertexArray: WebGLVertexArrayObject;
	dispose(): void;
}

export interface Webgl2Texture2DResource {
	readonly texture: WebGLTexture;
	readonly width: number;
	readonly height: number;
	dispose(): void;
}

export interface Webgl2Texture2DUpload {
	width: number;
	height: number;
	internalFormat: GLenum;
	format: GLenum;
	type: GLenum;
	data: TexImageSource | ArrayBufferView | null;
	generateMipmaps?: boolean;
}

export interface Webgl2SamplerParameters {
	wrapS?: GLenum;
	wrapT?: GLenum;
	minFilter?: GLenum;
	magFilter?: GLenum;
	maxAnisotropy?: number;
}

export function createWebgl2Program<
	TAttributeName extends string,
	TUniformName extends string,
>(
	gl: WebGL2RenderingContext,
	input: {
		label: string;
		vertexSource: string;
		fragmentSource: string;
		attributes?: readonly TAttributeName[];
		uniforms?: readonly TUniformName[];
	},
): Webgl2ProgramResource<TAttributeName, TUniformName> {
	const vertexShader = compileWebgl2Shader(gl, {
		label: `${input.label} vertex shader`,
		stage: "vertex",
		source: input.vertexSource,
	});
	const fragmentShader = compileWebgl2Shader(gl, {
		label: `${input.label} fragment shader`,
		stage: "fragment",
		source: input.fragmentSource,
	});

	const program = gl.createProgram();
	if (!program) {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
		throw new Error(`Failed to create WebGL2 program ${input.label}.`);
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown program error";
		gl.deleteProgram(program);
		throw new Error(`Failed to link WebGL2 program ${input.label}: ${message}`);
	}

	return {
		program,
		attributes: lookupAttributeLocations(
			gl,
			program,
			input.attributes ?? [],
			input.label,
		),
		uniforms: lookupUniformLocations(
			gl,
			program,
			input.uniforms ?? [],
			input.label,
		),
		dispose() {
			gl.deleteProgram(program);
		},
	};
}

export function createWebgl2ArrayBuffer(
	gl: WebGL2RenderingContext,
	input: {
		label: string;
		data: Webgl2BufferUploadData;
		usage?: GLenum;
	},
): Webgl2BufferResource {
	return createWebgl2Buffer(gl, {
		label: input.label,
		target: gl.ARRAY_BUFFER,
		data: input.data,
		usage: input.usage ?? gl.STATIC_DRAW,
	});
}

export function createWebgl2ElementArrayBuffer(
	gl: WebGL2RenderingContext,
	input: {
		label: string;
		data: Webgl2BufferUploadData;
		usage?: GLenum;
	},
): Webgl2BufferResource {
	return createWebgl2Buffer(gl, {
		label: input.label,
		target: gl.ELEMENT_ARRAY_BUFFER,
		data: input.data,
		usage: input.usage ?? gl.STATIC_DRAW,
	});
}

export function createWebgl2VertexArray(
	gl: WebGL2RenderingContext,
	input: {
		label: string;
		configure(vertexArray: WebGLVertexArrayObject): void;
	},
): Webgl2VertexArrayResource {
	const vertexArray = gl.createVertexArray();
	if (!vertexArray) {
		throw new Error(`Failed to create WebGL2 vertex array ${input.label}.`);
	}
	gl.bindVertexArray(vertexArray);
	try {
		input.configure(vertexArray);
	} finally {
		gl.bindVertexArray(null);
	}
	return {
		vertexArray,
		dispose() {
			gl.deleteVertexArray(vertexArray);
		},
	};
}

export function createWebgl2Texture2D(
	gl: WebGL2RenderingContext,
	input: {
		label: string;
		upload: Webgl2Texture2DUpload;
		sampler?: Webgl2SamplerParameters;
	},
): Webgl2Texture2DResource {
	const texture = gl.createTexture();
	if (!texture) {
		throw new Error(`Failed to create WebGL2 texture ${input.label}.`);
	}

	gl.bindTexture(gl.TEXTURE_2D, texture);
	try {
		uploadWebgl2Texture2D(gl, input.upload);
		applyWebgl2SamplerParameters(gl, input.sampler ?? {});
	} finally {
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	return {
		texture,
		width: input.upload.width,
		height: input.upload.height,
		dispose() {
			gl.deleteTexture(texture);
		},
	};
}

function applyWebgl2SamplerParameters(
	gl: WebGL2RenderingContext,
	parameters: Webgl2SamplerParameters,
): void {
	if (parameters.wrapS !== undefined) {
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, parameters.wrapS);
	}
	if (parameters.wrapT !== undefined) {
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, parameters.wrapT);
	}
	if (parameters.minFilter !== undefined) {
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, parameters.minFilter);
	}
	if (parameters.magFilter !== undefined) {
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, parameters.magFilter);
	}
	if (parameters.maxAnisotropy !== undefined) {
		const extension =
			gl.getExtension("EXT_texture_filter_anisotropic") ??
			gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic") ??
			gl.getExtension("MOZ_EXT_texture_filter_anisotropic");
		if (extension) {
			gl.texParameterf(
				gl.TEXTURE_2D,
				extension.TEXTURE_MAX_ANISOTROPY_EXT,
				parameters.maxAnisotropy,
			);
		}
	}
}

function compileWebgl2Shader(
	gl: WebGL2RenderingContext,
	input: {
		label: string;
		stage: Webgl2ShaderStage;
		source: string;
	},
): WebGLShader {
	const shaderType =
		input.stage === "vertex" ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER;
	const shader = gl.createShader(shaderType);
	if (!shader) {
		throw new Error(`Failed to create WebGL2 ${input.stage} shader.`);
	}
	gl.shaderSource(shader, input.source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader) ?? "unknown shader error";
		gl.deleteShader(shader);
		throw new Error(`Failed to compile ${input.label}: ${message}`);
	}
	return shader;
}

function createWebgl2Buffer(
	gl: WebGL2RenderingContext,
	input: {
		label: string;
		target: GLenum;
		data: Webgl2BufferUploadData;
		usage: GLenum;
	},
): Webgl2BufferResource {
	const buffer = gl.createBuffer();
	if (!buffer) {
		throw new Error(`Failed to create WebGL2 buffer ${input.label}.`);
	}
	gl.bindBuffer(input.target, buffer);
	gl.bufferData(input.target, normalizeWebgl2BufferUploadData(input.data), input.usage);
	gl.bindBuffer(input.target, null);
	return {
		buffer,
		dispose() {
			gl.deleteBuffer(buffer);
		},
	};
}

function normalizeWebgl2BufferUploadData(
	data: Webgl2BufferUploadData,
): BufferSource | null {
	if (!data) {
		return null;
	}
	if (data instanceof ArrayBuffer) {
		return data;
	}
	if (
		typeof SharedArrayBuffer !== "undefined" &&
		data instanceof SharedArrayBuffer
	) {
		return new Uint8Array(data).slice().buffer;
	}
	if (ArrayBuffer.isView(data)) {
		if (data.buffer instanceof ArrayBuffer) {
			return data as ArrayBufferView<ArrayBuffer>;
		}
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
			.buffer;
	}
	return new Uint8Array(data).slice().buffer;
}

function uploadWebgl2Texture2D(
	gl: WebGL2RenderingContext,
	upload: Webgl2Texture2DUpload,
): void {
	if (isTexImageSource(upload.data)) {
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			upload.internalFormat,
			upload.format,
			upload.type,
			upload.data,
		);
	} else {
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			upload.internalFormat,
			upload.width,
			upload.height,
			0,
			upload.format,
			upload.type,
			upload.data,
		);
	}
	if (upload.generateMipmaps) {
		gl.generateMipmap(gl.TEXTURE_2D);
	}
}

function lookupAttributeLocations<TName extends string>(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	names: readonly TName[],
	programLabel: string,
): Record<TName, number> {
	const locations = {} as Record<TName, number>;
	for (const name of names) {
		const location = gl.getAttribLocation(program, name);
		if (location < 0) {
			throw new Error(
				`WebGL2 program ${programLabel} is missing attribute ${name}.`,
			);
		}
		locations[name] = location;
	}
	return locations;
}

function lookupUniformLocations<TName extends string>(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	names: readonly TName[],
	programLabel: string,
): Record<TName, WebGLUniformLocation> {
	const locations = {} as Record<TName, WebGLUniformLocation>;
	for (const name of names) {
		const location = gl.getUniformLocation(program, name);
		if (!location) {
			throw new Error(`WebGL2 program ${programLabel} is missing uniform ${name}.`);
		}
		locations[name] = location;
	}
	return locations;
}

function isTexImageSource(value: unknown): value is TexImageSource {
	return (
		typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap
	) || (
		typeof ImageData !== "undefined" && value instanceof ImageData
	) || (
		typeof HTMLImageElement !== "undefined" &&
		value instanceof HTMLImageElement
	) || (
		typeof HTMLCanvasElement !== "undefined" &&
		value instanceof HTMLCanvasElement
	) || (
		typeof HTMLVideoElement !== "undefined" &&
		value instanceof HTMLVideoElement
	) || (
		typeof OffscreenCanvas !== "undefined" &&
		value instanceof OffscreenCanvas
	);
}
