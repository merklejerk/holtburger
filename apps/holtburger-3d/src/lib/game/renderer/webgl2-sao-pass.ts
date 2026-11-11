import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import type { Mat4 } from "../math/types";
import {
	AMBIENT_OCCLUSION_SAMPLE_KERNEL,
	type EffectiveAmbientOcclusionPolicy,
} from "./ambient-occlusion-policy";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import { withPreservedWebGL2AllocationBindings } from "./webgl2-render-target";
import {
	type RenderExtent,
	validateRenderDimensions,
	validateRenderExtent,
} from "./render-extent";

const SAO_TEXTURE_UNIT = 0;
const SCENE_DEPTH_TEXTURE_UNIT = 1;
const R8_BYTES_PER_PIXEL = 1;
const FULLSCREEN_VERTEX_COUNT = 3;

const FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;

void main() {
	vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const SAO_EVALUATION_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uSceneDepth;
uniform vec2 uOutputExtent;
uniform vec2 uDrawingBufferExtent;
uniform vec2 uProjectionScale;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uSampleRadius;
uniform float uBias;
uniform float uIntensity;
uniform bool uCoverageVisualization;
uniform vec2 uDistanceFade;
uniform vec2 uKernel[${AMBIENT_OCCLUSION_SAMPLE_KERNEL.length / 2}];
layout(location = 0) out float outAmbientOcclusion;

float linearDepth(float depth) {
	float ndcDepth = depth * 2.0 - 1.0;
	return 2.0 * uCameraNear * uCameraFar
		/ (uCameraFar + uCameraNear - ndcDepth * (uCameraFar - uCameraNear));
}

ivec2 scenePixelFromScratch(ivec2 scratchPixel) {
	return min(
		textureSize(uSceneDepth, 0) - 1,
		ivec2((vec2(scratchPixel) + 0.5) * uDrawingBufferExtent / uOutputExtent)
	);
}

vec3 viewPosition(ivec2 pixel, float depth) {
	vec2 ndc = (vec2(pixel) + 0.5) * 2.0 / uDrawingBufferExtent - 1.0;
	float distance = linearDepth(depth);
	return vec3(
		ndc.x * distance / uProjectionScale.x,
		ndc.y * distance / uProjectionScale.y,
		-distance
	);
}

vec3 positionAt(ivec2 pixel) {
	ivec2 clampedPixel = clamp(pixel, ivec2(0), textureSize(uSceneDepth, 0) - 1);
	return viewPosition(clampedPixel, texelFetch(uSceneDepth, clampedPixel, 0).r);
}

float distanceWeight(float distance) {
	if (distance <= uDistanceFade.x) return 1.0;
	if (distance >= uDistanceFade.y) return 0.0;
	float ratio = (distance - uDistanceFade.x) / (uDistanceFade.y - uDistanceFade.x);
	return 1.0 - ratio * ratio * (3.0 - 2.0 * ratio);
}

void main() {
	ivec2 pixel = scenePixelFromScratch(ivec2(gl_FragCoord.xy));
	float centerDepth = texelFetch(uSceneDepth, pixel, 0).r;
	if (centerDepth >= 1.0) {
		outAmbientOcclusion = 1.0;
		return;
	}
	vec3 center = viewPosition(pixel, centerDepth);
	float eligibility = distanceWeight(length(center));
	if (uCoverageVisualization) {
		outAmbientOcclusion = eligibility >= 1.0
			? 0.25
			: eligibility > 0.0 ? 0.5 : 0.75;
		return;
	}
	if (eligibility <= 0.0) {
		outAmbientOcclusion = 1.0;
		return;
	}

	vec3 left = positionAt(pixel + ivec2(-1, 0));
	vec3 right = positionAt(pixel + ivec2(1, 0));
	vec3 down = positionAt(pixel + ivec2(0, -1));
	vec3 up = positionAt(pixel + ivec2(0, 1));
	vec3 derivativeX = abs(right.z - center.z) < abs(center.z - left.z)
		? right - center
		: center - left;
	vec3 derivativeY = abs(up.z - center.z) < abs(center.z - down.z)
		? up - center
		: center - down;
	vec3 normal = normalize(cross(derivativeX, derivativeY));
	if (any(isnan(normal)) || any(isinf(normal))) {
		outAmbientOcclusion = 1.0;
		return;
	}

	float centerLinearDepth = -center.z;
	vec2 samplePixelsPerWorldUnit = 0.5 * uDrawingBufferExtent * uProjectionScale
		/ centerLinearDepth;
	float rotation = fract(sin(dot(vec2(pixel), vec2(12.9898, 78.233))) * 43758.5453)
		* 6.28318530718;
	mat2 rotationMatrix = mat2(cos(rotation), -sin(rotation), sin(rotation), cos(rotation));
	float obscurance = 0.0;
	for (int index = 0; index < ${AMBIENT_OCCLUSION_SAMPLE_KERNEL.length / 2}; index += 1) {
		vec2 screenOffset = rotationMatrix * uKernel[index]
			* uSampleRadius * samplePixelsPerWorldUnit;
		ivec2 samplePixel = pixel + ivec2(round(screenOffset));
		// Offscreen samples contribute no occlusion rather than duplicating border depth.
		if (any(lessThan(samplePixel, ivec2(0)))
			|| any(greaterThanEqual(samplePixel, textureSize(uSceneDepth, 0)))) {
			continue;
		}
		float sampleDepth = texelFetch(uSceneDepth, samplePixel, 0).r;
		if (sampleDepth >= 1.0) continue;
		vec3 delta = viewPosition(samplePixel, sampleDepth) - center;
		float separation = length(delta);
		if (separation <= uBias || separation >= uSampleRadius) continue;
		float facing = max(dot(normal, delta / separation) - uBias / separation, 0.0);
		float rangeWeight = 1.0 - smoothstep(uSampleRadius * 0.5, uSampleRadius, separation);
		obscurance += facing * rangeWeight;
	}
	float normalizedObscurance = obscurance / float(${AMBIENT_OCCLUSION_SAMPLE_KERNEL.length / 2});
	outAmbientOcclusion = clamp(1.0 - normalizedObscurance * uIntensity * eligibility, 0.0, 1.0);
}
`;

const SAO_BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uAmbientOcclusion;
uniform sampler2D uSceneDepth;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uBilateralDepthThreshold;
uniform float uNeutralLinearDepthCutoff;
uniform ivec2 uBlurDirection;
layout(location = 0) out float outAmbientOcclusion;

float linearDepth(float depth) {
	float ndcDepth = depth * 2.0 - 1.0;
	return 2.0 * uCameraNear * uCameraFar
		/ (uCameraFar + uCameraNear - ndcDepth * (uCameraFar - uCameraNear));
}

float sceneDepthAtScratch(ivec2 pixel) {
	ivec2 sceneExtent = textureSize(uSceneDepth, 0);
	ivec2 scratchExtent = textureSize(uAmbientOcclusion, 0);
	ivec2 scenePixel = min(
		sceneExtent - 1,
		ivec2((vec2(pixel) + 0.5) * vec2(sceneExtent) / vec2(scratchExtent))
	);
	return texelFetch(uSceneDepth, scenePixel, 0).r;
}

void main() {
	ivec2 scratchExtent = textureSize(uAmbientOcclusion, 0);
	ivec2 centerPixel = ivec2(gl_FragCoord.xy);
	float centerDepth = sceneDepthAtScratch(centerPixel);
	if (centerDepth >= 1.0) {
		outAmbientOcclusion = 1.0;
		return;
	}
	float centerLinearDepth = linearDepth(centerDepth);
	// Pass 1 reads raw AO (neutral beyond fadeEnd), so centerLinearDepth >= fadeEnd + threshold
	// guarantees every positive-weight tap is neutral. Pass 2 reads Pass 1's output (neutral
	// beyond fadeEnd + threshold), extending the exact neutral boundary to fadeEnd + 2 * threshold.
	if (centerLinearDepth >= uNeutralLinearDepthCutoff) {
		outAmbientOcclusion = 1.0;
		return;
	}
	const float spatialWeights[5] = float[5](1.0, 4.0, 6.0, 4.0, 1.0);
	float weightedOcclusion = 0.0;
	float totalWeight = 0.0;
	for (int index = -2; index <= 2; index += 1) {
		ivec2 sampleLocal = clamp(
			centerPixel + uBlurDirection * index,
			ivec2(0),
			scratchExtent - 1
		);
		float sampleDepth = sceneDepthAtScratch(sampleLocal);
		if (sampleDepth >= 1.0) continue;
		float depthWeight = max(
			0.0,
			1.0 - abs(linearDepth(sampleDepth) - centerLinearDepth) / uBilateralDepthThreshold
		);
		float weight = spatialWeights[index + 2] * depthWeight;
		weightedOcclusion += texelFetch(
			uAmbientOcclusion,
			sampleLocal,
			0
		).r * weight;
		totalWeight += weight;
	}
	outAmbientOcclusion = totalWeight > 0.0 ? weightedOcclusion / totalWeight : 1.0;
}
`;

const SAO_COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uAmbientOcclusion;
uniform vec2 uOutputExtent;
uniform bool uCoverageVisualization;
layout(location = 0) out vec4 outFactor;

void main() {
	ivec2 scratchExtent = textureSize(uAmbientOcclusion, 0);
	ivec2 scratchPixel = min(
		scratchExtent - 1,
		ivec2(gl_FragCoord.xy * vec2(scratchExtent) / uOutputExtent)
	);
	float factor = texelFetch(uAmbientOcclusion, scratchPixel, 0).r;
	if (uCoverageVisualization) {
		outFactor = factor < 0.375
			? vec4(0.1, 1.0, 0.1, 1.0)
			: factor < 0.625
				? vec4(1.0, 0.8, 0.05, 1.0)
				: factor < 0.875
					? vec4(0.1, 0.35, 1.0, 1.0)
					: vec4(0.0, 0.0, 0.0, 1.0);
		return;
	}
	outFactor = vec4(factor, factor, factor, 1.0);
}
`;

interface SaoProgram {
	readonly program: WebGLProgram;
}

interface SaoEvaluationProgram extends SaoProgram {
	readonly outputExtent: WebGLUniformLocation;
	readonly bias: WebGLUniformLocation;
	readonly cameraFar: WebGLUniformLocation;
	readonly cameraNear: WebGLUniformLocation;
	readonly coverageVisualization: WebGLUniformLocation;
	readonly distanceFade: WebGLUniformLocation;
	readonly drawingBufferExtent: WebGLUniformLocation;
	readonly intensity: WebGLUniformLocation;
	readonly projectionScale: WebGLUniformLocation;
	readonly sampleRadius: WebGLUniformLocation;
}

interface SaoBlurProgram extends SaoProgram {
	readonly bilateralDepthThreshold: WebGLUniformLocation;
	readonly blurDirection: WebGLUniformLocation;
	readonly cameraFar: WebGLUniformLocation;
	readonly cameraNear: WebGLUniformLocation;
	readonly neutralLinearDepthCutoff: WebGLUniformLocation;
}

interface SaoCompositeProgram extends SaoProgram {
	readonly outputExtent: WebGLUniformLocation;
	readonly coverageVisualization: WebGLUniformLocation;
}

interface SaoScratchTarget {
	readonly framebuffer: WebGLFramebuffer;
	readonly texture: WebGLTexture;
}

interface SaoScratchTargetSet {
	readonly extent: RenderExtent;
	readonly first: SaoScratchTarget;
	readonly second: SaoScratchTarget;
}

/** Scene target consumed and modified by SAO without changing its attachment ownership. */
export interface WebGL2SaoSceneTarget {
	readonly depth: WebGLTexture;
	readonly extent: RenderExtent;
	readonly framebuffer: WebGLFramebuffer;
}

/** Camera clip range used for view-space depth reconstruction. */
export interface WebGL2SaoCameraRange {
	readonly far: number;
	readonly near: number;
}

/** Explicit SAO lifecycle and active scratch-allocation facts. */
export interface WebGL2SaoPassDiagnostics {
	readonly activeBytes: number;
	readonly allocatedGenerationCount: number;
	readonly disposedGenerationCount: number;
	readonly extent: RenderExtent | null;
}

/** One-shot harness census over committed opaque depth, excluding clear sky. */
export interface WebGL2SaoCoverageCensus {
	readonly clearDepthPixelCount: number;
	readonly distanceNeutralPixelCount: number;
	readonly fadingPixelCount: number;
	readonly fullStrengthPixelCount: number;
	readonly opaqueDepthPixelCount: number;
}

/** Transactional owner for the two optional R8 SAO scratch attachments. */
export class WebGL2SaoScratchTargets {
	readonly #gl: WebGL2RenderingContext;
	#allocatedGenerationCount = 0;
	#destroyed = false;
	#disposedGenerationCount = 0;
	#scratch: SaoScratchTargetSet | null = null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	resize(extent: RenderExtent): SaoScratchTargetSet {
		validateRenderExtent(extent, "SAO scratch target");
		return this.resizeDimensions(extent.width, extent.height);
	}

	/** Reuse scratch storage from scalar dimensions without allocating an extent record. */
	resizeDimensions(width: number, height: number): SaoScratchTargetSet {
		this.#assertAlive();
		validateRenderDimensions(width, height, "SAO scratch target");
		saoScratchByteLengthFromDimensions(width, height);
		const current = this.#scratch;
		if (
			current &&
			current.extent.width === width &&
			current.extent.height === height
		) {
			return current;
		}
		const extent = { height, width };
		const replacement = withPreservedWebGL2AllocationBindings(this.#gl, () =>
			allocateScratch(this.#gl, extent),
		);
		this.#scratch = replacement;
		this.#allocatedGenerationCount += 1;
		if (current) {
			disposeScratch(this.#gl, current);
			this.#disposedGenerationCount += 1;
		}
		return replacement;
	}

	/** Exact live scratch bytes without allocating a diagnostic snapshot. */
	get activeBytes(): number {
		return this.#scratch ? saoScratchByteLength(this.#scratch.extent) : 0;
	}

	/** Complete scratch generations allocated over this owner's lifetime. */
	get allocatedGenerationCount(): number {
		return this.#allocatedGenerationCount;
	}

	/** Complete scratch generations disposed over this owner's lifetime. */
	get disposedGenerationCount(): number {
		return this.#disposedGenerationCount;
	}

	disable(): void {
		this.#assertAlive();
		if (!this.#scratch) return;
		disposeScratch(this.#gl, this.#scratch);
		this.#scratch = null;
		this.#disposedGenerationCount += 1;
	}

	getDiagnostics(): WebGL2SaoPassDiagnostics {
		return {
			activeBytes: this.#scratch
				? saoScratchByteLength(this.#scratch.extent)
				: 0,
			allocatedGenerationCount: this.#allocatedGenerationCount,
			disposedGenerationCount: this.#disposedGenerationCount,
			extent: this.#scratch ? { ...this.#scratch.extent } : null,
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.disable();
		this.#destroyed = true;
	}

	#assertAlive(): void {
		if (this.#destroyed)
			throw new Error("SAO scratch targets have been destroyed.");
	}
}

/** Near-field obscurance over complete composed scene depth for every view. */
export class WebGL2SaoPass {
	readonly #blurProgram: SaoBlurProgram;
	readonly #compositeProgram: SaoCompositeProgram;
	readonly #evaluationProgram: SaoEvaluationProgram;
	readonly #gl: WebGL2RenderingContext;
	readonly #scratchTargets: WebGL2SaoScratchTargets;
	readonly #vertexArray: WebGLVertexArrayObject;
	#coverageCensus: WebGL2SaoCoverageCensus | null = null;
	#coverageCensusRequested = false;
	#coverageVisualizationEnabled = false;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		this.#scratchTargets = new WebGL2SaoScratchTargets(gl);
		const previousProgram = gl.getParameter(
			gl.CURRENT_PROGRAM,
		) as WebGLProgram | null;
		let evaluationProgram: SaoEvaluationProgram | null = null;
		let blurProgram: SaoBlurProgram | null = null;
		let compositeProgram: SaoCompositeProgram | null = null;
		let vertexArray: WebGLVertexArrayObject | null = null;
		try {
			evaluationProgram = createEvaluationProgram(gl);
			blurProgram = createBlurProgram(gl);
			compositeProgram = createCompositeProgram(gl);
			vertexArray = gl.createVertexArray();
			if (!vertexArray) throw new Error("Failed to allocate SAO vertex array.");
		} catch (cause) {
			if (vertexArray) gl.deleteVertexArray(vertexArray);
			if (compositeProgram) gl.deleteProgram(compositeProgram.program);
			if (blurProgram) gl.deleteProgram(blurProgram.program);
			if (evaluationProgram) gl.deleteProgram(evaluationProgram.program);
			throw cause;
		} finally {
			gl.useProgram(previousProgram);
		}
		this.#evaluationProgram = evaluationProgram;
		this.#blurProgram = blurProgram;
		this.#compositeProgram = compositeProgram;
		this.#vertexArray = vertexArray;
	}

	/** Tear down optional scratch attachments while retaining immutable programs for later toggles. */
	disable(): void {
		this.#assertAlive();
		this.#scratchTargets.disable();
	}

	/** Exact live scratch bytes without allocating a diagnostic snapshot. */
	get activeBytes(): number {
		return this.#scratchTargets.activeBytes;
	}

	/** Complete scratch generations allocated over this pass's lifetime. */
	get allocatedGenerationCount(): number {
		return this.#scratchTargets.allocatedGenerationCount;
	}

	/** Complete scratch generations disposed over this pass's lifetime. */
	get disposedGenerationCount(): number {
		return this.#scratchTargets.disposedGenerationCount;
	}

	/** Enable the harness-only category view and request one full-resolution depth census. */
	setCoverageVisualizationEnabled(enabled: boolean): void {
		this.#assertAlive();
		this.#coverageVisualizationEnabled = enabled;
		this.#coverageCensusRequested = enabled;
		if (!enabled) this.#coverageCensus = null;
	}

	getCoverageCensus(): WebGL2SaoCoverageCensus | null {
		return this.#coverageCensus ? { ...this.#coverageCensus } : null;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#scratchTargets.destroy();
		this.#destroyed = true;
		this.#gl.deleteVertexArray(this.#vertexArray);
		this.#deletePrograms();
	}

	/** Apply SAO once to complete static and opaque entity color/depth. */
	apply(
		scene: WebGL2SaoSceneTarget,
		camera: WebGL2SaoCameraRange,
		projection: Mat4,
		policy: EffectiveAmbientOcclusionPolicy,
	): void {
		const {
			depth: sceneDepth,
			framebuffer: sceneFramebuffer,
			extent: sceneExtent,
		} = scene;
		this.#assertAlive();
		if (policy.kind !== "enabled") {
			throw new Error("SAO draw requires an enabled effective policy.");
		}
		const tuning = SHARED_FRONTEND_TUNING.rendering.ambientOcclusion;
		const scratch = this.#scratchTargets.resize(
			scaledSaoExtent(sceneExtent, tuning.resolutionScale),
		);
		const gl = this.#gl;
		gl.bindVertexArray(this.#vertexArray);
		this.#prepareScratchDraw(scratch.first.framebuffer, scratch.extent);
		this.#bindEvaluation(
			sceneDepth,
			sceneExtent,
			camera,
			projection,
			policy,
			scratch.extent,
		);
		gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_VERTEX_COUNT);
		if (this.#coverageCensusRequested) {
			this.#coverageCensus = this.#captureCoverageCensus(
				sceneDepth,
				sceneExtent,
				camera,
				projection,
				policy,
			);
			this.#coverageCensusRequested = false;
		}

		if (!this.#coverageVisualizationEnabled) {
			this.#prepareScratchDraw(scratch.second.framebuffer, scratch.extent);
			this.#bindBlur(
				scratch.first.texture,
				sceneDepth,
				camera,
				policy,
				1,
				0,
				1,
			);
			gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_VERTEX_COUNT);

			this.#prepareScratchDraw(scratch.first.framebuffer, scratch.extent);
			this.#bindBlur(
				scratch.second.texture,
				sceneDepth,
				camera,
				policy,
				0,
				1,
				2,
			);
			gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_VERTEX_COUNT);
		}

		this.#bindComposite(sceneFramebuffer, sceneExtent, scratch.first.texture);
		gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_VERTEX_COUNT);
		gl.disable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.bindVertexArray(null);
	}

	#bindEvaluation(
		sceneDepth: WebGLTexture,
		sceneExtent: RenderExtent,
		camera: WebGL2SaoCameraRange,
		projection: Mat4,
		policy: Extract<
			EffectiveAmbientOcclusionPolicy,
			{ readonly kind: "enabled" }
		>,
		scratchExtent: RenderExtent,
	): void {
		const gl = this.#gl;
		const program = this.#evaluationProgram;
		const tuning = policy.parameters;
		gl.useProgram(program.program);
		gl.uniform2f(
			program.outputExtent,
			scratchExtent.width,
			scratchExtent.height,
		);
		gl.uniform2f(
			program.drawingBufferExtent,
			sceneExtent.width,
			sceneExtent.height,
		);
		gl.uniform2f(program.projectionScale, projection.m11, projection.m22);
		gl.uniform1f(program.cameraNear, camera.near);
		gl.uniform1f(program.cameraFar, camera.far);
		gl.uniform1f(program.sampleRadius, tuning.sampleRadius);
		gl.uniform1f(program.bias, tuning.bias);
		gl.uniform1f(program.intensity, tuning.intensity);
		gl.uniform1i(
			program.coverageVisualization,
			this.#coverageVisualizationEnabled ? 1 : 0,
		);
		gl.uniform2f(
			program.distanceFade,
			policy.distanceFade.fullStrengthUntil,
			policy.distanceFade.disabledAt,
		);
		gl.activeTexture(gl.TEXTURE0 + SCENE_DEPTH_TEXTURE_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, sceneDepth);
	}

	#bindBlur(
		ambientOcclusion: WebGLTexture,
		depth: WebGLTexture,
		camera: WebGL2SaoCameraRange,
		policy: Extract<
			EffectiveAmbientOcclusionPolicy,
			{ readonly kind: "enabled" }
		>,
		directionX: number,
		directionY: number,
		blurPassOrdinal: SaoBlurPassOrdinal,
	): void {
		const gl = this.#gl;
		const program = this.#blurProgram;
		const tuning = policy.parameters;
		gl.useProgram(program.program);
		gl.uniform1f(program.cameraNear, camera.near);
		gl.uniform1f(program.cameraFar, camera.far);
		gl.uniform1f(
			program.bilateralDepthThreshold,
			tuning.bilateralDepthThreshold,
		);
		gl.uniform1f(
			program.neutralLinearDepthCutoff,
			saoBlurNeutralLinearDepthCutoff(
				policy.distanceFade.disabledAt,
				tuning.bilateralDepthThreshold,
				blurPassOrdinal,
			),
		);
		gl.uniform2i(program.blurDirection, directionX, directionY);
		gl.activeTexture(gl.TEXTURE0 + SAO_TEXTURE_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, ambientOcclusion);
		gl.activeTexture(gl.TEXTURE0 + SCENE_DEPTH_TEXTURE_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, depth);
	}

	#bindComposite(
		sceneFramebuffer: WebGLFramebuffer,
		sceneExtent: RenderExtent,
		ambientOcclusion: WebGLTexture,
	): void {
		const gl = this.#gl;
		const program = this.#compositeProgram;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sceneFramebuffer);
		gl.viewport(0, 0, sceneExtent.width, sceneExtent.height);
		gl.useProgram(program.program);
		gl.uniform2f(program.outputExtent, sceneExtent.width, sceneExtent.height);
		gl.uniform1i(
			program.coverageVisualization,
			this.#coverageVisualizationEnabled ? 1 : 0,
		);
		gl.activeTexture(gl.TEXTURE0 + SAO_TEXTURE_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, ambientOcclusion);
		gl.disable(gl.DEPTH_TEST);
		gl.depthMask(false);
		if (this.#coverageVisualizationEnabled) {
			gl.disable(gl.BLEND);
		} else {
			gl.enable(gl.BLEND);
			gl.blendEquation(gl.FUNC_ADD);
			gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
		}
	}

	#captureCoverageCensus(
		sceneDepth: WebGLTexture,
		sceneExtent: RenderExtent,
		camera: WebGL2SaoCameraRange,
		projection: Mat4,
		policy: Extract<
			EffectiveAmbientOcclusionPolicy,
			{ readonly kind: "enabled" }
		>,
	): WebGL2SaoCoverageCensus {
		const gl = this.#gl;
		const previousReadFramebuffer = gl.getParameter(
			gl.READ_FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null;
		const coverage = withPreservedWebGL2AllocationBindings(gl, () =>
			allocateScratchTarget(gl, sceneExtent, "coverage-census"),
		);
		let clearDepthPixelCount = 0;
		let distanceNeutralPixelCount = 0;
		let fadingPixelCount = 0;
		let fullStrengthPixelCount = 0;
		try {
			this.#prepareScratchDraw(coverage.framebuffer, sceneExtent);
			this.#bindEvaluation(
				sceneDepth,
				sceneExtent,
				camera,
				projection,
				policy,
				sceneExtent,
			);
			gl.drawArrays(gl.TRIANGLES, 0, FULLSCREEN_VERTEX_COUNT);
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, coverage.framebuffer);
			const labels = new Uint8Array(sceneExtent.width * sceneExtent.height);
			gl.readPixels(
				0,
				0,
				sceneExtent.width,
				sceneExtent.height,
				gl.RED,
				gl.UNSIGNED_BYTE,
				labels,
			);
			for (const label of labels) {
				if (label < 96) fullStrengthPixelCount += 1;
				else if (label < 160) fadingPixelCount += 1;
				else if (label < 224) distanceNeutralPixelCount += 1;
				else clearDepthPixelCount += 1;
			}
		} finally {
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousReadFramebuffer);
			gl.deleteFramebuffer(coverage.framebuffer);
			gl.deleteTexture(coverage.texture);
		}
		return {
			clearDepthPixelCount,
			distanceNeutralPixelCount,
			fadingPixelCount,
			fullStrengthPixelCount,
			opaqueDepthPixelCount:
				fullStrengthPixelCount + fadingPixelCount + distanceNeutralPixelCount,
		};
	}

	#prepareScratchDraw(
		framebuffer: WebGLFramebuffer,
		extent: RenderExtent,
	): void {
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
		gl.viewport(0, 0, extent.width, extent.height);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.colorMask(true, true, true, true);
		gl.depthMask(false);
	}

	#deletePrograms(): void {
		this.#gl.deleteProgram(this.#evaluationProgram.program);
		this.#gl.deleteProgram(this.#blurProgram.program);
		this.#gl.deleteProgram(this.#compositeProgram.program);
	}

	#assertAlive(): void {
		if (this.#destroyed) throw new Error("SAO pass has been destroyed.");
	}
}

/** Separable bilateral blur pass ordinal (`1` horizontal from raw AO, `2` vertical from Pass 1). */
export type SaoBlurPassOrdinal = 1 | 2;

const SAO_BLUR_CUTOFF_FLOAT32_GUARD = 1 + 16 * 2 ** -23;

/**
 * Minimum center linear depth at which every bilaterally admitted blur tap is guaranteed neutral.
 *
 * Raw evaluation outputs `1.0` once Euclidean view distance (at least linear depth) reaches
 * `distanceFadeEnd`. Pass 1 admits positive bilateral weight only when
 * `|sampleLinearDepth - centerLinearDepth| < threshold`, so Pass 1 is identically neutral beyond
 * `distanceFadeEnd + threshold`. Pass 2 samples Pass 1's `R8` output, extending the neutral
 * boundary by triangle inequality to `distanceFadeEnd + 2 * threshold`. The `float32` upward guard
 * ensures `gl.uniform1f` and `highp` GLSL arithmetic never round below the exact real threshold.
 */
export function saoBlurNeutralLinearDepthCutoff(
	distanceFadeEnd: number,
	bilateralDepthThreshold: number,
	blurPassOrdinal: SaoBlurPassOrdinal,
): number {
	if (!Number.isFinite(distanceFadeEnd) || distanceFadeEnd <= 0) {
		throw new Error(
			"SAO blur fade cutoff requires a positive finite distance.",
		);
	}
	if (
		!Number.isFinite(bilateralDepthThreshold) ||
		bilateralDepthThreshold <= 0
	) {
		throw new Error(
			"SAO blur fade cutoff requires a positive finite bilateral threshold.",
		);
	}
	if (blurPassOrdinal !== 1 && blurPassOrdinal !== 2) {
		throw new Error("SAO blur fade cutoff requires pass ordinal 1 or 2.");
	}
	return Math.fround(
		(distanceFadeEnd + blurPassOrdinal * bilateralDepthThreshold) *
			SAO_BLUR_CUTOFF_FLOAT32_GUARD,
	);
}

/** Exact bytes owned by the two resolution-scaled R8 textures. */
export function saoScratchByteLength(extent: RenderExtent): number {
	return saoScratchByteLengthFromDimensions(extent.width, extent.height);
}

function saoScratchByteLengthFromDimensions(
	width: number,
	height: number,
): number {
	const byteLength = width * height * R8_BYTES_PER_PIXEL * 2;
	if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
		throw new Error("SAO scratch byte length must be a positive safe integer.");
	}
	return byteLength;
}

/** Resolve a positive scratch extent from one source extent and linear scale. */
export function scaledSaoExtent(
	extent: RenderExtent,
	resolutionScale: number,
): RenderExtent {
	if (
		!Number.isSafeInteger(extent.width) ||
		!Number.isSafeInteger(extent.height) ||
		extent.width <= 0 ||
		extent.height <= 0 ||
		!Number.isFinite(resolutionScale) ||
		resolutionScale <= 0 ||
		resolutionScale > 1
	) {
		throw new Error(
			"SAO extent requires positive source dimensions and scale in (0, 1].",
		);
	}
	return {
		height: Math.max(1, Math.floor(extent.height * resolutionScale)),
		width: Math.max(1, Math.floor(extent.width * resolutionScale)),
	};
}

function allocateScratch(
	gl: WebGL2RenderingContext,
	extent: RenderExtent,
): SaoScratchTargetSet {
	const targets: SaoScratchTarget[] = [];
	try {
		targets.push(allocateScratchTarget(gl, extent, "first"));
		targets.push(allocateScratchTarget(gl, extent, "second"));
		return { extent: { ...extent }, first: targets[0]!, second: targets[1]! };
	} catch (cause) {
		for (const target of targets) {
			gl.deleteFramebuffer(target.framebuffer);
			gl.deleteTexture(target.texture);
		}
		throw cause;
	}
}

function allocateScratchTarget(
	gl: WebGL2RenderingContext,
	extent: RenderExtent,
	owner: string,
): SaoScratchTarget {
	const framebuffer = gl.createFramebuffer();
	if (!framebuffer)
		throw new Error(`Failed to allocate ${owner} SAO framebuffer.`);
	const texture = gl.createTexture();
	if (!texture) {
		gl.deleteFramebuffer(framebuffer);
		throw new Error(`Failed to allocate ${owner} SAO texture.`);
	}
	try {
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, extent.width, extent.height);
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			texture,
			0,
		);
		gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
		gl.readBuffer(gl.COLOR_ATTACHMENT0);
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		if (status !== gl.FRAMEBUFFER_COMPLETE) {
			throw new Error(
				`${owner} SAO framebuffer is incomplete with status ${status}.`,
			);
		}
		return { framebuffer, texture };
	} catch (cause) {
		gl.deleteFramebuffer(framebuffer);
		gl.deleteTexture(texture);
		throw cause;
	}
}

function disposeScratch(
	gl: WebGL2RenderingContext,
	scratch: SaoScratchTargetSet,
): void {
	for (const target of [scratch.first, scratch.second]) {
		gl.deleteFramebuffer(target.framebuffer);
		gl.deleteTexture(target.texture);
	}
}

function createEvaluationProgram(
	gl: WebGL2RenderingContext,
): SaoEvaluationProgram {
	const program = linkSaoProgram(
		gl,
		SAO_EVALUATION_FRAGMENT_SHADER,
		"evaluation",
	);
	try {
		configureSampler(
			gl,
			program.program,
			"uSceneDepth",
			SCENE_DEPTH_TEXTURE_UNIT,
		);
		gl.useProgram(program.program);
		const kernel = requireWebGL2Uniform(gl, program.program, "uKernel[0]");
		gl.uniform2fv(kernel, AMBIENT_OCCLUSION_SAMPLE_KERNEL);
		return {
			...program,
			outputExtent: requireWebGL2Uniform(gl, program.program, "uOutputExtent"),
			bias: requireWebGL2Uniform(gl, program.program, "uBias"),
			cameraFar: requireWebGL2Uniform(gl, program.program, "uCameraFar"),
			cameraNear: requireWebGL2Uniform(gl, program.program, "uCameraNear"),
			coverageVisualization: requireWebGL2Uniform(
				gl,
				program.program,
				"uCoverageVisualization",
			),
			distanceFade: requireWebGL2Uniform(gl, program.program, "uDistanceFade"),
			drawingBufferExtent: requireWebGL2Uniform(
				gl,
				program.program,
				"uDrawingBufferExtent",
			),
			intensity: requireWebGL2Uniform(gl, program.program, "uIntensity"),
			projectionScale: requireWebGL2Uniform(
				gl,
				program.program,
				"uProjectionScale",
			),
			sampleRadius: requireWebGL2Uniform(gl, program.program, "uSampleRadius"),
		};
	} catch (cause) {
		gl.deleteProgram(program.program);
		throw cause;
	}
}

function createBlurProgram(gl: WebGL2RenderingContext): SaoBlurProgram {
	const program = linkSaoProgram(
		gl,
		SAO_BLUR_FRAGMENT_SHADER,
		"bilateral blur",
	);
	try {
		configureSampler(
			gl,
			program.program,
			"uAmbientOcclusion",
			SAO_TEXTURE_UNIT,
		);
		configureSampler(
			gl,
			program.program,
			"uSceneDepth",
			SCENE_DEPTH_TEXTURE_UNIT,
		);
		return {
			...program,
			bilateralDepthThreshold: requireWebGL2Uniform(
				gl,
				program.program,
				"uBilateralDepthThreshold",
			),
			blurDirection: requireWebGL2Uniform(
				gl,
				program.program,
				"uBlurDirection",
			),
			cameraFar: requireWebGL2Uniform(gl, program.program, "uCameraFar"),
			cameraNear: requireWebGL2Uniform(gl, program.program, "uCameraNear"),
			neutralLinearDepthCutoff: requireWebGL2Uniform(
				gl,
				program.program,
				"uNeutralLinearDepthCutoff",
			),
		};
	} catch (cause) {
		gl.deleteProgram(program.program);
		throw cause;
	}
}

function createCompositeProgram(
	gl: WebGL2RenderingContext,
): SaoCompositeProgram {
	const program = linkSaoProgram(
		gl,
		SAO_COMPOSITE_FRAGMENT_SHADER,
		"composite",
	);
	try {
		configureSampler(
			gl,
			program.program,
			"uAmbientOcclusion",
			SAO_TEXTURE_UNIT,
		);
		return {
			...program,
			outputExtent: requireWebGL2Uniform(gl, program.program, "uOutputExtent"),
			coverageVisualization: requireWebGL2Uniform(
				gl,
				program.program,
				"uCoverageVisualization",
			),
		};
	} catch (cause) {
		gl.deleteProgram(program.program);
		throw cause;
	}
}

function linkSaoProgram(
	gl: WebGL2RenderingContext,
	fragmentSource: string,
	owner: string,
): SaoProgram {
	const program = linkWebGL2Program(
		gl,
		`SAO ${owner}`,
		FULLSCREEN_VERTEX_SHADER,
		fragmentSource,
	);
	return { program };
}

function configureSampler(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	name: string,
	textureUnit: number,
): void {
	gl.useProgram(program);
	gl.uniform1i(requireWebGL2Uniform(gl, program, name), textureUnit);
}
