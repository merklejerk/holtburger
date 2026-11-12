import { BILLBOARD_CLIP_GLSL } from "./billboard-clip-glsl";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import type { NameplateTextureBinding } from "./webgl2-nameplate-texture-cache";
import type { NameplateColor } from "./nameplate-policy";
import type { Vec3 } from "../math/types";
import {
	bindWebGL2PortalDeferredVisibilityProgram,
	PORTAL_DEFERRED_VISIBILITY_GLSL,
	type WebGL2PortalDeferredVisibilityUniforms,
} from "./portal-deferred-visibility-glsl";

const CORNER_ATTRIBUTE = 0;
const ANCHOR_ATTRIBUTE = 1;
const HEALTH_ATTRIBUTE = 2;
const INSTANCE_FLOATS = 4;
const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const HIDDEN_HEALTH_SENTINEL = -1;

export interface NameplateDrawInstance {
	/** Anchor-relative bottom-center position. */
	readonly anchor: Vec3;
	readonly binding: NameplateTextureBinding;
	/** Selected and hovered entity plates overlay scene geometry; ordinary plates test depth. */
	readonly depthTest: boolean;
	/** Recent health fraction in [0, 1], or null/undefined when hidden. */
	readonly healthFraction?: number | null;
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

interface NameplateHealthBarDrawStyle {
	/** Raster-pixel [width, height] scaled by current rendering density. */
	readonly sizePixels: readonly [number, number];
	readonly gapPixels: number;
	readonly borderWidthPixels: number;
	readonly fillColor: NameplateColor;
	readonly backgroundColor: NameplateColor;
	readonly borderColor: NameplateColor;
}

export interface NameplateDrawContext {
	readonly clipFromAnchor: Float32Array;
	readonly referenceDistance: number;
	readonly viewportHeight: number;
	readonly viewportWidth: number;
	readonly healthBar: NameplateHealthBarDrawStyle;
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
		readonly healthBarBackgroundColor: WebGLUniformLocation;
		readonly healthBarBorderColor: WebGLUniformLocation;
		readonly healthBarFillColor: WebGLUniformLocation;
		readonly healthBarGapBorder: WebGLUniformLocation;
		readonly healthBarSize: WebGLUniformLocation;
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
		gl.vertexAttribPointer(
			ANCHOR_ATTRIBUTE,
			3,
			gl.FLOAT,
			false,
			INSTANCE_STRIDE_BYTES,
			0,
		);
		gl.vertexAttribDivisor(ANCHOR_ATTRIBUTE, 1);
		gl.enableVertexAttribArray(HEALTH_ATTRIBUTE);
		gl.vertexAttribPointer(
			HEALTH_ATTRIBUTE,
			1,
			gl.FLOAT,
			false,
			INSTANCE_STRIDE_BYTES,
			3 * Float32Array.BYTES_PER_ELEMENT,
		);
		gl.vertexAttribDivisor(HEALTH_ATTRIBUTE, 1);
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
		const floatCount = instances.length * INSTANCE_FLOATS;
		if (floatCount === 0) {
			this.#diagnostics = { drawCount: 0, instanceCount: 0 };
			return;
		}
		if (this.#anchorScratch.length < floatCount)
			this.#anchorScratch = new Float32Array(floatCount);
		let floatOffset = 0;
		for (const { anchor, healthFraction } of instances) {
			this.#anchorScratch[floatOffset] = anchor.x;
			this.#anchorScratch[floatOffset + 1] = anchor.y;
			this.#anchorScratch[floatOffset + 2] = anchor.z;
			this.#anchorScratch[floatOffset + 3] =
				healthFraction !== undefined &&
				healthFraction !== null &&
				Number.isFinite(healthFraction)
					? Math.max(0, Math.min(1, healthFraction))
					: HIDDEN_HEALTH_SENTINEL;
			floatOffset += INSTANCE_FLOATS;
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
		gl.uniform2f(
			program.uniforms.healthBarSize,
			context.healthBar.sizePixels[0],
			context.healthBar.sizePixels[1],
		);
		gl.uniform2f(
			program.uniforms.healthBarGapBorder,
			context.healthBar.gapPixels,
			context.healthBar.borderWidthPixels,
		);
		gl.uniform4f(
			program.uniforms.healthBarFillColor,
			context.healthBar.fillColor.red,
			context.healthBar.fillColor.green,
			context.healthBar.fillColor.blue,
			context.healthBar.fillColor.alpha,
		);
		gl.uniform4f(
			program.uniforms.healthBarBackgroundColor,
			context.healthBar.backgroundColor.red,
			context.healthBar.backgroundColor.green,
			context.healthBar.backgroundColor.blue,
			context.healthBar.backgroundColor.alpha,
		);
		gl.uniform4f(
			program.uniforms.healthBarBorderColor,
			context.healthBar.borderColor.red,
			context.healthBar.borderColor.green,
			context.healthBar.borderColor.blue,
			context.healthBar.borderColor.alpha,
		);
		gl.bindVertexArray(this.#vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#anchorBuffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			this.#anchorScratch.subarray(0, floatCount),
			gl.STREAM_DRAW,
		);
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
					next.depthTest !== first.depthTest ||
					(routing &&
						(!("renderScopeKey" in next) ||
							next.renderScopeKey !== renderScopeKey))
				)
					break;
				endInstance += 1;
			}
			const count = endInstance - firstInstance;
			if (first.depthTest) gl.enable(gl.DEPTH_TEST);
			else gl.disable(gl.DEPTH_TEST);
			const baseByteOffset = firstInstance * INSTANCE_STRIDE_BYTES;
			gl.vertexAttribPointer(
				ANCHOR_ATTRIBUTE,
				3,
				gl.FLOAT,
				false,
				INSTANCE_STRIDE_BYTES,
				baseByteOffset,
			);
			gl.vertexAttribPointer(
				HEALTH_ATTRIBUTE,
				1,
				gl.FLOAT,
				false,
				INSTANCE_STRIDE_BYTES,
				baseByteOffset + 3 * Float32Array.BYTES_PER_ELEMENT,
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
layout(location = ${HEALTH_ATTRIBUTE}) in float aHealthFraction;
uniform mat4 uNameplateClipFromAnchor;
uniform vec2 uPlateSize;
uniform float uReferenceDistance;
uniform vec2 uViewportSize;
uniform vec2 uHealthBarSize;
uniform vec2 uHealthBarGapBorder;
out vec2 vLocalPixel;
out float vHealthFraction;
${BILLBOARD_CLIP_GLSL}
void main() {
	vec4 clip = uNameplateClipFromAnchor * vec4(aAnchor, 1.0);
	float hasBar = step(0.0, aHealthFraction);
	float barFootprintH = hasBar * (uHealthBarSize.y + uHealthBarGapBorder.x);
	float totalWidth = max(uPlateSize.x, hasBar * uHealthBarSize.x);
	float totalHeight = uPlateSize.y + barFootprintH;
	vec2 localPixel = vec2(aCorner.x * totalWidth, aCorner.y * totalHeight);
	clip = offsetBillboardClip(clip, localPixel, uViewportSize, uReferenceDistance);
	gl_Position = clip;
	vLocalPixel = localPixel;
	vHealthFraction = aHealthFraction;
}`;
	const fragment = `#version 300 es
precision highp float;
precision highp int;
${portal ? PORTAL_DEFERRED_VISIBILITY_GLSL : ""}
uniform sampler2D uPlate;
uniform vec2 uPlateSize;
uniform vec2 uHealthBarSize;
uniform vec2 uHealthBarGapBorder;
uniform vec4 uHealthBarFillColor;
uniform vec4 uHealthBarBackgroundColor;
uniform vec4 uHealthBarBorderColor;
in vec2 vLocalPixel;
in float vHealthFraction;
out vec4 outColor;
void main() {
	float hasBar = step(0.0, vHealthFraction);
	float barFootprintH = hasBar * (uHealthBarSize.y + uHealthBarGapBorder.x);
	bool inPlate = abs(vLocalPixel.x) <= uPlateSize.x * 0.5 && vLocalPixel.y >= barFootprintH && vLocalPixel.y <= barFootprintH + uPlateSize.y;
	vec4 color = vec4(0.0);
	if (inPlate) {
		vec2 plateUv = vec2(
			vLocalPixel.x / uPlateSize.x + 0.5,
			1.0 - (vLocalPixel.y - barFootprintH) / uPlateSize.y
		);
		color = texture(uPlate, plateUv);
	} else if (
		vHealthFraction >= 0.0 &&
		abs(vLocalPixel.x) <= uHealthBarSize.x * 0.5 &&
		vLocalPixel.y >= 0.0 &&
		vLocalPixel.y <= uHealthBarSize.y
	) {
		float dx = uHealthBarSize.x * 0.5 - abs(vLocalPixel.x);
		float dy = min(vLocalPixel.y, uHealthBarSize.y - vLocalPixel.y);
		float border = uHealthBarGapBorder.y;
		if (dx < border || dy < border) {
			color = uHealthBarBorderColor;
		} else {
			float innerWidth = max(uHealthBarSize.x - 2.0 * border, 1.0);
			float fillT = (vLocalPixel.x + uHealthBarSize.x * 0.5 - border) / innerWidth;
			color = fillT <= vHealthFraction ? uHealthBarFillColor : uHealthBarBackgroundColor;
		}
	}
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
			healthBarBackgroundColor: requireWebGL2Uniform(
				gl,
				program,
				"uHealthBarBackgroundColor",
			),
			healthBarBorderColor: requireWebGL2Uniform(
				gl,
				program,
				"uHealthBarBorderColor",
			),
			healthBarFillColor: requireWebGL2Uniform(
				gl,
				program,
				"uHealthBarFillColor",
			),
			healthBarGapBorder: requireWebGL2Uniform(
				gl,
				program,
				"uHealthBarGapBorder",
			),
			healthBarSize: requireWebGL2Uniform(gl, program, "uHealthBarSize"),
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
