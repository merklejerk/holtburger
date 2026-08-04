import type { LandblockId } from "../game-types";
import type { SceneLightingRole } from "../environment/scene-lighting";
import type {
	ObjectBlendPolicy,
	PreparedObjectTextureBinding,
} from "./object-rendering-policy";

const UNKNOWN_STATE = Symbol("unknown-object-device-state");
type UnknownState = typeof UNKNOWN_STATE;

/**
 * Applies only WebGL state owned by one object phase.
 *
 * Terrain and portal execution are independent state owners, so callers must invalidate before
 * entering each object phase instead of assuming this cache observed their mutations.
 */
export class WebGL2ObjectStateApplicator {
	readonly #gl: WebGL2RenderingContext;
	#activeTextureUnit: number | UnknownState = UNKNOWN_STATE;
	#blendEnabled: boolean | UnknownState = UNKNOWN_STATE;
	#blendPolicy: ObjectBlendPolicy | UnknownState = UNKNOWN_STATE;
	#cullFace: "back" | "front" | UnknownState = UNKNOWN_STATE;
	#lightingRole: SceneLightingRole | UnknownState = UNKNOWN_STATE;
	#staticLightScope: LandblockId | null | UnknownState = UNKNOWN_STATE;
	#program: WebGLProgram | UnknownState = UNKNOWN_STATE;
	readonly #textureUnits = new Map<
		number,
		PreparedObjectTextureBinding<WebGLTexture, WebGLSampler>
	>();
	#vertexArray: WebGLVertexArrayObject | UnknownState = UNKNOWN_STATE;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	/** Forget every applied value after another state owner may have touched the context. */
	invalidate(): void {
		this.#activeTextureUnit = UNKNOWN_STATE;
		this.#blendEnabled = UNKNOWN_STATE;
		this.#blendPolicy = UNKNOWN_STATE;
		this.#cullFace = UNKNOWN_STATE;
		this.#lightingRole = UNKNOWN_STATE;
		this.#staticLightScope = UNKNOWN_STATE;
		this.#program = UNKNOWN_STATE;
		this.#textureUnits.clear();
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
	applyStaticLightScope(landblockId: LandblockId | null): boolean {
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
		const previous = this.#textureUnits.get(unit);
		let textureBound = false;
		if (previous?.texture !== binding.texture) {
			if (this.#activeTextureUnit !== unit) {
				this.#gl.activeTexture(this.#gl.TEXTURE0 + unit);
				this.#activeTextureUnit = unit;
			}
			this.#gl.bindTexture(this.#gl.TEXTURE_2D, binding.texture);
			textureBound = true;
		}
		if (previous?.sampler !== binding.sampler) {
			this.#gl.bindSampler(unit, binding.sampler);
		}
		this.#textureUnits.set(unit, binding);
		return textureBound;
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
