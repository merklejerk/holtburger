import { WebGL2Renderer } from "./webgl2-renderer";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";

/** One WebGL2 context composed with all backend services that consume it. */
export class WebGL2Device {
	readonly renderer: WebGL2Renderer;
	readonly resources: WebGL2ResourceManager;
	#destroyed = false;

	protected constructor(
		renderer: WebGL2Renderer,
		resources: WebGL2ResourceManager,
	) {
		this.renderer = renderer;
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
		const renderer = await WebGL2Renderer.build(canvas, gl);
		return new WebGL2Device(renderer, resources);
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		await this.resources.destroy();
		await this.renderer.destroy();
	}
}
