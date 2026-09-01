import type { LandblockOwnerId } from "../game-types";
import type { SceneLightingRole } from "../environment/scene-lighting";
import type {
	ObjectBlendPolicy,
	PreparedObjectTextureBinding,
} from "./object-rendering-policy";

const UNKNOWN_STATE = Symbol("unknown-device-state");
type UnknownState = typeof UNKNOWN_STATE;

/** Components in the mat4 uniforms this applicator compares. */
const MAT4_COMPONENTS = 16;

/** Components in the widest scalar/vector uniform assembled in the reusable scratch buffer. */
const UNIFORM_SCRATCH_COMPONENTS = 4;

/**
 * Applies WebGL state owned by one explicitly bounded renderer phase.
 *
 * Terrain and portal execution are independent state owners, so callers must invalidate before
 * entering each object phase instead of assuming this cache observed their mutations.
 */
export class WebGL2DeviceStateApplicator {
	readonly #gl: WebGL2RenderingContext;
	#activeTextureUnit: number | UnknownState = UNKNOWN_STATE;
	#blendEnabled: boolean | UnknownState = UNKNOWN_STATE;
	#blendPolicy: ObjectBlendPolicy | UnknownState = UNKNOWN_STATE;
	#cullFace: "back" | "front" | UnknownState = UNKNOWN_STATE;
	#lightingRole: SceneLightingRole | UnknownState = UNKNOWN_STATE;
	#staticLightScope: LandblockOwnerId | null | UnknownState = UNKNOWN_STATE;
	#program: WebGLProgram | UnknownState = UNKNOWN_STATE;
	readonly #texture2DUnits = new Map<number, WebGLTexture>();
	/** Samplers are physical per unit and therefore shared by the 2D and array binding paths. */
	readonly #samplerUnits = new Map<number, WebGLSampler | null>();
	/** Array textures are independent bindings but share the context's active-unit selector. */
	readonly #textureArrayUnits = new Map<number, WebGLTexture>();
	#vertexArray: WebGLVertexArrayObject | UnknownState = UNKNOWN_STATE;
	/**
	 * Last applied components per uniform location, for redundancy filtering.
	 *
	 * Keyed by location rather than by program because locations are already per-program objects,
	 * and GL retains uniform state per program across program switches. Values are float64 so a
	 * stored component compares equal to the float64 the caller passed; float32 storage would round
	 * on write and report every upload as a change.
	 */
	readonly #uniformComponents = new Map<WebGLUniformLocation, Float64Array>();
	/** Reused so per-draw comparison of scalar and vector uniforms allocates nothing. */
	readonly #uniformScratch = new Float64Array(UNIFORM_SCRATCH_COMPONENTS);

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	/**
	 * Forget shared device bindings after another owner may have touched the context.
	 *
	 * Uniform values remain cached because WebGL stores them on their program and every cached
	 * location has one writer; callers must not route a second writer around this applicator.
	 */
	invalidate(): void {
		this.#activeTextureUnit = UNKNOWN_STATE;
		this.#blendEnabled = UNKNOWN_STATE;
		this.#blendPolicy = UNKNOWN_STATE;
		this.#cullFace = UNKNOWN_STATE;
		this.#lightingRole = UNKNOWN_STATE;
		this.#staticLightScope = UNKNOWN_STATE;
		this.#program = UNKNOWN_STATE;
		this.#texture2DUnits.clear();
		this.#samplerUnits.clear();
		this.#textureArrayUnits.clear();
		this.#vertexArray = UNKNOWN_STATE;
	}

	/** Apply one linked program and report whether pass uniforms must be refreshed. */
	applyProgram(program: WebGLProgram): boolean {
		if (this.#program === program) return false;
		this.#gl.useProgram(program);
		this.#program = program;
		// Uniform state belongs to the program object, so a switch always re-binds lighting.
		this.#lightingRole = UNKNOWN_STATE;
		this.#staticLightScope = UNKNOWN_STATE;
		return true;
	}

	/** Report whether this draw's lighting role still needs its uniforms bound. */
	applyLightingRole(role: SceneLightingRole): boolean {
		if (this.#lightingRole === role) return false;
		this.#lightingRole = role;
		return true;
	}

	/**
	 * Report whether this draw needs its static light array rebound.
	 *
	 * Keyed by landblock rather than by role, because two draws sharing a role can sit in
	 * different landblocks and therefore need different sets.
	 */
	applyStaticLightScope(landblockId: LandblockOwnerId | null): boolean {
		if (this.#staticLightScope === landblockId) return false;
		this.#staticLightScope = landblockId;
		return true;
	}

	/** Object draws always enable culling; only the rejected face varies within a phase. */
	applyCullFace(cullFace: "back" | "front"): void {
		if (this.#cullFace === UNKNOWN_STATE) this.#gl.enable(this.#gl.CULL_FACE);
		if (this.#cullFace !== cullFace) {
			this.#gl.cullFace(cullFace === "front" ? this.#gl.FRONT : this.#gl.BACK);
			this.#cullFace = cullFace;
		}
	}

	/** Null selects the opaque blend-disabled phase; a policy selects blended submission. */
	applyBlend(policy: ObjectBlendPolicy | null): void {
		const enabled = policy !== null;
		if (this.#blendEnabled !== enabled) {
			if (enabled) this.#gl.enable(this.#gl.BLEND);
			else this.#gl.disable(this.#gl.BLEND);
			this.#blendEnabled = enabled;
		}
		if (policy === null) return;
		if (
			this.#blendPolicy !== UNKNOWN_STATE &&
			blendPolicyEquals(this.#blendPolicy, policy)
		) {
			return;
		}
		this.#gl.blendFunc(
			blendFactor(this.#gl, policy.source),
			blendFactor(this.#gl, policy.destination),
		);
		this.#blendPolicy = policy;
	}

	/** Apply one complete physical texture-unit binding and report a physical texture bind. */
	applyTextureUnit(
		unit: number,
		binding: PreparedObjectTextureBinding<WebGLTexture, WebGLSampler>,
	): boolean {
		return this.applyTexture2D(unit, binding.texture, binding.sampler);
	}

	/** Apply one texture and sampler pair without requiring a caller-owned binding wrapper. */
	applyTexture2D(
		unit: number,
		texture: WebGLTexture,
		sampler: WebGLSampler,
	): boolean {
		let textureBound = false;
		if (this.#texture2DUnits.get(unit) !== texture) {
			if (this.#activeTextureUnit !== unit) {
				this.#gl.activeTexture(this.#gl.TEXTURE0 + unit);
				this.#activeTextureUnit = unit;
			}
			this.#gl.bindTexture(this.#gl.TEXTURE_2D, texture);
			this.#texture2DUnits.set(unit, texture);
			textureBound = true;
		}
		if (this.#samplerUnits.get(unit) !== sampler) {
			this.#gl.bindSampler(unit, sampler);
			this.#samplerUnits.set(unit, sampler);
		}
		return textureBound;
	}

	/** Bind one texture-array unit without desynchronizing later material texture mutations. */
	applyTextureArrayUnit(unit: number, texture: WebGLTexture): boolean {
		let textureBound = false;
		if (this.#textureArrayUnits.get(unit) !== texture) {
			if (this.#activeTextureUnit !== unit) {
				this.#gl.activeTexture(this.#gl.TEXTURE0 + unit);
				this.#activeTextureUnit = unit;
			}
			this.#gl.bindTexture(this.#gl.TEXTURE_2D_ARRAY, texture);
			this.#textureArrayUnits.set(unit, texture);
			textureBound = true;
		}
		// Manual PCF relies on the depth texture's nearest comparison parameters, not a sampler
		// object that some earlier binding path may have left on this physical unit.
		if (this.#samplerUnits.get(unit) !== null) {
			this.#gl.bindSampler(unit, null);
			this.#samplerUnits.set(unit, null);
		}
		return textureBound;
	}

	/**
	 * Upload one object uniform only when its value differs from the one already applied.
	 *
	 * Returns whether a GL call was issued. Sound because every location this caches has exactly one
	 * writer: `#drawObjectRange` owns the per-draw material and transform set, while program
	 * activation, lighting, fog and portal clip routing write a disjoint set of locations. Adding a
	 * second writer for any cached location would desync this silently.
	 */
	applyUniform1i(location: WebGLUniformLocation, value: number): boolean {
		this.#uniformScratch[0] = value;
		if (!this.#recordUniform(location, this.#uniformScratch, 1)) return false;
		this.#gl.uniform1i(location, value);
		return true;
	}

	applyUniform1f(location: WebGLUniformLocation, value: number): boolean {
		this.#uniformScratch[0] = value;
		if (!this.#recordUniform(location, this.#uniformScratch, 1)) return false;
		this.#gl.uniform1f(location, value);
		return true;
	}

	applyUniform3f(
		location: WebGLUniformLocation,
		x: number,
		y: number,
		z: number,
	): boolean {
		const scratch = this.#uniformScratch;
		scratch[0] = x;
		scratch[1] = y;
		scratch[2] = z;
		if (!this.#recordUniform(location, scratch, 3)) return false;
		this.#gl.uniform3f(location, x, y, z);
		return true;
	}

	applyUniform4f(
		location: WebGLUniformLocation,
		x: number,
		y: number,
		z: number,
		w: number,
	): boolean {
		const scratch = this.#uniformScratch;
		scratch[0] = x;
		scratch[1] = y;
		scratch[2] = z;
		scratch[3] = w;
		if (!this.#recordUniform(location, scratch, 4)) return false;
		this.#gl.uniform4f(location, x, y, z, w);
		return true;
	}

	/** A vec4 array is compared component-wise before one bulk upload. */
	applyUniform4fv(
		location: WebGLUniformLocation,
		value: Float32Array,
	): boolean {
		if (!this.#recordUniform(location, value, value.length)) return false;
		this.#gl.uniform4fv(location, value);
		return true;
	}

	/** The caller owns the matrix buffer; it is read here and never retained. */
	applyUniformMatrix4fv(
		location: WebGLUniformLocation,
		value: Float32Array,
	): boolean {
		if (!this.#recordUniform(location, value, MAT4_COMPONENTS)) {
			return false;
		}
		this.#gl.uniformMatrix4fv(location, false, value);
		return true;
	}

	/**
	 * Record one uniform's components and report whether any differed from the last applied value.
	 *
	 * Compared with `!==` rather than `Object.is` deliberately: an unseen location starts as `NaN`,
	 * which compares unequal to every real value and so reports the first upload as a change, while
	 * `-0` and `0` are the same uniform value and must not read as one.
	 */
	#recordUniform(
		location: WebGLUniformLocation,
		components: ArrayLike<number>,
		count: number,
	): boolean {
		let stored = this.#uniformComponents.get(location);
		if (stored === undefined) {
			stored = new Float64Array(count).fill(Number.NaN);
			this.#uniformComponents.set(location, stored);
		} else if (stored.length !== count) {
			throw new Error(
				`Uniform location changed component width from ${stored.length} to ${count}.`,
			);
		}
		let changed = false;
		for (let index = 0; index < count; index += 1) {
			const next = components[index]!;
			if (stored[index] !== next) {
				stored[index] = next;
				changed = true;
			}
		}
		return changed;
	}

	applyVertexArray(vertexArray: WebGLVertexArrayObject): void {
		if (this.#vertexArray === vertexArray) return;
		this.#gl.bindVertexArray(vertexArray);
		this.#vertexArray = vertexArray;
	}
}

function blendPolicyEquals(
	left: ObjectBlendPolicy,
	right: ObjectBlendPolicy,
): boolean {
	return left.source === right.source && left.destination === right.destination;
}

function blendFactor(
	gl: WebGL2RenderingContext,
	factor: ObjectBlendPolicy["source"],
): number {
	if (factor === "one") return gl.ONE;
	if (factor === "src-alpha") return gl.SRC_ALPHA;
	return gl.ONE_MINUS_SRC_ALPHA;
}
