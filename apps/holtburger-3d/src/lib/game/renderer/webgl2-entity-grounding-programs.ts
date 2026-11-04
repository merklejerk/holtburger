import {
	createWebGL2ObjectProgram,
	type WebGL2FogObjectProgram,
	type WebGL2ObjectProgram,
} from "./webgl2-object-program";
/** Lazy radial-grounding receiver programs for EnvCell-shell submissions. */
export class WebGL2EntityGroundingPrograms {
	readonly #gl: WebGL2RenderingContext;
	#fogged: WebGL2FogObjectProgram | null = null;
	#blended: WebGL2ObjectProgram | null = null;
	#portalBlended: WebGL2ObjectProgram | null = null;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	fogged(): WebGL2FogObjectProgram {
		this.#assertAlive();
		return (this.#fogged ??= createWebGL2ObjectProgram(this.#gl, {
			distanceFog: true,
			groundingMode: "env-cell-shell",
		}));
	}

	blended(portalVisibility: boolean): WebGL2ObjectProgram {
		this.#assertAlive();
		if (portalVisibility) {
			return (this.#portalBlended ??= createWebGL2ObjectProgram(this.#gl, {
				distanceFog: false,
				groundingMode: "env-cell-shell",
				portalVisibility: true,
			}));
		}
		return (this.#blended ??= createWebGL2ObjectProgram(this.#gl, {
			distanceFog: false,
			groundingMode: "env-cell-shell",
		}));
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const program of [this.#fogged, this.#blended, this.#portalBlended]) {
			if (program) this.#gl.deleteProgram(program.program);
		}
		this.#fogged = null;
		this.#blended = null;
		this.#portalBlended = null;
	}

	#assertAlive(): void {
		if (this.#destroyed) {
			throw new Error("Entity grounding programs have been destroyed.");
		}
	}
}
