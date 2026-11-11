import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import type { WebGL2EntitySelectionMask } from "./webgl2-entity-selection-pass";
import { withPreservedWebGL2AllocationBindings } from "./webgl2-render-target";

const VERTEX_SHADER = `#version 300 es
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSource;
uniform bool uHorizontal;
uniform vec2 uCssTexelSize;
uniform float uDistanceRange;
layout(location = 0) out vec2 outDistance;
void main() {
	ivec2 pixel = ivec2(gl_FragCoord.xy);
	ivec2 size = textureSize(uSource, 0);
	vec2 center = texelFetch(uSource, pixel, 0).rg;
	float spacing = uHorizontal ? uCssTexelSize.x : uCssTexelSize.y;
	ivec2 direction = uHorizontal ? ivec2(1, 0) : ivec2(0, 1);
	int limit = uHorizontal ? size.x : size.y;
	int extent = min(int(ceil(uDistanceRange / spacing)), limit - 1);
	float rangeSquared = uDistanceRange * uDistanceRange;
	float nearestSquared = rangeSquared;
	for (int offset = -extent; offset <= extent; ++offset) {
		ivec2 samplePixel = pixel + direction * offset;
		// Offscreen samples are empty, never clamped copies of an edge silhouette.
		if (any(lessThan(samplePixel, ivec2(0))) || any(greaterThanEqual(samplePixel, size))) continue;
		vec2 source = texelFetch(uSource, samplePixel, 0).rg;
		float along = float(offset) * spacing;
		if (uHorizontal) {
			if (source.r >= 0.5) nearestSquared = min(nearestSquared, along * along);
		} else {
			nearestSquared = min(nearestSquared, source.r * rangeSquared + along * along);
		}
	}
	// Horizontal stores normalized squared distance; vertical stores linear distance for
	// smooth upsampling. Green preserves occupancy so the entity's interior stays untouched.
	outDistance = uHorizontal
		? vec2(nearestSquared / rangeSquared, center.r)
		: vec2(sqrt(nearestSquared) / uDistanceRange, center.g);
}`;

/** One universally renderable RG8 distance/occupancy attachment; no float extensions required. */
interface DistanceTarget extends WebGL2EntitySelectionMask {
	readonly framebuffer: WebGLFramebuffer;
}

/** A complete replaceable generation; both passes share dimensions and lifetime. */
interface DistanceTargets {
	readonly horizontal: DistanceTarget;
	readonly vertical: DistanceTarget;
}

/** Two separable line searches replace the presenter's quadratic neighborhood search. */
export class WebGL2SelectionDistancePass {
	readonly #gl: WebGL2RenderingContext;
	readonly #program: WebGLProgram;
	readonly #vertexArray: WebGLVertexArrayObject;
	readonly #uniforms: {
		readonly source: WebGLUniformLocation;
		readonly horizontal: WebGLUniformLocation;
		readonly cssTexelSize: WebGLUniformLocation;
		readonly distanceRange: WebGLUniformLocation;
	};
	#targets: DistanceTargets | null = null;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		this.#program = linkWebGL2Program(
			gl,
			"selection distance",
			VERTEX_SHADER,
			FRAGMENT_SHADER,
		);
		try {
			this.#uniforms = {
				source: requireWebGL2Uniform(gl, this.#program, "uSource"),
				horizontal: requireWebGL2Uniform(gl, this.#program, "uHorizontal"),
				cssTexelSize: requireWebGL2Uniform(gl, this.#program, "uCssTexelSize"),
				distanceRange: requireWebGL2Uniform(
					gl,
					this.#program,
					"uDistanceRange",
				),
			};
			const vertexArray = gl.createVertexArray();
			if (!vertexArray)
				throw new Error("Failed to allocate selection distance vertex array.");
			this.#vertexArray = vertexArray;
		} catch (error) {
			gl.deleteProgram(this.#program);
			throw error;
		}
	}

	/** Render at mask resolution; CSS distances account for odd extents and render scale. */
	render(
		mask: WebGL2EntitySelectionMask,
		cssWidth: number,
		cssHeight: number,
		radius: number,
	): { readonly texture: WebGLTexture; readonly distanceRange: number } {
		if (this.#destroyed)
			throw new Error("Selection distance pass is destroyed.");
		const gl = this.#gl;
		const targets = this.#resize(mask.width, mask.height);
		const spacingX = cssWidth / mask.width;
		const spacingY = cssHeight / mask.height;
		// The empty-distance sentinel stays beyond the halo even after RG8 quantization.
		const distanceRange = radius + Math.max(spacingX, spacingY);
		gl.viewport(0, 0, mask.width, mask.height);
		gl.disable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.CULL_FACE);
		gl.colorMask(true, true, true, true);
		gl.useProgram(this.#program);
		gl.bindVertexArray(this.#vertexArray);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindSampler(0, null);
		gl.uniform1i(this.#uniforms.source, 0);
		gl.uniform2f(this.#uniforms.cssTexelSize, spacingX, spacingY);
		gl.uniform1f(this.#uniforms.distanceRange, distanceRange);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.horizontal.framebuffer);
		gl.bindTexture(gl.TEXTURE_2D, mask.texture);
		gl.uniform1i(this.#uniforms.horizontal, 1);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.vertical.framebuffer);
		gl.bindTexture(gl.TEXTURE_2D, targets.horizontal.texture);
		gl.uniform1i(this.#uniforms.horizontal, 0);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindVertexArray(null);
		return { texture: targets.vertical.texture, distanceRange };
	}

	#resize(width: number, height: number): DistanceTargets {
		if (
			this.#targets?.horizontal.width === width &&
			this.#targets.horizontal.height === height
		)
			return this.#targets;
		const replacement = withPreservedWebGL2AllocationBindings(this.#gl, () => {
			const horizontal = allocateTarget(this.#gl, width, height);
			try {
				return {
					horizontal,
					vertical: allocateTarget(this.#gl, width, height),
				};
			} catch (error) {
				this.#disposeTarget(horizontal);
				throw error;
			}
		});
		this.#releaseTargets();
		this.#targets = replacement;
		return replacement;
	}

	#disposeTarget(target: DistanceTarget): void {
		this.#gl.deleteFramebuffer(target.framebuffer);
		this.#gl.deleteTexture(target.texture);
	}

	#releaseTargets(): void {
		if (!this.#targets) return;
		this.#disposeTarget(this.#targets.horizontal);
		this.#disposeTarget(this.#targets.vertical);
		this.#targets = null;
	}

	/** Release both retained attachments and the filter program exactly once. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#releaseTargets();
		this.#gl.deleteVertexArray(this.#vertexArray);
		this.#gl.deleteProgram(this.#program);
	}
}

function allocateTarget(
	gl: WebGL2RenderingContext,
	width: number,
	height: number,
): DistanceTarget {
	const texture = gl.createTexture();
	if (!texture)
		throw new Error("Failed to allocate selection distance texture.");
	const framebuffer = gl.createFramebuffer();
	if (!framebuffer) {
		gl.deleteTexture(texture);
		throw new Error("Failed to allocate selection distance framebuffer.");
	}
	try {
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8, width, height);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(
			gl.DRAW_FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			texture,
			0,
		);
		if (
			gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
		)
			throw new Error("Selection distance framebuffer is incomplete.");
		return { texture, framebuffer, width, height };
	} catch (error) {
		gl.deleteFramebuffer(framebuffer);
		gl.deleteTexture(texture);
		throw error;
	}
}
