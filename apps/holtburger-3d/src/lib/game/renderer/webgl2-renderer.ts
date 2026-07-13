import type { FrameInput, Renderer } from "./renderer";

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
		gl: WebGL2RenderingContext,
	): Promise<WebGL2Renderer> {
		return new WebGL2Renderer(canvas, gl);
	}

	protected constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
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

	drawFrame(input: FrameInput): void {
		void input;
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
