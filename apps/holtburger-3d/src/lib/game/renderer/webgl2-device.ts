import { WebGL2Renderer } from "./webgl2-renderer";
import { RenderWorld } from "./render-world";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";
import {
	IntegerTexture2DFormat,
	type Texture2DResourceKey,
} from "./resource-manager";
import { TexturePixelFormat } from "../textures/types";

/** One transient RGBA preview copied from a live two-dimensional GPU texture. */
export interface Texture2DReadback {
	/** Original normalized texture format, used to display one- and two-channel pages faithfully. */
	readonly format: TexturePixelFormat;
	readonly height: number;
	/** Pixels are top-left-origin RGBA8 values suitable for Canvas ImageData. */
	readonly pixels: Uint8Array;
	readonly width: number;
}

/** One WebGL2 context composed with all backend services that consume it. */
export class WebGL2Device {
	readonly resources: WebGL2ResourceManager;
	/** Canvas whose context owns every backend resource allocated by this device. */
	readonly #canvas: HTMLCanvasElement;
	/** Context retained so this device, rather than one renderer, owns context loss. */
	readonly #gl: WebGL2RenderingContext;
	#destroyed = false;

	protected constructor(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
	) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.resources = resources;
	}

	static async build(canvas: HTMLCanvasElement): Promise<WebGL2Device> {
		const gl = canvas.getContext("webgl2", {
			alpha: false,
			antialias: false,
			depth: true,
			premultipliedAlpha: false,
			stencil: true,
		});
		if (!gl) throw new Error("WebGL2 is not available in this browser.");

		const resources = new WebGL2ResourceManager(gl);
		return new WebGL2Device(canvas, gl, resources);
	}

	/** Construct one renderer after the runtime exposes its read-only RenderWorld. */
	buildRenderer(world: RenderWorld): Promise<WebGL2Renderer> {
		if (this.#destroyed) throw new Error("WebGL2 device has been destroyed.");
		return WebGL2Renderer.build(this.#canvas, this.#gl, this.resources, world);
	}

	/**
	 * Copy a live two-dimensional texture only when an explicit diagnostic inspector requests it.
	 * This avoids retaining page-sized CPU copies during normal rendering.
	 */
	readTexture2D(key: Texture2DResourceKey): Texture2DReadback {
		if (this.#destroyed) throw new Error("WebGL2 device has been destroyed.");
		const resource = this.resources.getTexture2D(key);
		if (
			resource.format === IntegerTexture2DFormat.R32UI ||
			resource.format === IntegerTexture2DFormat.RGBA32UI
		) {
			throw new Error(
				`Texture ${key} uses an integer format and cannot be previewed.`,
			);
		}
		const framebuffer = this.#gl.createFramebuffer();
		if (!framebuffer)
			throw new Error("Failed to allocate texture readback framebuffer.");
		const previousFramebuffer = this.#gl.getParameter(
			this.#gl.FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null;
		try {
			this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, framebuffer);
			this.#gl.framebufferTexture2D(
				this.#gl.FRAMEBUFFER,
				this.#gl.COLOR_ATTACHMENT0,
				this.#gl.TEXTURE_2D,
				resource.texture,
				0,
			);
			if (
				this.#gl.checkFramebufferStatus(this.#gl.FRAMEBUFFER) !==
				this.#gl.FRAMEBUFFER_COMPLETE
			) {
				throw new Error(`Texture ${key} cannot be read through a framebuffer.`);
			}
			const pixels = new Uint8Array(resource.width * resource.height * 4);
			this.#gl.readPixels(
				0,
				0,
				resource.width,
				resource.height,
				this.#gl.RGBA,
				this.#gl.UNSIGNED_BYTE,
				pixels,
			);
			return {
				format: resource.format,
				height: resource.height,
				pixels: flipRgbaRows(pixels, resource.width, resource.height),
				width: resource.width,
			};
		} finally {
			this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, previousFramebuffer);
			this.#gl.deleteFramebuffer(framebuffer);
		}
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		await this.resources.destroy();
		this.#gl.getExtension("WEBGL_lose_context")?.loseContext();
	}
}

function flipRgbaRows(
	pixels: Uint8Array,
	width: number,
	height: number,
): Uint8Array {
	const rowBytes = width * 4;
	const flipped = new Uint8Array(pixels.length);
	for (let row = 0; row < height; row += 1) {
		const source = row * rowBytes;
		const target = (height - row - 1) * rowBytes;
		flipped.set(pixels.subarray(source, source + rowBytes), target);
	}
	return flipped;
}
