import {
	createWebGL2ObjectProgram,
	type WebGL2FogInstancedObjectProgram,
	type WebGL2FogObjectProgram,
	type WebGL2InstancedObjectProgram,
	type WebGL2ObjectProgram,
} from "./webgl2-object-program";
import {
	createWebGL2NearTerrainProgram,
	type WebGL2NearTerrainProgram,
} from "./webgl2-terrain-program";

/** Lazy catalog of programs compiled only while outdoor PSSM has active receiver work. */
export class WebGL2OutdoorPssmReceiverPrograms {
	readonly #gl: WebGL2RenderingContext;
	#terrain: WebGL2NearTerrainProgram | null = null;
	#foggedBaked: WebGL2FogObjectProgram | null = null;
	#foggedInstanced: WebGL2FogInstancedObjectProgram | null = null;
	#blendedBaked: WebGL2ObjectProgram | null = null;
	#blendedInstanced: WebGL2InstancedObjectProgram | null = null;
	#portalBlendedBaked: WebGL2ObjectProgram | null = null;
	#portalBlendedInstanced: WebGL2InstancedObjectProgram | null = null;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	terrain(): WebGL2NearTerrainProgram {
		this.#assertAlive();
		return (this.#terrain ??= createWebGL2NearTerrainProgram(this.#gl, "pssm"));
	}

	foggedBaked(): WebGL2FogObjectProgram {
		this.#assertAlive();
		return (this.#foggedBaked ??= createWebGL2ObjectProgram(this.#gl, {
			distanceFog: true,
			outdoorPssm: true,
		}));
	}

	foggedInstanced(): WebGL2FogInstancedObjectProgram {
		this.#assertAlive();
		return (this.#foggedInstanced ??= createWebGL2ObjectProgram(this.#gl, {
			distanceFog: true,
			outdoorPssm: true,
			transformSource: "attribute",
		}));
	}

	blendedBaked(portalVisibility: boolean): WebGL2ObjectProgram {
		this.#assertAlive();
		if (portalVisibility) {
			return (this.#portalBlendedBaked ??= createWebGL2ObjectProgram(this.#gl, {
				distanceFog: false,
				outdoorPssm: true,
				portalVisibility: true,
			}));
		}
		return (this.#blendedBaked ??= createWebGL2ObjectProgram(this.#gl, {
			distanceFog: false,
			outdoorPssm: true,
		}));
	}

	blendedInstanced(portalVisibility: boolean): WebGL2InstancedObjectProgram {
		this.#assertAlive();
		if (portalVisibility) {
			return (this.#portalBlendedInstanced ??= createWebGL2ObjectProgram(
				this.#gl,
				{
					distanceFog: false,
					outdoorPssm: true,
					portalVisibility: true,
					transformSource: "attribute",
				},
			));
		}
		return (this.#blendedInstanced ??= createWebGL2ObjectProgram(this.#gl, {
			distanceFog: false,
			outdoorPssm: true,
			transformSource: "attribute",
		}));
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		const programs = [
			this.#terrain,
			this.#foggedBaked,
			this.#foggedInstanced,
			this.#blendedBaked,
			this.#blendedInstanced,
			this.#portalBlendedBaked,
			this.#portalBlendedInstanced,
		];
		for (const program of programs) {
			if (program) this.#gl.deleteProgram(program.program);
		}
		this.#terrain = null;
		this.#foggedBaked = null;
		this.#foggedInstanced = null;
		this.#blendedBaked = null;
		this.#blendedInstanced = null;
		this.#portalBlendedBaked = null;
		this.#portalBlendedInstanced = null;
	}

	#assertAlive(): void {
		if (this.#destroyed) {
			throw new Error("Outdoor PSSM receiver programs have been destroyed.");
		}
	}
}
