import { WebGL2Renderer } from "./webgl2-renderer";
import { RenderWorld } from "./render-world";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";

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

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		await this.resources.destroy();
		this.#gl.getExtension("WEBGL_lose_context")?.loseContext();
	}
}
