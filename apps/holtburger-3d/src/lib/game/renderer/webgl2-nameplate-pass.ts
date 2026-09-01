import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import type { NameplateTextureBinding } from "./webgl2-nameplate-texture-cache";
import type { Vec3 } from "../math/types";
import {
	bindWebGL2PortalDeferredVisibilityProgram,
	PORTAL_DEFERRED_VISIBILITY_GLSL,
	type WebGL2PortalDeferredVisibilityUniforms,
} from "./portal-deferred-visibility-glsl";

const CORNER_ATTRIBUTE = 0;
const ANCHOR_ATTRIBUTE = 1;

export interface NameplateDrawInstance {
	/** Anchor-relative bottom-center position. */
	readonly anchor: Vec3;
	readonly binding: NameplateTextureBinding;
}

export interface NameplateScopedDrawInstance extends NameplateDrawInstance {
	/** Selected portal visibility domain for this ordered instance. */
	readonly renderScopeKey: string;
}

export interface NameplatePortalScopeRouting {
	routeDeferredSubmission(
		renderScopeKey: string,
		uniforms: WebGL2PortalDeferredVisibilityUniforms,
	): void;
}

export interface NameplateDrawContext {
	readonly clipFromAnchor: Float32Array;
	readonly referenceDistance: number;
	readonly viewportHeight: number;
	readonly viewportWidth: number;
}

export interface NameplateDrawDiagnostics {
	readonly drawCount: number;
	readonly instanceCount: number;
}

interface NameplateProgram {
	readonly program: WebGLProgram;
	readonly portal: WebGL2PortalDeferredVisibilityUniforms | null;
	readonly uniforms: {
		readonly clipFromAnchor: WebGLUniformLocation;
		readonly plate: WebGLUniformLocation;
		readonly plateSize: WebGLUniformLocation;
		readonly referenceDistance: WebGLUniformLocation;
		readonly viewportSize: WebGLUniformLocation;
	};
}

/** One reusable instanced camera-facing quad pass for complete nameplate textures. */
export class WebGL2NameplatePass {
	readonly #anchorBuffer: WebGLBuffer;
	readonly #cornerBuffer: WebGLBuffer;
	readonly #gl: WebGL2RenderingContext;
	readonly #flatProgram: NameplateProgram;
	readonly #portalProgram: NameplateProgram;
	/** Shared single-level sampler that makes this pass independent of earlier material state. */
	readonly #sampler: WebGLSampler;
	readonly #vertexArray: WebGLVertexArrayObject;
	#anchorScratch = new Float32Array(0);
	#diagnostics: NameplateDrawDiagnostics = { drawCount: 0, instanceCount: 0 };
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext, sampler: WebGLSampler) {
		this.#gl = gl;
		this.#sampler = sampler;
		const vertexArray = gl.createVertexArray();
		const cornerBuffer = gl.createBuffer();
		const anchorBuffer = gl.createBuffer();
		if (!vertexArray || !cornerBuffer || !anchorBuffer) {
			if (vertexArray) gl.deleteVertexArray(vertexArray);
			if (cornerBuffer) gl.deleteBuffer(cornerBuffer);
			if (anchorBuffer) gl.deleteBuffer(anchorBuffer);
			throw new Error("Failed to allocate nameplate pass geometry.");
		}
		this.#vertexArray = vertexArray;
		this.#cornerBuffer = cornerBuffer;
		this.#anchorBuffer = anchorBuffer;
		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, -0.5, 1]),
			gl.STATIC_DRAW,
		);
		gl.enableVertexAttribArray(CORNER_ATTRIBUTE);
		gl.vertexAttribPointer(CORNER_ATTRIBUTE, 2, gl.FLOAT, false, 0, 0);
		gl.bindBuffer(gl.ARRAY_BUFFER, anchorBuffer);
		gl.enableVertexAttribArray(ANCHOR_ATTRIBUTE);
		gl.vertexAttribPointer(ANCHOR_ATTRIBUTE, 3, gl.FLOAT, false, 0, 0);
		gl.vertexAttribDivisor(ANCHOR_ATTRIBUTE, 1);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		let flatProgram: NameplateProgram | null = null;
		let portalProgram: NameplateProgram | null = null;
		try {
			flatProgram = createNameplateProgram(gl, false);
			portalProgram = createNameplateProgram(gl, true);
		} catch (cause) {
			if (flatProgram) gl.deleteProgram(flatProgram.program);
			if (portalProgram) gl.deleteProgram(portalProgram.program);
			gl.deleteBuffer(anchorBuffer);
			gl.deleteBuffer(cornerBuffer);
			gl.deleteVertexArray(vertexArray);
			throw cause;
		}
		this.#flatProgram = flatProgram;
		this.#portalProgram = portalProgram;
	}

	draw(
		context: NameplateDrawContext,
		instances: readonly NameplateDrawInstance[],
	): void {
		this.#draw(context, instances, null);
	}

	/** Draw scope-grouped plates through the portal compositor's deferred visibility envelope. */
	drawScoped(
		context: NameplateDrawContext,
		instances: readonly NameplateScopedDrawInstance[],
		routing: NameplatePortalScopeRouting,
	): void {
		this.#draw(context, instances, routing);
	}

	#draw(
		context: NameplateDrawContext,
		instances: readonly (NameplateDrawInstance | NameplateScopedDrawInstance)[],
		routing: NameplatePortalScopeRouting | null,
	): void {
		this.#requireAlive();
		const floatCount = instances.length * 3;
		if (floatCount === 0) {
			this.#diagnostics = { drawCount: 0, instanceCount: 0 };
			return;
		}
		if (this.#anchorScratch.length < floatCount)
			this.#anchorScratch = new Float32Array(floatCount);
		let floatOffset = 0;
		for (const { anchor } of instances) {
			this.#anchorScratch[floatOffset] = anchor.x;
			this.#anchorScratch[floatOffset + 1] = anchor.y;
			this.#anchorScratch[floatOffset + 2] = anchor.z;
			floatOffset += 3;
		}

		const gl = this.#gl;
		const program = routing ? this.#portalProgram : this.#flatProgram;
		gl.useProgram(program.program);
		gl.uniformMatrix4fv(
			program.uniforms.clipFromAnchor,
			false,
			context.clipFromAnchor,
		);
		gl.uniform2f(
			program.uniforms.viewportSize,
			context.viewportWidth,
			context.viewportHeight,
		);
		gl.uniform1i(program.uniforms.plate, 0);
		gl.uniform1f(program.uniforms.referenceDistance, context.referenceDistance);
		gl.bindVertexArray(this.#vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#anchorBuffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			this.#anchorScratch.subarray(0, floatCount),
			gl.STREAM_DRAW,
		);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.depthMask(false);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.activeTexture(gl.TEXTURE0);
		// WebGL sampler objects override texture parameters. Claim the sampler explicitly so a
		// mipmapped material sampler left on unit zero cannot make this one-level texture incomplete.
		gl.bindSampler(0, this.#sampler);
		let firstInstance = 0;
		let drawCount = 0;
		let instanceCount = 0;
		while (firstInstance < instances.length) {
			const first = instances[firstInstance];
			if (first === undefined)
				throw new Error("Nameplate draw run lost its first instance.");
			const renderScopeKey =
				routing && "renderScopeKey" in first ? first.renderScopeKey : null;
			let endInstance = firstInstance + 1;
			while (endInstance < instances.length) {
				const next = instances[endInstance];
				if (
					next === undefined ||
					next.binding !== first.binding ||
					(routing &&
						(!("renderScopeKey" in next) ||
							next.renderScopeKey !== renderScopeKey))
				)
					break;
				endInstance += 1;
			}
			const count = endInstance - firstInstance;
			gl.vertexAttribPointer(
				ANCHOR_ATTRIBUTE,
				3,
				gl.FLOAT,
				false,
				0,
				firstInstance * 3 * Float32Array.BYTES_PER_ELEMENT,
			);
			gl.uniform2f(
				program.uniforms.plateSize,
				first.binding.width,
				first.binding.height,
			);
			gl.bindTexture(gl.TEXTURE_2D, first.binding.texture);
			if (routing) {
				if (program.portal === null)
					throw new Error(
						"Portal nameplate program has no visibility uniforms.",
					);
				if (renderScopeKey === null)
					throw new Error("Portal nameplate instance has no render scope key.");
				routing.routeDeferredSubmission(renderScopeKey, program.portal);
			}
			gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
			firstInstance = endInstance;
			drawCount += 1;
			instanceCount += count;
		}
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.bindSampler(0, null);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		this.#diagnostics = { drawCount, instanceCount };
	}

	diagnostics(): NameplateDrawDiagnostics {
		return this.#diagnostics;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#gl.deleteProgram(this.#flatProgram.program);
		this.#gl.deleteProgram(this.#portalProgram.program);
		this.#gl.deleteBuffer(this.#anchorBuffer);
		this.#gl.deleteBuffer(this.#cornerBuffer);
		this.#gl.deleteVertexArray(this.#vertexArray);
	}

	#requireAlive(): void {
		if (this.#destroyed) throw new Error("Nameplate pass is destroyed.");
	}
}

function createNameplateProgram(
	gl: WebGL2RenderingContext,
	portal: boolean,
): NameplateProgram {
	const vertex = `#version 300 es
precision highp float;
layout(location = ${CORNER_ATTRIBUTE}) in vec2 aCorner;
layout(location = ${ANCHOR_ATTRIBUTE}) in vec3 aAnchor;
uniform mat4 uNameplateClipFromAnchor;
uniform vec2 uPlateSize;
uniform float uReferenceDistance;
uniform vec2 uViewportSize;
out vec2 vUv;
void main() {
	vec4 clip = uNameplateClipFromAnchor * vec4(aAnchor, 1.0);
	vec2 pixelOffset = vec2(aCorner.x * uPlateSize.x, aCorner.y * uPlateSize.y);
	clip.xy += (pixelOffset * 2.0 / uViewportSize) * uReferenceDistance;
	gl_Position = clip;
	vUv = vec2(aCorner.x + 0.5, 1.0 - aCorner.y);
}`;
	const fragment = `#version 300 es
precision highp float;
precision highp int;
${portal ? PORTAL_DEFERRED_VISIBILITY_GLSL : ""}
uniform sampler2D uPlate;
in vec2 vUv;
out vec4 outColor;
void main() {
	vec4 color = texture(uPlate, vUv);
	if (color.a <= 0.01) discard;
	${portal ? "if (!portalDeferredFragmentVisible()) discard;" : ""}
	outColor = color;
}`;
	const program = linkWebGL2Program(
		gl,
		portal ? "portal nameplate" : "nameplate",
		vertex,
		fragment,
	);
	return {
		program,
		portal: portal
			? bindWebGL2PortalDeferredVisibilityProgram(gl, program)
			: null,
		uniforms: {
			clipFromAnchor: requireWebGL2Uniform(
				gl,
				program,
				"uNameplateClipFromAnchor",
			),
			plate: requireWebGL2Uniform(gl, program, "uPlate"),
			plateSize: requireWebGL2Uniform(gl, program, "uPlateSize"),
			referenceDistance: requireWebGL2Uniform(
				gl,
				program,
				"uReferenceDistance",
			),
			viewportSize: requireWebGL2Uniform(gl, program, "uViewportSize"),
		},
	};
}
