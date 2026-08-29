import {
	createWebGL2ObjectProgram,
	type WebGL2FogObjectProgram,
	type WebGL2ObjectProgram,
} from "./webgl2-object-program";
import {
	createWebGL2NearTerrainProgram,
	type WebGL2NearTerrainProgram,
} from "./webgl2-terrain-program";

/** Lazy analytic-grounding receiver programs for terrain and EnvCell-shell submissions. */
export class WebGL2EntityGroundingPrograms {
	readonly #gl: WebGL2RenderingContext;
	#terrain: WebGL2NearTerrainProgram | null = null;
	#fogged: WebGL2FogObjectProgram | null = null;
	#blended: WebGL2ObjectProgram | null = null;
	#portalBlended: WebGL2ObjectProgram | null = null;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	terrain(): WebGL2NearTerrainProgram {
		this.#assertAlive();
		return (this.#terrain ??= createWebGL2NearTerrainProgram(
			this.#gl,
			"grounding",
		));
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
		if (this.#terrain) this.#gl.deleteProgram(this.#terrain.program);
		this.#terrain = null;
	}

	#assertAlive(): void {
		if (this.#destroyed) {
			throw new Error("Entity grounding programs have been destroyed.");
		}
	}
}
