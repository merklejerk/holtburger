/** Native WebGL observations for the pre-game harness; production code does not collect them. */
export interface PreviewDeviceProbeSnapshot {
	/** Source edits must not request another context from the mounted canvas. */
	readonly contextRequests: number;
	/** Creation count verifies shader reuse; live count verifies final program retirement. */
	readonly programs: { readonly created: number; readonly live: number };
	/** Distinguish actual replacements, steady residency and the active-plus-staged ceiling. */
	readonly textures: {
		readonly created: number;
		readonly live: number;
		readonly peak: number;
	};
	/** Geometry/index allocations must all be retired when the surface closes. */
	readonly buffers: { readonly live: number };
	/** Vertex-array lifetime is independent of its backing buffer retirement. */
	readonly vertexArrays: { readonly live: number };
}

/** Instrument this diagnostic canvas before its first context request, retaining native behavior. */
export function observePreviewDevice(canvas: HTMLCanvasElement): {
	read(): PreviewDeviceProbeSnapshot;
	/** Numeric readback from the existing device, without requesting another context. */
	readPixels(): Uint8Array;
	/** Inject one allocation failure after a bounded number of successful staging uploads. */
	failTextureAllocationAfter(successfulAllocations: number): void;
} {
	const getContext = canvas.getContext.bind(canvas);
	let contextRequests = 0;
	let capturedContext: WebGL2RenderingContext | null = null;
	const programs = new Set<WebGLProgram>();
	const textures = new Set<WebGLTexture>();
	const buffers = new Set<WebGLBuffer>();
	const arrays = new Set<WebGLVertexArrayObject>();
	let createdPrograms = 0;
	let createdTextures = 0;
	let peakTextures = 0;
	let failAfterTextures: number | null = null;
	const observed = new WeakSet<WebGL2RenderingContext>();
	Object.defineProperty(canvas, "getContext", {
		configurable: true,
		value(contextId: string, options?: unknown): RenderingContext | null {
			const context = getContext(contextId, options);
			if (contextId !== "webgl2") return context;
			contextRequests++;
			if (!(context instanceof WebGL2RenderingContext) || observed.has(context))
				return context;
			capturedContext = context;
			observed.add(context);
			const createProgram = context.createProgram.bind(context);
			const deleteProgram = context.deleteProgram.bind(context);
			const createTexture = context.createTexture.bind(context);
			const deleteTexture = context.deleteTexture.bind(context);
			const createBuffer = context.createBuffer.bind(context);
			const deleteBuffer = context.deleteBuffer.bind(context);
			const createVertexArray = context.createVertexArray.bind(context);
			const deleteVertexArray = context.deleteVertexArray.bind(context);
			Object.defineProperties(context, {
				createProgram: {
					value: () => {
						const value = createProgram();
						if (value !== null) {
							programs.add(value);
							createdPrograms++;
						}
						return value;
					},
				},
				deleteProgram: {
					value: (value: WebGLProgram | null) => {
						if (value !== null) programs.delete(value);
						deleteProgram(value);
					},
				},
				createTexture: {
					value: () => {
						if (failAfterTextures === 0) {
							failAfterTextures = null;
							return null;
						}
						if (failAfterTextures !== null) failAfterTextures--;
						const value = createTexture();
						if (value !== null) {
							textures.add(value);
							createdTextures++;
							peakTextures = Math.max(peakTextures, textures.size);
						}
						return value;
					},
				},
				deleteTexture: {
					value: (value: WebGLTexture | null) => {
						if (value !== null) textures.delete(value);
						deleteTexture(value);
					},
				},
				createBuffer: {
					value: () => {
						const value = createBuffer();
						if (value !== null) buffers.add(value);
						return value;
					},
				},
				deleteBuffer: {
					value: (value: WebGLBuffer | null) => {
						if (value !== null) buffers.delete(value);
						deleteBuffer(value);
					},
				},
				createVertexArray: {
					value: () => {
						const value = createVertexArray();
						if (value !== null) arrays.add(value);
						return value;
					},
				},
				deleteVertexArray: {
					value: (value: WebGLVertexArrayObject | null) => {
						if (value !== null) arrays.delete(value);
						deleteVertexArray(value);
					},
				},
			});
			return context;
		},
	});
	return {
		failTextureAllocationAfter: (count) => {
			failAfterTextures = count;
		},
		readPixels: () => {
			const gl = capturedContext;
			if (gl === null)
				throw new Error("Device readback requires an existing WebGL2 context.");
			const framebuffer = gl.getParameter(
				gl.READ_FRAMEBUFFER_BINDING,
			) as WebGLFramebuffer | null;
			const buffer = gl.getParameter(gl.READ_BUFFER) as number;
			const pixels = new Uint8Array(
				gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
			);
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
			gl.readBuffer(gl.BACK);
			gl.readPixels(
				0,
				0,
				gl.drawingBufferWidth,
				gl.drawingBufferHeight,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				pixels,
			);
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
			gl.readBuffer(buffer);
			return pixels;
		},
		read: () => ({
			contextRequests,
			programs: { created: createdPrograms, live: programs.size },
			textures: {
				created: createdTextures,
				live: textures.size,
				peak: peakTextures,
			},
			buffers: { live: buffers.size },
			vertexArrays: { live: arrays.size },
		}),
	};
}
