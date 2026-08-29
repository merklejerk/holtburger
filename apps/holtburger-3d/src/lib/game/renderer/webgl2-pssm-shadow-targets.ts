import {
	MAX_OUTDOOR_PSSM_CASCADES,
	MAX_OUTDOOR_PSSM_MAP_RESOLUTION,
} from "./entity-shadow-policy";
import { withPreservedWebGL2AllocationBindings } from "./webgl2-render-target";

const DEPTH_COMPONENT24_BYTES_PER_TEXEL = 4;

/** GPU identity of one complete outdoor PSSM target generation. */
export interface WebGL2PssmShadowTargetSet {
	readonly cascadeCount: number;
	readonly depth: WebGLTexture;
	readonly framebuffer: WebGLFramebuffer;
	readonly resolution: number;
}

/** Cold lifecycle diagnostics for the outdoor shadow target owner. */
export interface WebGL2PssmShadowTargetDiagnostics {
	readonly activeBytes: number;
	readonly activeFramebufferCount: number;
	readonly activeTextureCount: number;
	readonly allocatedGenerationCount: number;
	readonly cascadeCount: number | null;
	readonly disposedGenerationCount: number;
	readonly resolution: number | null;
}

/** Lazy transactional owner of one depth texture array and its reusable layer framebuffer. */
export class WebGL2PssmShadowTargets {
	readonly #gl: WebGL2RenderingContext;
	#allocatedGenerationCount = 0;
	#destroyed = false;
	#disposedGenerationCount = 0;
	#targets: WebGL2PssmShadowTargetSet | null = null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	/** Allocate or reuse one complete depth-array generation. */
	resize(resolution: number, cascadeCount: number): WebGL2PssmShadowTargetSet {
		this.#assertAlive();
		validateConfiguration(resolution, cascadeCount);
		const current = this.#targets;
		if (
			current?.resolution === resolution &&
			current.cascadeCount === cascadeCount
		) {
			return current;
		}
		this.#validateDeviceCapacity(resolution, cascadeCount);
		pssmShadowTargetByteLength(resolution, cascadeCount);
		const replacement = withPreservedWebGL2AllocationBindings(
			this.#gl,
			() => allocateTargets(this.#gl, resolution, cascadeCount),
			this.#gl.TEXTURE_2D_ARRAY,
		);
		const previous = this.#targets;
		this.#targets = replacement;
		this.#allocatedGenerationCount += 1;
		if (previous) this.#dispose(previous);
		return replacement;
	}

	/** Attach and validate one cascade layer before its depth submission. */
	attachLayer(layer: number): WebGL2PssmShadowTargetSet {
		this.#assertAlive();
		const targets = this.#targets;
		if (!targets) throw new Error("Outdoor shadow targets are not allocated.");
		if (
			!Number.isInteger(layer) ||
			layer < 0 ||
			layer >= targets.cascadeCount
		) {
			throw new Error(
				`Outdoor shadow layer ${layer} is outside cascade count ${targets.cascadeCount}.`,
			);
		}
		this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, targets.framebuffer);
		this.#gl.framebufferTextureLayer(
			this.#gl.FRAMEBUFFER,
			this.#gl.DEPTH_ATTACHMENT,
			targets.depth,
			0,
			layer,
		);
		requireCompleteLayer(this.#gl, layer);
		return targets;
	}

	/** Release the active generation when the master setting is disabled. */
	disable(): void {
		this.#assertAlive();
		if (!this.#targets) return;
		this.#dispose(this.#targets);
		this.#targets = null;
	}

	getDiagnostics(): WebGL2PssmShadowTargetDiagnostics {
		const targets = this.#targets;
		return {
			activeBytes: targets
				? pssmShadowTargetByteLength(targets.resolution, targets.cascadeCount)
				: 0,
			activeFramebufferCount: targets ? 1 : 0,
			activeTextureCount: targets ? 1 : 0,
			allocatedGenerationCount: this.#allocatedGenerationCount,
			cascadeCount: targets?.cascadeCount ?? null,
			disposedGenerationCount: this.#disposedGenerationCount,
			resolution: targets?.resolution ?? null,
		};
	}

	/** Release the active generation exactly once. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		if (!this.#targets) return;
		this.#dispose(this.#targets);
		this.#targets = null;
	}

	#dispose(targets: WebGL2PssmShadowTargetSet): void {
		this.#gl.deleteFramebuffer(targets.framebuffer);
		this.#gl.deleteTexture(targets.depth);
		this.#disposedGenerationCount += 1;
	}

	#validateDeviceCapacity(resolution: number, cascadeCount: number): void {
		const maximumTextureSize = requirePositiveDeviceLimit(
			this.#gl.getParameter(this.#gl.MAX_TEXTURE_SIZE),
			"MAX_TEXTURE_SIZE",
		);
		if (resolution > maximumTextureSize) {
			throw new Error(
				`Outdoor shadow resolution ${resolution} exceeds maximum texture size ${maximumTextureSize}.`,
			);
		}
		const maximumArrayLayers = requirePositiveDeviceLimit(
			this.#gl.getParameter(this.#gl.MAX_ARRAY_TEXTURE_LAYERS),
			"MAX_ARRAY_TEXTURE_LAYERS",
		);
		if (cascadeCount > maximumArrayLayers) {
			throw new Error(
				`Outdoor shadow cascade count ${cascadeCount} exceeds maximum array layers ${maximumArrayLayers}.`,
			);
		}
	}

	#assertAlive(): void {
		if (this.#destroyed)
			throw new Error("Outdoor shadow targets have been destroyed.");
	}
}

/** Exact D24 array bytes, excluding framebuffer metadata. */
export function pssmShadowTargetByteLength(
	resolution: number,
	cascadeCount: number,
): number {
	validateConfiguration(resolution, cascadeCount);
	return (
		resolution * resolution * cascadeCount * DEPTH_COMPONENT24_BYTES_PER_TEXEL
	);
}

function allocateTargets(
	gl: WebGL2RenderingContext,
	resolution: number,
	cascadeCount: number,
): WebGL2PssmShadowTargetSet {
	const framebuffer = gl.createFramebuffer();
	if (!framebuffer)
		throw new Error("Failed to allocate outdoor shadow framebuffer.");
	const depth = gl.createTexture();
	if (!depth) {
		gl.deleteFramebuffer(framebuffer);
		throw new Error("Failed to allocate outdoor shadow depth array.");
	}
	try {
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, depth);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(
			gl.TEXTURE_2D_ARRAY,
			gl.TEXTURE_COMPARE_MODE,
			gl.COMPARE_REF_TO_TEXTURE,
		);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
		gl.texStorage3D(
			gl.TEXTURE_2D_ARRAY,
			1,
			gl.DEPTH_COMPONENT24,
			resolution,
			resolution,
			cascadeCount,
		);
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.drawBuffers([gl.NONE]);
		gl.readBuffer(gl.NONE);
		for (let layer = 0; layer < cascadeCount; layer += 1) {
			gl.framebufferTextureLayer(
				gl.FRAMEBUFFER,
				gl.DEPTH_ATTACHMENT,
				depth,
				0,
				layer,
			);
			requireCompleteLayer(gl, layer);
		}
		return { cascadeCount, depth, framebuffer, resolution };
	} catch (cause) {
		gl.deleteFramebuffer(framebuffer);
		gl.deleteTexture(depth);
		throw cause;
	}
}

function requireCompleteLayer(gl: WebGL2RenderingContext, layer: number): void {
	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	if (status !== gl.FRAMEBUFFER_COMPLETE) {
		throw new Error(
			`Outdoor shadow framebuffer layer ${layer} is incomplete with status ${status}.`,
		);
	}
}

function validateConfiguration(resolution: number, cascadeCount: number): void {
	if (
		!Number.isInteger(resolution) ||
		resolution <= 0 ||
		resolution > MAX_OUTDOOR_PSSM_MAP_RESOLUTION
	) {
		throw new Error(
			`Outdoor shadow target resolution must be a positive integer no larger than ${MAX_OUTDOOR_PSSM_MAP_RESOLUTION}.`,
		);
	}
	if (
		!Number.isInteger(cascadeCount) ||
		cascadeCount < 1 ||
		cascadeCount > MAX_OUTDOOR_PSSM_CASCADES
	) {
		throw new Error(
			`Outdoor shadow target cascade count must be an integer from 1 through ${MAX_OUTDOOR_PSSM_CASCADES}.`,
		);
	}
}

function requirePositiveDeviceLimit(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`WebGL2 ${name} must be a positive safe integer.`);
	}
	return value;
}
