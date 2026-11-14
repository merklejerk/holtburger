import { BILLBOARD_CLIP_GLSL } from "./billboard-clip-glsl";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import type { NameplateTextureBinding } from "./webgl2-nameplate-texture-cache";
import type { NameplateColor } from "./nameplate-policy";
import type { Vec3 } from "../math/types";
import {
	bindWebGL2PortalDeferredVisibilityInstanceProgram,
	PORTAL_DEFERRED_VISIBILITY_INSTANCE_GLSL,
} from "./portal-deferred-visibility-glsl";

const CORNER_ATTRIBUTE = 0;
const ANCHOR_ATTRIBUTE = 1;
const HEALTH_ATTRIBUTE = 2;
const PLATE_SIZE_ATTRIBUTE = 3;
const ATLAS_UV_ATTRIBUTE = 4;
const PORTAL_DOMAIN_ATTRIBUTE = 5;
const INSTANCE_FLOATS = 11;
const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const HIDDEN_HEALTH_SENTINEL = -1;

/** One instance layout shared by VAO creation and draw-run offset changes. */
const INSTANCE_ATTRIBUTES = [
	[ANCHOR_ATTRIBUTE, 3, 0],
	[HEALTH_ATTRIBUTE, 1, 3],
	[PLATE_SIZE_ATTRIBUTE, 2, 4],
	[ATLAS_UV_ATTRIBUTE, 4, 6],
	[PORTAL_DOMAIN_ATTRIBUTE, 1, 10],
] as const;

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

/** Per-instance scope selection lets ordered plates share one portal draw. */
export interface NameplateInstanceScopeRouting {
	deferredRenderDomainOrdinal(renderScopeKey: string): number;
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
	readonly uniforms: {
		readonly clipFromAnchor: WebGLUniformLocation;
		readonly healthBarBackgroundColor: WebGLUniformLocation;
		readonly healthBarBorderColor: WebGLUniformLocation;
		readonly healthBarFillColor: WebGLUniformLocation;
		readonly healthBarGapBorder: WebGLUniformLocation;
		readonly healthBarSize: WebGLUniformLocation;
		readonly plate: WebGLUniformLocation;
		readonly referenceDistance: WebGLUniformLocation;
		readonly viewportSize: WebGLUniformLocation;
	};
}

/** One reusable instanced camera-facing quad pass for atlas-resident nameplates. */
export class WebGL2NameplatePass {
	readonly #anchorBuffer: WebGLBuffer;
	readonly #cornerBuffer: WebGLBuffer;
	readonly #gl: WebGL2RenderingContext;
	readonly #flatProgram: NameplateProgram;
	readonly #portalProgram: NameplateProgram;
	/** Shared single-level sampler that makes this pass independent of earlier material state. */
	readonly #sampler: WebGLSampler;
	readonly #vertexArray: WebGLVertexArrayObject;
	#instanceScratch = new Float32Array(0);
	#instanceCapacityFloats = 0;
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
		for (const [attribute, size, floatOffset] of INSTANCE_ATTRIBUTES) {
			gl.enableVertexAttribArray(attribute);
			gl.vertexAttribPointer(
				attribute,
				size,
				gl.FLOAT,
				false,
				INSTANCE_STRIDE_BYTES,
				floatOffset * Float32Array.BYTES_PER_ELEMENT,
			);
			gl.vertexAttribDivisor(attribute, 1);
		}
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
		routing: NameplateInstanceScopeRouting,
	): void {
		this.#draw(context, instances, routing);
	}

	#draw(
		context: NameplateDrawContext,
		instances: readonly (NameplateDrawInstance | NameplateScopedDrawInstance)[],
		routing: NameplateInstanceScopeRouting | null,
	): void {
		this.#requireAlive();
		const floatCount = instances.length * INSTANCE_FLOATS;
		if (floatCount === 0) {
			this.#diagnostics = { drawCount: 0, instanceCount: 0 };
			return;
		}
		if (this.#instanceScratch.length < floatCount)
			this.#instanceScratch = new Float32Array(floatCount);
		let floatOffset = 0;
		for (const instance of instances) {
			const { anchor, healthFraction, binding } = instance;
			this.#instanceScratch[floatOffset] = anchor.x;
			this.#instanceScratch[floatOffset + 1] = anchor.y;
			this.#instanceScratch[floatOffset + 2] = anchor.z;
			this.#instanceScratch[floatOffset + 3] =
				healthFraction !== undefined &&
				healthFraction !== null &&
				Number.isFinite(healthFraction)
					? Math.max(0, Math.min(1, healthFraction))
					: HIDDEN_HEALTH_SENTINEL;
			this.#instanceScratch[floatOffset + 4] = binding.width;
			this.#instanceScratch[floatOffset + 5] = binding.height;
			this.#instanceScratch.set(binding.atlasUvRect, floatOffset + 6);
			this.#instanceScratch[floatOffset + 10] =
				routing && "renderScopeKey" in instance
					? routing.deferredRenderDomainOrdinal(instance.renderScopeKey)
					: 0;
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
		if (this.#instanceCapacityFloats < floatCount) {
			this.#instanceCapacityFloats = Math.max(
				floatCount,
				this.#instanceCapacityFloats * 2,
			);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				this.#instanceCapacityFloats * Float32Array.BYTES_PER_ELEMENT,
				gl.STREAM_DRAW,
			);
		}
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.#instanceScratch, 0, floatCount);
		gl.depthFunc(gl.LEQUAL);
		gl.depthMask(false);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.activeTexture(gl.TEXTURE0);
		// WebGL sampler objects override texture parameters. Claim the sampler explicitly so a
		// mipmapped material sampler left on unit zero cannot make this one-level texture incomplete.
		gl.bindSampler(0, this.#sampler);
		const texture = instances[0]?.binding.texture;
		if (!texture) throw new Error("Nameplate draw has no atlas texture.");
		let firstInstance = 0;
		let drawCount = 0;
		let instanceCount = 0;
		while (firstInstance < instances.length) {
			const first = instances[firstInstance];
			if (first === undefined)
				throw new Error("Nameplate draw run lost its first instance.");
			let endInstance = firstInstance + 1;
			while (endInstance < instances.length) {
				const next = instances[endInstance];
				if (
					next === undefined ||
					next.binding.texture !== first.binding.texture ||
					next.depthTest !== first.depthTest
				)
					break;
				endInstance += 1;
			}
			const count = endInstance - firstInstance;
			if (first.depthTest) gl.enable(gl.DEPTH_TEST);
			else gl.disable(gl.DEPTH_TEST);
			gl.bindTexture(gl.TEXTURE_2D, first.binding.texture);
			const baseByteOffset = firstInstance * INSTANCE_STRIDE_BYTES;
			for (const [attribute, size, floatOffset] of INSTANCE_ATTRIBUTES)
				gl.vertexAttribPointer(
					attribute,
					size,
					gl.FLOAT,
					false,
					INSTANCE_STRIDE_BYTES,
					baseByteOffset + floatOffset * Float32Array.BYTES_PER_ELEMENT,
				);
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
layout(location = ${PLATE_SIZE_ATTRIBUTE}) in vec2 aPlateSize;
layout(location = ${ATLAS_UV_ATTRIBUTE}) in vec4 aAtlasUvRect;
layout(location = ${PORTAL_DOMAIN_ATTRIBUTE}) in float aPortalRenderDomain;
uniform mat4 uNameplateClipFromAnchor;
uniform float uReferenceDistance;
uniform vec2 uViewportSize;
uniform vec2 uHealthBarSize;
uniform vec2 uHealthBarGapBorder;
out vec2 vLocalPixel;
out float vHealthFraction;
out vec2 vPlateSize;
out vec4 vAtlasUvRect;
flat out uint vPortalRenderDomain;
${BILLBOARD_CLIP_GLSL}
void main() {
	vec4 clip = uNameplateClipFromAnchor * vec4(aAnchor, 1.0);
	float hasBar = step(0.0, aHealthFraction);
	float barFootprintH = hasBar * (uHealthBarSize.y + uHealthBarGapBorder.x);
	float totalWidth = max(aPlateSize.x, hasBar * uHealthBarSize.x);
	float totalHeight = aPlateSize.y + barFootprintH;
	vec2 localPixel = vec2(aCorner.x * totalWidth, aCorner.y * totalHeight);
	clip = offsetBillboardClip(clip, localPixel, uViewportSize, uReferenceDistance);
	gl_Position = clip;
	vLocalPixel = localPixel;
	vHealthFraction = aHealthFraction;
	vPlateSize = aPlateSize;
	vAtlasUvRect = aAtlasUvRect;
	vPortalRenderDomain = uint(aPortalRenderDomain);
}`;
	const fragment = `#version 300 es
precision highp float;
precision highp int;
${portal ? PORTAL_DEFERRED_VISIBILITY_INSTANCE_GLSL : ""}
uniform sampler2D uPlate;
uniform vec2 uHealthBarSize;
uniform vec2 uHealthBarGapBorder;
uniform vec4 uHealthBarFillColor;
uniform vec4 uHealthBarBackgroundColor;
uniform vec4 uHealthBarBorderColor;
in vec2 vLocalPixel;
in float vHealthFraction;
in vec2 vPlateSize;
in vec4 vAtlasUvRect;
flat in uint vPortalRenderDomain;
out vec4 outColor;
void main() {
	float hasBar = step(0.0, vHealthFraction);
	float barFootprintH = hasBar * (uHealthBarSize.y + uHealthBarGapBorder.x);
	bool inPlate = abs(vLocalPixel.x) <= vPlateSize.x * 0.5 && vLocalPixel.y >= barFootprintH && vLocalPixel.y <= barFootprintH + vPlateSize.y;
	vec4 color = vec4(0.0);
	if (inPlate) {
		vec2 plateUv = vec2(
			vLocalPixel.x / vPlateSize.x + 0.5,
			1.0 - (vLocalPixel.y - barFootprintH) / vPlateSize.y
		);
		color = texture(uPlate, vAtlasUvRect.xy + plateUv * vAtlasUvRect.zw);
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
	${portal ? "if (!portalDeferredFragmentVisible(vPortalRenderDomain)) discard;" : ""}
	outColor = color;
}`;
	const program = linkWebGL2Program(
		gl,
		portal ? "portal nameplate" : "nameplate",
		vertex,
		fragment,
	);
	if (portal) bindWebGL2PortalDeferredVisibilityInstanceProgram(gl, program);
	return {
		program,
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
			referenceDistance: requireWebGL2Uniform(
				gl,
				program,
				"uReferenceDistance",
			),
			viewportSize: requireWebGL2Uniform(gl, program, "uViewportSize"),
		},
	};
}
