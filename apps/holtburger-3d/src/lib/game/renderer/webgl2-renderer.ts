import type { FramePlan, Renderer } from "./renderer";

const CLEAR_COLOR = {
	red: 0.15,
	green: 0.05,
	blue: 0.05,
	alpha: 1,
} as const;

export class WebGL2Renderer implements Renderer {
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	#frameWidth = 0;
	#frameHeight = 0;

	public static async build(
		canvas: HTMLCanvasElement,
	): Promise<WebGL2Renderer> {
		return new WebGL2Renderer(canvas);
	}

	protected constructor(canvas: HTMLCanvasElement) {
		const gl = canvas.getContext("webgl2", {
			alpha: false,
			antialias: false,
			depth: true,
			stencil: false,
			premultipliedAlpha: false,
		});

		if (gl === null) {
			throw new Error("WebGL2 is not available in this browser.");
		}

		this.#canvas = canvas;
		this.#gl = gl;
		this.#gl.clearColor(
			CLEAR_COLOR.red,
			CLEAR_COLOR.green,
			CLEAR_COLOR.blue,
			CLEAR_COLOR.alpha,
		);
		this.#gl.enable(this.#gl.DEPTH_TEST);
	}

	drawFrame(plan: FramePlan): void {
		void plan;
		this.#resizeCanvasForDpr();
		this.#gl.clear(this.#gl.COLOR_BUFFER_BIT | this.#gl.DEPTH_BUFFER_BIT);
	}

	async destroy(): Promise<void> {
		const loseContext = this.#gl.getExtension("WEBGL_lose_context");
		loseContext?.loseContext();
	}

	#resizeCanvasForDpr(): void {
		const dpr = window.devicePixelRatio ?? 1;
		const width = Math.max(1, Math.floor(this.#canvas.clientWidth * dpr));
		const height = Math.max(1, Math.floor(this.#canvas.clientHeight * dpr));

		if (width === this.#frameWidth && height === this.#frameHeight) {
			return;
		}

		this.#frameWidth = width;
		this.#frameHeight = height;
		this.#canvas.width = width;
		this.#canvas.height = height;
		this.#gl.viewport(0, 0, width, height);
	}
}
